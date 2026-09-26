# The Word check (Word 1, ruling R16; docs/design/word-output.md, WO-L): opens every .docx in a folder
# in a hidden Word through COM, read-only, updates its contents and every field, and reports what Word
# made of it as JSON, written to <Folder>\word.json (UTF-8). Grown from spikes/word-measure/measure.ps1.
#
# Run by src/word-check.test.ts, which writes the fixtures, reads the PDFs this exports and asserts;
# see that file for how a person runs it. Windows with Word only, and never in CI.
#
# For each document: whether it opened without an error, and the window's caption (a file Word
# repairs silently opens as if nothing were wrong, hidden with its alerts off - measurements.md, "Kit
# and method" - so "opened" is no proof that nothing was repaired); each section as opened and after
# the update, with where it starts and how its pages are numbered; every paragraph after the update,
# with its style, its list string, its page and where its first line stands on it; the contents'
# entries as opened and after the update; whether it embeds its faces; Word's own PDF of it,
# <name>.pdf, for the per-page reading COM cannot give; and the round trip, a copy saved by Word as
# <name>-saved.docx and reopened, with every paragraph read again. And what Word 2 writes (ruling R9),
# after the update: each list after the contents (a table of figures) by its paragraphs; every table's
# title and cells, each cell with its fill, whether its row is a header row Word repeats, and its page;
# every image in a line, with its description, its decorative flag, its size and whether it stands in
# a floating text box; and every floating shape - a floated figure's text box - with what it holds,
# where it is placed from and whether it may overlap another. A text box's paragraphs are read with
# the text's, straight after the paragraph it is anchored in. And what Word 3 writes (ruling R6), after
# the update: every cross-reference's field in the text, the notes and a text box, with its result, the
# page it stands on and the page its bookmark begins on; every bookmark as opened, and how many a person
# sees who does not ask for hidden ones; and every footnote, with the pages its mark and its note begin
# on, and - on the reopened copy, which is never saved - its number, as Word's own NOTEREF to its mark
# reads it, since COM gives a mark's text only as a code point 2.
#
# Tracks the WINWORD process it started and stops only that one, if Quit leaves it running. Where
# starting Word started no process of its own, it attached to one somebody else runs, and it closes
# only its own documents and leaves that Word alone.
param([Parameter(Mandatory = $true)][string]$Folder)
$ErrorActionPreference = 'Stop'

# Word's enumerations, by the values this uses.
$wdActiveEndSectionNumber = 2
$wdFootnotesStory = 2
$wdCollapseStart = 1
$wdActiveEndPageNumber = 3
$wdVerticalPositionRelativeToPage = 6
$wdStatisticPages = 2
$wdExportFormatPDF = 17
$wdFormatXMLDocument = 12
$wdDoNotSaveChanges = 0

function Clean([string]$s) {
  # A paragraph mark, a cell's end, a line break and a page break, each read as a space; tabs are kept.
  # An image in a line is read as Word gives it, a slash; a footnote's mark, which Word gives as a code
  # point 2, as nothing.
  if ($null -eq $s) { return '' }
  $s = $s.Replace([string][char]2, '')
  return (($s -replace "[\r\a\x0b\x0c]", ' ').Trim())
}

# A colour as COM gives it, blue-green-red in an integer, as the PDF's #rrggbb less its hash; or auto.
function Rgb([int]$c) {
  if ($c -eq -16777216) { return 'auto' }
  $h = '{0:x6}' -f $c
  return $h.Substring(4, 2) + $h.Substring(2, 2) + $h.Substring(0, 2)
}

function ReadFigureLists($doc) {
  $lists = @()
  foreach ($t in $doc.TablesOfFigures) {
    $list = @()
    foreach ($para in $t.Range.Paragraphs) {
      $list += [ordered]@{ text = (Clean $para.Range.Text); style = [string]$para.Style.NameLocal }
    }
    $lists += , $list
  }
  return , $lists
}

