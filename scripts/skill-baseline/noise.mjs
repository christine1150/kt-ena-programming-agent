// 읽기 전용 — 잡음선: 같은 프로그램·같은 방영유형·같은 요일·시가 주마다 이어질 때(편성을 바꾸지 않았을 때) 시청률이 얼마나 흔들리는지,
// 그리고 약한 자리 판정의 "오늘 < 직전 같은 자리 중앙값 × 0.8" 규칙이 그런 평상시 주에 얼마나 자주 울리는지(헛경보율)를 본다.
//  · 직전 창은 4주 연속(사례 수 확보). 채널 전체 흐름(같은 주 채널 평균 ÷ 직전 4주 채널 평균)으로 나눈 값도 함께 낸다(계절·채널 전반 하락 분리).
//  · 같은 프로그램이라도 회차가 다르면 그 차이도 흔들림에 들어간다 — PD가 "자리를 그대로 뒀을 때"의 흔들림이 이것이다.
// 사용: node scripts/skill-baseline/noise.mjs [행 디렉터리=.cache/skill-baseline]
import fs from "node:fs";
const dir = process.argv[2] ?? ".cache/skill-baseline";
const CH = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
const dn = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const q = (a, p) => { const v = [...a].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
const med = (a) => q(a, 0.5);
const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null || !Number.isFinite(x) ? "—" : `${(100 * x).toFixed(0)}%`);
const weekOf = (d) => { const t = Date.parse(`${d}T00:00:00Z`); const k = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - k * 864e5).toISOString().slice(0, 10); };
const back = (w, n) => new Date(Date.parse(`${w}T00:00:00Z`) - n * 7 * 864e5).toISOString().slice(0, 10);

let t1 = "| 채널 | 이어진 주 쌍 | 실적 중앙값 | 주간 차이 중앙값(%p) | 주간 차이 80%선(%p) | 주간 흔들림 중앙값(배) | 다음 주에 0.8배 아래로 떨어진 비율 | 다음 주에 1.25배 위로 오른 비율 |\n|---|---|---|---|---|---|---|---|\n";
let t2 = "| 채널 | 사례 | 오늘÷직전 4회 중앙값(중앙값) | 0.8배 아래(헛경보율) | 채널 흐름 보정 후 0.8배 아래 | 헛경보 10%로 묶는 선 | 최근 2회 평균 0.8배 아래 | 2회 평균 10%선 | 프라임(19~23시) 0.8배 아래 |\n|---|---|---|---|---|---|---|---|---|\n";
for (const code of CH) {
  const file = `${dir}/rows-${code}.json`;
  if (!fs.existsSync(file)) continue;
  const rows = JSON.parse(fs.readFileSync(file, "utf8")).rows.filter((r) => r.lead === 0 && r.actual !== null);
  const wk = new Map();
  for (const r of rows) { const e = wk.get(r.week) ?? { s: 0, n: 0 }; e.s += r.actual; e.n++; wk.set(r.week, e); }
  const wMean = (w) => { const e = wk.get(w); return e ? e.s / e.n : null; };
  const units = new Map();
  for (const r of rows) { const k = `${r.pid}|${r.type}|${r.dow}|${r.hour}`; const m = units.get(k) ?? units.set(k, new Map()).get(k); (m.get(r.date) ?? m.set(r.date, []).get(r.date)).push(r.actual); }
  const diffs = [], swings = [], ups = [], downs = [];
  const raw = [], adj = [], two = [], prime = [];
  for (const [key, m] of units) {
    const hr = Number(key.split("|")[3]);
    const s = [...m].map(([d, v]) => [d, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let i = 1; i < s.length; i++) {
      if (dn(s[i][0]) - dn(s[i - 1][0]) !== 7) continue;
      const [a, b] = [s[i - 1][1], s[i][1]];
      diffs.push(Math.abs(b - a));
      if (a > 0) { downs.push(b < 0.8 * a); ups.push(b > 1.25 * a); }
      if (a > 0 && b > 0) swings.push(Math.exp(Math.abs(Math.log(b / a))));
    }
    for (let i = 4; i < s.length; i++) {
      const w = s.slice(i - 4, i);
      if (dn(s[i][0]) - dn(w[0][0]) !== 28) continue;
      const m4 = med(w.map((x) => x[1]));
      if (!(m4 > 0)) continue;
      const W = weekOf(s[i][0]);
      const prev = [1, 2, 3, 4].map((n) => wMean(back(W, n))).filter((x) => x !== null);
      const cur = wMean(W);
      const trend = prev.length === 4 && cur > 0 ? cur / (prev.reduce((a, b) => a + b, 0) / 4) : null;
      raw.push(s[i][1] / m4);
      if (trend) adj.push(s[i][1] / m4 / trend);
      if (dn(s[i][0]) - dn(s[i - 1][0]) === 7) two.push((s[i][1] + s[i - 1][1]) / 2 / m4);
      if (hr >= 19 && hr <= 23) prime.push(s[i][1] / m4);
    }
  }
  const share = (a) => (a.length ? a.filter(Boolean).length / a.length : null);
  const lo = (a) => (a.length ? a.filter((x) => x < 0.8).length / a.length : null);
  t1 += `| ${code} | ${diffs.length} | ${f(med(rows.map((r) => r.actual)), 4)} | ${f(med(diffs), 4)} | ${f(q(diffs, 0.8), 4)} | ×${f(med(swings))} | ${pc(share(downs))} | ${pc(share(ups))} |\n`;
  t2 += `| ${code} | ${raw.length} | ×${f(med(raw))} | ${pc(lo(raw))} | ${pc(lo(adj))} | ×${f(q(raw, 0.1))} | ${pc(lo(two))} | ×${two.length ? f(q(two, 0.1)) : "—"} | ${prime.length ? `${pc(lo(prime))}(${prime.length}건)` : "—"} |\n`;
}
console.log("### 같은 프로그램·자리의 주간 흔들림(편성을 바꾸지 않았을 때)\n\n" + t1 + "\n### 약한 자리 0.8배 규칙의 헛경보율(같은 프로그램이 같은 자리에 4주 넘게 이어진 평상시)\n\n" + t2);
