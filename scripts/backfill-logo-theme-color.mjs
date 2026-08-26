// 이미 저장된 7개 채널 로고(public/channel-logos/)의 대표 색상(theme_color)을 다시 추출해
// channels.theme_color에 채워 넣는 1회성 스크립트. src/lib/logoColor.ts의 extractDominantColor를
// "평균색"에서 "최빈값(mode)"으로 고친 뒤(사용자 지시, 2026-08-21 — ENA Story 로고 안의 미세한
// 그림자 음영에 평균이 이끌려 실제보다 칙칙한 색이 저장돼 있던 버그) 기존 채널 전체를 재추출한다.
// Channel Master를 다시 업로드하지 않고도 고친 로직을 기존 로고에 즉시 반영하기 위해 만들었다.
//
// 사용법 (my-app 폴더에서 실행):
//   node --env-file=.env scripts/backfill-logo-theme-color.mjs
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";

// src/lib/logoColor.ts의 extractDominantColor(최빈값 방식)와 동일한 로직을 그대로 복제한다
// (기존 backfill-logo-visible-ratio.mjs와 같은 관례 — plain node로 실행하는 .mjs 스크립트는
// TypeScript 모듈을 직접 import할 수 없어, 로직만 그대로 옮겨온다).
function isNearWhiteOrBlack(r, g, b) {
  const brightness = (r + g + b) / 3;
  return brightness > 245 || brightness < 12;
}
function extractDominantColor(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const counts = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
    if (a < 128) continue;
    if (isNearWhiteOrBlack(r, g, b)) continue;
    const key = `${Math.round(r / 8)},${Math.round(g / 8)},${Math.round(b / 8)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestKey = null, bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) { bestKey = key; bestCount = count; }
  }
  const [qr, qg, qb] = bestKey.split(",").map((n) => parseInt(n, 10) * 8);
  const toHex = (v) => Math.min(255, v).toString(16).padStart(2, "0");
  return `#${toHex(qr)}${toHex(qg)}${toHex(qb)}`;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(".env에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const { data: channels, error } = await supabase.from("channels").select("id, code, name, theme_color");
if (error) {
  console.error("채널 목록 조회 실패:", error.message);
  process.exit(1);
}

for (const channel of channels) {
  const logoFilePath = join(process.cwd(), "public", "channel-logos", `${channel.code}.png`);
  if (!existsSync(logoFilePath)) {
    console.log(`- ${channel.name}(${channel.code}): 로고 파일 없음, 건너뜀`);
    continue;
  }
  const newColor = extractDominantColor(readFileSync(logoFilePath));
  if (newColor === null) {
    console.log(`- ${channel.name}(${channel.code}): 색상 추출 실패`);
    continue;
  }
  const oldColor = channel.theme_color;
  const { error: updateError } = await supabase.from("channels").update({ theme_color: newColor }).eq("id", channel.id);
  if (updateError) {
    console.log(`- ${channel.name}(${channel.code}): 저장 실패 — ${updateError.message}`);
  } else if (oldColor === newColor) {
    console.log(`= ${channel.name}(${channel.code}): 변화 없음 (${newColor})`);
  } else {
    console.log(`✅ ${channel.name}(${channel.code}): ${oldColor} → ${newColor}`);
  }
}
