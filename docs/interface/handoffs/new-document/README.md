# Handoff: New document, a template gallery beside the details

The **New document** modal (`structure/NewDocument.tsx`) becomes a two-pane dialog:

- **Left:** a searchable gallery of templates, grouped by space, with Blank first.
- **Right:** what is chosen, previewed and described; its title; **the template's values, in a
  region of their own that scrolls**; and where, language and direction. Create is at the foot.

There is also one service change: **Blank is no longer empty.** It seeds one component (decision
9).

Drawn in the design canvas on 6 November 2026. Design B was chosen from two. The values area was
made to scroll because a template may declare many values.

**Drawings, not code**, as for the other handoffs:

- colour comes from `tokens.css`;
- layout comes from the HTML;
- the existing wording comes from `en-GB.json` (`document.*`).

Each screen has a `-light` and a `-dark` `.html`, each self-contained, and a `.png` of each at
1040x720 (2x), the dialog over a greyed page.

Delivered as a zip that unpacks at the repository root, into `docs/interface/handoffs/new-document/`.

## Screens

| Files               | Screen                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `values-to-give-*`  | Clinical study report chosen: 12 values, 3 required still empty, so Create waits and says why |
| `values-scrolled-*` | The same, its values scrolled to the end; everything around them stays put                    |
| `values-given-*`    | Every required value given: Create is ready                                                   |
| `blank-*`           | Blank chosen: nothing to give, and a note of the one component it seeds                       |

## Decisions to record (one ADR)

1. **A modal of its own size.**
   - **Size:** 920 x 684 at most, and never more than the window less 32px either way. It is
     centred over a scrim that greys the page.
   - **Behaviour:** use the app's `Modal` (`layouts/Modal.js`, as `OverrideDialog` does). That
     gives `aria-modal`, the trapped focus, `Esc` and the return of focus. The focus starts in
     **Title**.
   - **Layout:** two columns, 300px and the rest. The left has `--sunken` behind it, with a 1px
     `--border` between the columns.
2. **The left pane: what to start from.**
   - **Its header:** a 34px tile, on `--accent` in `--on-accent`, holding the **new document icon**
     (a page with a folded corner and a plus; add it to `Icon` as `New document`), then "New
     document".
   - **Find a template:** filters the list by name and by space, as you type.
   - **A `listbox`, grouped:**
     - "Start fresh" holds Blank;
     - then a group per space the reader may read templates in, by its name, in the spaces'
       order.
   - **Each option** is 46px: a page icon tinted per space (decision 8), the template's name, and
     "{n} sections · {n} values" (Blank: "One component to start").
   - **The chosen one:** `--chrome` behind it and a 1.5px `--accent` ring (`aria-selected`).
   - **Keys:** the arrows move the choice, `Home`/`End` go to the ends, and typing goes to Find.
