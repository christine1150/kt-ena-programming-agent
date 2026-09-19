"use client";

// 사용자 지시(2026-09-20): "2주 이상의 비교 및 다운로드는... 이 링크들을 관리자 화면의
// 링크가 아닌 2페이지에서의 링크로 변환해줘. 다시 각 PD들이 관리자 화면으로 접근할 수
// 없도록." — admin/schedule-grid/page.tsx와 같은 두 주 비교 화면을 PD 세션으로도 열 수 있는
// 자리에 새로 만든다. 채널 선택 드롭다운은 없다 — Page 2의 "주간 비교" 링크가 이미 그 채널을
// 알고 있어(?channel=코드) 넘겨주므로, 여기서는 그 채널 하나의 주차 비교만 다룬다(2주 이상
// 비교·다운로드라는 기능 범위는 그대로, 채널 전환만 뺐다 — 다른 채널을 보려면 그 채널의
// Page 2에서 다시 들어오면 된다).
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ScheduleWeekGrid } from "@/components/ScheduleWeekGrid";
import { ChannelLogo } from "@/components/ChannelLogo";

type Week = { weekStart: string; weekEnd: string; hasUpload: boolean };
type ChannelOption = {
  code: string;
  name: string;
  logoPath: string | null;
  logoVisibleRatio: number | null;
  logoVisibleTopRatio: number | null;
  themeColor: string | null;
};

function ScheduleComparisonInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelCode = searchParams.get("channel") ?? "";
  const [channelName, setChannelName] = useState("");
  const [themeColor, setThemeColor] = useState("#6366f1");
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [weekA, setWeekA] = useState("");
  const [weekB, setWeekB] = useState("");
  const [loaded, setLoaded] = useState(false);
  // 사용자 지시(2026-09-20): "왼쪽 상단에는 다른 채널 편성표로 갈 수 있는 드랍다운 메뉴를,
  // 우측에는... 각 채널의 2페이지로 갈 수 있는 동그라미 링크 버튼" — Page 1 상단과 같은
  // 7개 채널 원형 로고 링크를 그리려면 전체 채널 목록이 필요해, weeks API에 함께 실어온다.
  const [allChannels, setAllChannels] = useState<ChannelOption[]>([]);

  useEffect(() => {
    if (!channelCode) return;
    fetch(`/api/schedule-grid/weeks?channel=${channelCode}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.ok) return;
        setChannelName(body.channelName ?? channelCode);
        setThemeColor(body.themeColor || "#6366f1");
        const ws: Week[] = body.weeks ?? [];
        setWeeks(ws);
        setWeekA(ws[0]?.weekStart ?? "");
        setWeekB(ws[1]?.weekStart ?? "");
        setAllChannels(body.allChannels ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [channelCode]);

  if (!channelCode) {
    return <div className="p-10 text-sm text-zinc-500">채널 정보가 없습니다 — 채널 화면의 "주간 비교" 링크로 들어와 주세요.</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      {/* 사용자 지시(2026-09-20): "양쪽의 화면을 충분히 활용하여, 편성표가 좌우 스크롤바 없이
          보이도록" — 기존 max-w-6xl(1152px)은 두 주 편성표를 나란히 놓기엔 좁아 각 편성표
          내부(overflow-x-auto, minWidth 560px)가 잘려 자체 스크롤바가 생겼다. 훨씬 넓은
          상한으로 바꿔 두 편성표가 화면 안에서 각자 충분한 폭을 받게 한다. */}
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-500">
              채널
              <select
                value={channelCode}
                onChange={(e) => router.push(`/schedule-grid?channel=${e.target.value}`)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-700"
              >
                {(allChannels.length > 0 ? allChannels : [{ code: channelCode, name: channelName || channelCode }]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">{channelName || channelCode} 주간 비교</h1>
              <p className="text-sm text-zinc-500">두 주의 편성표를 나란히 비교하고, 각각 엑셀로 받거나 인쇄할 수 있습니다.</p>
            </div>
          </div>
          {/* Page 1 상단과 동일한 원형 로고 링크 — "채널 화면으로" 버튼 하나 대신, 7개 채널
              모두의 Page 2로 바로 이동할 수 있게 한다(지금 보고 있는 채널도 그 안에 포함). */}
          <div className="flex items-center gap-1.5">
            {allChannels.map((c) => (
              <Link
                key={c.code}
                href={`/channel/${c.code}`}
                title={c.name}
                aria-label={c.name}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200 transition hover:ring-zinc-300"
              >
                <ChannelLogo
                  channel={{ logoPath: c.logoPath, name: c.name, logoVisibleRatio: c.logoVisibleRatio, logoVisibleTopRatio: c.logoVisibleTopRatio }}
                  heightPx={22}
                  maxWidthPx={32}
                />
              </Link>
            ))}
          </div>
        </div>

        {loaded && weeks.length === 0 && <p className="text-sm text-zinc-400">이 채널의 시청률 데이터가 없어 편성표를 그릴 수 없습니다.</p>}

        {weeks.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              왼쪽 주
              <select value={weekA} onChange={(e) => setWeekA(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                {weeks.map((w) => (
                  <option key={w.weekStart} value={w.weekStart}>
                    {w.weekStart} ~ {w.weekEnd}
                    {w.hasUpload ? " (업로드됨)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              오른쪽 주(비교, 선택)
              <select value={weekB} onChange={(e) => setWeekB(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                <option value="">없음</option>
                {weeks.map((w) => (
                  <option key={w.weekStart} value={w.weekStart}>
                    {w.weekStart} ~ {w.weekEnd}
                    {w.hasUpload ? " (업로드됨)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {weekA && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <ScheduleWeekGrid
              apiBase="/api/schedule-grid"
              channelCode={channelCode}
              week={weekA}
              weekEnd={weeks.find((w) => w.weekStart === weekA)?.weekEnd ?? ""}
              themeColor={themeColor}
            />
            {weekB && (
              <ScheduleWeekGrid
                apiBase="/api/schedule-grid"
                channelCode={channelCode}
                week={weekB}
                weekEnd={weeks.find((w) => w.weekStart === weekB)?.weekEnd ?? ""}
                themeColor={themeColor}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScheduleComparisonPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-zinc-400">불러오는 중...</div>}>
      <ScheduleComparisonInner />
    </Suspense>
  );
}
