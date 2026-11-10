# docx 를 Word(COM)로 읽기 전용으로 열어 쪽 수를 세고 첫 쪽을 PNG 로 저장한다(렌더 검증용). 사용자의 Word 창은 건드리지 않는다.
param([string]$Dir = "docs\iptv\word", [string]$OutDir = "$env:TEMP\gen\render")
New-Item -ItemType Directory -Force $OutDir | Out-Null
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($f in Get-ChildItem $Dir -Filter *.docx) {
    $doc = $word.Documents.Open($f.FullName, $false, $true)
    $doc.Repaginate()
    $pages = $doc.ComputeStatistics(2)
    $doc.Activate()
    $word.ActiveWindow.View.Type = 3
    $null = $word.Selection.GoTo(1, 1, 1)
    $pane = $word.ActiveWindow.ActivePane
    try { $bits = $pane.Pages.Item(1).EnhMetaFileBits } catch { "{0}: {1} pages (render skipped: {2})" -f $f.Name, $pages, $_.Exception.Message; $doc.Close($false); continue }
    $emf = Join-Path $OutDir ($f.BaseName + ".emf")
    [IO.File]::WriteAllBytes($emf, $bits)
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($emf)
    $bmp = New-Object System.Drawing.Bitmap ([int]($img.Width * 1.6)), ([int]($img.Height * 1.6))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($img, 0, 0, $bmp.Width, $bmp.Height)
    $png = Join-Path $OutDir ($f.BaseName + ".png")
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose()
    "{0}: {1}쪽 -> {2}" -f $f.Name, $pages, $png
    $doc.Close($false)
  }
} finally {
  $word.Quit()
}
