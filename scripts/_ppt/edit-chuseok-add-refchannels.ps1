# 추석 상세판/핵심판 pptx에 EBS·OCN 계열 참고채널 학습 슬라이드를 추가한다.
# 기존 슬라이드는 전혀 건드리지 않고, EOD(마무리) 슬라이드 바로 앞에 새 슬라이드를 끼워 넣는 방식이라
# 기존 슬라이드의 쪽번호(정적 텍스트라 자동 갱신되지 않음)를 다시 매길 필요가 없다.
# 주의: PowerShell 토크나이저가 유니코드 스마트따옴표(U+2018/2019)를 ' 와 동일하게 취급해
# 문자열이 중간에 끊긴다 — 그래서 작은따옴표 문자열 안에는 절대 직접 넣지 않고 Q() 헬퍼로 조립한다.
$ErrorActionPreference = 'Stop'

$LQ = [char]0x2018
$RQ = [char]0x2019
function Q($s) { return $LQ + $s + $RQ }

# 값 TextRange에 "0.220 (가구 0.82)" 형태로 2049(진하게)+가구(얇게, 소수 둘째자리) 두 런을 만든다.
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
  # [math]::Max(7, ...)로 쓰면 정수 오버로드로 잡혀 반환값이 Int32가 되고, 그걸 Font.Size(단정도
  # 부동소수 기대)에 대입할 때 COM 쪽에서 "Specified cast is not valid" 오류가 난다 — 7.0으로
  # 명시해 배정도 오버로드를 강제한 뒤 [single]로 캐스트한다.
  $hhRange.Font.Size = [single]([math]::Max(7.0, [double]$baseSize - 1.0))
  $hhRange.Font.Color.RGB = 9206908
}

# 원본(기존) FILM SOURCING 슬라이드 2장(16=막대 비교표, 17=체급대비 배수 네이티브 표)에서
# 당사 채널(ENA·ENA Play) 4행에만 가구 시청률을 병기한다 — 경쟁사(SBS·tvN·JTBC) 8행은
# competitor_program_ratings에 유료방송가구 타깃 데이터가 전혀 없어(전수 확인 완료) 임의로
# 채우지 않고 그대로 둔다.
$OUR_FILM_HOUSEHOLD = @{
  '도굴 (오전)' = 0.82308
  '도굴 (심야)' = 0.54599
  '아이 캔 스피크' = 0.042
  '검은 사제들' = 0.16507
}
# 슬라이드16(막대 비교표)의 12행 순서 — 당사 4행의 위치(0-based i)만 알면 된다.
$OUR_ROW_INDEX_IN_BAR_TABLE = @{ 6 = '도굴 (오전)'; 9 = '도굴 (심야)'; 10 = '아이 캔 스피크'; 11 = '검은 사제들' }

function Patch-BarTableHousehold($slide) {
  foreach ($i in $OUR_ROW_INDEX_IN_BAR_TABLE.Keys) {
    try {
      $key = $OUR_ROW_INDEX_IN_BAR_TABLE[$i]
      $hh = $OUR_FILM_HOUSEHOLD[$key]
      $base = 6 + 7 * $i
      $valShape = $slide.Shapes.Item($base + 5)
      $valShape.Width = 118
      $tr = $valShape.TextFrame.TextRange
      $mainVal = [double]($tr.Text.Trim())
      Set-InlineHousehold $tr $mainVal $hh 3
    } catch {
      Write-Output "Patch-BarTableHousehold FAILED at i=$i key=$key : $($_.Exception.Message)"
      throw
    }
  }
}

