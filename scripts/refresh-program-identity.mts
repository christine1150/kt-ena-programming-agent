// 작품 식별 계층(program_identity) 재생성 — refresh_program_identity() 한 번 호출(운영 DB 쓰기, 승인 A3 2026-10-22).
// 신작이 검색·프로그램 성과 목록에 나오려면 닐슨 자료가 쌓인 뒤 이 함수가 다시 돌아야 한다.
// 실행: npx tsx --env-file=.env scripts/refresh-program-identity.mts  (예약 실행은 .github/workflows/refresh-program-identity.yml)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function latestIdentityDate(): Promise<string | null> {
  const { data } = await db.from("program_identity").select("last_date").order("last_date", { ascending: false, nullsFirst: false }).limit(1);
  return (data?.[0]?.last_date as string | undefined) ?? null;
}

const before = await latestIdentityDate();
const t0 = Date.now();
const { data, error } = await db.rpc("refresh_program_identity");
if (error) {
  console.error(`작품 식별 갱신 실패: ${error.message}`);
  process.exit(1);
}
const after = await latestIdentityDate();
console.log(`작품 식별 갱신 완료 (${((Date.now() - t0) / 1000).toFixed(1)}초) 최신 방영일 ${before ?? "-"} → ${after ?? "-"} 결과 ${JSON.stringify(data)}`);
