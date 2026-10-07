"use client";

// 1페이지 "오늘의 시청률" 카드 안쪽 맨 아래에 이어 붙는 정보 줄 — 해당일 수도권 개인2049 채널 순위 1~20위 채널의 상위 프로그램 21개(2026-10-06 사용자 지시, 2026-10-07 9개→12개→15개→21개).
// 별도 제목 없이 정보만: 3단 × 7줄, 한 줄 구성 = 순위 · 채널명 · 프로그램명 · 시작 시각 · 시청률(2049) (유료방송가구).
// 프로그램명이 길면 글씨를 줄여 한 줄에 넣는다(잘라 내지 않음). 값은 API(/api/dashboard/top-programs)가 저장된 시청률을 고른 것이며 이 컴포넌트는 그리기만 한다.
import { useLayoutEffect, useRef, useState } from "react";
import { displayProgramName, formatRating, type TopProgramRow } from "@/lib/dashboard/marketTopPrograms";
import { useContextData } from "@/lib/workspace/useContextData";

interface Payload {
  date: string;
  rows: TopProgramRow[];
  /** 드라마·예능 장르 프로그램만 뽑은 21개(구 응답에는 없을 수 있다) */
  rowsDramaVariety?: TopProgramRow[];
  coverage: { rankedChannels: number; withProgramData: number; missing: string[]; missingCount?: number };
  reason?: string;
}

// 자사 채널 프로그램이 순위에 들면 칩에 그 채널 로고의 고유 색을 쓴다(사용자 지시 2026-10-07). 값은 채널 로고 RGB.
// OLIFE 연두는 흰 글씨가 안 읽혀 어두운 글씨를 쓴다. 채널명이 목록에 없으면 기존 검정 칩.
const OWN_CHANNEL_CHIP: Record<string, { bg: string; fg: string }> = {
  ena: { bg: "#3C32E1", fg: "#ffffff" },
  enaplay: { bg: "#00C8D2", fg: "#ffffff" },
  enadrama: { bg: "#EE2A30", fg: "#ffffff" },
  enastory: { bg: "#7826DC", fg: "#ffffff" },
  once: { bg: "#002D50", fg: "#ffffff" },
  olife: { bg: "#B9DB01", fg: "#18181b" },
  skyuhd: { bg: "#D52027", fg: "#ffffff" },
};
const ownChipStyle = (name: string) => OWN_CHANNEL_CHIP[name.replace(/\s+/g, "").toLowerCase()] ?? { bg: "#18181b", fg: "#ffffff" };
// 칩에 보이는 채널명(영문 표기를 사내에서 쓰는 한글 표기로)
const chipLabel = (name: string) => (name === "TV CHOSUN" ? "TV 조선" : name);

/** 글씨를 줄이는 하한(원래 크기의 비율). 일반적인 프로그램명에서는 닿지 않는다. */
const MIN_SCALE = 0.5;

