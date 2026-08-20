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
    </nav>
  );
}