function ReadTables($doc) {
  $list = @()
  foreach ($t in $doc.Tables) {
    $cells = @()
    # By its cells: a table with a vertical merge has no row COM will hand out, but each cell's range
    # still says whether the row it stands in is a header row.
    foreach ($c in $t.Range.Cells) {
      $r = $c.Range
      $cells += [ordered]@{
        row = $c.RowIndex; column = $c.ColumnIndex; text = (Clean $r.Text)
        fill = (Rgb $c.Shading.BackgroundPatternColor); heading = [int]$r.Rows.HeadingFormat
        page = $r.Information($wdActiveEndPageNumber)
      }
    }
    $list += [ordered]@{ title = [string]$t.Title; cells = $cells }
  }
  return , $list
}

function ReadImage($s, [bool]$boxed) {
  return [ordered]@{
    alternative = [string]$s.AlternativeText; decorative = [int]$s.Decorative
    width = $s.Width; height = $s.Height; page = $s.Range.Information($wdActiveEndPageNumber); boxed = $boxed
  }
}

function ReadImages($doc) {
  # The text's own, and each floating text box's, in the document's order: a box's by where it is
  # anchored in the text.
  $found = @()
  foreach ($s in $doc.InlineShapes) { $found += [pscustomobject]@{ at = $s.Range.Start; n = $found.Count; read = (ReadImage $s $false) } }
  foreach ($shape in $doc.Shapes) {
    if (-not $shape.TextFrame.HasText) { continue }
    $at = $shape.Anchor.Start
    foreach ($s in $shape.TextFrame.TextRange.InlineShapes) { $found += [pscustomobject]@{ at = $at; n = $found.Count; read = (ReadImage $s $true) } }
  }
  $list = @()
  foreach ($each in ($found | Sort-Object -Property at, n)) { $list += $each.read }
  return , $list
}

function ReadFloats($doc) {
  $list = @()
  foreach ($s in $doc.Shapes) {
    $held = $s.TextFrame.HasText
    $list += [ordered]@{
      text = $(if ($held) { Clean $s.TextFrame.TextRange.Text } else { '' })
      images = $(if ($held) { $s.TextFrame.TextRange.InlineShapes.Count } else { 0 })
      page = $s.Anchor.Information($wdActiveEndPageNumber)
      vertical = $s.Top; relativeVertical = $s.RelativeVerticalPosition
      wrap = $s.WrapFormat.Type; allowOverlap = [int]$s.WrapFormat.AllowOverlap
    }
  }
  return , $list
}

function Short([string]$s) { return $s.Substring(0, [Math]::Min(60, $s.Length)) }

function ReadSections($doc) {
  $list = @()
  foreach ($section in $doc.Sections) {
    $numbers = $section.Headers.Item(1).PageNumbers
    $first = $section.Range.Paragraphs.Item(1).Range
    $list += [ordered]@{
      first = (Short (Clean $first.Text)); page = $first.Information($wdActiveEndPageNumber)
      restart = [bool]$numbers.RestartNumberingAtSection; start = $numbers.StartingNumber; style = $numbers.NumberStyle
      topMargin = $section.PageSetup.TopMargin; headerDistance = $section.PageSetup.HeaderDistance
      bottomMargin = $section.PageSetup.BottomMargin; footerDistance = $section.PageSetup.FooterDistance
      titlePage = [bool]$section.PageSetup.DifferentFirstPageHeaderFooter
    }
  }
  return , $list
}

function ReadParagraph($para, [bool]$boxed) {
  $r = $para.Range
  return [ordered]@{
    text = (Clean $r.Text); style = [string]$para.Style.NameLocal; list = [string]$r.ListFormat.ListString
    page = $r.Information($wdActiveEndPageNumber); section = $r.Information($wdActiveEndSectionNumber)
    top = $r.Information($wdVerticalPositionRelativeToPage); images = $r.InlineShapes.Count
    anchors = $(if ($boxed) { 0 } else { $r.ShapeRange.Count }); boxed = $boxed
  }
}

