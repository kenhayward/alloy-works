$out.sizes = @()
foreach ($para in $doc.Paragraphs) { foreach ($w in $para.Range.Words) { $t = Clean $w.Text; if ($t) { $out.sizes += ('{0} size={1} sizeBi={2} lang={3}' -f $t, $w.Font.Size, $w.Font.SizeBi, $w.LanguageID) } } }
