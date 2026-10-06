-- Which documents hold a dataset's image (the D8 plan, D8-I; the B6 plan, "Risks"), asked once for
-- every read of such an image's bytes or its metadata, so once per bound image a page draws. Read
-- from the asset's own versions to the dataset versions naming one, by this index on the asset
-- versions each dataset version's `images` names, and on to the resolutions holding those - in
-- place of a walk of every binding's latest resolution. Measured in B6.2 on 50,000 resolutions and
-- 10,000 dataset versions of four images each: 357 ms a read before, 4 ms after.
--
-- The deferred check fired first and set back after, as 0016 explains: on a tenant provisioned now
-- an earlier migration's insert has left a pending trigger event on artifact_version, and Postgres
-- indexes no table that has one (55006).
set constraints artifact_version_component_type_recorded immediate;
create index artifact_version_dataset_images
  on artifact_version using gin (jsonb_path_query_array(content -> 'images', '$.*'))
  where kind = 'dataset';
set constraints artifact_version_component_type_recorded deferred;