function ReadParagraphs($doc) {
  # The text's, each floating text box's straight after the paragraph it is anchored in.
  $list = @()
  foreach ($para in $doc.Paragraphs) {
    $list += (ReadParagraph $para $false)
    foreach ($shape in $para.Range.ShapeRange) {
      if (-not $shape.TextFrame.HasText) { continue }
      foreach ($held in $shape.TextFrame.TextRange.Paragraphs) { $list += (ReadParagraph $held $true) }
    }
  }
  return , $list
}

function ReadContents($doc) {
  $list = @()
  if ($doc.TablesOfContents.Count -gt 0) {
    foreach ($para in $doc.TablesOfContents.Item(1).Range.Paragraphs) {
      $list += [ordered]@{ text = (Clean $para.Range.Text); style = [string]$para.Style.NameLocal }
    }
  }
  return , $list
}

function ReadReferences($doc) {
  # A cross-reference's field is one naming a bookmark the writer made, `_Ref` and its digits: never
  # the contents' or a list's own PAGEREF, whose bookmarks Word names `_Toc`.
  $stories = @([pscustomobject]@{ story = 'text'; fields = $doc.Fields })
  if ($doc.Footnotes.Count -gt 0) {
    $stories += [pscustomobject]@{ story = 'footnotes'; fields = $doc.StoryRanges.Item($wdFootnotesStory).Fields }
  }
  foreach ($shape in $doc.Shapes) {
    if ($shape.TextFrame.HasText) { $stories += [pscustomobject]@{ story = 'box'; fields = $shape.TextFrame.TextRange.Fields } }
  }
  $list = @()
  foreach ($each in $stories) {
    foreach ($f in $each.fields) {
      $code = Clean $f.Code.Text
      if ($code -notmatch '(_Ref[0-9]+)') { continue }
      $name = $Matches[1]
      $r = $f.Result
      $list += [ordered]@{
        story = $each.story; code = $code; result = (Clean $r.Text); page = $r.Information($wdActiveEndPageNumber)
        target = $(if ($doc.Bookmarks.Exists($name)) { $doc.Bookmarks.Item($name).Range.Information($wdActiveEndPageNumber) } else { $null })
        style = [string]$r.Paragraphs.Item(1).Style.NameLocal
      }
    }
  }
  return , $list
}

function ReadNotes($doc) {
  $list = @()
  foreach ($fn in $doc.Footnotes) {
    $mark = $fn.Reference
    $start = $fn.Range.Duplicate
    $start.Collapse($wdCollapseStart)
    $list += [ordered]@{
      section = $mark.Information($wdActiveEndSectionNumber); mark = $mark.Information($wdActiveEndPageNumber)
      note = $start.Information($wdActiveEndPageNumber); text = (Clean $fn.Range.Text)
    }
  }
  return , $list
}

function NumberNotes($doc) {
  # Each note's number as Word prints it at its mark: a NOTEREF to a bookmark around the mark, added at
  # the document's end - only ever to a copy that is closed unsaved.
  $numbers = @()
  $count = $doc.Footnotes.Count
  for ($k = 1; $k -le $count; $k++) { [void]$doc.Bookmarks.Add("_Check$k", $doc.Footnotes.Item($k).Reference) }
  for ($k = 1; $k -le $count; $k++) {
    $at = $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
    $f = $doc.Fields.Add($at, -1, "NOTEREF _Check$k", $false)
    [void]$f.Update()
    $numbers += (Clean $f.Result.Text)
  }
  return , $numbers
}

