$out.sections = @()
foreach ($s in $doc.Sections) {
  $pn = $s.Headers.Item(1).PageNumbers
  $out.sections += [ordered]@{ index = $s.Index; start = $s.Range.Information(3); end = $s.Range.Characters.Last.Information(3); style = $pn.NumberStyle; restart = $pn.RestartNumberingAtSection; startingNumber = $pn.StartingNumber; differentFirst = $s.PageSetup.DifferentFirstPageHeaderFooter; linkedHeader = $s.Headers.Item(1).LinkToPrevious; adjustedFirstPageNumber = $s.Range.Information(1) }
}
