-- What an image is held to on its way in and on its way out (assets.md; the AL plan, AL-G, AL-H, AL-I).

-- The most bytes an image of each format may be in this environment (AST-004): null for the format's
-- own limit, `ADMITTED_FORMATS` in the domain, which this repeats; lowered, never raised.
alter table images_policy
  add column limits jsonb not null default '{"png": null, "jpeg": null}'::jsonb,
  add constraint images_policy_limits check (
    jsonb_typeof(limits) = 'object'
    and limits ? 'png' and limits ? 'jpeg' and limits - 'png' - 'jpeg' = '{}'::jsonb
    and (jsonb_typeof(limits -> 'png') = 'null'
      or (jsonb_typeof(limits -> 'png') = 'number' and (limits ->> 'png')::numeric between 1024 and 25000000
        and (limits ->> 'png')::numeric = trunc((limits ->> 'png')::numeric)))
    and (jsonb_typeof(limits -> 'jpeg') = 'null'
      or (jsonb_typeof(limits -> 'jpeg') = 'number' and (limits ->> 'jpeg')::numeric between 1024 and 25000000
        and (limits ->> 'jpeg')::numeric = trunc((limits ->> 'jpeg')::numeric)))
  );

do $$
begin
  execute format('grant update (limits) on images_policy to %I', current_schema());
end
$$;
