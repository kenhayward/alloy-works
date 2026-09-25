$out.embedTrueTypeFonts = $doc.EmbedTrueTypeFonts
$out.runFonts = @(); foreach ($para in $doc.Paragraphs) { $out.runFonts += ($para.Range.Font.Name + ' / last char: ' + $para.Range.Characters.Item([Math]::Max(1, $para.Range.Characters.Count - 1)).Font.Name) }
$out.omathFonts = @(); foreach ($m in $doc.OMaths) { $out.omathFonts += $m.Range.Font.Name }
