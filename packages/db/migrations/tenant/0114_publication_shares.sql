-- Publication shares (PUB-057, PUB-084; the R17 plan, R17-B): a share is an ordinary grant at the
-- publication, through one fixed role, read alone. Fixed: no change or removal, by any path, so a
-- tenant widening a role never widens a share.

set constraints all immediate;

alter table role add column fixed boolean not null default false;

create unique index role_one_fixed on role (fixed) where fixed;

-- Named so, unless the tenant has a role of that name already.
insert into role (name, permissions, fixed)
select case when exists (select 1 from role where name = 'Shared reader')
    then 'Shared reader (shares)' else 'Shared reader' end,
  array['read'], true;

create function role_fixed() returns trigger
language plpgsql as $$
begin
  if old.fixed then
    raise exception 'role: % is fixed', old.name;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.fixed then
    raise exception 'role: only the shared reader is fixed';
  end if;
  return new;
end
$$;

create trigger role_fixed before update or delete on role
  for each row execute function role_fixed();
