// 사내 소개 발표 「도와줘, 편성 비서!」 슬라이드 순서·대사·실제 화면 주소(2026-11-27, 사용자 요청).
// 만화 → 실제 사이트 화면(같은 사이트를 iframe으로) → 만화 순서로 넘긴다. 내용을 고치려면 이 파일만 고치면 된다.
// - 만화 그림: public/intro/comics/<img> 에 같은 이름으로 넣으면 자동으로 보인다(없으면 '그림 자리' 상자).
// - 실제 화면이 안 뜰 때 대비 캡처: src/content/intro/fallback/<fallback> (로그인한 사람만 /api/intro/fallback 로 받음).
// - only15: 15분 판에서만 보이는 장. 10분 판은 /intro?min=10.

export type Line = { who: string; text: string };

export type Slide =
  | { kind: "cover"; title: string; subtitle: string; img?: string; notes?: string; only15?: boolean }
  | { kind: "comic"; scene: string; step: "intro" | "problem" | "solution" | "happy"; imgs: string[]; alt: string; lines: Line[]; punch?: string; notes?: string; only15?: boolean }
  | { kind: "live"; scene: string; title: string; point: string; url: string; focusText?: string; fallback: string; notes?: string; only15?: boolean }
  | { kind: "closing"; title: string; items: { who: string; what: string }[]; footer: string; notes?: string; only15?: boolean };

const S1 = "장면 1 · 아침 7시 반의 불안";
const S2 = "장면 2 · 어제 성적표";
const S3 = "장면 3 · 이 작품, 통할까?";
const S4 = "장면 4 · 다음 달엔 뭘 틀지?";
const S5 = "장면 5 · 우리 채널은 언제 틀 수 있어?";
const S6 = "장면 6 · 달력 전쟁";
const S7 = "장면 7 · 보고하래!";

