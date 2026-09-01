"use client";

// Page 2 좌측 채널 선택 사이드바 (DESIGN.md 1.3 — 로고 아이콘 세로 배치).
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface ChannelOption {
  code: string;
  name: string;
  logoPath: string | null;
}

export default function ChannelSidebar({ channels }: { channels: ChannelOption[] }) {
  const pathname = usePathname();

  // 사용자 피드백(2026-08-20): 홈 아이콘이 mt-auto로 사이드바 맨 아래에 있었는데, 사이드바가
  // 페이지 본문과 함께 스크롤되는 일반 문서 흐름 안에 있어서 본문이 길어지면(8대 질문 섹션
  // 전부) 홈 아이콘이 화면 맨 아래로 밀려나 스크롤을 끝까지 내려야만 보이는 문제가 있었다 —
  // sticky + h-screen으로 사이드바 자체를 뷰포트에 고정해, 본문을 얼마나 스크롤하든 채널
  // 아이콘들과 홈 아이콘이 항상 화면에 보이게 한다(내용이 뷰포트보다 많아지면 사이드바 자체만
  // 세로 스크롤).
  return (
    <nav className="sticky top-0 flex h-screen w-20 shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-zinc-100 bg-white/60 py-6 sm:w-24">
      {channels.map((c) => {
        const active = pathname === `/channel/${c.code}`;
        return (
          <Link
            key={c.code}
            href={`/channel/${c.code}`}
            className={`flex w-16 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-center transition ${
              active ? "bg-white shadow-sm ring-1 ring-zinc-200" : "hover:bg-white/70"
            }`}
          >
            {c.logoPath ? (
              // 사용자 지시(2026-09-02): "좌측 메뉴에서 채널 로고 밑 채널 이름은 삭제" — 로고가
              // 있으면 로고만, 이름 텍스트는 없앤다. 로고가 없는 채널(폴백)은 이름 자체가 유일한
              // 식별 수단이라 그대로 둔다.
              <Image src={c.logoPath} alt={c.name} width={40} height={24} className="h-6 w-auto object-contain" />
            ) : (
              <div className="h-6 text-[10px] font-medium text-zinc-500">{c.name}</div>
            )}
          </Link>
        );
      })}
      {/* 사용자 지시(2026-08-20, 2026-08-21 재조정): 1페이지(종합 대시보드)로 돌아가는 홈
          아이콘 — 위 채널 아이콘들과 같은 모양·간격. 처음엔 mt-auto로 사이드바 맨 아래(뷰포트
          하단)에 뒀는데, 채널 아이콘 7개 다음 화면 끝까지 큰 빈틈이 생겨 페이지마다 skyUHD와
          거리가 달라 보이는 문제가 있었다(사용자 피드백) — mt-auto를 빼고 skyUHD 바로 아래에
          자연스럽게 이어지도록 해, 모든 채널 페이지에서 항상 같은 위치가 되게 했다. sticky
          사이드바라 스크롤해도 항상 보이는 것은 그대로 유지. */}
      <Link
        href="/"
        title="메인 화면으로"
        aria-label="메인 화면으로"
        className="flex w-16 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-center transition hover:bg-white/70"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-zinc-500"
        >
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1V9.5" />
        </svg>
        <span className="text-[10px] text-zinc-500">홈</span>
      </Link>
    </nav>
  );
}