function Update($doc) {
  # What a person gets by accepting the prompt to update fields on opening, or by pressing F9: in the
  # notes as well as the text.
  foreach ($t in $doc.TablesOfContents) { $t.Update() }
  foreach ($t in $doc.TablesOfFigures) { $t.Update() }
  [void]$doc.Fields.Update()
  if ($doc.Footnotes.Count -gt 0) { [void]$doc.StoryRanges.Item($wdFootnotesStory).Fields.Update() }
  foreach ($s in $doc.Sections) {
    foreach ($i in 1..3) {
      [void]$s.Headers.Item($i).Range.Fields.Update()
      [void]$s.Footers.Item($i).Range.Fields.Update()
    }
  }
  $doc.Repaginate()
}

$files = @(Get-ChildItem -Path $Folder -Filter '*.docx' | Where-Object { $_.BaseName -notlike '*-saved' } | Sort-Object Name)
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
$mine = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
$note = ''
try {
  foreach ($file in $files) {
    $name = $file.BaseName
    $out = [ordered]@{ name = $name; opened = $false; error = $null }
    $doc = $null
    try {
      $doc = $word.Documents.Open($file.FullName, $false, $true, $false)
      $out.opened = $true
      $out.version = [string]$word.Version
      $out.caption = [string]$doc.Windows.Item(1).Caption
      $doc.Repaginate()
      $doc.Bookmarks.ShowHidden = $false
      $out.visibleBookmarks = $doc.Bookmarks.Count
      $doc.Bookmarks.ShowHidden = $true
      $marks = @()
      foreach ($b in $doc.Bookmarks) { $marks += [string]$b.Name }
      $out.bookmarks = $marks
      $out.sectionsBefore = (ReadSections $doc)
      $out.contentsBefore = (ReadContents $doc)
      Update $doc
      $out.pages = $doc.ComputeStatistics($wdStatisticPages)
      $out.embedTrueTypeFonts = [bool]$doc.EmbedTrueTypeFonts
      $out.sectionsAfter = (ReadSections $doc)
      $out.paragraphs = (ReadParagraphs $doc)
      $out.contents = (ReadContents $doc)
      $out.figureLists = (ReadFigureLists $doc)
      $out.tables = (ReadTables $doc)
      $out.images = (ReadImages $doc)
      $out.floats = (ReadFloats $doc)
      $out.references = (ReadReferences $doc)
      $out.notes = (ReadNotes $doc)
      # Each path cast to a plain string: Join-Path's answer reaches COM wrapped, and Word then waits
      # forever inside ExportAsFixedFormat or SaveAs2 rather than failing.
      $pdf = [string](Join-Path $Folder "$name.pdf")
      $out.pdf = $pdf
      $doc.ExportAsFixedFormat($pdf, $wdExportFormatPDF)
      $saved = [string](Join-Path $Folder "$name-saved.docx")
      $doc.SaveAs2($saved, $wdFormatXMLDocument)
      $doc.Close([ref]$wdDoNotSaveChanges)
      $doc = $null
      $doc = $word.Documents.Open($saved, $false, $true, $false)
      $doc.Repaginate()
      $out.saved = [ordered]@{
        path = $saved; embedTrueTypeFonts = [bool]$doc.EmbedTrueTypeFonts; paragraphs = (ReadParagraphs $doc)
      }
      $out.saved.numbers = (NumberNotes $doc)
      $doc.Close([ref]$wdDoNotSaveChanges)
      $doc = $null
    } catch {
      $out.error = $_.Exception.Message
      if ($null -ne $doc) { try { $doc.Close([ref]$wdDoNotSaveChanges) } catch {} }
    }
    $results += $out
  }
} finally {
  if ($mine.Count -gt 0) { try { $word.Quit([ref]$wdDoNotSaveChanges) } catch {} }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  foreach ($id in $mine) {
    for ($k = 0; $k -lt 20; $k++) { if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -eq 0) { Stop-Process -Id $id -Force; $note = "stopped leftover WINWORD $id started by this script" }
  }
}
$json = ConvertTo-Json -InputObject $results -Depth 8
[IO.File]::WriteAllText((Join-Path $Folder 'word.json'), $json, (New-Object Text.UTF8Encoding $false))
if ($note) { Write-Output $note }
