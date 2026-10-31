-- Vocabularies published (vocabularies.md; the VO plan, VO-H): the vocabulary versions whose labels a
-- publish prints are recorded as its terms are (0154), rows of the request and of the publication of
-- their own kind, so 0022's and 0073's checks hold a publication to its request and a baseline's
-- request to its pins with vocabularies among them. A baseline pins them as it pins terms, with no
-- node (LIB-004).

set constraints all immediate;

alter table publication_request_asset drop constraint publication_request_asset_asset_kind_check;
alter table publication_request_asset add constraint publication_request_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry', 'term', 'vocabulary'));

alter table publication_asset drop constraint publication_asset_asset_kind_check;
alter table publication_asset add constraint publication_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry', 'term', 'vocabulary'));

alter table baseline_pin drop constraint baseline_pin_kind;
alter table baseline_pin add constraint baseline_pin_kind check (
  (node is not null and kind = 'component')
  or (node is null and kind in ('asset', 'bibliographyEntry', 'term', 'vocabulary'))
);
