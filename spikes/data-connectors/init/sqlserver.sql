-- SQL Server 2022 Developer: the second relational source, with a different identity model. Security
-- policy + SESSION_CONTEXT so asserted identity shows Ada and Grace different rows (cases 3-4). Run
-- by the init one-shot after the server is healthy. All credentials are invented fake dev values.
IF DB_ID('sourcedb') IS NULL CREATE DATABASE sourcedb;
GO
USE sourcedb;
GO
IF OBJECT_ID('dbo.record') IS NOT NULL DROP TABLE dbo.record;
GO
CREATE TABLE dbo.record (
  id INT PRIMARY KEY,
  owner NVARCHAR(50) NOT NULL,
  amount DECIMAL(28,2) NOT NULL,
  label NVARCHAR(50) NOT NULL
);
INSERT INTO dbo.record VALUES
  (1, N'ada', 100.00, N'alpha'),
  (2, N'grace', 250.50, N'beta'),
  (3, N'ada', 12.34, N'gamma');
GO
CREATE TABLE dbo.probe (one INT);
INSERT INTO dbo.probe VALUES (1);
GO
-- Security policy reads SESSION_CONTEXT('app_user') that the connection sets per user (asserted id).
CREATE FUNCTION dbo.fn_record_predicate(@owner NVARCHAR(50))
RETURNS TABLE WITH SCHEMABINDING AS
RETURN SELECT 1 AS ok WHERE @owner = CAST(SESSION_CONTEXT(N'app_user') AS NVARCHAR(50));
GO
CREATE SECURITY POLICY dbo.record_policy
  ADD FILTER PREDICATE dbo.fn_record_predicate(owner) ON dbo.record
  WITH (STATE = ON);
GO
