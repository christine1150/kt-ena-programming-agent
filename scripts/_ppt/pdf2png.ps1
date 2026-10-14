# Windows 내장 PDF 렌더러(Windows.Data.Pdf)로 PDF 페이지를 PNG로 저장한다.
param(
  [Parameter(Mandatory=$true)][string]$Pdf,
  [Parameter(Mandatory=$true)][string]$OutDir,
  [int]$From = 1,
  [int]$To = 0,
  [int]$Width = 1400
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function AwaitOp($op, $resultType) {
  $m = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $m.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function AwaitAction($action) {
  $task = $asTaskAction.Invoke($null, @($action))
  $task.Wait(-1) | Out-Null
}

$pdfPath = (Resolve-Path $Pdf).Path
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force $OutDir | Out-Null }

$file = AwaitOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdfPath)) ([Windows.Storage.StorageFile])
$doc  = AwaitOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])

$last = if ($To -gt 0) { [Math]::Min($To, $doc.PageCount) } else { $doc.PageCount }
Write-Output "pages: $($doc.PageCount) · rendering $From..$last"

for ($i = $From; $i -le $last; $i++) {
  $page = $doc.GetPage($i - 1)
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32]$Width
  $out = Join-Path (Resolve-Path $OutDir).Path ("p{0:D2}.png" -f $i)
  $fs = [System.IO.File]::Create($out)
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($fs)
  AwaitAction ($page.RenderToStreamAsync($ras, $opts))
  $ras.FlushAsync() | Out-Null
  $fs.Dispose()

}
Write-Output "done -> $OutDir"
