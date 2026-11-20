// 편성표 서식(굵게·음영) 판정 단위 시험 — 사용자 지시(2026-11-20) ENA Drama 표기: 본방 = 굵게, 초방 = 주황 음영(초방은 본방에 포함)
import { classifyStyle, fillKey, sameFill, isOrangeRgb, withRunTag, type StyleLegend } from "../src/lib/scheduleGridStyle";

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
};

eq("fill none", fillKey(undefined), "none");
eq("fill white", fillKey({ argb: "FFFFFFFF" }), "none");
eq("fill theme0", fillKey({ theme: 0 }), "none");
eq("fill argb", fillKey({ argb: "FFFFC000" }), "FFC000");
eq("fill theme tint", fillKey({ theme: 4, tint: 0.4 }), "t4/0.40");
eq("orange FFC000", isOrangeRgb("FFC000"), true);
eq("orange F4B183", isOrangeRgb("F4B183"), true);
eq("yellow FFFF00 not orange", isOrangeRgb("FFFF00"), false);
eq("blue not orange", isOrangeRgb("3C5CFA"), false);

// ENA Drama 형태: 범례에 본방 = 굵게(음영 없음), 초방 = 주황 음영, 재방 = 보통
const drama: StyleLegend = { main: { fill: "none", bold: true }, premiere: { fill: "FFC000", bold: false }, rerun: { fill: "none", bold: false } };
eq("drama 굵게 = 본방", classifyStyle({ fill: "none", bold: true }, drama), "main");
eq("drama 주황 = 초방", classifyStyle({ fill: "FFC000", bold: false }, drama), "premiere");
eq("drama 주황+굵게 = 초방", classifyStyle({ fill: "FFC000", bold: true }, drama), "premiere");
eq("drama 보통 = 모름", classifyStyle({ fill: "none", bold: false }, drama), null);
eq("drama 다른 음영 = 모름", classifyStyle({ fill: "00B0F0", bold: true }, drama), null);

// 범례 없음: 주황 음영만 초방, 굵게만으로는 판정하지 않는다
eq("범례 없음 주황 = 초방", classifyStyle({ fill: "FFC000", bold: false }, {}), "premiere");
eq("범례 없음 굵게 = 모름", classifyStyle({ fill: "none", bold: true }, {}), null);

// 제목이 모두 굵은 표(ENA Play 형태): 본방·초방 모두 음영으로만 구별, 굵게만으로는 본방이 아니다
const play: StyleLegend = { premiere: { fill: "t4/0.40", bold: true }, main: { fill: "t8/0.40", bold: true } };
eq("play 초방 음영", classifyStyle({ fill: "t4/0.40", bold: true }, play), "premiere");
eq("play 본방 음영", classifyStyle({ fill: "t8/0.40", bold: true }, play), "main");
eq("play 굵게만 = 모름", classifyStyle({ fill: "none", bold: true }, play), null);

// ENA Drama 실제 파일: 범례 "신규" = 테마 9 농도 0.6, 제목 칸은 농도 0.4(같은 색 계열)
const real: StyleLegend = { main: { fill: "none", bold: true }, premiere: { fill: "t9/0.60", bold: true } };
eq("같은 계열 농도 차", sameFill("t9/0.40", "t9/0.60"), true);
eq("다른 계열", sameFill("t5/0.40", "t9/0.60"), false);
eq("농도 크게 다름", sameFill("t9/0.00", "t9/0.60"), false);
eq("real 신규 음영(농도 0.4) = 초방", classifyStyle({ fill: "t9/0.40", bold: false }, real), "premiere");
eq("real 흰 바탕 굵게 = 본방", classifyStyle({ fill: "none", bold: true }, real), "main");
eq("real 머리글 음영(t5) = 모름", classifyStyle({ fill: "t5/0.40", bold: true }, real), null);

// 글자 표시와 합치기: 글자가 우선, 없으면 서식, [본]+초방 서식은 [초]
eq("태그 없음+본방", withRunTag(null, "main"), "[본]");
eq("태그 없음+초방", withRunTag(null, "premiere"), "[초]");
eq("태그 [재] 유지", withRunTag("[재][H]", "main"), "[재][H]");
eq("태그 [본]+초방 → [초]", withRunTag("[본][15]", "premiere"), "[초][15]");
eq("태그 [초]+본방 유지", withRunTag("[초]", "main"), "[초]");
eq("태그만 [H]+본방", withRunTag("[H]", "main"), "[본][H]");
eq("서식 없음 그대로", withRunTag("[H]", undefined), "[H]");
eq("태그 null 서식 없음", withRunTag(null, undefined), null);

console.log(`${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
