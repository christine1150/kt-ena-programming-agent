// 로그인 응답 시간 균일화 — 2026-10-15 외부 검증(S-01): 계정이 없으면 bcrypt 비교 없이 바로 401을 돌려줘, 응답 시간 차이로 계정 존재 여부를 추정할 수 있었다.
// 계정이 없을 때도 같은 비용(cost 12 — scripts/seed-admin.mjs·seed-pd-users.mjs가 쓰는 값)의 bcrypt 비교를 한 번 수행해 시간 신호를 없앤다.
// 더미 해시는 첫 호출 때 만들어 재사용한다(비밀번호와 무관한 임의 문자열의 해시이며 어떤 계정과도 연결되지 않는다).
import bcrypt from "bcryptjs";

const COST = 12;
let dummyHash: Promise<string> | null = null;

/** 계정이 없을 때 호출 — 결과는 쓰지 않고 항상 false다. */
export async function burnPasswordCheck(password: string): Promise<false> {
  dummyHash ??= bcrypt.hash(`unused-${Math.random().toString(36).slice(2)}`, COST);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
