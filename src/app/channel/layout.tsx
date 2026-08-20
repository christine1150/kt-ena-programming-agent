// Page 2(채널별 딥다이브) 공통 레이아웃 — 좌측 채널 선택 사이드바 + 오른쪽 상세 화면.
import { supabase } from "@/lib/supabase";
import ChannelSidebar from "./ChannelSidebar";

const ALL_CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];

export default async function ChannelLayout({ children }: { children: React.ReactNode }) {
  const { data: channels } = await supabase
    .from("channels")
    .select("code, name, logo_path")
    .in("code", ALL_CHANNEL_CODES)
    .order("code");

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50">
      <ChannelSidebar
        channels={(channels ?? []).map((c) => ({ code: c.code, name: c.name, logoPath: c.logo_path }))}
      />
      <div className="flex-1">{children}</div>
    </div>
  );
}
