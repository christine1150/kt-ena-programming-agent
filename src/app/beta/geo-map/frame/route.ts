// 권역별 시청률 지도(베타) 본문 — 자체 완결 HTML을 그대로 내려 준다(로그인은 proxy.ts가 이미 확인).
// 값은 분석 스크립트가 만든 정적 요약이며 화면에서 계산하지 않는다.
import { GEO_MAP_HTML } from "@/lib/beta/geoMapHtml";

export const dynamic = "force-static";

export function GET() {
  return new Response(GEO_MAP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=300" } });
}
