"use client";

// 전역 탐색 막대(단계 07) — 브리핑/채널별 분석/편성 비교/AI 편성/구매시뮬레이터/보고서/관리.
// 메뉴는 세션 역할(서버가 넘겨 준 role)에 맞게만 보인다(숨김은 보안이 아니며 각 화면·API가 서버에서 다시 검사한다).
// 현재 화면의 채널·기간·보기를 읽어 메뉴 링크에 실어 주므로, 메뉴로 이동해도 같은 문맥이 이어진다.
// PPT 보기(/deck)와 로그인 전(role=null)에는 보이지 않는다.
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Role } from "@/lib/admin/permissions";
import { activeNavId, navHref, visibleExtras, visibleNav } from "@/lib/workspace/nav";
import { hrefFor, isIsoDate, parseViewContext } from "@/lib/workspace/viewContext";
import ActionRibbon from "./ActionRibbon";

function channelFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:channel|audience-report)\/([^/?#]+)/);
  return m && m[1] !== "portfolio" && m[1] !== "view" ? m[1] : null;
}

function NavInner({ role }: { role: Role | null }) {
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const items = visibleNav(role);
  if (items.length === 0 || /\/deck(\/|$)/.test(pathname)) return null;

  const { ctx } = parseViewContext((k) => sp.get(k), { channelFromPath: channelFromPath(pathname) });
  const active = activeNavId(pathname);
  const cutParam = isIsoDate(sp.get("cut")) ? sp.get("cut") : null;
  const resolvedTo = ctx.dateTo ?? ctx.date ?? cutParam;
  // 결정 카드에서 이어진 검토(from·ft·sj·hour·cut)가 있으면 메뉴로 이동해도 이어진다(띠의 '닫기'로 끝낼 수 있다).
  const actionExtra = { from: sp.get("from"), ft: sp.get("ft"), sj: sp.get("sj"), hour: sp.get("hour"), cut: cutParam };
  const carry = actionExtra.from && actionExtra.ft ? actionExtra : {};

  return (
    <>
      <nav aria-label="전역 메뉴" className="border-b border-zinc-200 bg-white print:hidden" data-global-nav>
        <ul className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-0.5 px-3 sm:px-6">
          {items.map((item) => {
            const isActive = active === item.id;
            return (
              <Fragment key={item.id}>
                {/* 오리지널 라인업(ENA 콘텐츠 편성센터, 별도 사이트) — 보고서와 관리 사이, 새 창으로 연다(사용자 요청 2026-10-22). */}
                {item.id === "admin" && (
                  <li className="shrink-0">
                    <a
                      href="https://ktena.pages.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="ENA 콘텐츠 편성센터의 오리지널 라인업을 새 창으로 엽니다"
                      className="block border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-zinc-500 transition hover:text-zinc-800"
                    >
                      라인업
                    </a>
                  </li>
                )}
                <li className="shrink-0">
                  <Link
                    href={navHref(item, ctx, resolvedTo, carry)}
                    title={item.hint}
                    aria-current={isActive ? "page" : undefined}
                    className={`block border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${isActive ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
                  >
                    {item.label}
                  </Link>
                </li>
                {/* 숫자만 크게 읽는 별도 창(/ratings) — 브리핑과 채널별 분석 사이, 새 탭으로 열어 에이전트 화면과 나란히 본다(사용자 요청 2026-10-19). 지금 보는 기준일을 이어 준다. */}
                {item.id === "briefing" && (
                  <li className="shrink-0">
                    <a
                      href={`/ratings?tab=daily${resolvedTo ? `&date=${resolvedTo}` : ""}`}
                      target="_blank"
                      rel="noopener"
                      title="시청률 표를 새 창으로 엽니다"
                      className="block border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-zinc-500 transition hover:text-zinc-800"
                    >
                      시청률 표
                    </a>
                  </li>
                )}
                {/* 프로그램 성과(작품 × 채널 비교, 2026-10-22) — 메뉴 항목(NAV_ITEMS) 개편 없이 채널별 분석 옆 보조 진입점으로 둔다. */}
                {item.id === "channel" && (
                  <li className="shrink-0">
                    <Link
                      href="/program-performance"
                      aria-current={pathname.startsWith("/program-performance") ? "page" : undefined}
                      title="한 작품의 채널별 실적·채널 평균 대비·동슬롯 대비 비교"
                      className={`block border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${pathname.startsWith("/program-performance") ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
                    >
                      프로그램 성과
                    </Link>
                  </li>
                )}
                {visibleExtras(item, role).map((e) => (
                  <li key={`${item.id}-${e.label}`} className="shrink-0">
                    <Link href={hrefFor(e.dest, ctx)} className="block px-2 py-2.5 text-[12px] text-zinc-400 hover:text-zinc-700">
                      · {e.label}
                    </Link>
                  </li>
                ))}
              </Fragment>
            );
          })}
          {/* 베타 카테고리(2026-10-26 사용자 요청) — 시험 공개 화면 모음. 지금은 권역별 시청률 지도 하나. */}
          <li className="shrink-0">
            <Link
              href="/beta/geo-map"
              aria-current={pathname.startsWith("/beta") ? "page" : undefined}
              title="시험 공개 화면 — 권역별 시청률 지도"
              className={`block border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${pathname.startsWith("/beta") ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}
            >
              베타 <span className="ml-0.5 rounded-full bg-[#f1f0f9] px-1.5 py-0.5 text-[10px] font-semibold text-[#5b4bd0]">NEW</span>
            </Link>
          </li>
        </ul>
      </nav>
      <ActionRibbon />
    </>
  );
}

export default function GlobalNav({ role }: { role: Role | null }) {
  return (
    <Suspense fallback={null}>
      <NavInner role={role} />
    </Suspense>
  );
}
