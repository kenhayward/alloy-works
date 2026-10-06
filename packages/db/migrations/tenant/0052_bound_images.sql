-- Bound images (the B6 plan, "The stored-shape check"; DAT-097): a take of an image column answers
-- the image's hash, its description and its column, or `image_description_missing` naming the
-- description's column. `dataset_take`'s outcome check is widened to both, and nothing else changes.
alter table dataset_take drop constraint dataset_take_outcome;

alter table dataset_take add constraint dataset_take_outcome check (
  jsonb_typeof(outcome) = 'object'
  and (
    (
      outcome ?& array['value', 'column']
      and outcome - 'value' - 'column' = '{}'::jsonb
      and jsonb_typeof(outcome -> 'value') in ('string', 'boolean')
      and jsonb_typeof(outcome -> 'column') = 'object'
      and (outcome -> 'column') ?& array['name', 'type']
      and (outcome -> 'column') - 'name' - 'type' = '{}'::jsonb
      and jsonb_typeof(outcome -> 'column' -> 'name') = 'string'
      and (outcome -> 'column' ->> 'name') <> ''
      and jsonb_typeof(outcome -> 'column' -> 'type') = 'object'
      and (outcome -> 'column' -> 'type') ? 'base'
      and jsonb_typeof(outcome -> 'column' -> 'type' -> 'base') = 'string'
      and (outcome -> 'column' -> 'type' ->> 'base') in
        ('text', 'integer', 'decimal', 'date', 'time', 'localDateTime', 'instant', 'boolean')
    )
    or (
      -- An image (B6-D): exactly its hash, its description - a text of at least one character, or
      -- `decorative` - and its column, an image column by name. Whether the description agrees with
      -- the column's type is the writer's (`takeOutcomeSchema`, `recordTake`), as a value's
      -- canonical form is.
      outcome ?& array['image', 'description', 'column']
      and outcome - 'image' - 'description' - 'column' = '{}'::jsonb
      and jsonb_typeof(outcome -> 'image') = 'string'
      and (outcome ->> 'image') ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(outcome -> 'description') = 'string'
      and (outcome ->> 'description') <> ''
      and jsonb_typeof(outcome -> 'column') = 'object'
      and (outcome -> 'column') ?& array['name', 'type']
      and (outcome -> 'column') - 'name' - 'type' = '{}'::jsonb
      and jsonb_typeof(outcome -> 'column' -> 'name') = 'string'
      and (outcome -> 'column' ->> 'name') <> ''
      and jsonb_typeof(outcome -> 'column' -> 'type') = 'object'
      and (outcome -> 'column' -> 'type' ->> 'base') = 'image'
    )
    or (
      outcome ? 'failure'
      and outcome - 'failure' - 'count' - 'column' = '{}'::jsonb
      and jsonb_typeof(outcome -> 'failure') = 'string'
      and outcome ->> 'failure' in (
        'take_invalid', 'value_none', 'value_many', 'row_missing', 'value_null', 'value_empty',
        'image_description_missing'
      )
      and (outcome ->> 'failure' = 'value_many') = (outcome ? 'count')
      and (
        not (outcome ? 'count')
        or case
          when jsonb_typeof(outcome -> 'count') = 'number'
            and (outcome ->> 'count') ~ '^[0-9]{1,16}$'
          then (outcome ->> 'count')::numeric between 2 and 9007199254740991
          else false
        end
      )
      and (outcome ->> 'failure' in ('take_invalid', 'image_description_missing')) = (outcome ? 'column')
      and (
        not (outcome ? 'column')
        or (jsonb_typeof(outcome -> 'column') = 'string' and (outcome ->> 'column') <> '')
      )
    )
  )
);

-- Every take that failed `take_invalid`: an image take answered it before B6 (D8-H), and answers an
-- image now. Derived data, a function of an immutable version and a take, so a row deleted is taken
-- again on its next read (BI-G) and nothing is lost.
delete from dataset_take where outcome ->> 'failure' = 'take_invalid';
