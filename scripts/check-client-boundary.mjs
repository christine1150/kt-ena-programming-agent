// 클라이언트 번들 경계 점검(2026-10-15, 외부 검증 E-05): `node scripts/check-client-boundary.mjs` — 서버가 아닌 쪽 번들로 서버 전용 모듈이 새면 종료 코드 1.
// 2026-10-15 프로덕션 빌드가 수 시간 실패한 사고(Dashboard → … → avail/adapters/common → node:crypto)를 같은 방식으로 잡는다(사고 직전 커밋에서 검증함). 읽기 전용: "use client" 파일에서 import 사슬을 따라가 서버 전용 모듈(node:*·fs·supabase·bcrypt·메일/문서 라이브러리)에 닿는 경로를 전수 탐색
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(SRC);
const text = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

const SERVER_PKG = /^(fs|path|crypto|child_process|os|net|tls|http|https|stream|zlib|dns|worker_threads|bcryptjs|imapflow|mailparser|nodemailer|docx|pptxgenjs|exceljs|xlsx|googleapis|@supabase\/supabase-js|openai|pg|sharp)$/;
const isServerPkg = (s) => s.startsWith("node:") || SERVER_PKG.test(s);
const SERVER_LOCAL = new Set(["@/lib/supabase"]);

function resolveLocal(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) if (text.has(c)) return c;
  return null;
}
function imports(f) {
  const t = text.get(f);
  const out = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[2]) continue; // import type — 컴파일 때 지워진다
    if (m[6] && /^\s*\.\s*[A-Z]/.test(t.slice(re.lastIndex))) continue; // 타입 자리의 import("x").Name — 지워진다
    const spec = m[4] ?? m[5] ?? m[6] ?? m[7];
    if (spec) out.push(spec);
  }
  return out;
}

const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");
const clients = files.filter((f) => /^\s*["']use client["']/.test(text.get(f).slice(0, 400)) || /(^|\n)["']use client["']/.test(text.get(f).slice(0, 400)));
console.log("client files:", clients.length);

const found = new Map(); // 서버 모듈 → 첫 사슬
for (const c of clients) {
  const seen = new Set([c]);
  const queue = [[c, [c]]];
  while (queue.length) {
    const [f, chain] = queue.shift();
    for (const spec of imports(f)) {
      if (isServerPkg(spec) || SERVER_LOCAL.has(spec)) {
        const key = `${spec} ← ${rel(f)}`;
        if (!found.has(key)) found.set(key, chain.map(rel).concat(spec));
        continue;
      }
      const r = resolveLocal(f, spec);
      if (!r || seen.has(r)) continue;
      // 서버 전용 파일은 맨 위에서 "server-only"/"use server"를 선언하지 않았으므로 그대로 따라간다
      seen.add(r);
      queue.push([r, [...chain, r]]);
    }
  }
}
console.log("server-only reach (unique module←importer):", found.size);
for (const [k, chain] of found) console.log("-", k, "\n    via:", chain.length > 5 ? [chain[0], "...", ...chain.slice(-3)].join(" → ") : chain.join(" → "));

if (found.size > 0) { console.log("실패: 클라이언트 컴포넌트가 서버 전용 모듈에 닿습니다. 서버 전용 코드를 분리하거나 import type을 쓰세요."); process.exit(1); }
console.log("통과: 클라이언트 번들이 서버 전용 모듈에 닿지 않습니다.");
