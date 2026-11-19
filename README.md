# PlayOutPs5Pkg

PlayOut's PS5 package helper: a small console program that unpacks **fake/debug PS5 packages (FPKG)** into game
folders with [PS5PKGTool](https://github.com/pearlxcore/PS5PKGTool)'s own extraction
(`PS5PKGTool.Core.Services.SonyPackageExtraction`), so the folder holds exactly what PS5PKGTool's Extract writes: the
game's files plus the package's `sce_sys` metadata (`param.json`, artwork, trophies…).

PS5PKGTool only has a GUI; this helper runs the same code from the command line for PlayOut (Settings › Convert ›
PlayStation 5 › PKG → Game Folder). It is a separate program under the GPL-3.0, like PS5PKGTool.

- **Fake/debug packages only.** Retail packages are locked with Sony's keys and are refused before anything is
  written. Update (patch) packages are refused too (they need their base package). The passcode is PS5PKGTool's
  default (32 zeros) unless `--passcode` gives another.
- Nothing proprietary ships: PS5PKGTool's GUI carries `oo2core_9_win64.dll` (Oodle), `libScePubTools.dll` and
  LibProsperoPkg for other features; the helper builds only `PS5PKGTool.Core` and its own projects and decodes with
  the managed engine, ProsperoPkgTool (MIT), which `build.mjs` compiles from source **without** its embedded
  package-building files (`Keys\*.bin`, `Resources\right.sprx`: only needed to build packages). `build.mjs` deletes
  the other binaries from `vendor/` and scans the published files (names and embedded resources) before making the
  single exe, and stops if any of them is there.

## Commands

```
PlayOutPs5Pkg info    <package.pkg>
PlayOutPs5Pkg extract <package.pkg> <outDir> [--passcode <32 characters>]
PlayOutPs5Pkg --version | --help
```

Each stdout line is one JSON object (everything else goes to stderr):

- `info`: `{"type":"done","kind":"fpkg|retail|patch|metadata|unknown","unpackable":true|false,"contentId":"…","contentType":…,"size":…}`.
- `extract`: `{"type":"progress","phase":"reading",…}` while the package image is decrypted and decompressed
  (this step reports nothing and cannot be cancelled: stop the process), then
  `{"type":"progress","done":<bytes>,"total":<bytes>,"percent":<0-100>,"path":"…"}` at most 4 times a second, then
  `{"type":"done","dest":"…","files":<n>,"bytes":<n>,"seconds":<s>}`.
  `outDir` must not exist: the files go to a staging folder beside it (`<outDir>.extracting.<id>`) that is moved into
  place only when every file is written, and deleted on a failure.
- Errors: `{"type":"error","code":"retail|patch|notPs5|unsupported|exists|passcode|missing|failed","message":"…"}`,
  exit code 1 (2 for wrong arguments).

Memory: packages whose image is under 2 GiB are decoded in memory (about their compressed plus unpacked size).

## Build

Needs git and the .NET 10 SDK: `node build.mjs` (or `DOTNET_EXE=<path to dotnet.exe> node build.mjs`). It fetches
PS5PKGTool and ProsperoPkgTool at the commits pinned in `build.mjs` into `vendor/`, rebuilds ProsperoPkgTool without
its embedded package-building files, checks a plain publish for anything that must not ship, publishes one
self-contained `PlayOutPs5Pkg.exe` into `dist/`, and adds the licence texts.

Source: https://github.com/jeremybris/PlayOut-PS5PKG

## Licence

GPL-3.0-or-later (`LICENSE`). PS5PKGTool © pearlxcore, GPL-3.0 (its `PS5PKGTool.Ufs2` is based on UFS2Tool © SvenGDK,
BSD-2-Clause); ProsperoPkgTool © pearlxcore, MIT. `dist/LICENSES-THIRD-PARTY.txt` holds every licence and notice text of
what is inside the exe (also the NuGet libraries and the .NET runtime).
