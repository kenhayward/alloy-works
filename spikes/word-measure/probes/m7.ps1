$out.inl = @()
foreach ($s in $doc.InlineShapes) {
  $dec = 'n/a'; try { $dec = $s.Decorative } catch { $dec = 'no property: ' + $_.Exception.Message }
  $out.inl += [ordered]@{ alt = $s.AlternativeText; title = $s.Title; decorative = $dec; page = $s.Range.Information(3) }
}
$out.flt = @()
foreach ($s in $doc.Shapes) {
  $dec = 'n/a'; try { $dec = $s.Decorative } catch { $dec = 'no property' }
  $o = [ordered]@{ alt = $s.AlternativeText; decorative = $dec; top = $s.Top; relV = $s.RelativeVerticalPosition; wrap = $s.WrapFormat.Type; anchorPage = $s.Anchor.Information(3); anchorY = $s.Anchor.Information(6) }
  $out.flt += $o
}