/** 한 줄에 맞추기 — 자연 폭이 칸보다 넓으면 그 비율만큼 글씨를 줄인다. DOM을 직접 갱신해 재렌더를 만들지 않는다. */
function FitOneLine({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      const avail = b.clientWidth;
      const natural = i.scrollWidth; // transform의 영향을 받지 않는 레이아웃 폭
      i.style.transform = natural > avail && avail > 0 ? `scale(${Math.max(MIN_SCALE, avail / natural)})` : "";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={box} className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={text}>
      <span ref={inner} className="inline-block origin-left whitespace-nowrap">
        {text}
      </span>
    </span>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-x-6 md:grid-cols-3" aria-busy="true" aria-label="상위 프로그램을 불러오는 중">
      {Array.from({ length: 21 }, (_, i) => (
        <div key={i} className="flex items-center gap-2 py-[7px]">
          <div className="h-3.5 w-4 animate-pulse rounded bg-zinc-100" />
          <div className="h-3.5 w-12 animate-pulse rounded bg-zinc-100" />
          <div className="h-3.5 flex-1 animate-pulse rounded bg-zinc-100" />
          <div className="h-3.5 w-16 animate-pulse rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  );
}

export default function MarketTopPrograms({ date }: { date: string | null }) {
  const f = useContextData<Payload>(date ? `top-programs|${date}` : null, async (signal) => {
    const res = await fetch(`/api/dashboard/top-programs?date=${encodeURIComponent(date ?? "")}`, { signal });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) throw new Error(body.message ?? "상위 프로그램을 불러오지 못했습니다.");
    return body as Payload;
  });
  // 사용자 지시(2026-10-07): 드라마·예능 프로그램만 보기 전환
  const [onlyDramaVariety, setOnlyDramaVariety] = useState(false);
  const data = f.data;
  const rows = data ? (onlyDramaVariety ? (data.rowsDramaVariety ?? []) : data.rows) : [];
  const stale = !!data && !f.isCurrent; // 날짜를 바꾸는 중에는 이전 날짜 값임을 흐리게 표시
  const cov = data?.coverage;
  const coverageNote = cov
    ? `순위 1~20위 채널 ${cov.rankedChannels}개 중 프로그램 단위 시청률 자료가 있는 채널 ${cov.withProgramData}개 기준입니다.${cov.missing.length > 0 ? ` 자료가 없어 빠진 채널: ${cov.missing.join(", ")}${(cov.missingCount ?? 0) > cov.missing.length ? ` 외 ${(cov.missingCount ?? 0) - cov.missing.length}개` : ""}.` : ""} 유료방송가구는 전국 기준이며 KBS1·MBC·SBS만 수도권 기준입니다(원본 시트 머리글).`
    : "";

  return (
    <div aria-label="해당일 상위 프로그램 21개" role="group">
      {/* 기준만 작게 — 제목은 두지 않는다 */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div role="group" aria-label="장르 보기" className="inline-flex rounded-full bg-zinc-100 p-0.5 text-[11px]">
          {[
            { v: false, label: "전체" },
            { v: true, label: "드라마·예능" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={onlyDramaVariety === o.v}
              onClick={() => setOnlyDramaVariety(o.v)}
              className={`rounded-full px-2.5 py-0.5 font-medium transition ${onlyDramaVariety === o.v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-right text-[11px] text-zinc-500" title={coverageNote || undefined}>
          {data?.date ? `${data.date.slice(5).replace("-", "/")} ` : ""}수도권 개인2049 시청률 순 · 채널 1~20위 · 뉴스 제외 · ( ) 유료방송가구
          {cov && cov.rankedChannels > 0 && (
            <span className="ml-1.5 text-zinc-400" aria-label={coverageNote}>
              ⓘ 자료 {cov.withProgramData}/{cov.rankedChannels}개 채널
            </span>
          )}
        </p>
      </div>
      <div className={stale ? "opacity-50 transition-opacity" : ""}>
        {f.status === "error" && !data ? (
          <p className="py-2 text-center text-[12.5px] text-zinc-600" role="alert">
            {f.errorMessage ?? "상위 프로그램을 불러오지 못했습니다."}{" "}
            <button type="button" onClick={f.reload} className="font-medium text-indigo-700 underline">
              다시 시도
            </button>
          </p>
        ) : !data ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <p className="py-2 text-center text-[12.5px] text-zinc-600">
            {onlyDramaVariety && data.rows.length > 0
              ? "장르가 드라마·예능으로 분류된 프로그램이 없습니다(미분류 프로그램은 이 보기에서 빠집니다)."
              : data.reason === "no_ranks"
              ? "이 날짜의 수도권 개인2049 채널 순위 자료가 없어 상위 프로그램을 만들지 않았습니다."
              : "순위 1~20위 채널 중 프로그램 단위 시청률 자료가 있는 채널이 없어 표시할 프로그램이 없습니다."}
          </p>
        ) : (
          <ol className="grid grid-cols-1 gap-x-6 md:grid-cols-3">
            {rows.map((r) => (
              // 칸 폭을 고정해 3단 모두에서 순위·채널·프로그램명·시각·시청률 열이 위아래로 정확히 맞는다(사용자 지시 2026-10-07: 정렬 정돈).
              <li key={`${r.channelName}|${r.startTime}|${r.programName}`} className="grid grid-cols-[1rem_4.7rem_minmax(0,1fr)_2.6rem_5.7rem] items-center gap-x-1.5 py-[6px]">
                <span className={`text-center text-[12px] font-bold tabular-nums ${r.rank <= 3 ? "text-zinc-900" : "text-zinc-400"}`} aria-label={`${r.rank}위`}>
                  {r.rank}
                </span>
                <span
                  title={`그날 수도권 개인2049 채널 순위 ${r.channelRank}위`}
                  className={`block overflow-hidden whitespace-nowrap rounded px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none ${r.own ? "" : "bg-zinc-100 text-zinc-700"}`}
                  style={r.own ? { backgroundColor: ownChipStyle(r.channelName).bg, color: ownChipStyle(r.channelName).fg } : undefined}
                >
                  {chipLabel(r.channelName)}
                  {r.own && <span className="sr-only"> (자사 채널)</span>}
                </span>
                <FitOneLine text={displayProgramName(r.channelName, r.programName)} className="text-[13px] font-medium text-zinc-900" />
                <span className="whitespace-nowrap text-right text-[11.5px] tabular-nums text-zinc-500">{r.startTime}</span>
                <span className="whitespace-nowrap text-right tabular-nums" title="수도권 개인2049 시청률(괄호: 유료방송가구)">
                  <b className="text-[13px] font-bold text-zinc-900">{formatRating(r.rating)}</b>{" "}
                  <span className="text-[11px] text-zinc-500">({formatRating(r.householdRating)})</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
