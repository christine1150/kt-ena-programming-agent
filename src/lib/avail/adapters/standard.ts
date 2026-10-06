// 표준 Avail 양식 어댑터(단계 06) — 콘텐츠별·채널별 Avail를 같은 열로 받는다(자료구분 열로 구분).
// 헤더는 이 표의 이름과 정확히 같아야 한다. 필수 열이 없으면 파일 전체를 거부하고, 모르는 열은 무시하지 않고 목록으로 알린다.
// 아래 예시 행은 표준 양식을 보여 주는 합성 데이터이며 실제 계약 조건이 아니다.
import type { UploadIssue } from "@/lib/admin/uploadPolicy";
import { parseDateCell } from "../dates";
import { parseEpisodeScope } from "../episodes";
import { identityMarkers, titleVariants } from "../identity";
import type { Condition, Grant, Rules, Tri } from "../types";
import type { ParseCtx } from "./contentAvail";
import { channelScopeFromCells, emptyRules, parseContractRefs, parseCountCell, parsePlatforms, rowHashOf, sha1, text } from "./common";

export interface StdColumn {
  key: string;
  header: string;
  required: boolean;
  desc: string;
  example: string;
}

export const STANDARD_COLUMNS: StdColumn[] = [
  { key: "grant_id", header: "권리ID", required: false, desc: "같은 계약을 다시 올릴 때 같은 값. 비우면 계약참조·제목·회차·채널·시작일로 자동 생성", example: "G-SAMPLE-001" },
  { key: "source_kind", header: "자료구분", required: false, desc: "콘텐츠 또는 채널(비우면 콘텐츠)", example: "콘텐츠" },
  { key: "title", header: "제목", required: true, desc: "콘텐츠 제목(시즌·편집판 표기 포함)", example: "샘플 시리즈 시즌2" },
  { key: "content_code", header: "콘텐츠코드", required: false, desc: "원본의 콘텐츠 식별 코드", example: "X-0001" },
  { key: "aliases", header: "별칭", required: false, desc: "영문 제품명·다른 표기('/'로 구분)", example: "SAMPLE SERIES #02" },
  { key: "production_year", header: "제작년도", required: false, desc: "리메이크·다른 판 구분에 중요. 모르면 비워 둠(비어 있으면 '미입력')", example: "2025" },
  { key: "origination", header: "구분", required: false, desc: "오리지널(자체 제작) 또는 수입. 비우면 표시 없음", example: "수입" },
  { key: "season", header: "시즌", required: false, desc: "시즌 번호(제목에 있으면 비워도 됨)", example: "2" },
  { key: "version", header: "편집판", required: false, desc: "확장판·더빙판 등. 일반판이면 비움", example: "" },
  { key: "episodes", header: "회차", required: true, desc: "허용 회차. 예: #1~12 / #1~12, #5제외 / 전체", example: "#1~12" },
  { key: "channels", header: "채널", required: true, desc: "허용 채널('/' 또는 ','로 구분). 전 채널은 ALL", example: "ENA/ENA Play" },
  { key: "platforms", header: "방영범위", required: false, desc: "플랫폼 표기(원문 보존)", example: "위/케/IP" },
  { key: "window_start", header: "시작일", required: true, desc: "방영 시작일(YYYY-MM-DD)", example: "2026-10-01" },
  { key: "window_end", header: "종료일", required: true, desc: "방영 종료일(YYYY-MM-DD, 당일 포함) 또는 무기한", example: "2028-09-30" },
  { key: "term", header: "기간", required: false, desc: "계약서의 기간 표기(원문 보존)", example: "2년" },
  { key: "count_limit", header: "방수", required: false, desc: "방영 가능 횟수(숫자) 또는 제한없음. 비우면 '미확인'(무제한 아님)", example: "9" },
  { key: "holdback", header: "홀드백", required: false, desc: "홀드백·동시 방영 조건 원문", example: "" },
  { key: "days_of_week", header: "허용요일", required: false, desc: "예: 월,화,수. 비우면 요일 제한 없음/미입력(검사 안 함)", example: "" },
  { key: "time_from", header: "허용시작시각", required: false, desc: "방송일 기준 시각. 예: 20:00 (25:30 가능)", example: "" },
  { key: "time_to", header: "허용종료시각", required: false, desc: "방송일 기준 시각", example: "" },
  { key: "blackout", header: "금지기간", required: false, desc: "예: 2026-12-24~2026-12-26; 2027-01-01 ('; '로 구분, 양끝 포함)", example: "" },
  { key: "min_rerun_gap_days", header: "재방간격(일)", required: false, desc: "같은 회차 재방 최소 간격", example: "" },
  { key: "first_window_channel", header: "1st window 채널", required: false, desc: "이 채널이 최초 방송한 뒤에야 다른 채널이 방영 가능", example: "" },
  { key: "approval_required", header: "승인필요", required: false, desc: "Y면 승인 증빙이 있어야 확정 가능", example: "N" },
  { key: "approval_note", header: "승인조건", required: false, desc: "승인 조건 설명", example: "" },
  { key: "usage_baseline", header: "기소진", required: false, desc: "0 = 지금까지 방영 없음, 미상 또는 비움 = 과거 방영분을 모름", example: "0" },
  { key: "contract_ref", header: "계약참조", required: false, desc: "계약 식별자(원문 계약서 내용은 넣지 않음)", example: "[0001]" },
  { key: "rights_holder", header: "권리자", required: false, desc: "권리자/거래처 식별", example: "샘플 배급사" },
  { key: "memo", header: "메모", required: false, desc: "해석하지 못한 조건은 메모에 적으면 확인 대기로 표시", example: "" },
  { key: "cost", header: "비용", required: false, desc: "선택. 비우면 가격 미확인(0원 아님)", example: "" },
  { key: "currency", header: "화폐", required: false, desc: "비용이 있을 때 KRW 등", example: "" },
];

