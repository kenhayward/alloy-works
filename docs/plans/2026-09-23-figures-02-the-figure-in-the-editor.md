`# Figures 2: The figure in the editor
`
`> **A sketch**, built inline and test first, with one final whole-branch review before the pull
`> request, as figures 1 was. It builds component-editor.md's [Figures](../design/component-editor.md#figures),
`> the second of the four slices publishing.md's [decision F-O](../design/publishing.md#figures) names,
`> over the asset routes [figures 1](2026-09-23-figures-01-assets.md) built.
`
`**Goal:** an author makes a figure from a PNG or a JPEG, describes it or marks it decorative, captions
`it, changes how its alternative text is given, replaces its image and deletes it - and a component
`holding a figure opens for editing rather than for reading only. Publishing a figure is still refused
`by name until figures 3; an inline image still opens a component read-only until figures 4.
`
`**Requirements:**
`
`- The editor's tests cite **AST-013** (a figure's own text overrides the asset's default) and
` **AST-015** (decorative, marked as such), each demonstrated by storing the state and reading it back.
`- The web's test of the dialog and panel cites **AST-039**: the description given at upload carries
` the language the author chose, and a figure's own text takes the component's language, which the
` model holds without a tag of its own.`- **Not cited:** AST-012 (the asset carries a default) is figures 1's shape; CNT-081, a caption-bearing
` block's identity, asks for equations too.`
`## Rulings
`
`- **R1. Two nodes**, as the table has: \`figure\` - a block, isolating, attributes \`id\`, \`asset\`,
`  \`imageStyle\` (\`figure\`) and \`alternative\` (the three-state, as stored) - holding one
`  \`figureCaption\` of text with any mark. \`toDOM\` renders the image itself, uneditable, above the
`  caption, from \`/v1/asset-versions/{asset}/content\`: the renderer is served on the service's origin
`  (ADR-0021's one origin), so one path serves the editor and \`renderContent\` alike and no node view is
`  needed. The image's \`alt\` is the figure's own text, empty where decorative, and a fixed sentence
` saying the image's own description is used where inherited.`- **R2. The mapping** holds a figure both ways, walks its caption for marks, and stops naming
`  \`figure\` as unsupported. An \`image\` is still named: inline images are figures 4.
`- **R3. Commands** in \`packages/editor/src/figures.ts\`: \`figureAt\`, \`insertFigure(asset,
`  alternative)\` after the block the cursor is in, \`setFigureAlternative\`, \`replaceFigureImage\`
`  keeping the figure's identity and caption, and \`deleteFigure\`, leaving an empty paragraph where it
` was the only block.`- **R4. The dialog** (\`FigureDialog.tsx\`): one file (PNG or JPEG), and either a description in a
` language - defaulting to the component's - or **It is decorative**; upload refused until one of the` two is given (decision F-P). Upload is the two requests, then the upload followed every half second
` for up to thirty; a refusal is said in words from its reason, nothing inserted. A description makes` the figure \`inherited\`; decorative makes it \`decorative\`.
`- **R5. The panel** (\`FigurePanel.tsx\`), in the \`F6\` ring while the cursor is in a figure:
` **Use the image's description**, **Describe it here** with a text field, **Decorative**; **Replace` image**, through the same dialog, whose answer becomes the figure's state; and **Delete figure**.
` Empty own text is not stored: the state stays as it was until something is typed.`- **R6. An image that does not load** - unreadable or gone - is marked in its place, _An image you may
`  not see_, by a capturing \`error\` listener on the surface's container; ProseMirror does not re-render
` an uneditable node's inside while its attributes stand.`- **R7. The toolbar's Figure button** is the page's, as **Paste as Markdown** is, not a registry
` command: it opens a dialog and uploads, which only the page can do. No shortcut.`
`## Tasks
`
`1. **\`packages/editor\`**: the nodes, the mapping, the commands, the image's \`alt\`, and \`renderContent\`
`  showing a figure.`2. **\`apps/web\`**: \`uploadImage\` over the client, the dialog, the panel, the toolbar button, the
`   missing-image marker, and \`ComponentEditor\` wiring - the space from the component, the panel in the
`   \`F6\` ring.
`3. **Docs**: component-editor.md's table row and what building changed, architecture, features and the
` README, this plan's status, 0.57.0 and the changelog; trace generate and pins.