function Patch-OriginalFilmSlides($pres) {
  $slide16 = $pres.Slides.Item(16)
  Patch-BarTableHousehold $slide16
  $slide16.Shapes.Item(99).TextFrame.TextRange.Text = '자료: 닐슨 실측(개인2049) · 개봉연도·누적 관객은 영화진흥위원회 통계 및 언론 보도 인용 근사치(반올림) · 괄호(얇은 글씨)=전국 유료가구, 당사 채널만 표기(경쟁사는 가구 데이터 미보유)'

  $slide17 = $pres.Slides.Item(17)
  $tbl = $slide17.Shapes.Item(6).Table
  $rowKeyByIndex = @{ 6 = '도굴 (오전)'; 8 = '도굴 (심야)'; 12 = '아이 캔 스피크'; 13 = '검은 사제들' }
  foreach ($r in $rowKeyByIndex.Keys) {
   try {
    $key = $rowKeyByIndex[$r]
    $hh = $OUR_FILM_HOUSEHOLD[$key]
    $cellTr = $tbl.Cell($r, 5).Shape.TextFrame.TextRange
    $mainVal = [double]($cellTr.Text.Trim())
    # 이 표는 시청률 열 폭이 좁아 "(가구 0.82)"가 줄바꿈된다 — 라벨 없이 "(0.82)"만 표기.
    Set-InlineHousehold $cellTr $mainVal $hh 3 ''
   } catch {
    Write-Output "slide17 table patch FAILED at r=$r key=$key : $($_.Exception.Message)"
    throw
   }
  }
  $slide17.Shapes.Item(22).TextFrame.TextRange.Text = '자료: 닐슨 실측(개인2049) · 개봉연도·누적 관객은 영화진흥위원회 통계 및 언론 보도 인용 근사치 · 괄호(얇은 글씨)=전국 유료가구, 당사 채널만 표기(경쟁사는 가구 데이터 미보유)'
}

$DOWNLOADS = "C:\Users\sky tv\Downloads"
$OUTDIR = "C:\Users\sky tv\Desktop\my-app\scripts\_ppt\_out"
New-Item -ItemType Directory -Force -Path $OUTDIR | Out-Null

# ── 데이터: EBS·OCN 계열 참고채널 12편 (개인2049 내림차순) ──────────────
# t=제목, s=채널·시각, y=전국 유료가구(부가정보), tag=편성 유형, v=개인2049 시청률, cat=OCN|EBS(막대색)
$FILMS = @(
  @{ t='왕과 사는 남자(영화판)'; s='OCN · 9/27 13:30'; hh=1.747; tag='OCN 재방'; v=0.470; cat='OCN' },
  @{ t='사운드 오브 뮤직'; s='EBS · 9/25 14:14'; hh=1.284; tag='EBS 추석특선'; v=0.418; cat='EBS' },
  @{ t='어벤져스: 인피니티 워'; s='OCN · 9/24 21:00'; hh=0.700; tag='OCN 프라임 본방'; v=0.347; cat='OCN' },
  @{ t='파묘'; s='OCN · 9/24 16:22'; hh=0.404; tag='OCN 구작'; v=0.234; cat='OCN' },
  @{ t='범죄도시2'; s='OCN · 9/25 20:07'; hh=0.631; tag='OCN 구작'; v=0.228; cat='OCN' },
  @{ t='도둑들'; s='OCN Movies · 9/24 08:24'; hh=0.292; tag='OCN Movies 구작'; v=0.226; cat='OCN' },
  @{ t='인턴'; s='OCN Movies · 9/27 09:20'; hh=0.371; tag='OCN Movies 구작'; v=0.211; cat='OCN' },
  @{ t='정보원(재방)'; s='OCN · 9/27 11:20'; hh=0.416; tag='OCN 재방(최초 9/24)'; v=0.206; cat='OCN' },
  @{ t='좀비딸(2부)'; s='cineF · 9/25 14:19'; hh=0.080; tag='cineF 구작'; v=0.180; cat='OCN' },
  @{ t='본 슈프리머시'; s='EBS · 9/26 23:08'; hh=0.552; tag='EBS 심야특선'; v=0.100; cat='EBS' },
  @{ t='조선명탐정: 각시투구꽃의 비밀'; s='EBS · 9/27 23:14'; hh=0.631; tag='EBS 심야특선'; v=0.058; cat='EBS' },
  @{ t='집으로 가는 길'; s='EBS · 9/27 13:34'; hh=0.745; tag='EBS 일요특선'; v=0.052; cat='EBS' }
)
$COLOR_OCN = 6707288
$COLOR_EBS = 14340047
$MAXV = 0.470
$BARMAX = 420.0

