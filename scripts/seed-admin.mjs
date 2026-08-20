// 관리자 계정을 추가/재설정하는 스크립트. 회원가입 화면이 없으므로, 관리자 계정은
// 이 스크립트로만 만든다 (CLAUDE.md: 회원가입 기능 없음).
//
// 사용법 (my-app 폴더에서 실행):
//   node --env-file=.env scripts/seed-admin.mjs 이메일@ktena.co.kr
//   node --env-file=.env scripts/seed-admin.mjs 이메일@ktena.co.kr 원하는비밀번호   (비밀번호 직접 지정 시)
//
// 비밀번호를 지정하지 않으면 안전한 임시 비밀번호를 자동으로 만들어 이 화면에 한 번만 보여준다.
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const [, , email, passwordArg] = process.argv;

if (!email) {
  console.error("사용법: node --env-file=.env scripts/seed-admin.mjs 이메일 [비밀번호]");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(".env에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY가 없습니다.");
  process.exit(1);
}

const password = passwordArg ?? randomBytes(9).toString("base64url"); // 12자 안팎의 임시 비밀번호
const passwordHash = await bcrypt.hash(password, 12);

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const { error } = await supabase
  .from("admins")
  .upsert({ email: email.trim().toLowerCase(), password_hash: passwordHash }, { onConflict: "email" });

if (error) {
  console.error("관리자 계정 저장 실패:", error.message);
  process.exit(1);
}

console.log(`✅ 관리자 계정이 저장되었습니다.`);
console.log(`   이메일: ${email}`);
if (!passwordArg) {
  console.log(`   임시 비밀번호: ${password}  (이 비밀번호는 지금 한 번만 표시됩니다. 꼭 별도로 보관하세요.)`);
} else {
  console.log(`   비밀번호: 입력하신 값으로 설정되었습니다.`);
}
