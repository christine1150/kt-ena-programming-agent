// PD 개별 로그인 계정을 일괄 추가/재설정하는 스크립트. 회원가입 화면이 없으므로,
// PD 계정도 admins와 마찬가지로 이 스크립트로만 만든다.
//
// 사용법 (my-app 폴더에서 실행):
//   node --env-file=.env scripts/seed-pd-users.mjs
//
// scripts/pd-users-seed.local.json 파일을 읽어 [{ "name": "이진경", "employeeNo": "2020101901" }, ...]
// 형태의 목록을 pd_users 테이블에 upsert한다(이름 기준). 초기 비밀번호는 사번이며,
// bcrypt로 해시만 저장하고 평문은 DB/git 어디에도 남기지 않는다.
//
// ★ pd-users-seed.local.json은 실제 이름·사번(=비밀번호) 원본이 그대로 담겨 있어
//   .gitignore에 등록돼 있다 — 절대 git에 커밋하지 않는다.
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "pd-users-seed.local.json");

// 보안 수정(2026-08-26)으로 pd_users에도 RLS가 켜져 있어 anon 키로는 쓰기가 안 된다 —
// 이 스크립트는 관리자가 로컬에서 직접 돌리는 운영 도구라 service_role 키를 쓴다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error(".env에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
  process.exit(1);
}

let entries;
try {
  const raw = await readFile(dataPath, "utf8");
  entries = JSON.parse(raw);
} catch (err) {
  console.error(`scripts/pd-users-seed.local.json을 읽을 수 없습니다: ${err.message}`);
  console.error(
    '형식 예시: [{ "name": "이진경", "employeeNo": "2020101901" }, { "name": "우규환", "employeeNo": "2011050101" }]'
  );
  process.exit(1);
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.error("pd-users-seed.local.json에 등록할 PD 목록이 없습니다.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

let succeeded = 0;
let failed = 0;

for (const entry of entries) {
  const name = typeof entry?.name === "string" ? entry.name.trim() : "";
  const employeeNo = typeof entry?.employeeNo === "string" ? entry.employeeNo.trim() : "";

  if (!name || !employeeNo) {
    console.error(`⚠️  건너뜀 — name/employeeNo가 비어 있는 항목: ${JSON.stringify(entry)}`);
    failed++;
    continue;
  }

  const passwordHash = await bcrypt.hash(employeeNo, 12);
  const { error } = await supabase
    .from("pd_users")
    .upsert(
      { name, employee_no: employeeNo, password_hash: passwordHash },
      { onConflict: "name" }
    );

  if (error) {
    console.error(`❌ ${name} 저장 실패: ${error.message}`);
    failed++;
  } else {
    console.log(`✅ ${name} 계정 저장 완료`);
    succeeded++;
  }
}

console.log(`\n총 ${entries.length}건 중 성공 ${succeeded}건, 실패 ${failed}건.`);
console.log("초기 비밀번호는 각자의 사번입니다. 최초 로그인 후 비밀번호 변경을 안내해주세요.");
if (failed > 0) process.exit(1);
