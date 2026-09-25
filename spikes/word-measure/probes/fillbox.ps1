# Bounding boxes (in PDF points) of runs of rows holding a given fill colour in a rendered page PNG.
# Usage: fillbox.ps1 -Png f.png -PxPerPt 10 -R 240 -G 240 -B 240
param([string]$Png, [double]$PxPerPt, [int]$R = 240, [int]$G = 240, [int]$B = 240)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $Png
$rows = @()
for ($y = 0; $y -lt $bmp.Height; $y++) {
  $minx = -1; $maxx = -1
  for ($x = 0; $x -lt $bmp.Width; $x += 1) { $c = $bmp.GetPixel($x, $y); if ([Math]::Abs($c.R - $R) -le 2 -and [Math]::Abs($c.G - $G) -le 2 -and [Math]::Abs($c.B - $B) -le 2) { if ($minx -lt 0) { $minx = $x }; $maxx = $x } }
  $rows += ,@($y, $minx, $maxx)
}
$bmp.Dispose()
$inRun = $false; $top = 0; $l = 1e9; $rr = -1
foreach ($row in $rows) {
  $has = $row[1] -ge 0 -and ($row[2] - $row[1]) -gt (20 * $PxPerPt)
  if ($has -and -not $inRun) { $inRun = $true; $top = $row[0]; $l = $row[1]; $rr = $row[2] }
  elseif ($has) { $l = [Math]::Min($l, $row[1]); $rr = [Math]::Max($rr, $row[2]) }
  elseif ($inRun) { $inRun = $false; 'fill: top={0:N2} bottom={1:N2} left={2:N2} right={3:N2} (pt)' -f ($top / $PxPerPt), ($row[0] / $PxPerPt), ($l / $PxPerPt), (($rr + 1) / $PxPerPt) }
}
