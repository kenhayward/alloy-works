$out.styles = @()
foreach ($st in $doc.Styles) {
  if ($st.InUse -and $st.Type -eq 1 -and ($st.NameLocal -match 'eading|Normal|TOC')) {
    $lt = $null; try { $lt = $st.ListLevelNumber } catch {}
    $out.styles += [ordered]@{ name = $st.NameLocal; builtIn = $st.BuiltIn; outline = $st.ParagraphFormat.OutlineLevel; listLevel = $lt }
  }
}
$h1 = $doc.Styles.Item(-2); $h2 = $doc.Styles.Item(-3)
$out.wdStyleHeading1 = [ordered]@{ name = $h1.NameLocal; inUse = $h1.InUse; builtIn = $h1.BuiltIn }
$out.wdStyleHeading2 = [ordered]@{ name = $h2.NameLocal; inUse = $h2.InUse; builtIn = $h2.BuiltIn }
$out.tocs = $doc.TablesOfContents.Count
