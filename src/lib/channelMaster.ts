// `채널기본정보.xlsx`의 "채널 별 경쟁채널" 시트를 읽어서
// channels / competitors / target_goals 테이블에 넣을 형태로 정리하는 도우미.
// PRD.md 5번 "목표 대비 분석"·"경쟁채널 분석" 항목에 문서화된 바로 그 구조를 그대로 따른다.
import * as XLSX from "xlsx";

export const SHEET_NAME = "채널 별 경쟁채널";

/** Excel에 적힌 채널 표시명 → DB의 channels.code로 정규화한다. (예: "ENA Play" → "ENA_PLAY") */
export function toChannelCode(displayName: string): string {
  return displayName.trim().toUpperCase().replace(/\s+/g, "_");
}

/** KPI 시청률 문구에서 시장구분을 유도한다 (PRD.md 5번에 명시된 규칙 그대로). */
export function toMarket(kpiText: string): "수도권" | "전국" {
  return kpiText.trim().startsWith("수도권") ? "수도권" : "전국";
}

export interface ParsedChannelRow {
  rowIndex: number; // 원본 시트에서 몇 번째 데이터 행인지 (오류 메시지용)
  channelName: string;
  channelCode: string;
  primaryTarget: string;
  market: "수도권" | "전국";
  targetRank: string;
  targetRating: number | null;
  competitors: string[]; // "경쟁 채널" 열 (콤마 구분)
  internalComparison: string[]; // "비교 채널" 열 (자사 내부 비교 채널)
}

export interface ParseResult {
  ok: true;
  rows: ParsedChannelRow[];
}

export interface ParseError {
  ok: false;
  message: string;
}

const KNOWN_CHANNEL_CODES = new Set([
  "ENA",
  "ENA_PLAY",
  "ENA_DRAMA",
  "ENA_STORY",
  "OLIFE",
  "ONCE",
  "SKYUHD",
]);

function splitList(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** 업로드된 엑셀 파일(Buffer)을 파싱한다. 구조가 예상과 다르면 ok:false로 이유를 알려준다. */
export function parseChannelMasterWorkbook(buffer: Buffer): ParseResult | ParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: "엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    return {
      ok: false,
      message: `"${SHEET_NAME}" 시트를 찾을 수 없습니다. 시트 목록: ${workbook.SheetNames.join(", ")}`,
    };
  }

  const raw = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(sheet, {
    header: 1,
    blankrows: false,
  });

  // 1행은 헤더, 2행부터 데이터 (원본 확인 결과: 순서 | 채널명 | KPI 시청률 | 목표 등위 | 목표 시청률 | 경쟁 채널 | 비교 채널)
  const dataRows = raw.slice(1);
  if (dataRows.length === 0) {
    return { ok: false, message: "시트에 데이터가 없습니다." };
  }

  const rows: ParsedChannelRow[] = [];
  const unknownChannels: string[] = [];

  dataRows.forEach((cells, idx) => {
    const channelName = String(cells[1] ?? "").trim();
    if (!channelName) return; // 빈 행은 건너뜀

    const channelCode = toChannelCode(channelName);
    if (!KNOWN_CHANNEL_CODES.has(channelCode)) {
      unknownChannels.push(channelName);
      return;
    }

    const kpiText = String(cells[2] ?? "").trim();
    const targetRankRaw = cells[3];
    const targetRatingRaw = cells[4];
    const competitorsRaw = String(cells[5] ?? "");
    const internalComparisonRaw = String(cells[6] ?? "");

    rows.push({
      rowIndex: idx + 2, // 실제 엑셀 행 번호(1-base, 헤더 포함)
      channelName,
      channelCode,
      primaryTarget: kpiText,
      market: toMarket(kpiText),
      targetRank: String(targetRankRaw ?? "").trim(),
      targetRating:
        typeof targetRatingRaw === "number"
          ? targetRatingRaw
          : targetRatingRaw
            ? parseFloat(String(targetRatingRaw))
            : null,
      competitors: splitList(competitorsRaw),
      internalComparison: splitList(internalComparisonRaw),
    });
  });

  // 알 수 없는 채널명이 하나라도 있으면(오타 등) 전체를 중단한다 — 존재하지 않는 채널을
  // 임의로 만들지 않는다는 원칙(CLAUDE.md) 때문에, 추측해서 매핑하지 않고 사람이 확인하게 한다.
  if (unknownChannels.length > 0) {
    return {
      ok: false,
      message: `알 수 없는 채널명이 있습니다: ${unknownChannels.join(", ")} (7개 채널 목록과 정확히 일치해야 합니다)`,
    };
  }

  if (rows.length === 0) {
    return { ok: false, message: "인식할 수 있는 채널 데이터가 없습니다." };
  }

  return { ok: true, rows };
}

/** 채널 코드별 로고 파일 경로 (public/channel-logos/에 미리 복사해둔 파일과 짝을 맞춘다) */
export function logoPathFor(channelCode: string): string {
  return `/channel-logos/${channelCode}.png`;
}

// 이 업로드는 지금 시점(2026년) 기준 목표 시청률이므로 연도를 고정한다.
// 다음 해 목표가 새로 오면, 이 값을 그 해로 바꿔서 다시 업로드하면 된다
// (PRD.md 개발 단위 12번: 향후 목표 시청률은 별도 업로드 흐름으로 확장 예정).
export const TARGET_GOAL_YEAR = 2026;
