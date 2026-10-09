### Fixed

- **A repeated key is named as one.** A sample whose rows share a key now says which row repeats it and to choose a key that is unique, rather than blaming the order and suggesting SQL a file cannot have.
- **Where an S3 file is.** A query definition on an S3 bucket asks where the file is in the bucket, a folder or the file name per segment, and shows the path it will read.
