$out.notes = @()
foreach ($n in $doc.Footnotes) { $out.notes += [ordered]@{ index = $n.Index; ref = (Clean $n.Reference.Text); page = $n.Reference.Information(3); inTable = $n.Reference.Information(12); text = (Clean $n.Range.Text); notePage = $n.Range.Information(3) } }
$out.restart = @(); foreach ($s in $doc.Sections) { $out.restart += $s.Range.FootnoteOptions.NumberingRule }
