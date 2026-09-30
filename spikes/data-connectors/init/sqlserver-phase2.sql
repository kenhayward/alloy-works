-- Phase 2 (cases 3 and 4) additions to the SQL Server source. Load after sqlserver.sql with the same
-- sqlcmd line (see README). Invented values only.
--
-- A least-privileged connection account, `connector_login`, instead of `sa`: it may read dbo.record
-- (whose security policy filters on SESSION_CONTEXT('app_user')), and may IMPERSONATE the database users
-- ada and grace, who exist WITHOUT LOGIN - they cannot sign in, only be asserted.
USE sourcedb;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'connector_login')
  CREATE LOGIN connector_login WITH PASSWORD = N'Spike-Connector-Fake-Pw1', CHECK_POLICY = OFF, DEFAULT_DATABASE = sourcedb;
GO
IF USER_ID(N'connector_login') IS NULL CREATE USER connector_login FOR LOGIN connector_login;
IF USER_ID(N'ada') IS NULL CREATE USER ada WITHOUT LOGIN;
IF USER_ID(N'grace') IS NULL CREATE USER grace WITHOUT LOGIN;
GO
GRANT SELECT ON dbo.record TO connector_login;
GRANT SELECT ON dbo.probe TO connector_login;
GRANT IMPERSONATE ON USER::ada TO connector_login;
GRANT IMPERSONATE ON USER::grace TO connector_login;
GO
-- The EXECUTE AS form: a table whose policy filters on USER_NAME(), readable by ada and grace only.
IF OBJECT_ID('dbo.record_eu') IS NOT NULL DROP SECURITY POLICY IF EXISTS dbo.record_eu_policy;
IF OBJECT_ID('dbo.record_eu') IS NOT NULL DROP TABLE dbo.record_eu;
GO
CREATE TABLE dbo.record_eu (
  id INT PRIMARY KEY,
  owner NVARCHAR(50) NOT NULL,
  amount DECIMAL(28,2) NOT NULL,
  label NVARCHAR(50) NOT NULL
);
INSERT INTO dbo.record_eu VALUES (1, N'ada', 100.00, N'alpha'), (2, N'grace', 250.50, N'beta'), (3, N'ada', 12.34, N'gamma');
GO
CREATE FUNCTION dbo.fn_record_eu_predicate(@owner NVARCHAR(50))
RETURNS TABLE WITH SCHEMABINDING AS
RETURN SELECT 1 AS ok WHERE @owner = USER_NAME();
GO
CREATE SECURITY POLICY dbo.record_eu_policy
  ADD FILTER PREDICATE dbo.fn_record_eu_predicate(owner) ON dbo.record_eu
  WITH (STATE = ON);
GO
GRANT SELECT ON dbo.record_eu TO ada;
GRANT SELECT ON dbo.record_eu TO grace;
GO
