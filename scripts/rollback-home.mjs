// 홈페이지(1페이지) 이전 버전 복원 — 개선 패키지(단계 07·홈 상위 프로그램·킬러 콘텐츠 순서) 배포 직전 상태로 되돌린다.
// 사용법:
//   npm run rollback:home                 복원 → 커밋 → push(Vercel 자동 배포)까지 한 번에
//   npm run rollback:home -- --no-push    파일만 복원하고 커밋은 직접(확인 후)
//   npm run rollback:home -- --check      복원 후 타입 검사까지 돌려 본다(시간이 더 걸림)
// 되돌린 것을 다시 적용하려면: git revert <복원 커밋>   (복원 커밋 해시는 이 스크립트가 출력한다)
// 앱 전체를 직전 배포로 되돌리려면(홈 외 변경 포함): vercel rollback
// 복원 대상은 홈 화면과 그 데이터 API 4개 파일뿐이며, 나머지 기능(편성표 뽑기 등)은 그대로 둔다.
import { execFileSync } from "node:child_process";

const TAG = "home/before-opt-20261007";
const FILES = ["src/app/Dashboard.tsx", "src/app/page.tsx", "src/app/api/dashboard/page1/route.ts", "src/app/api/dashboard/channel/route.ts"];
const args = new Set(process.argv.slice(2));
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

try {
  git("rev-parse", "--verify", `refs/tags/${TAG}`);
} catch {
  console.error(`복원 기준 태그(${TAG})가 이 저장소에 없습니다. git fetch --tags 후 다시 실행하세요.`);
  process.exit(1);
}
const dirty = git("status", "--porcelain", "--", ...FILES);
if (dirty && !args.has("--force")) {
  console.error("복원 대상 파일에 아직 커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 --force로 덮어쓰세요:\n" + dirty);
  process.exit(1);
}
git("checkout", TAG, "--", ...FILES);
console.log(`홈 화면 파일 ${FILES.length}개를 ${TAG} 시점으로 복원했습니다.`);
if (args.has("--check")) {
  console.log("타입 검사 중…");
  execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit", shell: true });
}
if (!git("status", "--porcelain", "--", ...FILES)) {
  console.log("이미 이전 버전과 같습니다. 할 일이 없습니다.");
  process.exit(0);
}
git("add", "--", ...FILES);
git("commit", "-m", `홈페이지 이전 버전으로 복원(rollback:home, 기준 ${TAG})`);
const hash = git("rev-parse", "--short", "HEAD");
console.log(`복원 커밋 ${hash} 생성. 되돌리려면: git revert ${hash}`);
if (args.has("--no-push")) {
  console.log("--no-push: push는 하지 않았습니다. 확인 후 git push origin main 하세요(Vercel 자동 배포).");
} else {
  git("push", "origin", "main");
  console.log("push 완료 — Vercel이 자동 배포합니다(보통 1~2분). 상태: vercel ls");
}
