$doc.Bookmarks.ShowHidden = $true
$out.allBookmarks = @(); foreach ($b in $doc.Bookmarks) { $out.allBookmarks += ($b.Name + ' len=' + $b.Name.Length + ' page=' + $b.Range.Information(3)) }
$out.uiLanguage = $word.LanguageSettings.LanguageID(2)
$out.installLanguage = $word.LanguageSettings.LanguageID(1)
$out.hyperlinks = @(); foreach ($h in $doc.Hyperlinks) { $out.hyperlinks += ('subaddress=' + $h.SubAddress + ' text=' + $h.TextToDisplay) }
# Save a copy through Word (the original stays untouched) to see what names Word writes back.
$copy = $Path -replace '\.docx$', '-saved.docx'
$doc.SaveAs2($copy, 16)
