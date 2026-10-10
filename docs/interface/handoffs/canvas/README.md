# Handoff: the editing canvas as a page on a desk

**This applies to documents and to components alike.** Wherever a component's text is shown on the
theme's paper, the paper becomes a centred, bordered sheet on a desk, the way Word's page view looks:

- a **document**, in Reading and in Authoring;
- a **component open in place** on a document's page;
- a **component opened on its own** in the component editor.

Today the paper (`.aw-canvas`) fills the whole middle column and the text sits at its left. Drawn in
the design canvas on 10 October 2026. Layout B was chosen from three (A kept today's controls; C set the
sheet to the layout's real page, which would need page geometry the editor does not have).

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML. Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at
1440x900. The text on the paper stands in for the theme's faces; the editor keeps setting it in them.

Delivered as a zip; it lives in `docs/interface/handoffs/canvas/`.

## Screens

| Files                         | Screen                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- |
| `document-*`                  | A document in Authoring, both panels hidden to their rails                 |
| `document-editing-in-place-*` | The same document with Study Details open in place, its toolbar in a band  |
| `component-editor-*`          | Study Details opened on its own, the space pane hidden, Attributes showing |

## Decisions to record (one ADR)

1. **The paper is a sheet, not a column.** The sheet is as wide as the layout's measure (CNT-115,
   scaled by zoom) plus a fixed interface margin each side, centred in the space between the panels.
   It has a 1px edge, a soft shadow and square corners, and stands 28px below the top of the desk.
   Its height is the text's: there are no pages and no page breaks, because the editor has none and
   line and page breaks never agree with the PDF (themes.md). Preview still shows them.
2. **The desk** is everything around the sheet: `--desk`, the token the publication viewer already
   uses (light `#e6e9ed`, dark `#070a0d`). It runs edge to edge between the module rail and the
   right-hand panel, and scrolls with the sheet.
3. **The paper stays paper in dark mode**, as themes.md already decides ("The canvas is paper").
   Only the chrome and the desk darken. The sheet's edge and shadow get a dark-mode variant so it
   still reads as lifted.
4. **Documents: a document bar** replaces the controls row, one line under the header:
   - the breadcrumb;
   - **Reading** and **Authoring** as a two-way segmented switch, with a book and a pencil icon (the
     same switch and the same rule for who is offered it);
   - **Preview**, a bordered button with an eye icon;
   - **Show boundaries**, a toggle button (`aria-pressed`) with a boundary icon, in place of the
     checkbox;
   - **Manage access**, a text button with a lock icon, at the right end.
5. **Zoom moves to the status bar**, at its right end before the document's counts: zoom out, a
   slider, zoom in and the percentage as a menu. The levels are the existing ones; the slider steps
   through them. This is the same in the component editor.
6. **The outline and part panels** hide to rails that float on the desk at its left and right edges,
   as today. Open, they stand on the desk in the same places and the sheet stays centred in what is
   left.
7. **A component open in place**: its toolbar sits in a band under the document bar, on the
   chrome, not on the paper, so the sheet does not move when a component opens (CNT-075). The band
   holds the component's name (in accent, with a pencil), the toolbar, the save chip and **Done**.
   The component's edge on the paper is the existing editing outline.
8. **A component opened on its own**: its strip (title, version, language and direction chips, save
   chip, Done, Save version) and its toolbar stay above, as today; the desk and sheet fill the space
   between the space pane and the right-hand panel. With the space pane open and a narrow window the
   sheet keeps its width and the desk scrolls sideways, which themes.md already accepts as the cost
   of a realistic measure.
9. **Light and dark** follow the user's theme for the chrome and desk; tokens only.

## Measures

```css
:root {
  --sheet-margin: 70px; /* interface margin each side of the measure, at 100% */
  --sheet-top: 56px; /* space above the first line, at 100% */
  --desk-gap: 28px; /* desk above the sheet */
  --document-bar: 50px;
  --inplace-toolbar: 44px;
}
.lw {
  --sheet-edge: #cfd5dc;
}
.lw.dark {
  --sheet-edge: #2a333d;
}
```

Sheet shadow: light `0 1px 2px rgba(0,0,0,.10), 0 10px 30px rgba(15,23,42,.10)`; dark
`0 1px 2px rgba(0,0,0,.6), 0 14px 40px rgba(0,0,0,.55)`. These are new tokens for `tokens.css`. The
margins scale with zoom, as the measure does.

## Wording

Kept: "Reading", "Authoring", "Preview", "Show boundaries", "Manage access", "Done", "Save version",
the save chip's words, and the status bar's counts.

New: none. The icons are new, and each button keeps its words as its accessible name.

## Not drawn

- A panel open on the desk. The outline panel and the part panel keep their current designs.
- The figure's second line ([`../figure-toolbar/`](../figure-toolbar/README.md)) in the in-place band.
  It goes directly under the toolbar line, on the chrome.
- A narrow window. The sheet keeps its width and the desk scrolls.
- Reading mode. It is Authoring with no in-place editing; the canvas is the same.

## Example data

The document, the component and its table rows are invented.

## Order of work

1. The ADR.
2. The desk and the sheet: one wrapper used by the document's text and by the component editor's
   surface, so the two cannot drift. Move `.aw-canvas` from the column to the sheet; give the column
   `--desk`.
3. The document bar, then zoom in the status bar, in both views.
4. The in-place toolbar band.
5. Move the existing tests' queries. Keep their requirement IDs and accessible names, including the
   mode switch's and Show boundaries' (now a toggle button, so `aria-pressed` in place of `checked`).
6. Check STY-080's editor-against-PDF measurements still pass: the sheet must not change the measure.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing.
Every control already exists. What is new is the sheet and desk, the document bar's layout, zoom in
the status bar, and the in-place toolbar band. The measure, the theme on the paper and the editor's
behaviour do not change.
