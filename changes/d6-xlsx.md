### Added

- **XLSX.** A file or an API's answer can be a workbook, read from one sheet by its name, each column by its header or its letter. Numbers are read exactly as the workbook stores them, and dates and times from the workbook's own date system; a date that never existed, an error cell, a formula saved without its value or a time finer than the workbook can hold is refused by name, never rounded.
- **Hostile files refused.** A workbook that expands past its limit, holds thousands of parts, disagrees with itself about its parts or declares entities is refused, as is JSON nested too deep; one table read from a database, JSON, JSON Lines, CSV or a workbook, over an API or from a bucket, gives one checksum.
