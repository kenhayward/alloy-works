-- Citations published (citations.md; the CI plan, CIc). The entry versions a publish reads are recorded
-- as its images are: rows of the request and of the publication beside 0022's, of their own kind, so
-- 0022's and 0073's checks hold a publication to its request and a baseline's request to its pins with
-- entries among them, and an entry version a publication or a baseline read is never deleted. A
-- baseline pins them as it pins images, with no node. And a publication records the citation style
-- version its theme named, where it printed a citation, as it records its theme's.

alter table publication_request_asset drop constraint publication_request_asset_asset_kind_check;
alter table publication_request_asset add constraint publication_request_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry'));

alter table publication_asset drop constraint publication_asset_asset_kind_check;
alter table publication_asset add constraint publication_asset_asset_kind_check
  check (asset_kind in ('asset', 'bibliographyEntry'));

alter table baseline_pin drop constraint baseline_pin_kind;
alter table baseline_pin add constraint baseline_pin_kind check (
  (node is not null and kind = 'component')
  or (node is null and kind in ('asset', 'bibliographyEntry'))
);

alter table publication
  add column citation_style_id uuid,
  add column citation_style_version_id uuid,
  add column citation_style_kind text not null default 'citationStyle'
    check (citation_style_kind = 'citationStyle'),
  add constraint publication_citation_style_whole
    check ((citation_style_id is null) = (citation_style_version_id is null)),
  add foreign key (citation_style_version_id, citation_style_id, citation_style_kind)
    references artifact_version (id, artifact_id, kind) on delete restrict;
