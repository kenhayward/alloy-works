-- A connection test's second finding (the D7 plan, D7-D; DAT-112): on a connection that asserts a
-- person's identity, an account that may read data of its own, `account_holds_privilege`. Every
-- stored test's findings are a subset of the wider set, so nothing stored is refused.
alter table connection_test drop constraint connection_test_findings;
alter table connection_test add constraint connection_test_findings check (
  findings <@ array['account_not_read_only', 'account_holds_privilege']::text[]
  and (array_ndims(findings) = 1 or findings = '{}')
  and connection_test_findings_distinct(findings)
);
