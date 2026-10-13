// 실제 Avail 파일 ↔ 시스템 자사 프로그램 매칭 점검(읽기 전용). DB에는 SELECT만 하고 파일은 저장소로 복사하거나 올리지 않는다.
// 최근 12주에 자사 6개 채널이 방영한 프로그램 각각이 Avail '소재'의 어느 행과 맞는지, 이번 주(대상 주) 판정이 어떤 상태·사유로 나오는지 집계한다.
// 계약 해석 5가지는 확인 전 기본값(모든 해석을 적용해 갈리면 조건부)을 쓴다. 가격·계약번호는 출력하지 않는다.
// 실행: node --env-file=.env --import tsx scripts/avail-real-coverage.ts "<Avail 파일 경로>" [대상주 월요일=2026-10-12]
import fs from "node:fs";
import * as A from "../src/lib/avail";
import { loadChannelRef, fetchOwnAirings } from "../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../src/lib/idealSchedule/configStore";

const file = process.argv[2];
const weekStart = process.argv[3] ?? "2026-10-12";
if (!file || !fs.existsSync(file)) throw new Error("Avail 파일 경로가 필요합니다.");
const NOW = new Date().toISOString();

async function main() {
  const analysis = A.analyzeWorkbookBuffer(fs.readFileSync(file), "Contents Availlist.xlsx", { batchId: "coverage", enteredAt: NOW });
  const main = analysis.find((s) => s.kind === "content_avail");
  if (!main) throw new Error("'소재' 시트를 콘텐츠별 Avail로 감지하지 못했습니다.");
  const applied = A.applyAddenda(main.grants, A.US_DRAMA_1ST_WINDOW);
  const grants = A.applyDuplicateResolution(applied.grants, []).grants;
  const cur = A.currentGrants(grants);
  const ctx: A.EvalContext = { grants: cur, ledger: [], links: [], confirmations: [], interpretation: A.DEFAULT_INTERPRETATION, originalPolicy: A.DEFAULT_ORIGINAL_POLICY, now: NOW, inventoryVersion: A.inventoryVersionOf(cur) };

  const codes = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"];
  const asOf = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const day = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10); // 수요일
  const byStatus = new Map<string, number>();
  const byReason = new Map<string, number>();
  const perChannel = new Map<string, Map<string, number>>();
  const unmatched: string[] = [];
  let total = 0;
  for (const code of codes) {
    const ch = await loadChannelRef(code);
    const cfg = await loadIdealScheduleConfig(ch.id);
    const bundle = await fetchOwnAirings(ch, asOf, cfg, null);
    const progs = new Map<string, string | null>();
    for (const a of bundle.airings) progs.set(a.programName, a.programId);
    for (const [name, id] of progs) {
      const r = A.evaluateEligibility({ programId: id, programName: name, episodeNumber: null }, { broadcastDate: day, startMin: 1200, endMin: 1260, channelId: code }, ctx);
      total++;
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
      const m = perChannel.get(code) ?? new Map<string, number>();
      m.set(r.status, (m.get(r.status) ?? 0) + 1);
      perChannel.set(code, m);
      for (const rc of r.reasonCodes) byReason.set(rc, (byReason.get(rc) ?? 0) + 1);
      if (r.grantRevisionIds.length === 0) unmatched.push(`${code}:${name}`);
    }
  }
  const fmt = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ");
  console.log(`대상 주 ${weekStart}(판정일 ${day} 20~21시), 최근 12주 방영 프로그램 ${total}건(채널별 중복 제외)`);
  console.log(`Avail 권리 ${cur.length}건(영미 드라마 보충 ${applied.applied.length}건 적용)`);
  console.log(`상태: ${fmt(byStatus)}`);
  for (const [c, m] of perChannel) console.log(`  ${c}: ${fmt(m)}`);
  console.log(`사유 코드 상위: ${[...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`Avail 행과 연결되지 못한 프로그램 ${unmatched.length}건(${((unmatched.length / total) * 100).toFixed(0)}%)`);
  console.log(unmatched.slice(0, 40).join("\n"));
}
main().catch((e) => { console.error("실패:", e instanceof Error ? e.message : e); process.exit(1); });
