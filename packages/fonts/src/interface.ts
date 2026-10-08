/**
 * The interface's own faces (ADR-0046, decision 5): IBM Plex Sans for the chrome, IBM Plex Mono for
 * numbers, versions and identifiers, from IBM's `@ibm/plex-sans` 1.1.0 and `@ibm/plex-mono` 2.5.0,
 * the complete woff2 files, under the SIL Open Font License 1.1 (ADR-0010), whose text ships beside
 * them as `LICENSE-Plex.txt`. Bundled by the renderer and never fetched: the desktop shell must work
 * without the network. In `interface/`, not `files/`, so Typst, which is handed `files/`, never sees
 * them, and no theme can name them: a component's text is set in its theme's faces (CNT-097).
 */
export const INTERFACE_FONT_FILES = [
  {
    file: 'IBMPlexSans-Regular.woff2',
    family: 'IBM Plex Sans',
    weight: 400,
    style: 'normal',
    sha256: 'ba711a3085ff9f27440b6b9c4550cfc47c97bf36591d5da958b975bb3add8c1a',
  },
  {
    file: 'IBMPlexSans-Italic.woff2',
    family: 'IBM Plex Sans',
    weight: 400,
    style: 'italic',
    sha256: '13284fab1821ba6e3652c1580fcf2bbfd8c9309520c69b3d1224dab40b37c597',
  },
  {
    file: 'IBMPlexSans-Medium.woff2',
    family: 'IBM Plex Sans',
    weight: 500,
    style: 'normal',
    sha256: '5660f8a658f8bb50dbc005232f885eadffd2bc1c235c4f6fbb63469d1f9cde6d',
  },
  {
    file: 'IBMPlexSans-SemiBold.woff2',
    family: 'IBM Plex Sans',
    weight: 600,
    style: 'normal',
    sha256: 'f78048030eab62e860efa39a0df79e2e5581bf122eb95b9bc42c0b8a4988d205',
  },
  {
    file: 'IBMPlexMono-Regular.woff2',
    family: 'IBM Plex Mono',
    weight: 400,
    style: 'normal',
    sha256: 'ba204497f16b6d334cee9d1e963a831b73e3a56e1d6300a8489d18df7214b350',
  },
  {
    file: 'IBMPlexMono-Medium.woff2',
    family: 'IBM Plex Mono',
    weight: 500,
    style: 'normal',
    sha256: '33faf307fa6031fb4062276d7320a6d632de890cbb347576fd80cfa01077bc25',
  },
] as const;
