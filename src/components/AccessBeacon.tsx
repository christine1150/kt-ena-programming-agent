"use client";
// 접속 이력 비콘 — 화면에는 아무것도 그리지 않는다.
// 사용자 지시(2026-11-27): 로그인을 새로 하지 않았어도 그날 이 사이트에 들어와 브리핑을 보거나 활동한 사람의
// 기록이 필요하다. 홈(/)만이 아니라 어느 화면으로 바로 들어와도 하루 한 번 서버에 알린다.
// 브라우저에 오늘(KST) 날짜를 기억해 같은 날 반복 호출을 줄이고, 서버도 하루 1행으로 한 번 더 막는다.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "lu-access-ping-day";

export default function AccessBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/admin/login") || pathname.startsWith("/pd/login") || pathname.startsWith("/access-denied")) return;
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(KEY) === today) return;
    } catch {
      /* 저장소를 못 쓰는 브라우저는 서버의 하루 1행 제한에 맡긴다 */
    }
    void fetch("/api/telemetry/access", { method: "POST", keepalive: true })
      .then((r) => {
        // 세션이 있어 서버가 처리했을 때만 오늘 보냈다고 기억한다(로그인 전 204도 같으므로 세션 확인은 서버가 한다)
        if (r.ok) {
          try {
            localStorage.setItem(KEY, today);
          } catch {
            /* 무시 */
          }
        }
      })
      .catch(() => undefined);
  }, [pathname]);

  return null;
}
