-- Two starting roles that use connections (docs/design/data.md, "Permissions"): Query builder builds
-- queries without SQL (the D4 plan, D4-J), and Query writer writes SQL too. Until now no starting role
-- held use_connection or write_sql, and roles cannot yet be made in the app, so nobody could be granted
-- either. No default grant names them: an administrator still grants them on purpose.
--
-- A tenant that already holds a role of either name keeps its own, whatever it holds, as 0017 does for
-- Publisher. Development's seed makes a Query builder of read and use_connection, which keeps its row
-- and the grants naming it; one changed since to hold something else is left as it is.
insert into role (name, permissions) values
  ('Query builder', array['read', 'use_connection']),
  ('Query writer', array['read', 'use_connection', 'write_sql'])
  on conflict (name) do nothing;
