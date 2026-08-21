// OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 적재 — 관리자 업로드 API와 백필 스크립트가 반드시 같은
// 로직을 태워야 한다는 이 프로젝트의 고정 결정(nielsenIngest.ts와 동일 원칙)을 따라, 파싱 이후의
// upsert 로직을 이 함수 하나로 공유한다.
import { supabase } from "@/lib/supabase";
import { parseEbsCatalogWorkbook, type OlifeCatalogRow } from "@/lib/olifeEpisodeParsing";

export interface CatalogIngestResult {
  ok: true;
  fileName: string;
  seriesCounts: Record<string, number>;
  totalRows: number;
  upserted: number;
}
export interface CatalogIngestError {
  ok: false;
  fileName: string;
  message: string;
}

export async function ingestOlifeEpisodeCatalogFile(buffer: Buffer, fileName: string): Promise<CatalogIngestResult | CatalogIngestError> {
  const parsed = parseEbsCatalogWorkbook(buffer, fileName);
  if (!parsed.ok) {
    return { ok: false, fileName, message: parsed.message };
  }

  const seriesCounts: Record<string, number> = {};
  for (const r of parsed.rows) seriesCounts[r.seriesName] = (seriesCounts[r.seriesName] ?? 0) + 1;

  // series_name + subtitle_norm이 유니크 제약이라, 같은 회차가 다른 파일에 다시 나와도 최신 내용으로
  // 덮어쓴다(재업로드 시 갱신되는 다른 업로드 기능과 동일한 원칙).
  // 실측 확인(2026-08-22): 정규화(공백·구두점 제거) 결과 같은 부제로 합쳐지는 서로 다른 원본 행이
  // 실제로 존재해(예: "특수청소부" vs "특수 청소" → 둘 다 "특수청소") 한 배치 안에서 같은 키가
  // 두 번 이상 나오면 "ON CONFLICT DO UPDATE command cannot affect row a second time" 오류가 난다 —
  // 같은 키는 먼저 나온 행만 남기고 나머지는 건너뛴다(뒤 항목이 유실되는 게 아니라, 정규화 후
  // 사실상 같은 콘텐츠로 판단된 것 — 원본 부제 차이는 subtitle_raw에 그대로 남아 감사 가능).
  const seenKeys = new Set<string>();
  const payload: {
    series_name: string;
    bis_episode_number: string | null;
    subtitle_raw: string;
    subtitle_norm: string;
    series_lead: string;
    detail_tail: string | null;
    country_guess: string | null;
    themes: string[];
    source_file: string;
  }[] = [];
  for (const r of parsed.rows as OlifeCatalogRow[]) {
    const key = `${r.seriesName}__${r.subtitleNorm}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    payload.push({
      series_name: r.seriesName,
      bis_episode_number: r.bisEpisodeNumber,
      subtitle_raw: r.subtitleRaw,
      subtitle_norm: r.subtitleNorm,
      series_lead: r.seriesLead,
      detail_tail: r.detailTail,
      country_guess: r.countryGuess,
      themes: r.themes,
      source_file: r.sourceFile,
    });
  }

  // Supabase upsert 배치 제한을 고려해 500건씩 나눠 넣는다(다른 대량 백필 스크립트와 동일 관행).
  let upserted = 0;
  const BATCH = 500;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error, count } = await supabase
      .from("olife_episode_catalog")
      .upsert(chunk, { onConflict: "series_name,subtitle_norm", count: "exact" });
    if (error) {
      return { ok: false, fileName, message: `DB 저장 실패: ${error.message}` };
    }
    upserted += count ?? chunk.length;
  }

  return { ok: true, fileName, seriesCounts, totalRows: parsed.rows.length, upserted };
}
