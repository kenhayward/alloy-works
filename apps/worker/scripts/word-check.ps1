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
# <name>-saved.docx and reopened, with every paragraph read again.
#
# Tracks the WINWORD process it started and stops only that one, if Quit leaves it running. Where
# starting Word started no process of its own, it attached to one somebody else runs, and it closes
# only its own documents and leaves that Word alone.
param([Parameter(Mandatory = $true)][string]$Folder)
$ErrorActionPreference = 'Stop'

# Word's enumerations, by the values this uses.
$wdActiveEndSectionNumber = 2
$wdActiveEndPageNumber = 3
$wdVerticalPositionRelativeToPage = 6
$wdStatisticPages = 2
$wdExportFormatPDF = 17
$wdFormatXMLDocument = 12
$wdDoNotSaveChanges = 0

function Clean([string]$s) {
  # A paragraph mark, a cell's end, a line break and a page break, each read as a space; tabs are kept.
  if ($null -eq $s) { return '' }
  return (($s -replace "[\r\a\x0b\x0c]", ' ').Trim())
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

function ReadParagraphs($doc) {
  $list = @()
  foreach ($para in $doc.Paragraphs) {
    $r = $para.Range
    $list += [ordered]@{
      text = (Clean $r.Text); style = [string]$para.Style.NameLocal; list = [string]$r.ListFormat.ListString
      page = $r.Information($wdActiveEndPageNumber); section = $r.Information($wdActiveEndSectionNumber)
      top = $r.Information($wdVerticalPositionRelativeToPage)
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

function Update($doc) {
  # What a person gets by accepting the prompt to update fields on opening, or by pressing F9.
  foreach ($t in $doc.TablesOfContents) { $t.Update() }
  [void]$doc.Fields.Update()
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
      $out.sectionsBefore = (ReadSections $doc)
      $out.contentsBefore = (ReadContents $doc)
      Update $doc
      $out.pages = $doc.ComputeStatistics($wdStatisticPages)
      $out.embedTrueTypeFonts = [bool]$doc.EmbedTrueTypeFonts
      $out.sectionsAfter = (ReadSections $doc)
      $out.paragraphs = (ReadParagraphs $doc)
      $out.contents = (ReadContents $doc)
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
