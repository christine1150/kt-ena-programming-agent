# Word COM으로 docx를 같은 이름의 PDF로 내보낸다(레이아웃·페이지 수 확인용).
param(
  [Parameter(Mandatory=$true)][string]$Docx
)
$ErrorActionPreference = 'Stop'
$docxPath = (Resolve-Path $Docx).Path
$pdfPath = [System.IO.Path]::ChangeExtension($docxPath, '.pdf')

$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open($docxPath, $false, $true)
  $doc.ExportAsFixedFormat($pdfPath, 17)  # 17 = wdExportFormatPDF
  $doc.Close([ref]0)
} finally {
  $word.Quit()
}
Write-Output "pdf: $pdfPath"
