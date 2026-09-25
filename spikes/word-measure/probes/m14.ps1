$out.banding = @()
$ti = 0
foreach ($t in $doc.Tables) {
  $ti++
  $row = @()
  for ($r = 1; $r -le $t.Rows.Count; $r++) {
    $c = $t.Cell($r, 2).Shading.BackgroundPatternColor
    if ($c -eq -16777216) { $row += "r$r=auto" } else { $h = '{0:X6}' -f $c; $row += ('r{0}={1}{2}{3}' -f $r, $h.Substring(4, 2), $h.Substring(2, 2), $h.Substring(0, 2)) }
  }
  $out.banding += ("table $ti ($($t.Style.NameLocal)): " + ($row -join ' '))
}
