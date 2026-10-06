// 콘텐츠별 Avail 원본 어댑터(단계 06) — "(배포용) Contents Availlist_260930" 형식("소재" 시트) 기준.
// 이 어댑터는 실제 파일 1건으로 열 이름·값 형식을 검증했다. 계약 해석(방수 단위·기간 기준·홀드백·방영범위 약어)은 검증하지 못했고
// 해석 설정(interpretation.ts)과 조건(Condition)으로 남긴다. 헤더가 맞지 않으면 조용히 해석하지 않고 거부한다(detect.ts).
import type { UploadIssue } from "@/lib/admin/uploadPolicy";
import { parseDateCell } from "../dates";
import { parseEpisodeScope } from "../episodes";
import { identityMarkers, titleVariants } from "../identity";
import type { Condition, Grant, Tri } from "../types";
import { channelScopeFromCells, emptyRules, parseContractRefs, parseCountCell, parsePlatforms, rowHashOf, text } from "./common";

export const CONTENT_AVAIL_REQUIRED = ["소재코드", "소재명", "국가", "년수", "방수", "방영 시작일", "방영 종료일", "방영권 적용", "방영채널1", "방영채널2", "방영채널3", "홀드백 해제", "회차", "방영범위", "계약번호", "메모"] as const;
/** 있으면 보존·활용하는 열(없어도 거부하지 않는다) */
export const CONTENT_AVAIL_OPTIONAL = ["ID", "ID_거래처", "장르", "화질", "편수", "편분", "총분", "총시간"] as const;

export interface ParseCtx {
  file: string;
  sheet: string;
  batchId: string;
  enteredAt: string;
}

function anchorOf(applies: string | null): { anchor: Grant["window"]["anchor"]; grouping: Grant["window"]["grouping"] } {
  if (!applies) return { anchor: "unknown", grouping: "unknown" };
  const [a, g] = applies.split("/").map((x) => x.trim());
  const anchor = a === "편성일기준" ? "schedule_date" : a === "시작일지정" ? "fixed_start" : a === "제공일기준" ? "delivery_date" : a === "제한없음" ? "none" : "unknown";
  const grouping = g === "각회차별" ? "per_episode" : g === "회차일괄" ? "batch" : g === "회차그룹별" ? "group" : a === "제한없음" && !g ? "none" : "unknown";
  return { anchor, grouping };
}

const numTri = (v: unknown): Tri<number> => {
  const n = typeof v === "number" ? v : v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? { state: "value", value: n } : { state: "unknown", raw: text(v) };
};

