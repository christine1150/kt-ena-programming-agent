// 제목별 편성 가능 채널 규칙(channelEligibility.ts) 단위 테스트 — 실행: npm run test:eligibility
import { buildChannelIneligiblePredicate, ineligibleReason, titleAllowedOnChannel } from "../src/lib/idealSchedule/channelEligibility";

let pass = 0;
let fail = 0;
function t(name: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}`);
  }
}

t("나는솔로: ENA·ENA Play만 가능", titleAllowedOnChannel("ENA", "나는솔로") && titleAllowedOnChannel("ENA_PLAY", "나는솔로"));
t("나는솔로: ENA Story·ENA Drama·OLIFE·ONCE 불가", ["ENA_STORY", "ENA_DRAMA", "OLIFE", "ONCE", "SKYUHD"].every((c) => !titleAllowedOnChannel(c, "나는솔로")));
t("나솔사계도 같은 규칙", titleAllowedOnChannel("ENA", "나솔사계") && !titleAllowedOnChannel("ENA_STORY", "나솔사계"));
t("표기 변형(나는 SOLO, 회차·기수 꼬리)도 같은 규칙", !titleAllowedOnChannel("ENA_STORY", "나는 SOLO") && !titleAllowedOnChannel("ENA_STORY", "나는솔로 24기") && !titleAllowedOnChannel("ENA_STORY", "<본> 나는솔로"));
t("나는 SOLO 그후 사랑은 계속된다도 불가", !titleAllowedOnChannel("ENA_STORY", "나는 SOLO 그후 사랑은 계속된다"));
t("지구마불: ENA·ENA Drama·ENA Play·ENA Story·skyUHD 가능", ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "SKYUHD"].every((c) => titleAllowedOnChannel(c, "지구마불 세계여행 4")));
t("지구마불: OLIFE·ONCE 불가", ["OLIFE", "ONCE"].every((c) => !titleAllowedOnChannel(c, "지구마불 세계여행4")));
t("규칙 없는 제목은 어느 채널이든 가능", titleAllowedOnChannel("ENA_STORY", "인간극장") && titleAllowedOnChannel("OLIFE", "한국기행"));
t("사유 문구: ENA Story에 나는솔로", (ineligibleReason("ENA_STORY", "나는솔로") ?? "").includes("ENA·ENA Play에만"));
t("사유 문구: 가능하면 null", ineligibleReason("ENA", "나는솔로") === null && ineligibleReason("ENA_STORY", "인간극장") === null);
{
  const p = buildChannelIneligiblePredicate("ENA_STORY");
  t("엔진 술어: ENA Story에서 나는솔로 후보는 불가, 인간극장은 가능", !!p && p({ programName: "나는솔로", contentType: "OWN" }) && !p({ programName: "인간극장", contentType: "OWN" }));
  t("엔진 술어: 장르 원형(ARCHETYPE)은 대상 아님", !!p && !p({ programName: "나는솔로", contentType: "ARCHETYPE" }));
  t("엔진 술어: 지구마불은 ENA Story에서 허용", !!p && !p({ programName: "지구마불 세계여행4", contentType: "OWN" }));
}
t("엔진 술어: ENA는 나는솔로 규칙에 걸리지 않지만 지구마불 규칙도 허용이라 적용할 규칙 없음 → OLIFE만 있음", buildChannelIneligiblePredicate("ENA") === null && buildChannelIneligiblePredicate("OLIFE") !== null);

console.log(`\n${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);
