### Added

- **Image limits.** Administration's Images lowers the largest PNG or JPEG an upload may be.
- **Thumbnails and previews.** Each image's are made when it is uploaded, and an administrator may discard a space's to be made again.
- **Metadata left out of outputs.** A published image carries no EXIF, GPS, XMP, IPTC or content credentials, and the publication records what was removed.

### Changed

- **Images checked on every read.** A stored image whose bytes no longer match their hash is never sent.
