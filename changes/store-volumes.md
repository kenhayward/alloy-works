### Fixed

- **Uploads on a development stack short of disk.** The object store sized its volumes from free disk, so with little left every upload answered 500. It now counts them.
