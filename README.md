# SRU ReaScripts

Professional REAPER scripts for sound editing, sound-library metadata, annotation import, batch rendering, and wildlife-audio detection workflows.

## Install With ReaPack

1. Install [ReaPack](https://reapack.com/) for REAPER.
2. In REAPER, open **Extensions > ReaPack > Import repositories...**
3. Add this repository URL:

```text
https://raw.githubusercontent.com/SGMscripts/SRU/refs/heads/master/index.xml
```

4. Open **Extensions > ReaPack > Browse packages**.
5. Search for `SGM` or `Sruthin`, install the scripts you need, then run them from REAPER's Action List.

## Script Catalog

| Area | Script | Purpose | Requirements |
| --- | --- | --- | --- |
| Batch Render | `POLY Smart Batch Render IMGUI sruthin - Auto Cover Art.lua` | Folder-based POLY/stereo batch renders with cover art, UCS metadata, channel-layout patching, and child-media sample-rate matching. | ReaImGui, optional `bwfmetaedit` |
| SFX Detection | `SGM-Perch-BirdNET/SGM Perch and Birdnet Detect .lua` | ReaImGui front-end for Perch v2 and BirdNET detection workflows. | ReaImGui, Python helper files |
| Chirpity | `Chirpity/Chirpity analysis results to reaper regions SGM .lua` | Imports per-item annotation TXT files as REAPER regions. | REAPER |
| Chirpity | `Chirpity/Chirpity Audacity  to reaper  with insertion offset SGM for Single item .lua` | Imports annotation TXT files at the edit cursor as regions. | REAPER |
| Chirpity | `Chirpity/Copy Unique Marker Names in Time Selection to Clipboard SGM .lua` | Copies unique marker and region names from the time selection, sorted by frequency. | SWS Extension |
| Item Editing | `Item/Align Highest Transient (Smart Priority- Hovered Item > Selection SGM v2.lua` | Aligns hovered or selected item transients to the edit cursor with overlap handling. | REAPER |
| UCS | `Ucsify/Add meta Marker and rename smart SGM.lua` | Renames takes from UCS clipboard data and adds META markers. | SWS Extension |
| UCS | `Ucsify/Meta markers for selected items from ucsify csv SGM.lua` | Creates META markers from UCS CSV rows matching selected item BWF ranges. | SWS Extension |
| UCS | `Ucsify/inject metaddata fileds SGM.lua` | Pre-populates project render metadata fields for UCS/ASWG workflows. | REAPER 6.33+ recommended |

## Repository Layout

```text
.
|-- Chirpity/             Annotation import and marker utility scripts
|-- Item/                 Item editing utilities
|-- SGM-Perch-BirdNET/    Detection UI script and Python helper files
|-- Ucsify/               UCS metadata and META marker tools
|-- index.xml             ReaPack package index
`-- .github/workflows/    ReaPack validation and index deployment
```

## Development Notes

- Keep every installable script as a standalone `.lua` file with ReaPack metadata at the top.
- Bump the `@version` field when changing script behavior.
- Run `luac -p path/to/script.lua` before release when possible.
- GitHub Actions run `reapack-index --check` on pushes and pull requests.
- The `deploy` workflow updates `index.xml` after changes land on `master`.

## Support

Open an issue with the script name, REAPER version, operating system, installed extensions, and a short description of what happened. Screenshots or a small test project are helpful when the issue depends on project routing or metadata.
