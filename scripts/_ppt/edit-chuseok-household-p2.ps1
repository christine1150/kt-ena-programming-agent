# 2단계: 채널 심층·포트폴리오·데이파트 등 나머지 슬라이드의 당사 채널 개인2049 옆에
# 전국 유료가구 시청률을 얇은 글씨로 병기한다. 1단계(edit-chuseok-add-refchannels.ps1)가
# 이미 만든 상세판(수정).pptx / 핵심판(수정).pptx를 이어서 편집한다(원본을 또 여는 게 아님).
$ErrorActionPreference = 'Stop'

$OUTDIR = "C:\Users\sky tv\Desktop\my-app\scripts\_ppt\_out"
$DETAIL_SRC = Join-Path $OUTDIR 'ENA_2026추석_시청률분석_상세판(수정).pptx'

# "기준 0.093" 처럼 라벨이 붙은 줄 전용 — 라벨+숫자(기존 서식 유지)+가구값(얇게) 세 런.
function Set-BaselineInlineHousehold($textRange, [string]$prefix, [double]$mainVal, [double]$hhVal, [int]$mainDecimals) {
  $fmt = '{0:N' + $mainDecimals + '}'
  $mainTxt = $prefix + ($fmt -f $mainVal)
  $hhTxt = ' (' + ('{0:N2}' -f $hhVal) + ')'
  $baseFont = $textRange.Font.Name
  $baseSize = $textRange.Font.Size
  $baseColor = $textRange.Font.Color.RGB
  $textRange.Text = $mainTxt + $hhTxt
  $mainRange = $textRange.Characters(1, $mainTxt.Length)
  $mainRange.Font.Name = $baseFont
  $mainRange.Font.Size = $baseSize
  $mainRange.Font.Color.RGB = $baseColor
  $hhRange = $textRange.Characters($mainTxt.Length + 1, $hhTxt.Length)
  $hhRange.Font.Name = 'KT Flow Thin'
  $hhRange.Font.Size = [single]([math]::Max(7.0, [double]$baseSize - 1.0))
  $hhRange.Font.Color.RGB = 9206908
}

function Set-InlineHousehold($textRange, [double]$mainVal, [double]$hhVal, [int]$mainDecimals, [string]$label = '가구 ') {
  $fmt = '{0:N' + $mainDecimals + '}'
  $mainTxt = ($fmt -f $mainVal)
  $hhTxt = ' (' + $label + ('{0:N2}' -f $hhVal) + ')'
  $baseFont = $textRange.Font.Name
  $baseSize = $textRange.Font.Size
  $baseColor = $textRange.Font.Color.RGB
  $textRange.Text = $mainTxt + $hhTxt
  $mainRange = $textRange.Characters(1, $mainTxt.Length)
  $mainRange.Font.Name = $baseFont
  $mainRange.Font.Size = $baseSize
  $mainRange.Font.Color.RGB = $baseColor
  $hhRange = $textRange.Characters($mainTxt.Length + 1, $hhTxt.Length)
  $hhRange.Font.Name = 'KT Flow Thin'
  $hhRange.Font.Size = [single]([math]::Max(7.0, [double]$baseSize - 1.0))
  $hhRange.Font.Color.RGB = 9206908
}

