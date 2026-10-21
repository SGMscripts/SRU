# Changelog

All notable repository-level changes are tracked here. Individual ReaPack package changes should also be reflected in each script's `@version` and `@changelog` metadata.

## Unreleased

- Fixed POLY Smart Batch Render v3.4 truncating multichannel source items to stereo; preserve source channel count and route all channels in order.

- Updated POLY Smart Batch Render to v3.3 with a project-saved render queue, per-job output folders and filename patterns, and batch cancellation when a render is cancelled.

- Updated the POLY Smart Batch Render UI to hide advanced ChannelLayout/URL metadata toggles while keeping those writes enabled.
- Added `Item/Create Folder Signal Region Item or Stretch Image SGM.lua`.
- Moved the POLY Smart Batch Render script into the `Batch Render/` folder.
- Reworked the README with ReaPack installation steps, a script catalog, repository layout, and support notes.
- Added contributor guidance and repository hygiene files.
- Ignored bundled Perch/BirdNET helper files from ReaPack package validation.
- Fixed the truncated Chirpity per-item annotation importer so it parses and runs again.
- Cleaned up one script author metadata field.
