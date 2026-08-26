// 이미 저장된 7개 채널 로고(public/channel-logos/)의 "실제 보이는(투명하지 않은) 부분" 세로 비율을
// 계산해 channels.logo_visible_ratio에 채워 넣는 1회성 스크립트. Channel Master를 다시 업로드하지
// 않고도 기존 로고들에 비율 값을 채우기 위해 만들었다 (로고 파일 자체는 이미 public/channel-logos/에
// 있으므로 다시 업로드할 필요 없음).
//
// 사용법 (my-app 폴더에서 실행):
//   node --env-file=.env scripts/backfill-logo-visible-ratio.mjs
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { PNG } from "pngjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(".env에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function extractVisibleHeightRatio(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const { width, height, data } = png;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    let rowHasVisiblePixel = false;
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha >= 128) {
        rowHasVisiblePixel = true;
        break;
      }
    }
    if (rowHasVisiblePixel) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (top === -1 || height === 0) return null;
  return { topRatio: top / height, visibleRatio: (bottom - top + 1) / height };
}

const { data: channels, error } = await supabase.from("channels").select("id, code, name");
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
  const result = extractVisibleHeightRatio(readFileSync(logoFilePath));
  if (result === null) {
    console.log(`- ${channel.name}(${channel.code}): 비율 계산 실패`);
    continue;
  }
  const { error: updateError } = await supabase
    .from("channels")
    .update({ logo_visible_ratio: result.visibleRatio, logo_visible_top_ratio: result.topRatio })
    .eq("id", channel.id);
  if (updateError) {
    console.log(`- ${channel.name}(${channel.code}): 저장 실패 — ${updateError.message}`);
  } else {
    console.log(
      `✅ ${channel.name}(${channel.code}): visibleRatio=${result.visibleRatio.toFixed(4)}, topRatio=${result.topRatio.toFixed(4)}`
    );
  }
}
