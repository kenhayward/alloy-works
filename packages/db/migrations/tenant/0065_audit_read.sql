-- The audit log read and exported by its filters (audit.md, "Reading and export"; the AU2 plan, AU-M):
-- each filter an index ending in the sequence, so a page of one actor's, kind's, subject's or space's
-- events is read newest first from its index; a kind's family is a range of the first.
create index audit_event_kind on audit_event (kind, sequence);
create index audit_event_actor on audit_event (actor, sequence);
create index audit_event_subject on audit_event (subject, sequence);
create index audit_event_space on audit_event (space, sequence);
create index audit_event_at on audit_event (at);
