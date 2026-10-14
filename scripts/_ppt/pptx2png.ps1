# PowerPoint COM으로 pptx를 PDF로 내보낸 뒤 pdf2png.ps1로 PNG를 만든다(검수용).
param(
  [Parameter(Mandatory=$true)][string]$Pptx,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$From = 1,
  [int]$To = 0,
  [int]$Width = 1400
)
$ErrorActionPreference = 'Stop'
$full = (Resolve-Path $Pptx).Path
$pdf = [System.IO.Path]::ChangeExtension($full, '.pdf')
$pp = New-Object -ComObject PowerPoint.Application
try {
  $pres = $pp.Presentations.Open($full, $true, $false, $false)
  $pres.SaveAs($pdf, 32)   # 32 = ppSaveAsPDF
  $pres.Close()
} finally {
  $pp.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null
}
& "$PSScriptRoot\pdf2png.ps1" -Pdf $pdf -OutDir $OutDir -From $From -To $To -Width $Width
Write-Output "pdf: $pdf"
