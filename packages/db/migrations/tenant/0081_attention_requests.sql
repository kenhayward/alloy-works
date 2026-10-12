-- What waits on a person (the HM plan, HM-B): their latest publish of each document, found by one
-- indexed read rather than every request of theirs. `id` breaks a tie, as the read does.
create index publication_request_attention
  on publication_request (requested_by, document_id, requested_at desc, made_tx desc, id desc)
  where kind = 'publish';
