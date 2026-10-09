# Handoff: the Query tab for a file on an S3 connection

The Query tab of a query definition whose connection is S3, redrawn to the pattern in
[`../details/`](../details/README.md). Each key segment, the format and each filter take one line,
and the filters become a table edited in place. Drawn in the design canvas on 9 October 2026 from
the U Values query definition. It keeps every setting `FileFields.tsx` and `FormatFields.tsx` have
today. Nothing is added except presentation and one phrase.

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and wording from the strings in the current build. There is a `-light` and a `-dark` `.html`,
each self-contained, and a `.png` of each at 1440x900. Links to the other query definition tabs
point at `../details/`.

Intended home: `docs/interface/handoffs/query-file/`, next to `details/`. It was delivered as a zip
and is not in the repo yet.

## The panel

One card fills the tab panel. The page does not scroll at 1440x900. It has four sections, each with
a 14px heading, its actions on the heading line, and its hint on a single line beneath at full
width.

1. **Where the file is in the bucket.** The heading line shows "Reads Requirements/uValues.csv"
   (the key as it stands, mono, on `--sunken`), then "Add segment". Then a table, one row per
   segment:

   | Cell                                     | Width    |
   | ---------------------------------------- | -------- |
   | Number                                   | 40px     |
   | Fixed or a parameter                     | 200px    |
   | Segment: the text, or the parameter list | the rest |
   | Remove, a bin                            | 50px     |

   A segment set to Parameter swaps its text box for the parameter list ("Choose a parameter"
   while empty), in the same cell.

2. **Format**, one line: "The file is" (CSV, JSON, JSON Lines, XLSX), "Fields are separated by",
   "The first record names the fields", "An empty field". These are the CSV fields. For other
   formats the same line holds that format's fields (see Not drawn).
3. **Filters.** The heading line holds "Match all | Match any", a two-option switch with
   `role="radiogroup"` that shows only once there are two filters or more, then "Add a filter".
   Then a table, one row per filter:

   | Cell                                         | Width    |
   | -------------------------------------------- | -------- |
   | Number                                       | 40px     |
   | Column                                       | 240px    |
   | Compared with: a parameter, or a fixed value | 220px    |
   | Comparison                                   | 200px    |
   | Value                                        | the rest |
   | Remove, a bin                                | 50px     |

   When a filter is compared with a parameter, or its comparison is "is empty" or "is not empty",
   the Value cell has no box. It reads "The value of meaning" for a parameter and is blank for
   empty and not empty. The comparisons offered follow `comparisonsFor`, as today.

4. **Parameters**, one line each: name (mono), its summary, edit (pencil), remove (bin), and "Add
   parameter" at the line's end. Editing opens the parameter's fields as they are today.

Row actions are icon buttons with `aria-label`s that match the current button words ("Remove
segment 1", "Remove filter 1"), so tests that query by name keep working. Each control in a row
has an accessible name that includes its number, as the stacked fields' labels do now.

## Measures

The same as `../details/` and `../bound-table/`: 40px rows, 30px controls in a row, 28px icon
buttons, header cells carrying their widths with `table-layout: fixed`. No new colours.

## Wording

Kept: "Where the file is in the bucket" and its hint, "Fixed", "Parameter", "Reads ...", "Add
segment", "The file is", the format names, "Fields are separated by", the delimiter names, "The
first record names the fields", "An empty field", its two options and hint, "Column", "Compared
with", "A fixed value", "Comparison", the comparison words, "Value", "Add a filter", "Match all",
"Match any", and the filters hint.

New, check each:

- "The value of meaning", the Value cell when a filter compares with a parameter.
- The column headings "#" and "Segment". "Fixed or a parameter" is shortened from "Segment 1:
  fixed or a parameter".
- "Format" and "Filters" as section headings.

## Not drawn

- The format line for JSON ("Rows at", "Row count at, where the file states one") and XLSX
  ("Sheet", "The first row names the columns"), each with its hint.
- No filters yet: in place of the table, "Sample the file and confirm its columns to filter its
  rows."
- Read-only, and a stored filter the page cannot show ("Its filter holds more than a list of
  comparisons..."): show that sentence in the Filters section and the table read only.

## Example data

The segments are the user's. The S3 connection name ("Survey files"), the `meaning` parameter and
the filter values are invented.

## Order of work

1. A shared row-table part (number, cells, bin) if `../bound-table/` has not made one already.
2. Segments, then format, then filters with the match switch, then parameters, each a PR keeping
   its tests' requirement IDs.

## For Claude Code

Read this README and open both `.png` files before planning. Treat the HTML as a measured drawing.
Every behaviour already exists in `FileFields.tsx`, `FormatFields.tsx` and `PartField`; this is a
layout change.
