"use client";

// 전역 탐색 막대(단계 07) — 브리핑/채널분석/포트폴리오/편성비교/AI편성/콘텐츠·Avail/보고서/관리.
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
  return m && m[1] !== "portfolio" ? m[1] : null;
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
        <ul className="mx-auto flex max-w-screen-2xl items-center gap-0.5 overflow-x-auto px-3 sm:px-6">
          {items.map((item) => {
            const isActive = active === item.id;
            return (
              <Fragment key={item.id}>
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
