// 시청률 지도(베타) 본문 — 서버가 DB의 닐슨 시청률과 분류표를 결합한 방송 목록을 자체 완결 HTML에 넣어 내려 준다.
// 로그인은 proxy.ts가 확인한다(관리자·PD 모두 열람). 새 방송이 DB에 들어오면 캐시(1시간)가 지난 뒤 자동 반영된다.
// ?t=타깃명 으로 타깃을 고른다(허용 목록 밖이면 채널 기본 타깃). 타깃마다 따로 캐시한다.
import { buildGeoMapData, GEO_MAP_TARGETS, type GeoMapData } from "@/lib/beta/geoMapData";
import { GEO_MAP_TEMPLATE } from "@/lib/beta/geoMapTemplate";

export const dynamic = "force-dynamic";

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: GeoMapData }>();
const html = (data: GeoMapData) =>
  new Response(GEO_MAP_TEMPLATE.replace("__DATA__", () => JSON.stringify(data).replace(/</g, "\\u003c")), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" },
  });

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const key = GEO_MAP_TARGETS.includes(t) ? t : "";
  const hit = cache.get(key);
  try {
    if (hit && Date.now() - hit.at <= TTL_MS) return html(hit.data);
    const data = await buildGeoMapData(key || undefined);
    cache.set(key, { at: Date.now(), data });
    return html(data);
  } catch (e) {
    // 계산 실패 시 직전 캐시가 있으면 그것을 쓰고, 없으면 안내만 낸다.
    if (hit) return html(hit.data);
    console.error("[geo-map] 데이터 계산 실패", e);
    return new Response("<!doctype html><meta charset=utf-8><p style='font:14px sans-serif;padding:24px'>시청률 지도 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>", { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}
