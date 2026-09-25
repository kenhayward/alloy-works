# Open every .docx in a folder in one Word instance and say which open. Probe kit only.
param([string]$Dir)
$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$word = New-Object -ComObject Word.Application
$mine = @(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
$word.Visible = $false; $word.DisplayAlerts = 0
try {
  foreach ($f in (Get-ChildItem $Dir -Filter *.docx | Sort-Object { [int](($_.BaseName -replace '\D.*$', '') -replace '^$', '0') }, Name)) {
    try { $d = $word.Documents.Open($f.FullName, $false, $true, $false); "$($f.Name) OK omaths=$($d.OMaths.Count)"; $d.Close([ref]0) } catch { "$($f.Name) FAIL" }
  }
} finally {
  try { $word.Quit([ref]0) } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word); [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  foreach ($id in $mine) { Start-Sleep -Milliseconds 500; $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -eq 0) { Stop-Process -Id $id -Force; "stopped leftover $id" } }
}
