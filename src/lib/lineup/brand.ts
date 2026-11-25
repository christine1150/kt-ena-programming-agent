// 라인업 방송사 로고·로고색(2026-11-25 사용자 요청: 경쟁 비교에서 채널 구분이 어려우니 막대 음영을 각 채널 로고색으로, 로고 활용).
// 타사 로고색은 홈 화면 경쟁 선 색(Dashboard.tsx COMPETITOR_BRAND_COLOR, 로고 PNG에서 뽑은 대표색)과 같은 값을 쓴다.
// 자사 채널 색은 channels.theme_color(DB), 로고는 channels.logo_path · public/channel-logos.

const RIVAL: Record<string, { color: string; logo: string | null }> = {
  KBS1: { color: "#0679e2", logo: "/competitor-logos/KBS1.png" },
  KBS2: { color: "#e6a800", logo: "/competitor-logos/KBS2.png" },
  MBC: { color: "#1f5fa8", logo: "/competitor-logos/MBC.png" },
  MBC_GN: { color: "#1f5fa8", logo: null }, // MBC경남 — 지역사 로고 파일 없음, 이름 글자로
  EBS1: { color: "#2b4a8b", logo: "/competitor-logos/EBS.png" },
  SBS: { color: "#0c6095", logo: "/competitor-logos/SBS.png" },
  TVN: { color: "#e8002a", logo: "/competitor-logos/tvN.png" },
  JTBC: { color: "#d9a21b", logo: "/competitor-logos/JTBC.png" },
  CHANNEL_A: { color: "#ff5a1f", logo: "/competitor-logos/CHANNEL_A.png" },
  MBN: { color: "#fa7915", logo: "/competitor-logos/MBN.png" },
  TV_CHOSUN: { color: "#c8102e", logo: "/competitor-logos/TV_CHOSUN.png" },
  // OTT 플랫폼(2026-11-25) — 대표 브랜드색(근사값). 로고 그림 파일은 아직 없어 이름 글자로 보인다(public/competitor-logos에 넣고 logo 경로만 채우면 로고로 바뀐다).
  OTT_NETFLIX: { color: "#e50914", logo: null },
  OTT_TVING: { color: "#ff153c", logo: null },
  OTT_WAVVE: { color: "#1351f9", logo: null },
  OTT_COUPANG: { color: "#0a9bdc", logo: null },
  OTT_APPLETV: { color: "#1d1d1f", logo: null },
  OTT_DISNEY: { color: "#113ccf", logo: null },
};

/** 방송사 코드 → 로고색·로고 파일. 자사는 DB 값(themeColor·logoPath)을 넘긴다. 모르면 null(회색 띠·이름 글자). */
export function outletBrand(code: string, side: "own" | "rival", own?: { themeColor: string | null; logoPath: string | null }): { color: string | null; logo: string | null } {
  if (side === "own") return { color: own?.themeColor ?? null, logo: own?.logoPath ?? `/channel-logos/${code}.png` };
  return RIVAL[code] ?? { color: null, logo: null };
}

/** '#rrggbb' → 엑셀용 'RRGGBB'과 흰색과 섞은 옅은 채움(비율 0~1). */
export function hexTint(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "F4F4F5";
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * ratio).toString(16).padStart(2, "0");
  return `${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}
