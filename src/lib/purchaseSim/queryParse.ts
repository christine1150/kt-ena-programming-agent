// 구매 시뮬레이터 — 자연어 질의 해석(결정론적 규칙). 예: "라디오스타 금요일 밤 10시 수도권2049"
// → 프로그램 검색어 / 요일 / 시작시각 / 타깃 / 채널. 프로그램명 확정은 여기서 하지 않는다(DB 식별 계층 몫).
// LLM 없이 정규식으로만 추출하고, 모호한 표현("10시"만)은 임의로 확정하지 않고 후보를 돌려준다.

export type SimTarget = "A2049" | "HH" | "A2039" | "F3049";

export interface ParsedPredictionQuery {
  raw: string;
  programQuery: string; // 요일·시간·타깃·채널·군더더기를 걷어낸 프로그램 검색어(조사 제거본)
  rawProgramText: string; // 조사 제거 전(검색 폴백용)
  isoDow: number | null; // 1=월 … 7=일
  date: string | null; // 명시된 날짜(YYYY-MM-DD)
  startTime: string | null; // "HH:MM"(달력 시각, 00~05시는 새벽)
  startTimeCandidates: string[]; // 오전/오후가 불명확할 때 가능한 시각들
  timeOfDayHint: "새벽" | "오전" | "낮" | "저녁" | "밤" | null;
  target: SimTarget | null;
  channelCode: string | null;
  notes: string[];
}

const DOW_MAP: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

// 문장에서 요일·시간·타깃·채널과 무관한 군더더기 단어(프로그램명 후보에서 제거)
const STOP_WORDS = new Set([
  "틀면", "틀어봐", "틀어줘", "틀어", "틀까", "편성하면", "편성", "편성해", "편성하면요", "하면", "해보면", "해서", "시청률", "예상", "예측",
  "얼마나", "나올까", "나와", "나올", "어때", "어떨까", "어떻게", "알려줘", "보고", "싶어", "싶다", "좀", "있던", "있었던", "있는", "방영", "방송",
  "프로그램", "콘텐츠", "에서", "으로", "이", "를", "을", "의", "는", "은", "가", "도", "만", "그", "이거", "저", "혹시", "만약", "때", "하면은", "산다면", "사면", "구매하면", "구매", "사오면",
]);
const PARTICLES = ["에서", "으로", "에게", "에는", "을", "를", "은", "는", "이", "가", "도", "만", "로", "에", "의", "과", "와"];

