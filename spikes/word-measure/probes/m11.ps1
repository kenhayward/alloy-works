# (An earlier version linearised each OMath through COM to read it back; Word spun at full CPU for
# minutes in that loop and the process was stopped. Type, font and page only.)
$out.omathList = @()
$k = 0
foreach ($m in $doc.OMaths) {
  $k++
  $out.omathList += [ordered]@{ i = $k; type = $m.Type; font = $m.Range.Font.Name; page = $m.Range.Information(3); text = (Clean $m.Range.Text) }
}
