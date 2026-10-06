### Added

- **S3 bucket connections.** A connection can reach an S3 bucket on AWS or any store that signs as it does: its endpoint, region, bucket and whether it is addressed by name or by path, with a static access key pair set on its page and never shown again. The store's own policy for the key decides what it may read.
- **Query definitions over a file.** A definition on an S3 connection reads one object by a key whose segments are fixed or a parameter placed whole. Its rows are read as JSON, JSON Lines or CSV, filtered by typed comparisons of its columns and put in the declared order, and **Sample for columns** proposes each column by its header, letter or pointer.
- **CSV.** A file or an API's answer can be CSV, with its delimiter, whether its first record names the fields, and whether an empty field is empty or empty text; a quoted empty field is always text.