$pp = New-Object -ComObject PowerPoint.Application
try {
  $pres = $pp.Presentations.Open($DETAIL_SRC, $false, $false, $false)

  # ── 슬라이드 25 · ENA PORTFOLIO ────────────────────────────────────
  $slide25 = $pres.Slides.Item(25)
  $tbl25 = $slide25.Shapes.Item(6).Table
  $portfolioHH = @{
    2 = @{ holiday = 0.31884; baseline = 0.32979 }  # ENA
    3 = @{ holiday = 0.07782; baseline = 0.06472 }  # ENA Play
    4 = @{ holiday = 0.11325; baseline = 0.07023 }  # ENA Drama
  }
  foreach ($r in $portfolioHH.Keys) {
    $h = $portfolioHH[$r]
    $c3 = $tbl25.Cell($r, 3).Shape.TextFrame.TextRange
    $v3 = [double]($c3.Text.Trim())
    Set-InlineHousehold $c3 $v3 $h.holiday 3 ''
    $c4 = $tbl25.Cell($r, 4).Shape.TextFrame.TextRange
    $v4 = [double]($c4.Text.Trim())
    Set-InlineHousehold $c4 $v4 $h.baseline 3 ''
  }
  Write-Output "slide25 done"

  # ── 슬라이드 30 · CHANNEL DEEP DIVE ENA ─────────────────────────────
  $slide30 = $pres.Slides.Item(30)
  $c9 = $slide30.Shapes.Item(9).TextFrame.TextRange   # 연휴 시청률 0.114
  Set-InlineHousehold $c9 ([double]$c9.Text.Trim()) 0.31884 3 ''
  $c10 = $slide30.Shapes.Item(10).TextFrame.TextRange # "기준 0.093"
  Set-BaselineInlineHousehold $c10 '기준 ' 0.093 0.32979 3
  $tbl30 = $slide30.Shapes.Item(79).Table
  # "실적" 열(45pt)이 좁아 괄호가 줄바꿈되며 표 높이가 늘어나 하단 출처줄과 겹친다 —
  # "편성"(프로그램명) 열에서 30pt를 덜어 "실적" 열에 준다(표 전체 폭은 그대로 유지).
  $tbl30.Columns.Item(2).Width = 181.5
  $tbl30.Columns.Item(3).Width = 75
  # row(실적열=3): 5=도굴 오전, 6=도굴 심야, 7=맡겨만주십숏2회, 8=짐쌀라비움, 9=신규 맡겨만주십숏 첫방
  $ena30 = @{ 5 = 0.82308; 6 = 0.54599; 7 = 0.25587; 8 = 0.47666; 9 = 0.20008 }
  foreach ($r in $ena30.Keys) {
    $cell = $tbl30.Cell($r, 3).Shape.TextFrame.TextRange
    Set-InlineHousehold $cell ([double]$cell.Text.Trim()) $ena30[$r] 3 ''
  }
  Write-Output "slide30 done"

  # ── 슬라이드 32 · CHANNEL DEEP DIVE ENA Play ────────────────────────
  $slide32 = $pres.Slides.Item(32)
  $c9b = $slide32.Shapes.Item(9).TextFrame.TextRange  # 0.024
  Set-InlineHousehold $c9b ([double]$c9b.Text.Trim()) 0.07782 3 ''
  $c10b = $slide32.Shapes.Item(10).TextFrame.TextRange
  Set-BaselineInlineHousehold $c10b '기준 ' 0.023 0.06472 3
  $tbl32 = $slide32.Shapes.Item(79).Table
  $tbl32.Columns.Item(2).Width = 181.5
  $tbl32.Columns.Item(3).Width = 75
  # 2=무한도전 특집(낮), 3=무한도전 특집(당일), 5=아이캔스피크 오전, 6=아이캔스피크 오후, 7=검은사제들 새벽, 8=검은사제들 심야
  $enaPlay32 = @{ 2 = 0.14292; 3 = 0.15154; 5 = 0.03263; 6 = 0.042; 7 = 0.16507; 8 = 0.03838 }
  foreach ($r in $enaPlay32.Keys) {
    $cell = $tbl32.Cell($r, 3).Shape.TextFrame.TextRange
    Set-InlineHousehold $cell ([double]$cell.Text.Trim()) $enaPlay32[$r] 3 ''
  }
  Write-Output "slide32 done"

  # ── 슬라이드 33 · CHANNEL DEEP DIVE ENA Drama (KPI만 - 표는 전부 다회차 연속 집계라 제외) ──
  $slide33 = $pres.Slides.Item(33)
  $c9c = $slide33.Shapes.Item(9).TextFrame.TextRange  # 0.018
  Set-InlineHousehold $c9c ([double]$c9c.Text.Trim()) 0.11325 3 ''
  $c10c = $slide33.Shapes.Item(10).TextFrame.TextRange
  Set-BaselineInlineHousehold $c10c '기준 ' 0.027 0.07023 3
  Write-Output "slide33 done"

  $pres.Save()
  $pres.Close()
} finally {
  $pp.Quit()
}
