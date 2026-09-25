# Word measurements

> **Throwaway.** The probes behind [Word output on publishing/13](../../docs/design/word-output.md#word-output-on-publishing13):
> small Word documents built by hand from their parts, opened in Word through COM, and measured. The
> results are in [`measurements.md`](measurements.md), and the design's table summarises them. The
> writer itself is built in `packages/domain`, not from these scripts, and the Word check the design
> calls for (WO-L) grows from `measure.ps1`.

Windows only, with Word installed; not part of the pnpm workspace and not run by CI. It borrows
`fflate` and `pdfjs-dist` from the workspace's `node_modules`, so run `pnpm install` first.

| File                              | What it is                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `docx.mjs`                        | Builds a `.docx` from its parts' XML                                                                   |
| `measure.ps1`                     | Opens a `.docx` in a hidden Word, optionally updates its fields, and prints what Word laid out as JSON |
| `probes/mN.mjs`                   | Probe N's documents, written to `out/` (ignored)                                                       |
| `probes/mN.ps1`                   | Probe N's own reads through COM, where it needs more than `measure.ps1` gives                          |
| `probes/run.ps1`                  | Builds one probe's documents and measures each: `.\probes\run.ps1 -Name m1 -Both -Pdf`                 |
| `probes/pdftext.mjs` and the rest | Readers: baselines and font names from Word's PDF, a page to PNG, the box a colour fills               |

Liberation Serif, Liberation Mono and STIX Two Math were not installed on the machine that measured,
which is the point: it stands where a recipient's does. Word hidden with its alerts off opens a file it
would repair without saying so, so "opens" in the record means it opened without an error.
