# 렌더된 PNG 여러 장을 격자로 합쳐 한 장으로 만든다(검수 효율용).
param(
  [Parameter(Mandatory=$true)][string]$Dir,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Cols = 2,
  [int]$CellW = 600
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter 'p*.png' | Sort-Object Name
if ($files.Count -eq 0) { throw "no png in $Dir" }
$cellH = [int]($CellW * 9 / 16)
$rows = [Math]::Ceiling($files.Count / $Cols)
$bmp = New-Object System.Drawing.Bitmap(($CellW * $Cols), ($cellH * $rows))
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(220,225,229))
$g.InterpolationMode = 'HighQualityBicubic'
$i = 0
foreach ($f in $files) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $x = ($i % $Cols) * $CellW
  $y = [Math]::Floor($i / $Cols) * $cellH
  $g.DrawImage($img, $x, $y, $CellW, $cellH)
  $img.Dispose()
  $i++
}
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "montage -> $Out ($($files.Count) pages)"