function Fill-FilmTableSlide($slide) {
  # 헤더
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = 'APPENDIX · E · FILM SOURCING(참고)'
  $slide.Shapes.Item(3).TextFrame.TextRange.Text = 'EBS·OCN 계열 학습 12편: ' + (Q '신작·구작') + '보다 ' + (Q '채널 프라임 설계') + '가 성적을 갈랐다'
  $slide.Shapes.Item(4).TextFrame.TextRange.Text = '개인2049 실측, 괄호(얇은 글씨)는 전국 유료가구. EBS·OCN·OCN Movies·OCN Movies2·cineF 09/24~09/27 편성 전수 학습'

  for ($i = 0; $i -lt $FILMS.Count; $i++) {
    $row = $FILMS[$i]
    $base = 6 + 7 * $i
    # 원본 12행 중 4개(ENA·ENA Play 자사 행)는 "당사 편성은 채널 색"으로 글자색이 따로
    # 지정돼 있었다. 이번 12행은 전부 참고채널이라 그 잔여 서식을 지우고 표준 색으로 통일한다.
    $tTitle = $slide.Shapes.Item($base).TextFrame.TextRange
    $tTitle.Text = $row.t
    $tTitle.Font.Color.RGB = 1709076
    $tTitle.Font.Underline = [Microsoft.Office.Core.MsoTriState]::msoFalse
    $tSub = $slide.Shapes.Item($base + 1).TextFrame.TextRange
    $tSub.Text = $row.s
    $tSub.Font.Color.RGB = 9206908
    $tTag = $slide.Shapes.Item($base + 3).TextFrame.TextRange
    $tTag.Text = $row.tag
    $tTag.Font.Color.RGB = 3089958
    $barShape = $slide.Shapes.Item($base + 4)
    $valShape = $slide.Shapes.Item($base + 5)
    $w = [math]::Round(($row.v / $MAXV) * $BARMAX, 1)
    if ($w -lt 6) { $w = 6 }
    $barShape.Width = $w
    $barShape.Fill.ForeColor.RGB = $(if ($row.cat -eq 'OCN') { $COLOR_OCN } else { $COLOR_EBS })
    $valShape.Left = 390 + $w + 6
    $valShape.Width = 118
    # 2049 값(굵게) + 가구 값(얇게, 괄호, 소수점 둘째자리까지) 두 런으로 구성.
    $mainTxt = ('{0:N3}' -f $row.v)
    $hhTxt = ' (가구 ' + ('{0:N2}' -f $row.hh) + ')'
    $valTr = $valShape.TextFrame.TextRange
    $valTr.Text = $mainTxt + $hhTxt
    $mainRange = $valTr.Characters(1, $mainTxt.Length)
    $mainRange.Font.Name = 'KT Flow Bold'
    $mainRange.Font.Size = 9
    $mainRange.Font.Color.RGB = 1709076
    $hhRange = $valTr.Characters($mainTxt.Length + 1, $hhTxt.Length)
    $hhRange.Font.Name = 'KT Flow Thin'
    $hhRange.Font.Size = 8
    $hhRange.Font.Color.RGB = 9206908
    # 원본 "년도·부가정보" 줄(가구 시청률의 옛 표기 위치)은 값에 인라인으로 옮겼으니 비운다.
    $slide.Shapes.Item($base + 2).TextFrame.TextRange.Text = ' '
  }

  # 범례(89~96): OCN 계열 / EBS 두 항목만 쓰고 나머지는 숨김
  $slide.Shapes.Item(89).Fill.ForeColor.RGB = $COLOR_OCN
  $slide.Shapes.Item(90).TextFrame.TextRange.Text = 'OCN 계열(OCN·Movies·Movies2·cineF)'
  $slide.Shapes.Item(91).Fill.ForeColor.RGB = $COLOR_EBS
  $slide.Shapes.Item(92).TextFrame.TextRange.Text = 'EBS'
  $slide.Shapes.Item(93).Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse
  $slide.Shapes.Item(94).Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse
  $slide.Shapes.Item(95).Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse
  $slide.Shapes.Item(96).Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse

  # 읽기 밴드(97~98)
  $slide.Shapes.Item(98).TextFrame.TextRange.Text = '읽기  OCN 계열 8편 중 6편이 0.2 이상 — 매일 프라임에 본방 1편을 배치하고 나머지는 구작을 다회전 재방하는 ' + (Q '티어링 편성') + '이 안정적 성적을 만듦. EBS 〈사운드 오브 뮤직〉(가족 고전)은 참고 12편 중 2위 — 채널 체급과 무관하게 콘텐츠 자체 힘으로 성과를 낸 유일한 사례'

  # 출처 · 페이지번호
  $slide.Shapes.Item(99).TextFrame.TextRange.Text = '자료: 닐슨 실측(개인2049·전국 유료가구) · 분석기간 09/24~09/27 · EBS·OCN·OCN Movies·OCN Movies2·cineF 학습 · 참고용(당사 편성 아님)'
  $slide.Shapes.Item(100).TextFrame.TextRange.Text = 'E'
}

