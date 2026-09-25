# Build one probe's documents with node and measure each.
# Usage: run.ps1 -Name m1 [-UpdateFields] [-Both] [-Pdf] [-Only "a b"]
#   -Both: measure each document twice, as opened (<doc>-pre.json) and after updating fields (<doc>.json).
param([string]$Name, [switch]$UpdateFields, [switch]$Both, [switch]$Pdf, [string]$Only)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$out = Join-Path $root 'out'
node (Join-Path $here "$Name.mjs") | Out-Null
$probe = Join-Path $here "$Name.ps1"
$docs = Get-ChildItem $out -Filter "$Name*.docx" | ForEach-Object { $_.BaseName }
if ($Only) { $docs = $Only -split '\s+' }
foreach ($d in $docs) {
  $base = @{ Path = (Join-Path $out "$d.docx") }
  if (Test-Path $probe) { $base.Probe = $probe }
  if ($Both) {
    "== $d (as opened)"
    & (Join-Path $root 'measure.ps1') @base -Json (Join-Path $out "$d-pre.json") | Out-Null
  }
  $a = $base.Clone(); $a.Json = (Join-Path $out "$d.json")
  if ($UpdateFields -or $Both) { $a.UpdateFields = $true }
  if ($Pdf) { $a.Pdf = (Join-Path $out "$d.pdf") }
  "== $d"
  $r = & (Join-Path $root 'measure.ps1') @a
  if ($r -match 'ERROR|stopped') { $r }
}