export const SLIDES: Slide[] = [
  {
    kind: "cover",
    title: "도와줘, 편성 비서!",
    subtitle: "KT ENA AI 편성비서 — 내일 아침부터 이렇게 씁니다",
    img: "00-character.png",
    notes: "인사. '오늘은 기능 설명 대신, 우리가 매일 겪는 곤란한 순간 7가지를 보여 드리겠습니다.'",
  },
  {
    kind: "comic",
    scene: "오프닝",
    step: "intro",
    imgs: ["00-night-1.png", "00-night-2.png", "00-night-3.png", "00-night-4.png"],
    alt: "여러분이 자는 동안 비서가 하는 일 4컷 — 새벽 3~4시 후보 줄 세우기·지난주 변화 찾기, 5시 20분 편성표 확인, 7시 닐슨 메일 지키기, 7시 반 뉴스 스크랩",
    lines: [{ who: "편성 비서", text: "여러분이 자는 동안, 저는 일합니다." }],
    punch: "닐슨 메일이 오면 자동 반영 · 뉴스는 7시 반에 정리 완료",
    notes: "새벽 5시 20분 포털 편성표 확인, 7시부터 닐슨 메일 대기(11시까지 5분마다), 7시 반 뉴스 스크랩, 10시 반 뉴스 추가 갱신. 월요일 새벽엔 구매 후보·지난주 변화 정리.",
  },

  // ── 장면 1 ─────────────────────────────
  {
    kind: "comic", scene: S1, step: "problem", imgs: ["s1-problem.png"],
    alt: "출근길 지하철, 마케터는 출연자 걱정에 사색, 심의 담당은 규정집이 날아다님",
    lines: [
      { who: "콘텐츠 마케터", text: "어젯밤 사이 우리 출연자가 사고 친 건 아니겠지? 불안해!" },
      { who: "심의 담당", text: "방송 정책이 바뀐 걸 빨리 알 수 없을까?" },
    ],
  },
  {
    kind: "comic", scene: S1, step: "solution", imgs: ["s1-solution.png"],
    alt: "비서가 색깔 띠로 나뉜 뉴스 목록을 내밈",
    lines: [{ who: "편성 비서", text: "제가 밤새 골라 놨어요. 브리핑 아래 '주요 뉴스'를 보세요!" }],
  },
  {
    kind: "live", scene: S1, title: "브리핑 › 주요 뉴스", point: "'출연자 이슈'와 '정책' 칸만 보면 끝",
    url: "/", focusText: "주요 뉴스", fallback: "news.png",
    notes: "가운데 '출연자 이슈'(감시 명단에 등록된 출연자만), 왼쪽 아래 '정책'. 기사 제목을 누르면 새 창으로 원문.",
  },
  {
    kind: "comic", scene: S1, step: "happy", imgs: ["s1-happy.png"],
    alt: "마케터와 심의 담당이 커피를 들고 웃으며 출근",
    lines: [], punch: "위험 기사와 정책 뉴스는 비서가 먼저 찾아 둡니다.",
  },

  // ── 장면 2 ─────────────────────────────
  {
    kind: "comic", scene: S2, step: "problem", imgs: ["s2-problem.png"],
    alt: "편성 PD가 엑셀 출력물 산에 파묻혀 눈이 빙글빙글",
    lines: [{ who: "편성 PD", text: "어제 내 편성, 경쟁사를 제쳤을까?" }],
  },
  {
    kind: "comic", scene: S2, step: "solution", imgs: ["s2-solution.png"],
    alt: "비서가 종이 산을 카드 7장으로 바꿈",
    lines: [{ who: "편성 비서", text: "엑셀은 그만! 7개 채널 성적표는 이미 만들어 놨어요." }],
  },
  {
    kind: "live", scene: S2, title: "브리핑 › 오늘의 시청률", point: "7개 채널 어제 성적과 순위 ▲▼가 한 화면에",
    url: "/", fallback: "briefing.png",
    notes: "카드마다 시청률·순위·목표 달성률. 파란 줄은 평소보다 잘 나온 방송.",
  },
  {
    kind: "live", scene: S2, title: "브리핑 › 동시간대 순위", point: "경쟁사 프로그램 사이에서 우리 작품이 몇 위인지",
    url: "/", focusText: "드라마·예능", fallback: "ranking.png", only15: true,
    notes: "수도권 2049 기준 전 채널 1~20위. ENA 칸이 파랗게 표시됨.",
  },
  {
    kind: "live", scene: S2, title: "시청률 표", point: "숫자만 크게 — 옆 창에 띄워 두고 보세요",
    url: "/ratings?tab=daily", fallback: "ratings.png", only15: true,
    notes: "메뉴 '시청률 표'는 새 창으로 열림. 평균 넘은 방송은 파란색.",
  },
  {
    kind: "comic", scene: S2, step: "happy", imgs: ["s2-happy.png"],
    alt: "깔끔한 책상에서 만세 부르는 편성 PD",
    lines: [], punch: "아침 엑셀 열기는 이제 그만.",
  },

  // ── 장면 3 ─────────────────────────────
  {
    kind: "comic", scene: S3, step: "problem", imgs: ["s3-problem.png"],
    alt: "회의실, 마케터·편성 PD·재제작 담당이 각자 고민",
    lines: [
      { who: "콘텐츠 마케터", text: "기사 쓸 우리 오리지널 성적 추이, 경쟁작 성과까지 한눈에 볼 수 없을까?" },
      { who: "편성 PD", text: "ENA에서 튼 오리지널, 과연 내 채널에서 틀어도 괜찮을까?" },
      { who: "재제작 담당", text: "재방으로 다시 돌릴 만한 작품은 뭐지?" },
    ],
  },
  {
    kind: "comic", scene: S3, step: "solution", imgs: ["s3-solution.png"],
    alt: "비서가 돋보기로 프로그램 카드를 비추자 채널별 막대가 솟음",
    lines: [{ who: "편성 비서", text: "작품 이름 하나만 검색하세요. 채널마다 성적을 나란히 보여 드릴게요." }],
  },
  {
    kind: "live", scene: S3, title: "프로그램 성과 › 크래시2", point: "채널마다 평균보다 잘했는지 — 맨 위 한 줄이 결론",
    url: "/program-performance?group=" + encodeURIComponent("크래시2"), fallback: "perf-crash2.png",
    notes: "맨 위 문장: 'ENA·ENA Drama에서는 평균보다 높지만, ENA Play에서는 평균에 못 미칩니다.' 괄호 %는 채널 평균 대비. '본방 / 본방 외' 버튼으로 재방 성적만 따로(재제작 담당).",
  },
  {
    kind: "live", scene: S3, title: "프로그램 성과 › 나솔사계", point: "경쟁 채널 동시방송까지 같은 표에서 비교",
    url: "/program-performance?group=" + encodeURIComponent("나는SOLO그후사랑은계속된다"), fallback: "perf-nasol.png", only15: true,
    notes: "SBS Plus 동시방송 행. 아래 그래프에서 회차별 흐름(기사용 추이).",
  },
  {
    kind: "comic", scene: S3, step: "happy", imgs: ["s3-happy.png"],
    alt: "세 사람이 비서를 헹가래",
    lines: [], punch: "이미 틀어 본 성적이 답입니다.",
  },

  // ── 장면 4 ─────────────────────────────
  {
    kind: "comic", scene: S4, step: "problem", imgs: ["s4-problem.png"],
    alt: "편성 PD가 수정구슬로 다음 달을 점치고, 옛날 작품 상자 앞에서 동전 던지기",
    lines: [{ who: "편성 PD", text: "다음 달에 사람들이 많이 볼 프로그램이 뭐지? 그 출연자 옛날 작품을 미리 사 둘까?" }],
  },
  {
    kind: "comic", scene: S4, step: "solution", imgs: ["s4-solution.png"],
    alt: "비서가 달력 두루마리를 펼치고 상자를 저울에 올림",
    lines: [{ who: "편성 비서", text: "다음 달 화제작은 라인업에서, 사 올 작품 성적은 시뮬레이터에서!" }],
  },
  {
    kind: "live", scene: S4, title: "라인업", point: "자사·경쟁사 첫방·종영과 출연진을 한 장에",
    url: "/lineup", fallback: "lineup.png",
    notes: "작품 막대를 누르면 오른쪽 상세: 첫 방송·종영·주연·동시간대 경쟁·같은 장르 기간 중첩.",
  },
  {
    kind: "live", scene: S4, title: "구매시뮬레이터", point: "사 올 작품을 우리 채널에 넣으면 예상 시청률은?",
    url: "/ideal-schedule/purchase", fallback: "purchase.png",
    notes: "작품명 입력 → 찾기 → ⚠ '예측 기록으로 남김' 체크를 끄고 → 예상 시청률 보기. 확정치가 아닌 기대값(범위 포함), 가격·ROI는 계산하지 않음.",
  },
  {
    kind: "comic", scene: S4, step: "happy", imgs: ["s4-happy.png"],
    alt: "편성 PD가 상자를 안고 신나서 깡충",
    lines: [], punch: "화제작은 라인업에서, 사 올 작품 성적은 시뮬레이터에서.",
  },

  // ── 장면 5 ─────────────────────────────
  {
    kind: "comic", scene: S5, step: "problem", imgs: ["s5-problem.png"],
    alt: "운행 담당이 첫방 버튼 앞에서 얼어붙고, 편성 PD는 발을 동동",
    lines: [
      { who: "운행 담당", text: "이 드라마 첫방이 언제야? 나 홀드백 어긴 건 아니겠지?" },
      { who: "편성 PD", text: "ENA 첫방일은 알겠는데, 대체 우리 채널은 언제 틀 수 있는 거야!?" },
    ],
  },
  {
    kind: "comic", scene: S5, step: "solution", imgs: ["s5-solution.png"],
    alt: "비서가 달력 위 파란 점선 문을 열어 줌",
    lines: [{ who: "편성 비서", text: "달력에 파란 점선이 뜬 날부터 틀어도 돼요!" }],
  },
  {
    kind: "live", scene: S5, title: "라인업 › 캘린더 · 방영 가능(ENA Drama)", point: "파란 점선 칸 = 우리 채널에서 틀 수 있는 날",
    url: "/lineup?view=calendar&month=2026-12&can=ENA_DRAMA", fallback: "holdback.png",
    notes: "'◇ ≈23:03~ 크래시2 9회' 같은 점선 칸. 오른쪽 위 '방영 가능 · ENA Drama'를 다른 채널로 바꿔 보기. 첫방일은 작품을 누르면 상세에.",
  },
  {
    kind: "comic", scene: S5, step: "happy", imgs: ["s5-happy.png"],
    alt: "운행 담당은 안심하고 버튼을 누르고, PD는 깃발 들고 입장",
    lines: [], punch: "ENA 첫방은 진한 칸, 우리 채널은 점선 뜬 날부터.", only15: true,
  },

  // ── 장면 6 ─────────────────────────────
  {
    kind: "comic", scene: S6, step: "problem", imgs: ["s6-problem.png"],
    alt: "OAP 담당에게 급해요 쪽지가 화살처럼 날아오고, 운행·재제작 담당은 긴 테이프 속에서 헤맴",
    lines: [
      { who: "OAP 담당", text: "이번 달 이벤트가 뭐가 있더라? 다들 급하대! 진짜 우선순위는 뭐야?" },
      { who: "운행·재제작 담당", text: "언제 시작하고 끝나는지 알아야 미리 만들고, 끝난 건 지우지!" },
    ],
    only15: true,
  },
  {
    kind: "comic", scene: S6, step: "solution", imgs: ["s6-solution.png"],
    alt: "비서가 달력을 뒤집자 일정이 순서대로 나타나고 쪽지들이 줄을 섬",
    lines: [{ who: "편성 비서", text: "달력 한 장이면 돼요. 맨 윗줄은 이벤트, 진한 칸이 먼저!" }],
    only15: true,
  },
  {
    kind: "live", scene: S6, title: "라인업 › 12월 캘린더", point: "이벤트 · 첫방 ↦ · 종영 ⇥ · 방송 순서가 한 달력에",
    url: "/lineup?view=calendar&month=2026-12", fallback: "calendar.png",
    notes: "25일 성탄절·1.1 신정(이벤트 띠), 첫방 ↦·종영 ⇥ 아이콘과 방송 시각, 자사 큰 일정은 진한 칸. '목록'·'저장·인쇄'로 한 장 출력.",
  },
  {
    kind: "comic", scene: S6, step: "happy", imgs: ["s6-happy.png"],
    alt: "OAP 담당이 슬레이트를 치고, 운행·재제작 담당은 하이파이브",
    lines: [], punch: "이번 달 시작과 끝, 우선순위까지 라인업 한 장으로.",
    only15: true,
  },

  // ── 장면 7 ─────────────────────────────
  {
    kind: "comic", scene: S7, step: "problem", imgs: ["s7-problem.png"],
    alt: "퇴근 직전 팀장 그림자가 서류를 내밀고 직원이 돌처럼 굳음",
    lines: [{ who: "누구나", text: "팀장님이 내일까지 정리해 오래…" }],
  },
  {
    kind: "comic", scene: S7, step: "solution", imgs: ["s7-solution.png"],
    alt: "비서가 모니터에서 문서와 슬라이드를 뽑아 줌",
    lines: [{ who: "편성 비서", text: "보고 있던 화면 그대로 Word·PPT로 뽑아 드릴게요." }],
  },
  {
    kind: "live", scene: S7, title: "보고서", point: "Word 다운로드 · PDF 저장 · PPT 미리보기",
    url: "/audience-report/portfolio", fallback: "report.png",
    notes: "처음 만들 때 30초~1분 걸림 — 발표 전에 'P'로 미리 불러 두기. 채널별 분석 화면에도 W·P 버튼.",
  },
  {
    kind: "comic", scene: S7, step: "happy", imgs: ["s7-happy.png"],
    alt: "노을 속 칼퇴하며 비서에게 손 흔드는 직원",
    lines: [], punch: "보는 화면이 곧 보고서.",
  },

  // ── 엔딩 ───────────────────────────────
  {
    kind: "comic", scene: "엔딩", step: "intro", imgs: ["99-ending.png"],
    alt: "직원들은 웃으며 퇴근하고, 비서는 혼자 남아 모니터를 켬",
    lines: [{ who: "편성 비서", text: "그럼 저는 출근! 내일 아침에도 먼저 와 있을게요." }],
  },
  {
    kind: "closing",
    title: "내일 아침, 딱 하나만 해 보세요",
    items: [
      { who: "편성 PD", what: "브리핑 → 프로그램 성과에서 내 채널 작품 검색" },
      { who: "콘텐츠 마케터", what: "주요 뉴스 '출연자 이슈' → 프로그램 성과 → 보고서" },
      { who: "심의 담당", what: "주요 뉴스 '정책' 칸" },
      { who: "운행 담당", what: "라인업 캘린더의 첫방 ↦ · 종영 ⇥ · 파란 점선" },
      { who: "재제작 담당", what: "프로그램 성과 '본방 외' + 라인업 종영일" },
      { who: "OAP 담당", what: "라인업 맨 윗줄 이벤트 띠와 방송 순서" },
    ],
    footer: "접속: 사내 계정으로 로그인 · 자세한 설명은 나눠 드린 리플렛",
  },
];