function Fill-StrategySlide($slide) {
  $slide.Shapes.Item(2).TextFrame.TextRange.Text = 'APPENDIX · F · 참고채널 전략 학습'
  $slide.Shapes.Item(3).TextFrame.TextRange.Text = '채널마다 같은 ' + (Q '영화') + ' 장르도 다른 방식으로 이겼다'
  $slide.Shapes.Item(4).TextFrame.TextRange.Text = 'OCN 자체 스케줄 안의 ' + (Q '최초 방영 vs 재방') + ' 대조로 APPENDIX·E의 채널체급 교란을 재검증하고, 참고채널 5개의 편성 전략을 정리'

  $ROWS = @(
    @{ pill='EBS'; title='가족 고전 카드를 오후 프라임에 단독 배치'; desc='9/25(목) 14:14 〈사운드 오브 뮤직〉 개인2049 0.418로 참고 12편 중 2위. 반면 심야 편성한 〈본 슈프리머시〉·〈조선명탐정〉은 0.05~0.10대 — 같은 채널도 시간대 격차가 뚜렷함' },
    @{ pill='OCN'; title='본방 1편 + 구작 다회전의 ' + (Q '프라임 티어링'); desc='9/24(목) 21:00 〈어벤져스: 인피니티 워〉(0.347)를 하루 유일 프라임 카드로 배치하고, 나머지 시간은 〈범죄도시〉·〈타짜〉 시리즈 재방으로 채움' },
    @{ pill='OCN Movies·Movies2'; title='프랜차이즈 구작 회전으로 낮 시간대 방어'; desc='〈도둑들〉·〈인턴〉·〈남산의 부장들〉 등 검증된 구작을 오전~오후에 반복 배치해 개인2049 0.20 내외를 꾸준히 유지' },
    @{ pill='cineF'; title='저비용 다편성으로 빈 슬롯만 채움'; desc='하루 10편 이상 구작·B급 영화를 연속 편성, 대부분 0.01 미만 — 〈좀비딸〉(0.180)·NCIS 재방(0.11) 등 예외적 스파이크 외엔 KPI 관련성 낮음' },
    @{ pill='OCN 자체 재방 대조'; title='같은 작품의 최초·재방 성적차는 방향이 일정하지 않음'; desc='〈포풍추영〉 본방 0.090 → 재방 0.012(하락) vs 〈정보원〉 본방 0.123 → 재방 0.193·0.206(상승) — 본문(슬라이드17)의 ' + (Q 'TV 최초 공개 교란') + ' 우려가 OCN 내부 대조에서도 재확인됨' }
  )
  for ($i = 0; $i -lt $ROWS.Count; $i++) {
    $r = $ROWS[$i]
    $base = 6 + 4 * $i
    $slide.Shapes.Item($base + 1).TextFrame.TextRange.Text = $r.pill
    $slide.Shapes.Item($base + 2).TextFrame.TextRange.Text = $r.title
    $slide.Shapes.Item($base + 3).TextFrame.TextRange.Text = $r.desc
  }
  # 남은 6~8번째 행(슬롯, 원본은 8행이었음) 숨김
  foreach ($idx in 26..37) { $slide.Shapes.Item($idx).Visible = [Microsoft.Office.Core.MsoTriState]::msoFalse }

  $slide.Shapes.Item(38).TextFrame.TextRange.Text = '수급 기준 업데이트(본문 슬라이드17 4원칙 보강)  — 기존 4원칙(TV 최초 공개 / 개봉 후 경과기간 3년 이내 / 채널체급·슬롯 상대성과 / 시간대 적합도)은 유지하되, ' + (Q '최초 공개') + ' 단독 효과는 과신하지 않음(OCN 내부 대조로 재확인). 대신 ' + (Q '프라임 1편 집중 + 구작 다회전 분산') + '의 티어링 설계가 재현성이 높고, EBS 사례처럼 온 가족이 아는 고전 IP는 채널 체급과 무관하게 통했다 — 명절 낮 시간대 가족영화 카드도 검토할 가치가 있음'
  $slide.Shapes.Item(39).TextFrame.TextRange.Text = '자료: 닐슨 실측(개인2049·전국 유료가구) · EBS·OCN·OCN Movies·OCN Movies2·cineF 09/24~09/27 편성 전수 학습 · 참고채널 데이터는 당사 편성 판단의 보조 근거로만 사용'
  $slide.Shapes.Item(40).TextFrame.TextRange.Text = 'F'
}

