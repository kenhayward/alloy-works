$out.cells = @()
$t = $doc.Tables.Item(1)
foreach ($rc in @(@(1,1), @(1,2), @(2,1), @(2,2), @(3,2), @(4,2))) {
  $c = $t.Cell($rc[0], $rc[1])
  $out.cells += [ordered]@{ row = $rc[0]; col = $rc[1]; bg = ('{0:X6}' -f $c.Shading.BackgroundPatternColor); bgRaw = $c.Shading.BackgroundPatternColor; bold = $c.Range.Font.Bold; text = (Clean $c.Range.Text) }
}
$out.table1 = [ordered]@{ builtInStyle = $t.Style.BuiltIn; top = $t.TopPadding; left = $t.LeftPadding; bottom = $t.BottomPadding; right = $t.RightPadding;
  borderTopWidth = $t.Borders.Item(-1).LineWidth; borderInsideH = $t.Borders.Item(-5).LineWidth; borderInsideV = $t.Borders.Item(-6).LineWidth;
  row1Heading = $t.Rows.Item(1).HeadingFormat; row2Heading = $t.Rows.Item(2).HeadingFormat;
  lastRowPage = $t.Rows.Item($t.Rows.Count).Range.Information(3); firstRowPage = $t.Rows.Item(1).Range.Information(3) }
$t2 = $doc.Tables.Item(2)
$r3 = $t2.Rows.Item(3)
$out.table2 = [ordered]@{ row3AllowBreak = $r3.AllowBreakAcrossPages; row3StartPage = $r3.Range.Characters.First.Information(3); row3EndPage = $r3.Cells.Item(1).Range.Paragraphs.Last.Range.Information(3); row4Page = $t2.Rows.Item(4).Range.Information(3); row2Page = $t2.Rows.Item(2).Range.Information(3) }
