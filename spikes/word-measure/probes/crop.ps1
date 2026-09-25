# Crop a PNG region given in PDF points (the PNG's scale is taken from -Scale). Usage: crop.ps1 -Png f -Scale 3 -X 60 -Y 60 -W 300 -H 90 -Out o.png
param([string]$Png, [double]$Scale, [double]$X, [double]$Y, [double]$W, [double]$H, [string]$Out)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Png)
$r = New-Object System.Drawing.Rectangle ([int]($X * $Scale)), ([int]($Y * $Scale)), ([int]($W * $Scale)), ([int]($H * $Scale))
$bmp = New-Object System.Drawing.Bitmap $r.Width, $r.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $r.Width, $r.Height), $r, [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $img.Dispose()
$Out
