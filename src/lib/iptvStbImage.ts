// skyUHD IPTV 셋톱 시청률 "화면 캡처 그림" → iptv_stb_ratings 변환(2026-11-13, 사용자 지시: 관리자 페이지 skyUHD 시청률 업로드에
// 이런 그림 파일을 넣으면 IPTV 셋톱 자료로 인식해 반영).
//
// 역할 분담(CLAUDE.md 원칙: 숫자는 LLM이 계산하지 않는다):
//  · 그림 속 표를 글자로 옮겨 적는 일만 비전 모델(gpt-4o)이 한다 — 판단·계산·추정은 시키지 않는다.
//  · 옮겨 적은 값의 검증(시각 순서·범위·시청률 범위)·방송일 환산·저장 행 만들기는 이 파일의 결정적 순수 함수가 한다.
//  · 모델이 잘못 읽을 수 있으므로 호출부(API)는 반드시 "미리보기 → 확인 후 반영" 두 단계로 쓴다.
//
// 저장 규칙은 scripts/ingest-iptv-stb.mts 와 같다: 닐슨 방송일(02:00~익일 02:00) 기준이라 달력상 00:00~01:59 에 시작한
// 구간은 전날 방송일의 24~26시대(+1440분)로 담고, "< 0.0001" 은 rating 을 비우고 below_floor 를 켠다. 같은 키는 새 값으로 바뀐다.
// 프로그램명에는 화면의 [재] 배지가 있으면 "<재>", 없으면 "<본>" 을 붙인다(사용자 지시 2026-11-11, 기존 IPTV 자료 표기와 동일).

/** 비전 모델이 그림에서 읽어 낸 한 줄(검증 전). */
export interface StbImageRow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  name: string; // 프로그램명(배지 글자 "재" 제외)
  rating: number | null; // % 단위, "< 0.0001" 처럼 바닥값이면 null
  belowFloor: boolean;
  isRerun: boolean; // 프로그램명 옆에 [재] 배지가 있으면 true
}

export interface IptvStbDbRow {
  broadcast_date: string;
  channel_code: "SKYUHD";
  start_minute: number;
  end_minute: number;
  program_name: string;
  rating: number | null;
  below_floor: boolean;
  source_file: string;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

export function hhmmToMinute(t: string): number | null {
  const m = HHMM.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 29 || mm > 59) return null;
  return h * 60 + mm;
}

function prevDate(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** 프로그램명 끝의 "<본>"·"<재>" 와 배지 글자를 걷어 낸 순수 이름. */
export function stripBroadcastTag(name: string): string {
  return name
    .replace(/\s*<\s*[본재]\s*>\s*$/u, "")
    .replace(/\s*[\[(【]\s*재\s*[\])】]\s*$/u, "")
    .trim();
}

export interface StbValidation {
  /** 반영하면 안 되는 문제(하나라도 있으면 저장 거부) */
  errors: string[];
  /** 반영은 가능하지만 사람이 눈으로 확인해야 하는 점 */
  warnings: string[];
}

/**
 * 읽어 낸 줄들을 점검한다. 달력 시각 순서(그림은 위에서 아래로 시각이 늘어난다)·길이·시청률 범위를 본다.
 * 이름 안 맞는 줄·시각 역전은 모델이 잘못 읽었을 가능성이 커서 오류로 막는다.
 */
export function validateStbRows(rows: StbImageRow[]): StbValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length === 0) errors.push("그림에서 읽어 낸 줄이 없습니다.");
  let prevStart = -1;
  let prevEnd: number | null = null;
  rows.forEach((r, i) => {
    const label = `${i + 1}번째 줄(${r.start}~${r.end} ${r.name})`;
    const s = hhmmToMinute(r.start);
    const e = hhmmToMinute(r.end);
    if (s === null || e === null) {
      errors.push(`${label}: 시각 형식이 올바르지 않습니다.`);
      return;
    }
    if (!r.name.trim()) errors.push(`${label}: 프로그램명이 비어 있습니다.`);
    if (!r.belowFloor && r.rating === null) errors.push(`${label}: 시청률이 없고 "< 0.0001" 표시도 아닙니다.`);
    if (r.rating !== null && (!Number.isFinite(r.rating) || r.rating < 0 || r.rating > 100)) errors.push(`${label}: 시청률 범위(0~100%)를 벗어났습니다.`);
    // 끝이 시작보다 이르면 자정을 넘기는 구간(예: 23:40~01:04)으로 본다. 단 맨 마지막 줄이고 끝이 새벽일 때만 허용.
    const crossesMidnight = e <= s;
    if (crossesMidnight && !(i === rows.length - 1 && e <= 6 * 60)) errors.push(`${label}: 끝 시각이 시작보다 이릅니다.`);
    if (s < prevStart) errors.push(`${label}: 앞 줄보다 시작 시각이 이릅니다(순서가 뒤섞임).`);
    const len = crossesMidnight ? e + 1440 - s : e - s;
    if (len > 4 * 60) warnings.push(`${label}: 방영 구간이 ${Math.round(len / 60)}시간으로 깁니다. 시각을 확인해 주세요.`);
    if (prevEnd !== null && s !== prevEnd) {
      const gap = s - prevEnd;
      if (gap < 0) warnings.push(`${label}: 앞 줄과 ${-gap}분 겹칩니다.`);
      else if (gap > 0) warnings.push(`${label}: 앞 줄과 ${gap}분 비어 있습니다(그림에 없는 구간이면 정상).`);
    }
    prevStart = s;
    prevEnd = e;
  });
  return { errors, warnings };
}