/** 헤더 행 아래의 데이터 행을 Grant로 바꾼다. headers는 헤더 행의 열 이름(왼→오). */
export function parseContentAvailRows(headers: string[], dataRows: { row: number; cells: unknown[] }[], ctx: ParseCtx): { grants: Grant[]; issues: UploadIssue[] } {
  const grants: Grant[] = [];
  const issues: UploadIssue[] = [];
  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h && !idx.has(h)) idx.set(h, i);
  });
  const seenCodes = new Map<string, number>();

  for (const { row, cells } of dataRows) {
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const get = (h: string): unknown => (idx.has(h) ? cells[idx.get(h)!] ?? null : null);
    const columns: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) columns[h] = cells[i] ?? null;
    });
    const issue = (column: string | null, cause: string, example: string | null, severity: UploadIssue["severity"] = "error") =>
      issues.push({ file: ctx.file, sheet: ctx.sheet, row, column, cause, example, severity });

    const code = text(get("소재코드"));
    const title = text(get("소재명"));
    if (!code) {
      issue("소재코드", "소재코드가 비어 있어 이 행의 권리를 식별할 수 없어 건너뜁니다", "D26081201");
      continue;
    }
    if (!title) {
      issue("소재명", "소재명이 비어 있어 건너뜁니다", null);
      continue;
    }
    if (seenCodes.has(code)) {
      issue("소재코드", `같은 파일의 ${seenCodes.get(code)}행과 소재코드가 같아 이 행을 건너뜁니다(합산하지 않음)`, null);
      continue;
    }
    seenCodes.set(code, row);

    const start = parseDateCell(get("방영 시작일"), "start");
    const end = parseDateCell(get("방영 종료일"), "end");
    if (start.issue) issue("방영 시작일", start.issue, "2026-10-01", "warning");
    if (end.issue) issue("방영 종료일", end.issue, "2026-10-01", "warning");
    if (start.value.state === "value" && end.value.state === "value" && end.value.value < start.value.value) issue("방영 종료일", "종료일이 시작일보다 빠릅니다", null, "warning");

    const appliesRaw = text(get("방영권 적용"));
    const { anchor, grouping } = anchorOf(appliesRaw);
    if (appliesRaw && anchor === "unknown") issue("방영권 적용", `알 수 없는 방영권 적용 표기: "${appliesRaw}"`, "시작일지정/회차일괄", "warning");

    const count = parseCountCell(get("방수"));
    if (count.limit.state === "unknown" && count.raw) issue("방수", `읽을 수 없는 방수 표기: "${count.raw}"`, "4방 또는 제한없음", "warning");

    const episodes = parseEpisodeScope(get("회차"));
    if (episodes.kind === "unknown") issue("회차", `${episodes.reason} — 허용 회차를 알 수 없어 권리는 unknown으로 둡니다`, "#1~12", "warning");

    const channels = channelScopeFromCells([get("방영채널1"), get("방영채널2"), get("방영채널3")]);
    if (channels.kind === "unknown") issue("방영채널1", "방영 채널을 알 수 없어 권리는 unknown으로 둡니다", "ENA", "warning");

    const plat = parsePlatforms(get("방영범위"));
    const rules = emptyRules();
    rules.count = { limit: count.limit, raw: count.raw };
    rules.platformsRaw = plat.raw;

    const conditions: Condition[] = [];
    const memo = text(get("메모"));
    const holdback = text(get("홀드백 해제"));
    if (memo) conditions.push({ code: "MEMO_REVIEW", kind: "memo", raw: memo, needs: "메모에 적힌 채널·시점 제한을 권리 담당자가 확인" });
    if (holdback) conditions.push({ code: "HOLDBACK_REVIEW", kind: "holdback", raw: holdback, needs: "홀드백 해제 조건을 권리 담당자가 확인(본방 종료 후 시점·동시 방영 조건 등)" });

    const tv = titleVariants(title);
    const markers = identityMarkers(title);
    const genre = text(get("장르"));
    const runtime = numTri(get("편분"));
    const eps = numTri(get("편수"));
    if (episodes.kind === "ranges" && eps.state === "value") {
      const span = episodes.ranges.reduce((a, [x, y]) => a + (y - x + 1), 0) - episodes.excluded.reduce((a, [x, y]) => a + (y - x + 1), 0);
      if (span !== eps.value) issue("회차", `회차 범위(${span}편)와 편수(${eps.value})가 다릅니다`, null, "warning");
    }

    const grantId = `ca:${code}`;
    const rowHash = rowHashOf(columns);
    const holder = get("ID_거래처");
    grants.push({
      grantId,
      revisionId: `${grantId}#${rowHash}`,
      rowHash,
      supersedesRevisionId: null,
      status: "active",
      contractRefs: parseContractRefs(get("계약번호")),
      rightsHolder: holder === null || holder === undefined ? null : String(holder),
      source: { kind: "content_avail", batchId: ctx.batchId, file: ctx.file, sheet: ctx.sheet, row, columns },
      enteredAt: ctx.enteredAt,
      content: {
        titleRaw: title,
        canonicalKey: tv.mainKey,
        sourceCode: code,
        genreRaw: genre,
        originRaw: text(get("국가")),
        aliases: tv.aliases,
        productionYear: { state: "unknown", raw: null },
        origination: "unknown",
        runtimeMin: runtime,
        episodeCount: eps,
      },
      scope: {
        episodes,
        channels,
        season: markers.season ? { state: "value", value: markers.season } : { state: "not_applicable" },
        version: markers.versions.length ? { state: "value", value: markers.versions.join("/") } : { state: "not_applicable" },
        territory: { state: "not_applicable" },
      },
      window: { start: start.value, end: end.value, termRaw: text(get("년수")), appliesRaw, anchor, grouping },
      rules,
      conditions,
      usageBaseline: "unknown",
      mergedInto: null,
      manual: null,
      optionalCommercial: null,
    });
  }
  return { grants, issues };
}
