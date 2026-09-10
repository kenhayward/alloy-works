# Brand assets

The vector masters for the Alloy Works mark. **These files are the source of truth** - every icon
in `apps/web/public` and `apps/desktop` was rendered from them. If a size is missing, re-render it
from the SVG rather than upscaling a PNG.

Nothing here is loaded at runtime. It is an archive, kept in the repo so a new size never depends
on finding the original handoff.

## The mark

An isometric cube drawn as a wireframe: three seams run from three coloured terminal nodes into one
graphite node at the centre - three inputs, one fused output. The hexagonal silhouette is what
carries recognition at 16px; the seams carry the meaning at large sizes.

| Seam        | Colour    | Represents           |
| ----------- | --------- | -------------------- |
| Upper-left  | `#2E6F9E` | Data                 |
| Upper-right | `#C4753C` | Human narrative      |
| Lower       | `#6E5FC0` | AI-generated content |

Rules that are easy to break by accident:

- **The centre node is always larger than the terminals** (r 5.4 vs 3.6). It is the fused output,
  not a fourth input. Never equalise them.
- Terminal nodes take their own seam's colour; the frame and centre node are always graphite, or
  the light ink on dark grounds.
- Nothing extends beyond the hexagon.
- The faces are never filled.

## Files

| File                       | Size   | Use                                                                  |
| -------------------------- | ------ | -------------------------------------------------------------------- |
| `svg/mark-light.svg`       | 64     | Primary mark, light grounds. Everything web is rendered from this    |
| `svg/mark-dark.svg`        | 64     | Light ink on dark grounds - frame and centre node only are swapped   |
| `svg/mark-small-light.svg` | 64     | Heavier strokes for rendering at 32px and below                      |
| `svg/mark-small-dark.svg`  | 64     | Ditto, dark grounds                                                  |
| `svg/mark-mono-black.svg`  | 64     | One colour - tray, menu bar template, stencil                        |
| `svg/mark-mono-white.svg`  | 64     | One colour, white                                                    |
| `svg/macos-tile-light.svg` | 1024   | Mark inset on a `#F2F0EB` squircle - the macOS app icon              |
| `svg/macos-tile-dark.svg`  | 1024   | Same on `#12161B`                                                    |
| `svg/lockup-light.svg`     | 286x64 | Mark plus wordmark                                                   |
| `ico/alloy-mark.ico`       | multi  | 16/24/32/48/64/128/256, the source for both favicon and Windows icon |

**At 32px and below use the `-small-` variants.** At those sizes the 5-unit stroke falls below 1.5
device pixels and greys out; the small variants carry stroke-width 6.5 and larger nodes. The ICO's
small frames were rendered from them.

## Design tokens

| Token              | Hex       | Use                                       |
| ------------------ | --------- | ----------------------------------------- |
| `--ink`            | `#12161B` | Frame, centre node, headings              |
| `--ink-inverse`    | `#EDEBE6` | Frame and centre node on dark grounds     |
| `--data`           | `#2E6F9E` | Data seam and terminal                    |
| `--narrative`      | `#C4753C` | Human-narrative seam and terminal         |
| `--ai`             | `#6E5FC0` | AI seam and terminal                      |
| `--paper`          | `#F2F0EB` | macOS tile ground, web light theme colour |
| `--surface`        | `#F7F6F3` | Card and panel ground                     |
| `--border`         | `#D7D4CD` | Hairline borders                          |
| `--text-secondary` | `#6D7178` | "Works" in the wordmark, meta text        |
| `--text-body`      | `#4A5057` | Body copy                                 |

The app has no stylesheet yet, so these live here rather than in code. When there is one, they move
into it and this table becomes a pointer.

## Re-rendering

The derived files were produced with [sharp](https://sharp.pixelplumbing.com). No dependency on it
is committed - it is a one-off tool, run through `pnpm dlx`:

```bash
pnpm dlx sharp-cli -i assets/brand/svg/mark-light.svg -o apps/web/public/icon-512.png resize 512 512
```

Sizes that are not a plain resize:

- **`apple-touch-icon.png`** (180) - iOS ignores transparency and applies its own mask, so the mark
  is rendered at 130px, centred on an opaque `#F2F0EB` ground, and padded to 180.
- **`icon-maskable-512.png`** - Android may crop to a circle of 80% diameter, so the mark is
  rendered at 307px (60%) on an opaque ground. Anything in the outer 20% has to be expendable.
- **`apps/desktop/build/icon-mac.png`** - the squircle tile at 1024, not the bare mark. macOS does
  not mask app icons; the artwork carries its own shape. electron-builder converts it to `.icns`
  itself, so no macOS machine is needed.

## Provenance

The SVGs and the ICO here carry their original C2PA Content Credentials manifests, which is why a
671-byte drawing is an 8.4KB file. **The rendered assets that ship to users have the manifest
stripped** - it is an ancillary PNG chunk and an SVG `<metadata>` element, so removing it changes
no pixel, and keeping it would have made the SVG favicon 93% metadata. The record is preserved
here, on the masters, where it is worth its size.

The mark is original vector geometry. The typefaces referenced by the lockup are Space Grotesk and
IBM Plex Mono, both Google Fonts under the SIL Open Font License.
