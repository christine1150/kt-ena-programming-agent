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

  return (
    <nav className="flex w-20 flex-col items-center gap-3 border-r border-zinc-100 bg-white/60 py-6 sm:w-24">
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
              <Image src={c.logoPath} alt={c.name} width={40} height={24} className="h-6 w-auto object-contain" />
            ) : (
              <div className="h-6 text-[10px] font-medium text-zinc-500">{c.name}</div>
            )}
            <span className="text-[10px] text-zinc-500">{c.name}</span>
          </Link>
        );
      })}
      {/* 사용자 지시(2026-08-20): 좌측 하단에 1페이지(종합 대시보드)로 돌아가는 홈 아이콘 —
          위 채널 아이콘들과 같은 모양·간격으로 통일감 있게, mt-auto로 사이드바 맨 아래 고정. */}
      <Link
        href="/"
        title="메인 화면으로"
        aria-label="메인 화면으로"
        className="mt-auto flex w-16 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-center transition hover:bg-white/70"
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
