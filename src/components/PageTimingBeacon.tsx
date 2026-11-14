"use client";
// 페이지·API 체감 속도 비콘(고도화 계획 E1) — 화면에는 아무것도 그리지 않는다.
// 한 화면 방문에서 첫 바이트·첫 화면·최대 콘텐츠·완전 로드와 같은 출처 /api/* 호출 소요(Resource Timing)를 모아
// 화면을 떠나거나 숨겨질 때(또는 로드 후 12초 뒤 한 번) navigator.sendBeacon으로 보낸다. 실패해도 조용히 무시한다.
// 개인정보 없음: 경로는 서버가 패턴으로 정규화하고 쿼리스트링은 보내지 않는다. 로그인 전 화면에서는 서버가 204로 버린다.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Entry = { metric: "ttfb" | "fcp" | "lcp" | "load" | "api"; apiPath?: string; durationMs: number };

// 모듈 단위 상태 — 앱 내 이동(soft navigation)으로 이 컴포넌트의 효과가 다시 돌아도 유지된다.
// navigation 항목은 첫 문서 로드를 가리키므로 문서 지표(ttfb·fcp·lcp·load)는 최초 1회만 내고,
// buffered 관찰자가 되돌려 주는 이전 화면의 API 항목은 이미 보낸 것으로 보고 건너뛴다.
let documentReported = false;
const reportedApi = new Set<string>();

export default function PageTimingBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
    // 로그인 화면·접근 거부 화면은 계측하지 않는다
    if (pathname.startsWith("/admin/login") || pathname.startsWith("/pd/login") || pathname.startsWith("/access-denied")) return;

    const reportPath = pathname; // 이동 중 cleanup에서 보낼 때 window.location이 이미 새 경로일 수 있어 효과 시작 시점 값으로 고정
    const entries: Entry[] = [];
    let lcp = 0;
    let sent = false;
    const startedAt = performance.now();

    const observers: PerformanceObserver[] = [];
    const observe = (type: string, cb: (list: PerformanceObserverEntryList) => void, opts: Record<string, unknown> = {}) => {
      try {
        const o = new PerformanceObserver(cb);
        o.observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
        observers.push(o);
      } catch {
        /* 지원하지 않는 브라우저는 그 지표만 건너뛴다 */
      }
    };

    observe("largest-contentful-paint", (list) => {
      const last = list.getEntries().at(-1);
      if (last) lcp = last.startTime;
    });
    observe("resource", (list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (e.initiatorType !== "fetch" && e.initiatorType !== "xmlhttprequest") continue;
        let u: URL;
        try {
          u = new URL(e.name);
        } catch {
          continue;
        }
        if (u.origin !== window.location.origin || !u.pathname.startsWith("/api/") || u.pathname.startsWith("/api/telemetry/")) continue;
        const key = `${u.pathname}|${Math.round(e.startTime)}`;
        if (reportedApi.has(key)) continue;
        reportedApi.add(key);
        entries.push({ metric: "api", apiPath: u.pathname, durationMs: Math.round(e.duration) });
      }
    });

    const flush = () => {
      if (sent) return;
      sent = true;
      const out: Entry[] = [...entries];
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      // 문서 지표는 최초 1회(첫 문서 로드)만 낸다 — 앱 내 이동 화면은 API 소요만 남는다.
      // load 이벤트가 아직 끝나지 않았으면(loadEventEnd = 0) 다음 flush로 미룬다.
      if (nav && !documentReported && nav.loadEventEnd > 0) {
        documentReported = true;
        out.push({ metric: "ttfb", durationMs: Math.round(nav.responseStart) });
        out.push({ metric: "load", durationMs: Math.round(nav.loadEventEnd) });
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        if (fcp) out.push({ metric: "fcp", durationMs: Math.round(fcp.startTime) });
        if (lcp > 0) out.push({ metric: "lcp", durationMs: Math.round(lcp) });
      }
      if (out.length === 0) return;
      const body = JSON.stringify({ path: reportPath, viewport: window.innerWidth < 768 ? "mobile" : "desktop", entries: out.slice(0, 60) });
      try {
        // sendBeacon은 Content-Type을 text/plain으로 보낸다 — 서버가 text로 읽어 JSON 파싱한다
        if (!navigator.sendBeacon("/api/telemetry/page-timing", body)) {
          void fetch("/api/telemetry/page-timing", { method: "POST", body, keepalive: true }).catch(() => undefined);
        }
      } catch {
        /* 계측 실패는 무시 */
      }
    };

    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    const timer = window.setTimeout(flush, Math.max(2000, 12000 - (performance.now() - startedAt)));

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      observers.forEach((o) => o.disconnect());
      flush(); // 앱 내 이동으로 이 화면을 떠날 때도 API 소요를 남긴다
    };
  }, [pathname]);

  return null;
}
