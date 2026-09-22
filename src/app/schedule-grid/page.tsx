"use client";

// 사용자 지시(2026-09-20): "2주 이상의 비교 및 다운로드는... 이 링크들을 관리자 화면의
// 링크가 아닌 2페이지에서의 링크로 변환해줘. 다시 각 PD들이 관리자 화면으로 접근할 수
// 없도록." — admin/schedule-grid/page.tsx와 같은 두 주 비교 화면을 PD 세션으로도 열 수 있는
// 자리에 새로 만든다.
// 사용자 재지시(2026-09-22): "왼쪽과 오른쪽을 같은 채널로 비교하는 것을 기본값으로 하되,
// 오른쪽도 왼쪽도 각각 채널과 기간을 정할 수 있게 해줘. 당사 채널 외에도 우리가 분석 가능한
// 모든 경쟁채널을 선택할 수 있게 해줘." — 좌/우 각각 독립된 채널·주차 상태로 바꾸고(초기값은
// URL의 channel과 그 채널의 최근 두 주 — 기존과 동일한 "같은 채널 비교"), 채널 드롭다운
// 옵션에 우리 7개 채널 + 등록된 모든 경쟁채널(scheduleGridSource.ts의 인코딩 규칙,
// COMPETITOR::이름)을 함께 넣는다.
import { Suspense, useEffect, useState, type Dispatch, type SetStateAction } from "react";
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
type CompetitorOption = { code: string; name: string };
type SideState = {
  channelCode: string;
  channelName: string;
  themeColor: string;
  weeks: Week[];
  week: string;
  loaded: boolean;
};

const EMPTY_SIDE: SideState = { channelCode: "", channelName: "", themeColor: "#6366f1", weeks: [], week: "", loaded: false };

function ScheduleComparisonInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlChannelCode = searchParams.get("channel") ?? "";
  const [allChannels, setAllChannels] = useState<ChannelOption[]>([]);
  const [allCompetitors, setAllCompetitors] = useState<CompetitorOption[]>([]);
  const [left, setLeft] = useState<SideState>(EMPTY_SIDE);
  const [right, setRight] = useState<SideState>(EMPTY_SIDE);

  // 사용자 지시(2026-09-22): "같은 채널로 비교하는 것을 기본값으로" — URL의 channel이 바뀌면
  // (Page 2의 "주간 비교" 링크로 새로 들어오거나, 아래 최상단 드롭다운으로 전환했을 때) 좌/우
  // 둘 다 그 채널로 초기화하고, 각 쪽의 최근 두 주를 기본 비교 대상으로 삼는다.
  useEffect(() => {
    if (!urlChannelCode) return;
    setLeft({ ...EMPTY_SIDE, channelCode: urlChannelCode });
    setRight({ ...EMPTY_SIDE, channelCode: urlChannelCode });
  }, [urlChannelCode]);

  function loadSide(channelCode: string, setSide: Dispatch<SetStateAction<SideState>>, preferSecondWeek: boolean) {
    fetch(`/api/schedule-grid/weeks?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.ok) {
          setSide((prev) => ({ ...prev, loaded: true }));
          return;
        }
        setAllChannels((prev) => (body.allChannels?.length ? body.allChannels : prev));
        setAllCompetitors((prev) => (body.allCompetitors?.length ? body.allCompetitors : prev));
        const ws: Week[] = body.weeks ?? [];
        setSide({
          channelCode,
          channelName: body.channelName ?? channelCode,
          themeColor: body.themeColor || "#6366f1",
          weeks: ws,
          week: (preferSecondWeek ? ws[1]?.weekStart : ws[0]?.weekStart) ?? "",
          loaded: true,
        });
      })
      .catch(() => setSide((prev) => ({ ...prev, loaded: true })));
  }

  useEffect(() => {
    if (!left.channelCode || left.loaded) return;
    loadSide(left.channelCode, setLeft, false);
  }, [left.channelCode, left.loaded]);
  useEffect(() => {
    if (!right.channelCode || right.loaded) return;
    loadSide(right.channelCode, setRight, true);
  }, [right.channelCode, right.loaded]);

  if (!urlChannelCode) {
    return <div className="p-10 text-sm text-zinc-500">채널 정보가 없습니다 — 채널 화면의 &quot;주간 비교&quot; 링크로 들어와 주세요.</div>;
  }

  // 채널 드롭다운 공용 옵션 — 우리 7개 채널 다음에 구분선 성격의 optgroup으로 등록 경쟁채널을 잇는다.
  const channelOptions = allChannels.length > 0 ? allChannels : [{ code: urlChannelCode, name: left.channelName || urlChannelCode }];

  function ChannelSelect({ side, onChange }: { side: SideState; onChange: (code: string) => void }) {
    return (
      <select
        value={side.channelCode}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-700"
      >
        <optgroup label="당사 채널">
          {channelOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </optgroup>
        {allCompetitors.length > 0 && (
          <optgroup label="등록 경쟁채널">
            {allCompetitors.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
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
                value={urlChannelCode}
                onChange={(e) => router.push(`/schedule-grid?channel=${encodeURIComponent(e.target.value)}`)}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-700"
              >
                {channelOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">{left.channelName || urlChannelCode} 주간 비교</h1>
              <p className="text-sm text-zinc-500">기본은 같은 채널의 두 주 비교이며, 좌우 각각 채널·기간을 따로 바꿀 수 있습니다.</p>
            </div>
          </div>
          {/* Page 1 상단과 동일한 원형 로고 링크 — 지금 보고 있는 채널도 포함해 7개 모두의
              Page 2로 바로 이동할 수 있게 한다. */}
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

        <div className="flex flex-col gap-4 lg:flex-row">
          {[
            { side: left, setSide: setLeft, label: "왼쪽" },
            { side: right, setSide: setRight, label: "오른쪽" },
          ].map(({ side, setSide, label }) => (
            <div key={label} className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-zinc-100">
                <span className="text-sm text-zinc-500">{label}</span>
                <ChannelSelect side={side} onChange={(code) => setSide({ ...EMPTY_SIDE, channelCode: code })} />
                {side.loaded && side.weeks.length > 0 ? (
                  <select
                    value={side.week}
                    onChange={(e) => setSide((prev) => ({ ...prev, week: e.target.value }))}
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-700"
                  >
                    {label === "오른쪽" && <option value="">없음</option>}
                    {side.weeks.map((w) => (
                      <option key={w.weekStart} value={w.weekStart}>
                        {w.weekStart} ~ {w.weekEnd}
                        {w.hasUpload ? " (업로드됨)" : ""}
                      </option>
                    ))}
                  </select>
                ) : side.loaded ? (
                  <span className="text-sm text-zinc-400">이 채널은 편성표 데이터가 없습니다.</span>
                ) : (
                  <span className="text-sm text-zinc-400">불러오는 중...</span>
                )}
              </div>
              {side.week && (
                <ScheduleWeekGrid
                  apiBase="/api/schedule-grid"
                  channelCode={side.channelCode}
                  week={side.week}
                  weekEnd={side.weeks.find((w) => w.weekStart === side.week)?.weekEnd ?? ""}
                  themeColor={side.themeColor}
                />
              )}
            </div>
          ))}
        </div>
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
