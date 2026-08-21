// 채널 로고 PNG 파일에서 대표 색상(dominant color)을 뽑아내는 도우미.
// DESIGN.md 1.0 원칙: "채널 로고/ 폴더의 로고 이미지에서 대표 색상을 자동 추출해
// Channel Master에 저장" — 1차 구현이므로 정교한 군집화 없이,
// 투명/거의 흰색/거의 검은색 배경 픽셀은 제외한 나머지 픽셀의 평균색으로 근사한다.
import { PNG } from "pngjs";

function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  const brightness = (r + g + b) / 3;
  return brightness > 245 || brightness < 12;
}

/** PNG 파일의 Buffer를 받아 대표 색상을 "#rrggbb" 형태로 돌려준다. 실패 시 null.
 * 사용자 지시(2026-08-21) 확인 중 발견한 버그: 단순 평균(모든 비-배경 픽셀의 RGB 평균)은
 * 로고 안에 미세한 그림자/그라디언트 음영(예: ENA Story 로고 "N" 안쪽의 어두운 사선 음영)이
 * 섞여 있으면 그 소수 픽셀에 이끌려 실제 브랜드색보다 어둡고 탁하게 나온다 — 실측: ENA Story는
 * 평균색 #673a92(칙칙한 보라)이 나왔지만, 실제 로고의 99% 이상 픽셀은 #7828e0(선명한 보라)
 * 하나였다(양자화 히스토그램으로 최빈값 확인). 평균 대신 최빈값(mode) 방식으로 바꿔, 로고의
 * 실제 "가장 많이 쓰인 색"을 대표색으로 삼는다(그림자 등 소수 픽셀에 흔들리지 않음). */
export function extractDominantColor(pngBuffer: Buffer): string | null {
  try {
    const png = PNG.sync.read(pngBuffer);
    const counts = new Map<string, number>();

    for (let i = 0; i < png.data.length; i += 4) {
      const r = png.data[i];
      const g = png.data[i + 1];
      const b = png.data[i + 2];
      const a = png.data[i + 3];

      if (a < 128) continue; // 투명 픽셀 제외
      if (isNearWhiteOrBlack(r, g, b)) continue; // 배경으로 추정되는 흰색/검은색 제외

      // 8단위로 양자화해 미세하게 다른 색(안티앨리어싱 등)을 같은 색으로 묶는다.
      const key = `${Math.round(r / 8)},${Math.round(g / 8)},${Math.round(b / 8)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    if (counts.size === 0) return null;

    let bestKey: string | null = null;
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }
    if (!bestKey) return null;
    const [qr, qg, qb] = bestKey.split(",").map((n) => parseInt(n, 10) * 8);
    const toHex = (value: number) => Math.min(255, value).toString(16).padStart(2, "0");
    return `#${toHex(qr)}${toHex(qg)}${toHex(qb)}`;
  } catch {
    return null;
  }
}

/**
 * PNG 로고의 "실제 보이는(투명하지 않은) 부분"이 전체 이미지에서 어디부터 어디까지인지를
 * 세로 비율(0~1)로 계산한다. 같은 렌더링 높이로 그려도 로고마다 위아래 투명 여백이 달라
 * 실제 보이는 높이가 채널마다 다르게 느껴지는 문제(사용자 피드백)를 고치기 위해 만들었다 —
 * topRatio(보이는 부분 시작 위치)와 visibleRatio(보이는 부분의 높이 비율)를 함께 저장해두면,
 * 화면에서 이미지를 확대하고 잘라내(overflow:hidden + 음수 margin) 보이는 부분의 높이를
 * 채널 간에 맞추면서도 로고 영역 자체의 높이는 그대로 유지할 수 있다.
 */
export function extractVisibleHeightRatio(pngBuffer: Buffer): { topRatio: number; visibleRatio: number } | null {
  try {
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
  } catch {
    return null;
  }
}