function stripParticle(tok: string): string {
  for (const p of PARTICLES) {
    if (tok.length - p.length >= 2 && tok.endsWith(p) && /[가-힣]/.test(tok[tok.length - p.length - 1])) return tok.slice(0, tok.length - p.length);
  }
  return tok;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface TimeHit {
  start: number;
  end: number;
  startTime: string | null;
  candidates: string[];
  hint: ParsedPredictionQuery["timeOfDayHint"];
}

function parseTime(text: string): TimeHit | null {
  // "22:00" / "22시 30분"
  let m = /(?<![\d:])([01]?\d|2[0-5]):([0-5]\d)(?![\d:])/.exec(text);
  if (m) {
    const h = Number(m[1]);
    return { start: m.index, end: m.index + m[0].length, startTime: `${pad(h % 24)}:${m[2]}`, candidates: [], hint: null };
  }
  m = /(오전|오후|새벽|아침|낮|저녁|밤)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/.exec(text);
  if (m) {
    const period = m[1] as string | undefined;
    let h = Number(m[2]);
    const minute = m[4] ? 30 : m[3] ? Number(m[3]) : 0;
    const hint = (period === "아침" ? "오전" : period) as ParsedPredictionQuery["timeOfDayHint"] | undefined;
    const mk = (hh: number) => `${pad(hh % 24)}:${pad(minute)}`;
    if (h > 24) return null;
    if (period === "오후" || period === "저녁") {
      if (h < 12) h += 12;
      return { start: m.index, end: m.index + m[0].length, startTime: mk(h), candidates: [], hint: hint ?? null };
    }
    if (period === "밤") {
      // 밤 6~11시 = 18~23시, 밤 12시 = 24시(자정), 밤 1~5시 = 새벽 1~5시(익일)
      if (h >= 6 && h <= 11) h += 12;
      return { start: m.index, end: m.index + m[0].length, startTime: mk(h), candidates: [], hint: "밤" };
    }
    if (period === "새벽" || period === "오전" || period === "아침") {
      if (period === "오전" && h === 12) h = 0;
      return { start: m.index, end: m.index + m[0].length, startTime: mk(h), candidates: [], hint: hint ?? null };
    }
    if (period === "낮") {
      if (h < 12 && h <= 5) h += 12;
      return { start: m.index, end: m.index + m[0].length, startTime: mk(h), candidates: [], hint: "낮" };
    }
    // 오전/오후 표현이 없다
    if (h >= 13 || h === 0) return { start: m.index, end: m.index + m[0].length, startTime: mk(h), candidates: [], hint: null };
    return { start: m.index, end: m.index + m[0].length, startTime: null, candidates: Array.from(new Set([mk(h), mk(h + 12)])), hint: null };
  }
  return null;
}

export function parsePredictionQuery(raw: string, now: Date = new Date()): ParsedPredictionQuery {
  let text = ` ${raw.normalize("NFC")} `;
  const notes: string[] = [];
  const cut = (start: number, end: number) => {
    text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
  };

  // 채널 (ENA / ENA Play / ENA 드라마 …)
  let channelCode: string | null = null;
  const ch = /(ENA\s*(PLAY|플레이)|에나\s*플레이)|(ENA\s*(DRAMA|드라마)|에나\s*드라마)|(ENA\s*(STORY|스토리))|(OLIFE|올라이프)|(ONCE|원스)(?![가-힣A-Za-z])|(ENA|에나)(?![A-Za-z])/i.exec(text);
  if (ch) {
    channelCode = ch[1] ? "ENA_PLAY" : ch[3] ? "ENA_DRAMA" : ch[6] ? "ENA_STORY" : ch[8] ? "OLIFE" : ch[10] ? "ONCE" : "ENA";
    cut(ch.index, ch.index + ch[0].length);
  }

  // 타깃
  let target: SimTarget | null = null;
  const tg = /(수도권|개인|남녀)?\s*(2049|2039|여자?\s*3049|여\s*3049)|유료\s*방송\s*가?\s*구|유료\s*가구|가구\s*시청률|가구/.exec(text);
  if (tg) {
    const t = tg[0].replace(/\s+/g, "");
    target = /2049/.test(t) ? "A2049" : /2039/.test(t) ? "A2039" : /3049/.test(t) ? "F3049" : "HH";
    cut(tg.index, tg.index + tg[0].length);
  }

  // 날짜(명시): YYYY-MM-DD, M월 D일
  let date: string | null = null;
  const d1 = /(20\d{2})-(\d{2})-(\d{2})/.exec(text);
  const d2 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (d1) {
    date = d1[0];
    cut(d1.index, d1.index + d1[0].length);
  } else if (d2) {
    const mm = Number(d2[1]);
    const dd = Number(d2[2]);
    let yy = now.getFullYear();
    const cand = new Date(Date.UTC(yy, mm - 1, dd));
    if (cand.getTime() < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - 86400000 * 30) yy += 1;
    date = `${yy}-${pad(mm)}-${pad(dd)}`;
    cut(d2.index, d2.index + d2[0].length);
  }

  // 요일
  let isoDow: number | null = null;
  const dw = /([월화수목금토일])\s*(요일|욜)/.exec(text);
  if (dw) {
    isoDow = DOW_MAP[dw[1]];
    cut(dw.index, dw.index + dw[0].length);
  }
  if (date) {
    const js = new Date(`${date}T00:00:00Z`).getUTCDay();
    const fromDate = js === 0 ? 7 : js;
    if (isoDow !== null && isoDow !== fromDate) notes.push("입력한 요일과 날짜의 요일이 달라 날짜를 우선했습니다.");
    isoDow = fromDate;
  }

  // 시각
  let startTime: string | null = null;
  let startTimeCandidates: string[] = [];
  let hint: ParsedPredictionQuery["timeOfDayHint"] = null;
  const th = parseTime(text);
  if (th) {
    startTime = th.startTime;
    startTimeCandidates = th.candidates;
    hint = th.hint;
    cut(th.start, th.end);
  } else {
    const hm = /(새벽|오전|낮|저녁|밤)(?:에|엔)?(?![가-힣])/.exec(text);
    if (hm) {
      hint = hm[1] as ParsedPredictionQuery["timeOfDayHint"];
      cut(hm.index, hm.index + hm[0].length);
    }
  }
  if (startTime === null && startTimeCandidates.length === 0 && hint) notes.push(`'${hint}'만으로는 시작 시각을 정할 수 없어 선택이 필요합니다.`);
  if (startTimeCandidates.length > 0) notes.push("오전/오후가 불명확해 시작 시각을 선택해야 합니다.");

  // 프로그램 검색어: 남은 토큰에서 군더더기·조사 제거
  const rest = text.replace(/[?？!.,~]+/g, " ").trim();
  const rawTokens = rest.split(/\s+/).filter(Boolean);
  const rawProgramText = rawTokens.filter((t) => !STOP_WORDS.has(t)).join(" ");
  const stripped = rawTokens
    .map((t) => (STOP_WORDS.has(t) ? "" : stripParticle(t)))
    .filter((t) => t && !STOP_WORDS.has(t));
  const programQuery = stripped.join(" ");

  return { raw, programQuery, rawProgramText, isoDow, date, startTime, startTimeCandidates, timeOfDayHint: hint, target, channelCode, notes };
}
