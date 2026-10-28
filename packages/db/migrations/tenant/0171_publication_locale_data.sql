-- The locale data a publication was made with (docs/design/interface-localisation.md; the TE plan,
-- TE-F; LOC-044): the worker's ICU, Unicode and CLDR versions, beside its engine's (PUB-050). Null on
-- one made before this, which recorded none.

alter table publication add column locale_data jsonb
  constraint publication_locale_data_object check (
    locale_data is null or jsonb_typeof(locale_data) = 'object'
  );

do $$
begin
  execute format('grant insert (locale_data) on publication to %I', current_schema());
end
$$;
