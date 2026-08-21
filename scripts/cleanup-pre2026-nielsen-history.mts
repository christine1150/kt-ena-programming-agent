// Supabase 무료 플랜 500MB 용량 초과 대응(사용자 지시, 2026-08-21): 2026-08-20~21에 걸쳐
// 진행한 Nielsen 히스토리 백필(2023-07-02~2025-12-31, ratings 약 140만 행 추가)로 DB가
// 947MB까지 커져 500MB 제한을 크게 넘겼다. 사용자가 "2026년만 유지(최대 절약)"을 선택 —
// 2023~2025년 데이터를 전부 지우고(전체 ratings 행의 76.5% 삭제, 예상 ~220MB로 복귀),
// DELETE만으로는 파일 크기가 안 줄어들어(dead tuple로만 남음) VACUUM FULL로 실제 디스크
// 공간까지 반환한다.
//
// 사용법: npx tsx scripts/cleanup-pre2026-nielsen-history.mts
process.loadEnvFile(".env");
import pg from "pg";

const ref = process.env.SUPABASE_PROJECT_REF;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!ref || !password) {
  console.error("SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD가 .env에 없습니다.");
  process.exit(1);
}
const connectionString = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const CUTOFF = "2026-01-01";

async function deleteBefore(table: string, dateCol: string) {
  const { rowCount } = await client.query(`delete from ${table} where ${dateCol} < $1`, [CUTOFF]);
  console.log(`${table}: ${rowCount}행 삭제`);
}

console.log(`=== ${CUTOFF} 이전 데이터 삭제 시작 ===`);
await deleteBefore("competitor_program_ratings", "broadcast_date");
await deleteBefore("competitor_ratings", "broadcast_date");
await deleteBefore("ratings", "broadcast_date");
// annual_2025는 broadcast_date가 그 해 12/31로 저장되는 연간 평균값이라(사용자 지시 범위 밖,
// "닐슨 데일리" 히스토리와 별개) 건드리지 않는다.

// 이제 이 기간에만 쓰였던 programs(프로그램) 행 중, 남은 ratings에서 더는 참조되지 않는
// 것들도 함께 정리한다(참조 무결성상 문제는 없지만 방치하면 불필요하게 공간을 차지함).
const orphanPrograms = await client.query(`
  delete from programs p
  where not exists (select 1 from ratings r where r.program_id = p.id)
`);
console.log(`programs(고아 행): ${orphanPrograms.rowCount}행 삭제`);

// file_uploads 이력도 같은 기간분은 정리(작아서 용량 영향은 미미하지만 일관성 차원).
const fileUploads = await client.query(`delete from file_uploads where reference_date < $1`, [CUTOFF]);
console.log(`file_uploads: ${fileUploads.rowCount}행 삭제`);

console.log("\n=== VACUUM FULL로 실제 디스크 공간 반환(시간이 좀 걸릴 수 있음) ===");
for (const table of ["ratings", "competitor_program_ratings", "competitor_ratings", "programs", "file_uploads"]) {
  const start = Date.now();
  await client.query(`vacuum (full, analyze) ${table}`);
  console.log(`VACUUM FULL ${table}: ${Date.now() - start}ms`);
}

console.log("\n=== 정리 후 크기 ===");
const dbSize = await client.query(`select pg_size_pretty(pg_database_size(current_database())) as size`);
console.log("전체 DB 크기:", dbSize.rows[0].size);
const tableSizes = await client.query(`
  select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc limit 5
`);
console.table(tableSizes.rows);

await client.end();
console.log("\n완료.");
