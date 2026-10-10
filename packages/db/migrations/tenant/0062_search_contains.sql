-- Search finds a part of a word too (UI6): every term typed, in any case, as a part of an entry's
-- text, beside the words its language reads. `ilike '%term%'` over `body` is answered by a trigram
-- index; pg_trgm is the database's, created in `extensions` by `prepareDatabase` as pgvector is.
create index search_entry_body_trigrams on search_entry using gin (body extensions.gin_trgm_ops);