export const STANDARD_REQUIRED = STANDARD_COLUMNS.filter((c) => c.required).map((c) => c.header);

const DOW: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

function parseClock(raw: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 26 && min < 60 ? h * 60 + min : null;
}

export function parseStandardRows(headers: string[], dataRows: { row: number; cells: unknown[] }[], ctx: ParseCtx): { grants: Grant[]; issues: UploadIssue[] } {
  const grants: Grant[] = [];
  const issues: UploadIssue[] = [];
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(h, i));
  const colOf = (key: string) => STANDARD_COLUMNS.find((c) => c.key === key)!.header;

  for (const { row, cells } of dataRows) {
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const get = (key: string): unknown => {
      const h = colOf(key);
      return idx.has(h) ? cells[idx.get(h)!] ?? null : null;
    };
    const columns: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) columns[h] = cells[i] ?? null;
    });
    const issue = (key: string, cause: string, example: string | null, severity: UploadIssue["severity"] = "warning") =>
      issues.push({ file: ctx.file, sheet: ctx.sheet, row, column: colOf(key), cause, example, severity });

    const title = text(get("title"));
    if (!title) {
      issue("title", "제목이 비어 있어 이 행을 건너뜁니다", "샘플 시리즈 시즌2", "error");
      continue;
    }
    const start = parseDateCell(get("window_start"), "start");
    const end = parseDateCell(get("window_end"), "end");
    if (start.value.state === "unknown") issue("window_start", start.issue ?? "시작일이 비어 있어 권리는 unknown으로 둡니다", "2026-10-01");
    if (end.value.state === "unknown") issue("window_end", end.issue ?? "종료일이 비어 있어 권리는 unknown으로 둡니다(무기한으로 보지 않음)", "2028-09-30 또는 무기한");
    if (start.value.state === "value" && end.value.state === "value" && end.value.value < start.value.value) issue("window_end", "종료일이 시작일보다 빠릅니다", null);

    const episodes = parseEpisodeScope(/^전체$/.test(text(get("episodes")) ?? "") ? "#1~99999" : get("episodes"));
    const allEpisodes = /^전체$/.test(text(get("episodes")) ?? "");
    if (episodes.kind === "unknown") issue("episodes", `${episodes.reason} — 허용 회차를 알 수 없어 권리는 unknown으로 둡니다`, "#1~12");

    const chRaw = text(get("channels"));
    const channels = chRaw ? channelScopeFromCells(chRaw.split(/[\/,;]/).map((x) => x.trim())) : channelScopeFromCells([null]);
    if (channels.kind === "unknown") issue("channels", "채널을 알 수 없어 권리는 unknown으로 둡니다", "ENA/ENA Play 또는 ALL");

    const count = parseCountCell(get("count_limit"));
    const rules: Rules = emptyRules();
    rules.count = { limit: count.limit, raw: count.raw };
    const plat = parsePlatforms(get("platforms"));
    rules.platformsRaw = plat.raw;

    const dowRaw = text(get("days_of_week"));
    if (dowRaw) {
      const days = dowRaw.split(/[,\s/]+/).map((d) => DOW[d.trim()]).filter(Boolean);
      rules.daysOfWeek = days.length ? { state: "value", value: [...new Set(days)].sort() } : { state: "unknown", raw: dowRaw };
      if (!days.length) issue("days_of_week", `읽을 수 없는 요일 표기: "${dowRaw}"`, "월,화,수");
    }
    const tf = parseClock(get("time_from"));
    const tt = parseClock(get("time_to"));
    if (get("time_from") || get("time_to")) {
      if (tf !== null && tt !== null) rules.timeOfDay = { state: "value", value: { fromMin: tf, toMin: tt } };
      else {
        rules.timeOfDay = { state: "unknown", raw: `${get("time_from") ?? ""}~${get("time_to") ?? ""}` };
        issue("time_from", "허용 시간대를 읽을 수 없습니다(둘 다 HH:MM 필요)", "20:00 / 25:30");
      }
    }
    const bo = text(get("blackout"));
    if (bo) {
      for (const part of bo.split(";").map((x) => x.trim()).filter(Boolean)) {
        const [a, b] = part.split("~").map((x) => x.trim());
        const da = parseDateCell(a, "start");
        const db = parseDateCell(b ?? a, "start");
        if (da.value.state === "value" && db.value.state === "value") rules.blackouts.push({ from: da.value.value, to: db.value.value });
        else issue("blackout", `읽을 수 없는 금지기간: "${part}"`, "2026-12-24~2026-12-26");
      }
    }
    const gap = text(get("min_rerun_gap_days"));
    if (gap) rules.minRerunGapDays = /^\d+$/.test(gap) ? { state: "value", value: Number(gap) } : { state: "unknown", raw: gap };
    const fw = text(get("first_window_channel"));
    if (fw) rules.firstWindowGate = { channel: fw, provenance: `${ctx.file} ${ctx.sheet} ${row}행` };

    const conditions: Condition[] = [];
    const memo = text(get("memo"));
    const holdback = text(get("holdback"));
    if (memo) conditions.push({ code: "MEMO_REVIEW", kind: "memo", raw: memo, needs: "메모에 적힌 조건을 권리 담당자가 확인" });
    if (holdback) conditions.push({ code: "HOLDBACK_REVIEW", kind: "holdback", raw: holdback, needs: "홀드백 해제 조건을 권리 담당자가 확인" });
    if (/^(y|예|네|필요)$/i.test(text(get("approval_required")) ?? "")) conditions.push({ code: "APPROVAL_REQUIRED", kind: "approval", raw: text(get("approval_note")), needs: "승인 증빙(승인자·일시)이 있어야 확정 가능" });

    const baseRaw = text(get("usage_baseline"));
    const usageBaseline: Grant["usageBaseline"] = baseRaw === "0" ? "zero" : "unknown";

    const origRaw = text(get("origination"));
    const origination: Grant["content"]["origination"] = origRaw && /오리지널|자체|^원$|^ori/i.test(origRaw) ? "original" : origRaw && /수입|구매|매입|acquired/i.test(origRaw) ? "acquired" : "unknown";
    const yearRaw = text(get("production_year"));
    const productionYear: Tri<string> = yearRaw ? { state: "value", value: yearRaw } : { state: "unknown", raw: null };

    const tv = titleVariants(title, (text(get("aliases")) ?? "").split("/").map((x) => x.trim()).filter(Boolean));
    const m = identityMarkers(title);
    const seasonRaw = text(get("season")) ?? m.season;
    const versionRaw = text(get("version")) ?? (m.versions.length ? m.versions.join("/") : null);

    const kindRaw = text(get("source_kind"));
    const kind: Grant["source"]["kind"] = kindRaw && /채널|channel/i.test(kindRaw) ? "channel_avail" : "content_avail";
    const contractRefs = parseContractRefs(get("contract_ref"));
    const providedId = text(get("grant_id"));
    const grantId = providedId ?? `st:${sha1([contractRefs.join(","), tv.mainKey, text(get("episodes")) ?? "", chRaw ?? "", start.value.state === "value" ? start.value.value : ""].join("|")).slice(0, 12)}`;
    const rowHash = rowHashOf(columns);

    const costRaw = text(get("cost"));
    const costNum = costRaw === null ? null : Number(costRaw.replace(/,/g, ""));

    grants.push({
      grantId,
      revisionId: `${grantId}#${rowHash}`,
      rowHash,
      supersedesRevisionId: null,
      status: "active",
      contractRefs,
      rightsHolder: text(get("rights_holder")),
      source: { kind, batchId: ctx.batchId, file: ctx.file, sheet: ctx.sheet, row, columns },
      enteredAt: ctx.enteredAt,
      content: {
        titleRaw: title,
        canonicalKey: tv.mainKey,
        sourceCode: text(get("content_code")),
        genreRaw: null,
        originRaw: null,
        aliases: tv.aliases,
        productionYear,
        origination,
        runtimeMin: { state: "unknown", raw: null },
        episodeCount: { state: "unknown", raw: null },
      },
      scope: {
        episodes: allEpisodes ? { kind: "all" } : episodes,
        channels,
        season: seasonRaw ? { state: "value", value: seasonRaw } : { state: "not_applicable" },
        version: versionRaw ? { state: "value", value: versionRaw } : { state: "not_applicable" },
        territory: { state: "not_applicable" },
      },
      window: { start: start.value, end: end.value, termRaw: text(get("term")), appliesRaw: null, anchor: "unknown", grouping: "unknown" },
      rules,
      conditions,
      usageBaseline,
      mergedInto: null,
      manual: null,
      optionalCommercial:
        costRaw === null && !text(get("currency"))
          ? null
          : { amount: costNum !== null && Number.isFinite(costNum) ? { state: "value", value: costNum } : { state: "unknown", raw: costRaw }, currency: text(get("currency")), billing: null },
    });
  }
  return { grants, issues };
}

/** 표준 양식 안내용 합성 예시(실제 계약 아님). */
export function standardTemplateRows(): string[][] {
  const row = (o: Record<string, string>) => STANDARD_COLUMNS.map((c) => o[c.key] ?? "");
  return [
    row({ title: "샘플 시리즈 시즌2", aliases: "SAMPLE SERIES #02", production_year: "2025", origination: "수입", episodes: "#1~12", channels: "ENA/ENA Play", platforms: "위/케/IP", window_start: "2026-10-01", window_end: "2028-09-30", term: "2년", count_limit: "9", approval_required: "N", usage_baseline: "0", contract_ref: "[0001]", rights_holder: "샘플 배급사" }),
    row({ title: "샘플 예능(합성)", origination: "오리지널", episodes: "전체", channels: "ALL", window_start: "2026-01-01", window_end: "무기한", count_limit: "제한없음" }),
  ];
}

export function standardTemplateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [STANDARD_COLUMNS.map((c) => c.header), ...standardTemplateRows()];
  return "﻿" + lines.map((l) => l.map(esc).join(",")).join("\r\n") + "\r\n";
}
