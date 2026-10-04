### Added

- **Values from your own data, shown in a document.** In a document's text, and in a component
  opened in place, each bound value shows the value the document holds, formatted by the document's
  theme, where it stands in the sentence. A value with a newer result waiting says _revision waiting_
  beside it.
- **Why a value is missing, said in its place.** A binding with no value says why where it stands -
  never resolved, changed since it was resolved, no rows, too many rows, no matching row, empty, or a
  result that cannot be read - set apart by its words and its border, not by colour alone.
- **A value's provenance in one step.** Click a value in a document's text, or press Enter on it, to
  see beside the text where it came from: the query and its version, its parameters, whose view, when
  it was fetched, the rows and their checksum, who resolved it, and the SQL where you may read it,
  with **Show the result** for its first 200 rows. Selecting a value in the editor shows the **Value
  panel**, which opens the same.
- **Components holding bound values open for editing.** A bound value can be deleted, undone, copied,
  cut and pasted: a copy is a new value to be resolved in each document, and a cut and paste keeps
  its own. On its own a component shows what each value asks for - its column and its query's title -
  and never a value.
