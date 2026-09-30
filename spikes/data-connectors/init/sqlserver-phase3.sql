-- Phase 3 (cases 5, 6 and 7) additions to the SQL Server source. Loaded by load-sqlserver.sh after
-- sqlserver.sql and sqlserver-phase2.sql. Invented values only.
USE sourcedb;
GO
IF OBJECT_ID('dbo.param_probe') IS NOT NULL DROP TABLE dbo.param_probe;
CREATE TABLE dbo.param_probe (
  id INT PRIMARY KEY,
  label NVARCHAR(100) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  day DATE NOT NULL,
  at DATETIMEOFFSET(6) NOT NULL,
  active BIT NOT NULL,
  region NVARCHAR(20) NOT NULL
);
INSERT INTO dbo.param_probe VALUES
  (1, N'alpha',        100.00, '2026-01-10', '2026-01-10T09:00:00Z', 1, N'north'),
  (2, N'beta',         250.50, '2026-02-20', '2026-02-20T12:30:00Z', 0, N'south'),
  (3, N'gamma',         12.34, '2026-03-30', '2026-03-30T18:45:00Z', 1, N'north'),
  (4, N'100% organic',   7.00, '2026-04-01', '2026-04-01T00:00:00Z', 1, N'east'),
  (5, N'under_score',    0.01, '2026-05-05', '2026-05-05T05:05:05Z', 0, N'west'),
  (6, N'O''Brien',      99.99, '2026-06-06', '2026-06-06T06:06:06Z', 1, N'south');
GRANT SELECT ON dbo.param_probe TO connector_login;
GO
-- A table type, for a list bound as a table-valued parameter.
IF TYPE_ID(N'dbo.IntList') IS NULL CREATE TYPE dbo.IntList AS TABLE (v INT NOT NULL);
GO
GRANT EXECUTE ON TYPE::dbo.IntList TO connector_login;
GO
IF OBJECT_ID('dbo.typed_result') IS NOT NULL DROP TABLE dbo.typed_result;
CREATE TABLE dbo.typed_result (
  k INT PRIMARY KEY,
  dec DECIMAL(28,10) NULL,
  big BIGINT NULL,
  amount DECIMAL(19,4) NULL,
  d DATE NULL,
  ldt DATETIME2(6) NULL,
  inst DATETIMEOFFSET(6) NULL,
  tm TIME(6) NULL,
  flag BIT NULL,
  note NVARCHAR(50) NULL,
  empty NVARCHAR(50) NULL,
  txt NVARCHAR(100) NULL
);
INSERT INTO dbo.typed_result VALUES
  (1, 123456789012345678.1234567891, 9223372036854775807, 1234.5600, '2026-03-29',
      '2026-03-29T01:30:00.123456', '2026-03-29T01:30:00.123456+01:00', '23:59:59.999999',
      1, NULL, N'', NCHAR(0x0391) + NCHAR(0x03B8) + NCHAR(0x03AE) + NCHAR(0x03BD) + NCHAR(0x03B1) + N' ' + NCHAR(0x6771) + NCHAR(0x4EAC) + N' ' + NCHAR(0xD842) + NCHAR(0xDFB7)),
  (2, -0.0000000001, -9223372036854775808, 922337203685477.5807, '1900-03-01',
      '1900-03-01T00:00:00', '1969-12-31T23:59:59.999999Z', '00:00:00',
      0, N'x', N'', N'caf' + NCHAR(0x00E9)),
  (3, 0, 9007199254740993, 0.1000, '2000-02-29',
      '2026-10-25T01:30:00', '2026-10-25T00:30:00Z', '12:00:00.5',
      NULL, N'', NULL, N'cafe' + NCHAR(0x0301));
GRANT SELECT ON dbo.typed_result TO connector_login;
GO
IF OBJECT_ID('dbo.unordered') IS NOT NULL DROP TABLE dbo.unordered;
CREATE TABLE dbo.unordered (id INT PRIMARY KEY NONCLUSTERED, category NVARCHAR(5) NOT NULL, v INT NOT NULL);
INSERT INTO dbo.unordered SELECT value, CASE WHEN value % 3 = 0 THEN N'a' WHEN value % 3 = 1 THEN N'b' ELSE N'c' END, value * 10
  FROM GENERATE_SERIES(1, 30);
GRANT SELECT, UPDATE, DELETE, INSERT ON dbo.unordered TO connector_login;
GO
IF OBJECT_ID('dbo.many') IS NOT NULL DROP TABLE dbo.many;
CREATE TABLE dbo.many (id INT PRIMARY KEY, payload NVARCHAR(200) NOT NULL);
INSERT INTO dbo.many SELECT value, REPLICATE(N'x', 100) FROM GENERATE_SERIES(1, 200000);
GRANT SELECT ON dbo.many TO connector_login;
GO