3. **The right pane, top: what is chosen.** It is fixed and never scrolls:
   - **A preview,** 112 x 145: a white page with a folded corner and a light shadow. It shows the
     template's title-page line and its first five headings, from its outline, each over two grey
     text lines. Under it: "{n} sections, {n} required components" (Blank: "One component, ready
     to write in").
   - **Beside the preview:**
     - a kicker, "Template · {space}" (Blank: "Start fresh");
     - the template's name, 18px;
     - its description, 12px `--muted`, three lines at most;
     - then **Title**, 40px, with the focus ring.
4. **The right pane, middle: the template's values. This region scrolls.**
   - **Its line**, fixed above it: "Values for this template", "{n} values · {n} required", and,
     while any required value is empty, a pill on `--warn-bg` in `--warn`, "{n} required values
     left". **Pressing the pill** scrolls to the first empty required value and focuses it.
   - **Under its line:** a `group` labelled by that line, `tabindex="0"` so a keyboard can scroll
     it. It takes all the height left (`flex: 1; min-height: 0; overflow-y: auto`), with the thin
     scrollbar in `--strong-border`.
   - **Its fields** are in two columns, 10px by 14px apart, in the template's declared order. Each
     field has an icon for its kind (text, choice, date, person), its label, and a `--warn` star
     where it is required. A required field still empty has a `--warn` edge.
   - **Fade cues:** a 28px fade into `--chrome` at the foot while there is more below, and at the
     top while there is more above. They show only when there is more to scroll to.
   - **A value the service refuses** (`refusedParameters`, TPL-045): its sentence goes under that
     field, and that field is scrolled into view.
   - **For Blank,** or a template with no values, the region is a dashed note instead: "Blank asks
     for nothing. It starts with one component titled **Please supply a title**, with a line of
     text to write over, so there is somewhere to type straight away."
5. **The right pane, below the values: where, language, direction.** It is fixed, on one row:
   - **Where**, a select with a folder icon;
   - **Language**, the name and the tag together ("English (UK) · en-GB"), with a globe icon,
     defaulting from the space as `useLanguageField` does today;
   - **Direction**, a two-icon `radiogroup`: Left to right, and Right to left.
6. **The foot.** A line saying what Create will do, then Cancel, then **Create document**, with the
   new document icon.
   - **When ready,** the line reads "Creates {n} sections from the template, in {space}." (Blank:
     "Creates a document with one component, in {space}.") and Create is on `--accent`.
   - **While a required value is empty,** it reads today's "Fill in {value1} to create the
     document." in `--warn`, and Create is `aria-disabled`, greyed.
   - **Kept from today:** the notices for the refusal states (signed out, no rights, gone,
     archived, template unresolved, and the rest), in that line.
7. **What does not scroll stays put.** Only the template list and the values scroll. The preview,
   the title, where, language, direction and the foot never move, whatever the number of values.
8. **Colour per space, for templates.** Their page icons use a tone per space: Clinical in
   `--accent-text`, Quality in `--warn`, and the others in turn from `--info` and `--ok`.
   - **Blank** is an outline in `--muted`.
   - **The rule:** the colour tells spaces apart and nothing more. The space's name is always said
     beside it.
9. **Blank seeds one component (service, new).** A document created without a template is created
   with **one component** placed at the top level of its outline:
   - **Component title:** "Please supply a title".
   - **Text:** one paragraph, "Please supply the text."
   - **Language:** both are in the document's language where the catalogue has the sentence, and
     in en-GB otherwise. They are ordinary content, typed over like any other. They are not a
     placeholder that disappears, so nothing new is needed in the editor.
   - **Where and whose:** the component is created in the document's space, as the creator, in the
     component type the space uses by default, as `Draft`. It is placed `latest`, in the same
     transaction as the document. The creation's audit records both.
   - **Where it goes in the code:** in `createDocument` (imported by
     `apps/service/src/documents.ts`), on the path without `template`. **Do not** make Blank a
     stored template: the API keeps "no template" meaning Blank (TE-J). Check the client's
     `template === ''` path still sends none.
   - **Afterwards:** the new document opens as it does today. Where the page opens the first part
     for editing, it opens this one.

## Measures

```css
:root {
  --new-doc-width: 920px;
  --new-doc-height: 684px; /* at most; the window less 32px otherwise */
  --new-doc-gallery: 300px;
  --new-doc-option: 46px;
  --new-doc-preview: 112px; /* x 145px */
  --new-doc-field: 34px; /* the title 40px */
  --new-doc-fade: 28px;
}
```

The right pane has 28px of padding at either side. Its blocks are divided by 1px `--border`. The
dialog has 14px corners, a 1px `--strong-border` edge, and the modal shadow.

## Wording

Kept (`document.*`): "New document", "Where", "Template", "Title", "Language", "Direction",
"Blank", "Parameters" (now the values line's accessible name), "Fill in {value1} to create the
document.", "Create" (as the base of the button's words), and every refusal sentence.

New, check each:

- "Find a template", "Start fresh", "Template · {space}".
- "{n} sections · {n} values", "One component to start", "{n} sections, {n} required components",
  "One component, ready to write in".
- "Values for this template", "{n} values · {n} required", "{n} required values left".
- "Blank asks for nothing. It starts with one component titled {title}, with a line of text to
  write over, so there is somewhere to type straight away."
- "Creates {n} sections from the template, in {space}.", "Creates a document with one component, in
  {space}.", "Create document".
- "Left to right", "Right to left" (check for existing keys).
- **Service catalogue:** "Please supply a title", "Please supply the text."

No em or en dashes. Plurals through ICU.

## Open questions

1. **What the gallery and preview need from the service.** `GET /v1/templates` lists name and space.
   The gallery also wants section and value counts and a description. The preview wants the first
   headings of the outline. Either add a summary to the list (cheap and cached), or read
   `GET /v1/templates/{id}` for the chosen one only (the preview then fills a moment later). The
   counts in the list need the summary. Without it, show the space alone.
2. **A template's description** may not exist. If templates carry none, show none: the line is
   left out, and nothing is invented.
3. **Publishing the seeded words.** Should a publish warn while "Please supply a title" or "Please
   supply the text." is still there? If so, it is a publish check like the others, raised against
   that component, and matched by the seeded component's provenance rather than by its words.
4. **Required fields' warn edge before any attempt.** The drawing shows it at once. If that reads
   as scolding, show it only after a Create is attempted, or after the pill is pressed.

## Not drawn

- Find with no match ("No template is called that"), and the list failing (today's sentence, with
  Blank still offered).
- A template's values failing to read (today's sentence, in the values region).
- A refused value with its sentence under it.
- The Where list, the language picker and the date and person pickers.
- A narrow window: under 760px wide, the gallery becomes a select above the right pane.

## Example data

The templates, counts, descriptions, study and product names, sponsor and people are invented. Do
not use them in fixtures.

## Order of work

Two PRs, the service first:

1. **Service:**
   - query the trace (`pnpm trace show TE-J`, `TPL-018`, `TPL-020`, `TPL-045`; `pnpm trace search
blank`, `create document`);
   - Blank's seeded component, test first: one reference at the top level, its component's title
     and text as above, in the document's space, `Draft`, audited, in one transaction; and in RTL
     and a language without the sentence;
   - settle open question 1 and add the template summary if chosen.
2. **Web:**
   - the ADR for this dialog;
   - the modal on `Modal`, the gallery and its keys, the preview, then the values region with its
     line, pill, fades and scroll-to-refused;
   - the fixed row and the foot, with the existing refusals moved into the foot's line;
   - move `NewDocument`'s tests' queries, keeping their requirement IDs and accessible names;
   - add axe checks for the listbox, the scrolling group and the radiogroup;
   - add a test that a template with 30 values keeps Create and Title on screen.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy.

Everything `NewDocument` does today stays:

- the spaces it offers;
- the language defaulting from the space;
- templates and their declared values;
- the starting values, missing-value checks and refusals;
- the double-click guard;
- `onCreated`.

What is new:

- the two-pane layout and the gallery with search;
- the preview and description;
- the values region that scrolls on its own, with its count and pill;
- the icons for direction, language and where;
- the foot's line of what Create will do;
- Blank's seeded component.
