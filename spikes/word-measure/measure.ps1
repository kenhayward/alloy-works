# Open a .docx in Word, optionally update its fields, and report what Word laid out, as JSON.
# Probe kit only.
# -Probe <ps1>: a script dot-sourced after the standard report with $word, $doc and $out in scope;
#               it adds its own keys to $out (probe-specific measurements).
# -Json <file>: also write the JSON (UTF-8) to a file.
# Tracks the WINWORD process this script started and stops only that one if Quit leaves it running.
param([string]$Path, [switch]$UpdateFields, [string]$Pdf, [string]$Probe, [string]$Json, [switch]$Writable)
$ErrorActionPreference = 'Stop'
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
$mine = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
$word.Visible = $false
$word.DisplayAlerts = 0
function Clean([string]$s) { if ($null -eq $s) { return '' }; return (($s -replace "[\r\a\x07\x0b]", ' ').Trim()) }
$result = $null
try {
  $doc = $word.Documents.Open($Path, $false, (-not $Writable), $false)
  if ($UpdateFields) {
    foreach ($t in $doc.TablesOfContents) { $t.Update() }
    foreach ($t in $doc.TablesOfFigures) { $t.Update() }
    [void]$doc.Fields.Update()
    foreach ($s in $doc.Sections) { foreach ($i in 1..3) { [void]$s.Headers.Item($i).Range.Fields.Update(); [void]$s.Footers.Item($i).Range.Fields.Update() } }
  }
  $doc.Repaginate()
  $out = [ordered]@{
    version = $word.Version; caption = $doc.Windows.Item(1).Caption; pages = $doc.ComputeStatistics(2); omaths = $doc.OMaths.Count
    paragraphs = @(); fields = @(); footnotes = @(); tables = @(); shapes = @(); headers = @(); bookmarks = @()
  }
  foreach ($para in $doc.Paragraphs) {
    $r = $para.Range
    $t = Clean $r.Text
    $out.paragraphs += [ordered]@{
      text = $t.Substring(0, [Math]::Min(50, $t.Length)); style = $para.Style.NameLocal
      list = $r.ListFormat.ListString; outline = $para.OutlineLevel
      page = $r.Information(3); y = [Math]::Round($r.Information(6), 2); x = [Math]::Round($r.Information(5), 2)
      before = $para.SpaceBefore; after = $para.SpaceAfter; line = $para.LineSpacing
      font = $r.Font.Name; size = $r.Font.Size; lang = $r.LanguageID
    }
  }
  foreach ($f in $doc.Fields) { $out.fields += [ordered]@{ type = $f.Type; code = (Clean $f.Code.Text); result = (Clean $f.Result.Text) } }
  foreach ($n in $doc.Footnotes) { $out.footnotes += [ordered]@{ ref = (Clean $n.Reference.Text); text = (Clean $n.Range.Text); page = $n.Reference.Information(3) } }
  foreach ($t in $doc.Tables) {
    $heading = 0; foreach ($row in $t.Rows) { if ($row.HeadingFormat -eq -1) { $heading++ } }
    $out.tables += [ordered]@{ rows = $t.Rows.Count; cols = $t.Columns.Count; headingRows = $heading; title = $t.Title; descr = $t.Descr; style = $t.Style.NameLocal }
  }
  foreach ($s in $doc.InlineShapes) { $out.shapes += [ordered]@{ kind = 'inline'; alt = $s.AlternativeText; w = $s.Width; h = $s.Height } }
  foreach ($s in $doc.Shapes) { $out.shapes += [ordered]@{ kind = 'float'; alt = $s.AlternativeText; w = $s.Width; h = $s.Height; top = $s.Top; page = $s.Anchor.Information(3) } }
  foreach ($b in $doc.Bookmarks) { $out.bookmarks += $b.Name }
  foreach ($sec in $doc.Sections) {
    foreach ($i in 1..3) {
      $h = $sec.Headers.Item($i); if ($h.Exists -and (Clean $h.Range.Text)) { $out.headers += "header$i " + (Clean $h.Range.Text) }
      $f = $sec.Footers.Item($i); if ($f.Exists -and (Clean $f.Range.Text)) { $out.headers += "footer$i " + (Clean $f.Range.Text) }
    }
  }
  if ($Probe) { . $Probe }
  if ($Pdf) { $doc.ExportAsFixedFormat($Pdf, 17) }
  $doc.Close([ref]0)
  $result = $out | ConvertTo-Json -Depth 6 -Compress
} catch {
  $result = 'ERROR: ' + $_.Exception.Message
} finally {
  try { $word.Quit([ref]0) } catch {}
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  foreach ($id in $mine) {
    for ($k = 0; $k -lt 20; $k++) { if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -eq 0) { Stop-Process -Id $id -Force; $result += "`n(stopped leftover WINWORD $id started by this script)" }
  }
}
if ($Json) { [IO.File]::WriteAllText($Json, $result, (New-Object Text.UTF8Encoding $false)) }
$result
