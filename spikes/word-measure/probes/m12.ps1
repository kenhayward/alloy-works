$out.runs = @()
$pi = 0
foreach ($para in $doc.Paragraphs) {
  $pi++
  $o = [ordered]@{ para = $pi; readingOrder = $para.ReadingOrder; alignment = $para.Alignment; paraLang = $para.Range.LanguageID; words = @() }
  foreach ($w in $para.Range.Words) {
    $t = Clean $w.Text
    if ($t) { $o.words += ('{0} lang={1} rtl={2} nameBi={3}' -f $t, $w.LanguageID, $w.Font.RightToLeft, $w.Font.NameBi) }
  }
  $out.runs += $o
}