# ── 1) 상세판 ────────────────────────────────────────────────────────
$pp = New-Object -ComObject PowerPoint.Application
try {
  # 주의: Downloads의 "상세판.pptx"는 이미 이 스크립트의 이전 실행 결과로 덮어써진 상태(52장)라
  # 다시 돌리면 APPENDIX·E/F가 중복 삽입된다 — 반드시 원본 50장짜리 백업본에서 시작한다.
  $detailPath = Join-Path $DOWNLOADS 'ENA_2026추석_시청률분석_상세판(EBS_OCN반영전 백업).pptx'
  $pres = $pp.Presentations.Open($detailPath, $true, $false, $false)

  # slide16(FILM SOURCING 표) 복제 -> EOD(50) 앞(49번 뒤)으로 이동
  $dup1 = $pres.Slides.Item(16).Duplicate()
  $slideE = $dup1.Item(1)
  $slideE.MoveTo(50)   # 16 다음(17)에 삽입된 것을 50번(EOD 직전)으로 이동
  Fill-FilmTableSlide $slideE

  # slide49(외부기사 표) 복제 -> EOD 앞으로 이동
  $dup2 = $pres.Slides.Item(49).Duplicate()
  $slideF = $dup2.Item(1)
  $slideF.MoveTo(51)   # 49 다음(50)에 삽입된 것을 51번(EOD 직전)으로 이동
  Fill-StrategySlide $slideF

  # 원본 FILM SOURCING 두 장(16·17)의 당사 채널 4행에도 가구 시청률 병기
  Patch-OriginalFilmSlides $pres

  $outPptx = Join-Path $OUTDIR 'ENA_2026추석_시청률분석_상세판(수정).pptx'
  $pres.SaveAs($outPptx, 24)   # 24 = ppSaveAsOpenXMLPresentation (.pptx)
  $outPdf = Join-Path $OUTDIR 'ENA_2026추석_시청률분석_상세판(수정).pdf'
  $pres.SaveAs($outPdf, 32)    # 32 = ppSaveAsPDF
  $pres.Close()
  Write-Output "상세판 완료: $outPptx / $outPdf"
} finally {
  $pp.Quit()
}

# ── 2) 핵심판 (표 슬라이드 1장만 추가) ─────────────────────────────────
$pp2 = New-Object -ComObject PowerPoint.Application
try {
  $summaryPath = Join-Path $DOWNLOADS 'ENA_2026추석_시청률분석_핵심판(EBS_OCN반영전 백업).pptx'
  $pres2 = $pp2.Presentations.Open($summaryPath, $true, $false, $false)

  $dup3 = $pres2.Slides.Item(11).Duplicate()
  $slideRef = $dup3.Item(1)
  $slideRef.MoveTo(30)  # 11 다음(12)에 삽입된 것을 30번(EOD 직전)으로 이동
  Fill-FilmTableSlide $slideRef
  # 핵심판은 챕터 넘버링 방식이라 부록 표기 대신 07 섹션으로 표기
  $slideRef.Shapes.Item(2).TextFrame.TextRange.Text = '07 · REFERENCE CHANNELS'
  $slideRef.Shapes.Item(100).TextFrame.TextRange.Text = ''

  # 원본 FILM SOURCING 표(11)의 당사 채널 4행에도 가구 시청률 병기
  $slide11 = $pres2.Slides.Item(11)
  Patch-BarTableHousehold $slide11
  $slide11.Shapes.Item(99).TextFrame.TextRange.Text = '자료: 닐슨 실측(개인2049) · 개봉연도·누적 관객은 영화진흥위원회 통계 및 언론 보도 인용 근사치(반올림) · 괄호(얇은 글씨)=전국 유료가구, 당사 채널만 표기(경쟁사는 가구 데이터 미보유)'

  $outPptx2 = Join-Path $OUTDIR 'ENA_2026추석_시청률분석_핵심판(수정).pptx'
  $pres2.SaveAs($outPptx2, 24)
  $outPdf2 = Join-Path $OUTDIR 'ENA_2026추석_시청률분석_핵심판(수정).pdf'
  $pres2.SaveAs($outPdf2, 32)
  $pres2.Close()
  Write-Output "핵심판 완료: $outPptx2 / $outPdf2"
} finally {
  $pp2.Quit()
}
