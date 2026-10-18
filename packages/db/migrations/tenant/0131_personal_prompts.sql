-- Personal prompts (GEN-054, GEN-055; the G5 plan, G5-G): a person's own saved words, read and run by
-- them alone, never an artifact, so never bound by a template nor listed to anybody else. Promotion
-- copies one into a space as a new prompt, which the row records; erasing its owner deletes it.

create table personal_prompt (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references principal on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  instructions text not null check (char_length(instructions) between 1 and 20000),
  made_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  -- The prompt it became, once promoted: a copy, which goes its own way from then on.
  promoted_to uuid,
  promoted_kind text check (promoted_kind is null or promoted_kind = 'prompt'),
  promoted_at timestamptz,
  check ((promoted_to is null) = (promoted_kind is null) and (promoted_to is null) = (promoted_at is null)),
  foreign key (promoted_to, promoted_kind) references artifact (id, kind) on delete restrict
);
create index personal_prompt_owner on personal_prompt (owner, changed_at desc);