/** 달력 날짜 하루치 줄 → 저장 행. 00:00~01:59 에 시작한 구간은 전날 방송일의 24~26시대로 담는다. */
export function buildStbDbRows(calendarDate: string, rows: StbImageRow[], source: string): IptvStbDbRow[] {
  return rows.map((r) => {
    const s = hhmmToMinute(r.start);
    let e = hhmmToMinute(r.end);
    if (s === null || e === null) throw new Error(`시각 형식 오류: ${r.start}~${r.end}`);
    if (e <= s) e += 1440;
    const early = s < 120;
    const out: IptvStbDbRow = {
      broadcast_date: early ? prevDate(calendarDate) : calendarDate,
      channel_code: "SKYUHD",
      start_minute: early ? s + 1440 : s,
      end_minute: early ? e + 1440 : e,
      program_name: `${stripBroadcastTag(r.name)} <${r.isRerun ? "재" : "본"}>`,
      rating: r.belowFloor ? null : r.rating,
      below_floor: r.belowFloor,
      source_file: source,
    };
    if (out.end_minute > 1800) throw new Error(`방송일(26:00)을 넘는 구간: ${r.start}~${r.end} ${r.name}`);
    return out;
  });
}

const OPENAI_VISION_MODEL = "gpt-4o";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end", "name", "rating", "below_floor", "is_rerun"],
        properties: {
          start: { type: "string", description: "방영 시간대의 시작 시각 HH:MM(24시간제, 그림에 적힌 그대로)" },
          end: { type: "string", description: "방영 시간대의 끝 시각 HH:MM(그림에 적힌 그대로)" },
          name: { type: "string", description: "프로그램 이름. 이름 옆 작은 [재] 배지 글자는 넣지 않는다" },
          rating: { type: ["number", "null"], description: "시청률(%) 숫자 그대로. '< 0.0001' 처럼 부등호 표시면 null" },
          below_floor: { type: "boolean", description: "시청률 칸이 '< 0.0001' 처럼 부등호로 적혀 있으면 true" },
          is_rerun: { type: "boolean", description: "프로그램 이름 옆에 [재] 배지(작은 테두리 상자 안의 '재')가 있으면 true, 없으면 false" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "당신은 방송 시청률 표 캡처 그림을 글자로 옮겨 적는 필사 도구입니다.",
  "그림은 열이 '방영 시간대 / 프로그램 / 시청률(%)'인 표입니다. 위에서 아래 순서 그대로 모든 줄을 빠짐없이 옮겨 적으세요.",
  "보이는 글자와 숫자만 그대로 적고, 계산·보정·추정·요약·순서 바꾸기는 절대 하지 마세요. 흐릿해도 지어내지 말고 보이는 대로 적습니다.",
  "시청률은 소수점 이하 자릿수까지 그림 그대로 숫자로 적고, '< 0.0001' 같은 부등호 표시는 rating=null, below_floor=true 로 적습니다.",
  "프로그램 이름 바로 옆에 붙은 작은 테두리 배지 '재'는 is_rerun=true 로만 표시하고 이름에는 넣지 않습니다. 배지가 없으면 is_rerun=false 입니다.",
  "표 위쪽의 채널 로고·'내 채널' 같은 머리 부분과 표 머리글 줄은 행이 아니므로 제외합니다.",
].join("\n");

/** 그림 → 읽어 낸 줄. 키가 없거나 호출이 실패하면 사유가 담긴 오류를 던진다(호출부가 사용자에게 보여 준다). */
export async function extractStbRowsFromImage(buffer: Buffer, mime: string): Promise<StbImageRow[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 가 설정되어 있지 않아 그림을 읽을 수 없습니다.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "이 그림의 표를 모두 옮겨 적어 주세요." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}`, detail: "high" } },
            ],
          },
        ],
        response_format: { type: "json_schema", json_schema: { name: "stb_rows", strict: true, schema: SCHEMA } },
      }),
    });
    if (!res.ok) {
      // 429 는 요청 한도 초과·사용 한도(결제) 소진 두 가지가 있어 원인 코드를 함께 보여 준다
      const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = errBody?.error?.code ? `, ${errBody.error.code}` : "";
      throw new Error(`그림 인식 서비스 응답 오류(${res.status}${code})${res.status === 429 ? " — 잠시 뒤 다시 시도하거나 OpenAI 사용 한도를 확인해 주세요." : ""}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("그림 인식 결과가 비어 있습니다.");
    const parsed = JSON.parse(content) as { rows: { start: string; end: string; name: string; rating: number | null; below_floor: boolean; is_rerun: boolean }[] };
    return parsed.rows.map((r) => ({
      start: r.start.trim(),
      end: r.end.trim(),
      name: stripBroadcastTag(r.name),
      rating: r.below_floor ? null : r.rating,
      belowFloor: r.below_floor,
      isRerun: r.is_rerun,
    }));
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("그림 인식이 시간 안에 끝나지 않았습니다. 다시 시도해 주세요.");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 그림 파일 여부(MIME 또는 확장자). */
export function imageMimeOf(fileName: string, type: string): string | null {
  const t = type.toLowerCase();
  if (t === "image/png" || t === "image/jpeg" || t === "image/webp") return t;
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/**
 * 날짜 추정: 그림의 시작 시각이 닐슨에 들어 있는 skyUHD 편성(방송일별 시작 시각)과 가장 많이 맞는 달력 날짜를 고른다.
 * schedule 은 방송일 → 그날 방영 시작 분 목록(닐슨 start_time 기준, 02:00 이전은 +1440). 절반 이상 맞을 때만 돌려준다.
 */
export function suggestCalendarDate(
  rows: StbImageRow[],
  candidates: string[],
  schedule: Map<string, number[]>
): { date: string; matched: number; total: number } | null {
  let best: { date: string; matched: number; total: number } | null = null;
  for (const d of candidates) {
    let matched = 0;
    for (const r of rows) {
      const s = hhmmToMinute(r.start);
      if (s === null) continue;
      const early = s < 120;
      const day = early ? prevDate(d) : d;
      const key = early ? s + 1440 : s;
      if ((schedule.get(day) ?? []).some((m) => Math.abs(m - key) <= 2)) matched++;
    }
    if (!best || matched > best.matched) best = { date: d, matched, total: rows.length };
  }
  return best && best.total > 0 && best.matched / best.total >= 0.5 ? best : null;
}
