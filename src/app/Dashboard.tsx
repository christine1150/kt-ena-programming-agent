"use client";

// Page 1 종합 대시보드 (DESIGN.md 1.2 참고 — 참고 이미지의 파스텔 블루·라벤더 그라디언트 +
// 글래스모피즘 화이트 카드 톤을 따른다). 숫자는 전부 /api/dashboard/page1이 SQL로 계산해
// 내려준 값을 그대로 표시하고, 여기서는 문장 조립(줄글 인사이트)만 한다.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChannelLogo } from "@/components/ChannelLogo";
import { formatDateWithDow } from "@/lib/dateFormat";
import { josaIga, josaEunNeun } from "@/lib/josa";

interface ChannelSummary {
  code: string;
  name: string;
  logoPath: string | null;
  themeColor: string | null;
  logoVisibleRatio: number | null;
  logoVisibleTopRatio: number | null;
  primaryTarget: string;
  currentRating: number | null;
  currentRank: number | null;
  dodChangePct: number | null;
  wowChangePct: number | null; // 전주 동요일(정확히 7일 전) 대비 — 사용자 지시(2026-08-20)
  targetRating: number | null;
  targetRank: string | null;
  achievementPct: number | null;
  gap: number | null;
  // ENA 히어로 카드용(사용자 지시 2026-08-20) — 올해 1월 1일~오늘 누적 평균 시청률·순위.
  ytdAvgRating: number | null;
  ytdAvgRank: number | null;
}

// Original 리포트: 관리자가 지정한 요일별 화이트리스트 프로그램만 분석한다(사용자 지시).
// 화이트리스트가 없는 요일(예: 금요일)은 최근 7일 종합 리뷰(weekly)로 대체된다.
interface OriginalCompetitorHighlight {
  competitor_name: string;
  competitor_program_name: string;
  competitor_start_time: string;
  competitor_rating: number | null;
  rating_gap: number | null;
}
interface OriginalDailyItem {
  whitelist_program_name: string;
  broadcast_channel_code: string;
  expected_time: string;
  note: string | null;
  matched_program_name: string;
  matched_start_time: string;
  matched_rating: number | null;
  featured_category: string | null;
  rerun_channel_code: string | null;
  rerun_program_name: string | null;
  rerun_start_time: string | null;
  rerun_rating: number | null;
  retention_pct: number | null;
  competitorHighlights: OriginalCompetitorHighlight[];
  // 사용자 지시(2026-08-20): 본방 전 선행 재방(전주 회차)·본방 후 당일 자체 재방·직전 방영
  // 대비·회차 번호(회차제 프로그램만, 관리자가 seed를 심어둔 것만 채워짐).
  pre_rerun_start_time: string | null;
  pre_rerun_rating: number | null;
  self_rerun_start_time: string | null;
  self_rerun_rating: number | null;
  prior_occurrence_date: string | null;
  prior_occurrence_rating: number | null;
  prior_rating_change_pct: number | null;
  episode_number: number | null;
}
interface OriginalWeeklyItem {
  program_name: string;
  broadcast_channel_code: string;
  instances_count: number;
  avg_rating: number | null;
  best_date: string | null;
  best_rating: number | null;
  latest_date: string | null;
  latest_rating: number | null;
}
interface OriginalContentSummary {
  mode: "daily" | "weekly_review";
  daily: OriginalDailyItem[];
  weekly: OriginalWeeklyItem[];
}

interface KillerContentRow {
  program_id: string;
  canonical_name: string;
  channel_rank: number;
  avg_rating: number;
  airing_count: number;
  last_aired_date: string;
  channels: { code: string; name: string };
}

// 채널별 인사이트(줄글)용 원시 신호 — get_channel_daily_narrative가 계산한 값 그대로.
interface NarrativeDemographic {
  label: string;
  today: number | null;
  baseline_avg: number | null;
  delta_pct: number | null;
}
interface ChannelNarrativeSignal {
  channelCode: string;
  today_rating: number | null;
  baseline_avg_rating: number | null;
  rating_delta_pct: number | null;
  today_rank: number | null;
  baseline_avg_rank: number | null;
  today_share: number | null;
  baseline_avg_share: number | null;
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  baseline_peak_hour: number | null;
  baseline_peak_rating: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  // 사용자 지시(2026-08-20): 평균 대비 엄청난 하락(자기 자신의 최근 12주 평균 대비 -30% 이상)을
  // 이끈 프로그램도 별도 코멘트.
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_baseline_days: number | null;
  decline_program_delta_pct: number | null;
  demographics: NarrativeDemographic[] | null;
  household?: {
    today_top_program: string | null;
    today_top_rating: number | null;
    today_top_share: number | null;
    today_top_start_time: string | null;
    baseline_avg_rating: number | null;
    baseline_avg_share: number | null;
    baseline_days: number | null;
  } | null;
}
interface KillerContentDaypartRow {
  channelCode: string;
  canonical_name: string;
  avg_rating: number;
  airing_count: number;
  best_daypart: string | null;
  best_daypart_avg: number | null;
  worst_daypart: string | null;
  worst_daypart_avg: number | null;
  avg_share: number | null;
  channel_avg_share_baseline: number | null;
  household_avg_rating: number | null;
  household_baseline_avg_rating: number | null;
}

interface DashboardData {
  asOfDate: string;
  channels: ChannelSummary[];
  originalContentReport: OriginalContentSummary;
  killerContent: KillerContentRow[];
  narrativeSignals: ChannelNarrativeSignal[];
  killerContentDaypart: KillerContentDaypartRow[];
}

// 사용자 지시: 인사이트·킬러콘텐츠는 이 순서로 언급 (ENA → ENA Play → ENA Drama → OLIFE → ONCE → ENA Story)
const INSIGHT_CHANNEL_ORDER = ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY"];

const CHANNEL_NAME_BY_CODE: Record<string, string> = {
  ENA: "ENA",
  ENA_DRAMA: "ENA Drama",
  ENA_PLAY: "ENA Play",
  ENA_STORY: "ENA Story",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "skyUHD",
};

const DAYPART_LABEL: Record<string, string> = {
  새벽: "새벽(02~08시)",
  오전: "오전(09~13시)",
  오후: "오후(14~18시)",
  저녁_심야: "저녁·심야(19~25시)",
};

function fmtTime(t: string): string {
  return t.slice(0, 5);
}

// 사용자 지시(2026-08-20): 화면 표시는 소수점 3자리까지만 반올림한다 — DB에는 원본 정밀도
// 그대로 저장돼 있고 다른 모든 계산(SQL)도 원본 값을 그대로 쓰므로, 이건 순수 표시 자릿수다.
// 사용자 지시(2026-08-20): skyUHD만 예외적으로 1페이지에서 소숫점 아래 네 자리까지 표기(원본
// 수기 파일의 정밀도를 그대로 살림), 나머지 채널은 전부 세 자리로 반올림.
function formatRating(v: number | null, channelCode?: string): string {
  if (v === null) return "—";
  const fixed = channelCode === "SKYUHD" ? v.toFixed(4) : v.toFixed(3);
  // 사용자 지시(2026-08-20): 반올림 결과가 0.000(skyUHD는 0.0000)이면 "0"으로만 표시한다
  // (NULL=데이터 없음과는 다르게, 0은 실제로 측정된 값이 0이라는 뜻 — CLAUDE.md NULL≠0 원칙).
  return parseFloat(fixed) === 0 ? "0" : fixed;
}

function shortDemoLabel(label: string): string {
  return label.replace(/^(수도권|전국)\s*/, "");
}

// 사용자 지시: "최근 4주 평균 동향과 오늘의 데이터를 보았을 때 독특한 인사이트를 주는 시간대·
// 프로그램·시청률·점유율·시청시간·시청 연령에서 독특한 모습... 4주 이상 같은 패턴이 반복되는
// 내용은 가급적 피함". SQL이 준 편차값 중 임계값을 넘는 것만 골라 문장으로 만든다 — 편차가
// 작다는 건 곧 "평소와 같은 반복 패턴"이라는 뜻이라 자연히 걸러진다.
function buildChannelNarrative(channelName: string, s: ChannelNarrativeSignal): { channelName: string; text: string } {
  const sentences: { priority: number; text: string }[] = [];

  if (s.rating_delta_pct !== null && Math.abs(s.rating_delta_pct) >= 15 && s.today_rating !== null) {
    const dir = s.rating_delta_pct >= 0 ? "상승" : "하락";
    sentences.push({
      priority: Math.abs(s.rating_delta_pct),
      text: `시청률이 최근 4주 평균(${formatRating(s.baseline_avg_rating)}) 대비 ${Math.abs(s.rating_delta_pct).toFixed(1)}% ${dir}한 ${formatRating(s.today_rating)}을 기록했습니다.`,
    });
  }

  if (s.today_rank !== null && s.baseline_avg_rank !== null) {
    const diff = s.baseline_avg_rank - s.today_rank; // 양수면 순위 상승(숫자가 작아짐)
    if (Math.abs(diff) >= 3) {
      sentences.push({
        priority: Math.abs(diff) * 3,
        text: `순위가 평소(평균 ${s.baseline_avg_rank.toFixed(1)}위)보다 ${Math.abs(diff).toFixed(1)}위 ${diff >= 0 ? "상승" : "하락"}한 ${s.today_rank}위입니다.`,
      });
    }
  }

  if (
    s.top_program_name &&
    s.top_program_baseline_days !== null &&
    s.top_program_baseline_days >= 3 &&
    s.top_program_rating !== null &&
    s.top_program_baseline_avg !== null &&
    s.top_program_baseline_avg > 0
  ) {
    const pct = ((s.top_program_rating - s.top_program_baseline_avg) / s.top_program_baseline_avg) * 100;
    if (Math.abs(pct) >= 30) {
      sentences.push({
        priority: Math.abs(pct),
        text: `'${s.top_program_name}'${josaIga(s.top_program_name)} 오늘 ${formatRating(s.top_program_rating)}(${s.top_program_start_time ? fmtTime(s.top_program_start_time) : ""})로, 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(s.top_program_baseline_avg)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높은" : "낮은"} 성적을 냈습니다.`,
      });
    }
  }

  // 사용자 지시(2026-08-20): "평균 대비 엄청난 하락을 이끌었을 경우 그 부분도 코멘트" — 위
  // top_program은 "오늘 최고 시청률" 프로그램 기준이라 그 프로그램 자체가 하락한 경우만 잡힌다.
  // decline_program은 오늘 방영된 프로그램 중 자기 자신의 같은 요일·시간대(본방 슬롯) 기준 최근
  // 8주 평균 대비 가장 크게(-30% 이상) 부진했던 프로그램을 별도로 짚어(SQL이 이미 -30% 이하만
  // 채워서 내려줌), top_program과 같은 프로그램이면 중복 언급을 피한다.
  // 사용자 피드백(2026-08-20): 이전엔 요일·시간대 구분 없이 같은 이름의 모든 방영분(재방송 포함)을
  // 평균 냈더니 "최근 평균"이 실제 본방 대비 비정상적으로 낮게 나와 등락률이 왜곡됐다(예: 712%) —
  // get_channel_daily_narrative가 2026-08-20부터 같은 요일·시간대(본방 슬롯)로 좁혀서 계산한다.
  if (s.decline_program_name && s.decline_program_name !== s.top_program_name && s.decline_program_delta_pct !== null) {
    sentences.push({
      priority: Math.abs(s.decline_program_delta_pct) * 0.9,
      text: `'${s.decline_program_name}'${josaEunNeun(s.decline_program_name)} 오늘 ${formatRating(s.decline_program_rating)}(${s.decline_program_start_time ? fmtTime(s.decline_program_start_time) : ""})로, 이 프로그램의 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(s.decline_program_baseline_avg)})보다 ${Math.abs(s.decline_program_delta_pct).toFixed(0)}% 하락해 평균을 끌어내렸습니다.`,
    });
  }

  if (s.today_peak_hour !== null && s.baseline_peak_hour !== null && s.today_peak_hour !== s.baseline_peak_hour) {
    sentences.push({
      priority: 20,
      text: `평소 강세 시간대(${s.baseline_peak_hour}시대)와 달리 오늘은 ${s.today_peak_hour}시대에 가장 높은 시청률(${formatRating(s.today_peak_rating)})을 보였습니다.`,
    });
  }

  // 사용자 지시: ENA/ENA Play/ENA Drama는 KPI(2049)와 별개로, 유료가구 시청률·점유율에서
  // 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균 대비 유의미하게(±30%) 기여한 타이틀이 있으면
  // 함께 언급한다. baseline_days는 최대 8주라(주 1회 편성 기준) >=3으로 top_program과 기준을
  // 맞춘다(사용자 피드백 2026-08-20 이전엔 요일·시간대 무관 최근 84일 평균이라 >=5였음).
  if (s.household?.today_top_program && s.household.baseline_days !== null && s.household.baseline_days >= 3) {
    const h = s.household;
    const todayTopProgram = h.today_top_program;
    if (todayTopProgram && h.today_top_rating !== null && h.baseline_avg_rating !== null && h.baseline_avg_rating > 0) {
      const pct = ((h.today_top_rating - h.baseline_avg_rating) / h.baseline_avg_rating) * 100;
      if (Math.abs(pct) >= 30) {
        const sameAsTarget = todayTopProgram === s.top_program_name;
        const lead = sameAsTarget
          ? `'${todayTopProgram}'${josaEunNeun(todayTopProgram)} 수도권 2049뿐 아니라 유료가구 기준으로도`
          : `2049 타깃과 별개로, 유료가구 기준으로는 '${todayTopProgram}'${josaIga(todayTopProgram)}`;
        sentences.push({
          priority: Math.abs(pct) * 0.8,
          text: `${lead} 오늘 시청률 ${formatRating(h.today_top_rating)}(점유율 ${h.today_top_share?.toFixed(2) ?? "—"}%)로 같은 요일·시간대(본방 슬롯) 기준 최근 8주 평균(${formatRating(h.baseline_avg_rating)})보다 ${Math.abs(pct).toFixed(0)}% ${pct >= 0 ? "높은" : "낮은"} 성과를 냈습니다.`,
        });
      }
    }
  }

  if (s.demographics && s.demographics.length > 0) {
    const candidates = s.demographics.filter((d) => d.delta_pct !== null && Math.abs(d.delta_pct) >= 30 && d.today !== null);
    // 사용자 지시(2026-08-20): 연령대별 시청률이 100% 빠져서(오늘 0을 기록해) 나온 변화는 가장
    // 나중에(덜 중요하게) 소개한다 — 표본이 작은 연령대에서 하루 0을 찍는 건 흔한 노이즈이므로,
    // 다른 의미 있는 변화가 있으면 그걸 먼저 보여주고, 이건 우선순위를 낮춰 3개 안에 못 들면
    // 아예 생략되게 한다.
    const isZeroedOut = (d: NarrativeDemographic) => d.today === 0 && d.delta_pct !== null && d.delta_pct <= -99.5;
    const meaningful = candidates.filter((d) => !isZeroedOut(d)).sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
    const zeroed = candidates.filter(isZeroedOut).sort((a, b) => Math.abs(b.delta_pct!) - Math.abs(a.delta_pct!));
    const notable = meaningful[0] ?? zeroed[0];
    if (notable) {
      sentences.push({
        priority: isZeroedOut(notable) ? 1 : Math.abs(notable.delta_pct!),
        text: `${shortDemoLabel(notable.label)} 시청률이 평소보다 ${Math.abs(notable.delta_pct!).toFixed(0)}% ${notable.delta_pct! >= 0 ? "상승한" : "하락한"} ${formatRating(notable.today)}을 기록했습니다.`,
      });
    }
  }

  // 사용자 지시(2026-08-20): 채널명은 로고 메인 색상으로 굵게 표시 — 문자열에 채널명을 섞지
  // 않고 별도 필드로 돌려줘서 렌더링 쪽에서 색을 입힐 수 있게 한다.
  if (sentences.length === 0) {
    return { channelName, text: "특별한 변화 없이 평소 수준을 유지했습니다." };
  }
  sentences.sort((a, b) => b.priority - a.priority);
  return {
    channelName,
    text: sentences
      .slice(0, 3)
      .map((s2) => s2.text)
      .join(" "),
  };
}

// skyUHD는 사용자 지시대로 등위가 10위 이상 바뀐 경우에만 문장을 만든다(아니면 아예 언급 안 함).
function buildSkyUhdNarrative(s: ChannelNarrativeSignal | undefined): { channelName: string; text: string } | null {
  if (!s || s.today_rank === null || s.baseline_avg_rank === null) return null;
  const diff = s.baseline_avg_rank - s.today_rank;
  if (Math.abs(diff) < 10) return null;
  return {
    channelName: "skyUHD",
    text: `시장 전체 순위가 평소(평균 ${s.baseline_avg_rank.toFixed(0)}위)보다 ${Math.abs(diff).toFixed(0)}위 ${diff >= 0 ? "상승" : "하락"}한 ${s.today_rank}위를 기록했습니다.`,
  };
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-zinc-400">전일 비교 자료 없음</span>;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// 카드 공통 스타일 — 참고 이미지의 글래스모피즘(반투명 화이트 + 은은한 그림자) 톤.
const CARD = "rounded-3xl bg-white/80 backdrop-blur-xl p-6 shadow-[0_8px_30px_-12px_rgba(99,102,241,0.25)] ring-1 ring-white/60";

// 올해 1/1~오늘 누적 평균 시청률·순위 + 목표 순위(6위 등) 대비 몇 위 차이인지(사용자 지시).
// target_rank는 target_goals에 자유 텍스트로 저장돼 있어(예: skyUHD "경쟁채널 중 2위") 숫자로
// 못 읽으면 목표 비교 문구는 생략한다.
function buildYtdLine(channel: ChannelSummary): string | null {
  if (channel.ytdAvgRating === null || channel.ytdAvgRank === null) return null;
  let gapText = "";
  const targetRankNum = channel.targetRank ? parseInt(channel.targetRank, 10) : NaN;
  if (!Number.isNaN(targetRankNum)) {
    const diff = channel.ytdAvgRank - targetRankNum; // 양수 = 목표보다 순위 숫자가 커서(=더 낮은 순위) 미달
    if (Math.abs(diff) < 0.5) {
      gapText = ` · 목표 순위(${targetRankNum}위)와 동일`;
    } else {
      gapText = ` · 목표 순위(${targetRankNum}위) 대비 ${Math.abs(diff).toFixed(1)}위 ${diff > 0 ? "낮음" : "높음"}`;
    }
  }
  return `누적(1/1~오늘) 평균 ${formatRating(channel.ytdAvgRating, channel.code)}(${channel.ytdAvgRank.toFixed(1)}위)${gapText}`;
}

// ENA 히어로 — 사용자 지시(2026-08-20): 로고·시청률 가운데 정렬, 시청률(순위) + 전일 대비
// 증감률, 그 아래 작은 글씨로 올해 누적 평균 시청률(순위)과 목표 순위 대비 격차.
function ChannelHero({ channel }: { channel: ChannelSummary }) {
  const ytdLine = buildYtdLine(channel);
  return (
    <Link href={`/channel/${channel.code}`} className="flex flex-col items-center text-center">
      <ChannelLogo
        channel={{
          logoPath: channel.logoPath,
          name: channel.name,
          logoVisibleRatio: channel.logoVisibleRatio,
          logoVisibleTopRatio: channel.logoVisibleTopRatio,
        }}
        heightPx={56}
      />
      {/* 사용자 지시(2026-08-20): ENA 시청률·순위·전일 대비 증감을 한 줄로. */}
      <div className="mt-3 flex flex-wrap items-baseline justify-center gap-2">
        <span className="text-4xl font-semibold text-zinc-900">
          {formatRating(channel.currentRating)}
          {channel.currentRank !== null && (
            <span className="ml-1.5 text-lg font-normal text-zinc-400">({channel.currentRank}위)</span>
          )}
        </span>
        <ChangeBadge pct={channel.dodChangePct} />
      </div>
      {ytdLine && <p className="mt-3 text-xs text-zinc-400">{ytdLine}</p>}
    </Link>
  );
}

// 사용자 지시(2026-08-20): ONCE·skyUHD 로고는 원본 워드마크 자체가 가로로 넓어(실측 가로세로비
// ONCE 4.03, skyUHD 3.70 vs OLIFE 2.26) 높이만 맞추면 이 좁은 줄에서 오른쪽이 잘린다 — 두 채널만
// OLIFE의 실제 렌더 폭(heightPx=20 기준 약 45px)에 맞춰 폭 상한을 준다.
const WIDTH_CAPPED_LOGO_CODES = new Set(["ONCE", "SKYUHD"]);
const COMPACT_ROW_LOGO_MAX_WIDTH_PX = 45;

function CompactChannelRow({ channel, logoReference }: { channel: ChannelSummary; logoReference?: ChannelSummary }) {
  const isSkyUhd = channel.code === "SKYUHD";
  return (
    <Link
      href={`/channel/${channel.code}`}
      className="flex flex-nowrap items-center gap-2 rounded-2xl bg-indigo-50/50 px-3 py-2 transition hover:bg-indigo-50"
    >
      {/* 사용자 지시(2026-08-20): 로고 폭이 채널마다 달라도 이 칸의 폭은 고정해, 그 다음에 오는
          시청률 숫자의 "0."이 모든 행에서 같은 위치에서 시작하도록 한다. */}
      <div className="flex w-14 shrink-0 items-center justify-center">
        <ChannelLogo
          channel={{
            logoPath: channel.logoPath,
            name: channel.name,
            logoVisibleRatio: channel.logoVisibleRatio,
            logoVisibleTopRatio: channel.logoVisibleTopRatio,
          }}
          reference={
            logoReference
              ? {
                  logoPath: logoReference.logoPath,
                  name: logoReference.name,
                  logoVisibleRatio: logoReference.logoVisibleRatio,
                  logoVisibleTopRatio: logoReference.logoVisibleTopRatio,
                }
              : undefined
          }
          heightPx={20}
          maxWidthPx={WIDTH_CAPPED_LOGO_CODES.has(channel.code) ? COMPACT_ROW_LOGO_MAX_WIDTH_PX : undefined}
        />
      </div>
      {/* 사용자 지시: 시청률 표현의 "0."이 왼쪽으로 동일하게 정렬되도록 고정폭+왼쪽정렬+숫자
          전용 자간(tabular-nums). skyUHD는 소수점 넷째 자리까지 표기해 자릿수가 하나 더
          많으므로, 폰트를 줄여 전체 숫자 폭을 다른 채널과 비슷하게 맞춘다. */}
      <span className={`w-12 shrink-0 text-left font-semibold tabular-nums text-zinc-800 ${isSkyUhd ? "text-xs" : "text-sm"}`}>
        {formatRating(channel.currentRating, channel.code)}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs font-normal text-zinc-400">
        {channel.currentRank !== null ? `(${channel.currentRank}위)` : ""}
      </span>
      {/* 사용자 지시(2026-08-20): 전주 대비 줄은 삭제 — 채널당 데이터가 한 줄에 깔끔하게 보이도록. */}
      <div className="ml-auto shrink-0 whitespace-nowrap">
        <ChangeBadge pct={channel.dodChangePct} />
      </div>
    </Link>
  );
}

// ① 채널 현황 카드 — R1C1
function ChannelStatusCard({ channels }: { channels: Map<string, ChannelSummary> }) {
  const ena = channels.get("ENA");
  const rest = ["ENA_PLAY", "ENA_DRAMA", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]
    .map((c) => channels.get(c))
    .filter((c): c is ChannelSummary => !!c);

  return (
    <div className={CARD}>
      {ena && <ChannelHero channel={ena} />}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rest.map((c) => (
          <CompactChannelRow key={c.code} channel={c} logoReference={ena} />
        ))}
      </div>
    </div>
  );
}

// ② Original 성과 리포트(표 형태) — R1C2
// 사용자 지시(2026-08-20): 헤드라인은 "<프로그램> N회 본방송 시청률 (전회 대비 상승/하락,
// 동시간대 타깃 #위)" 형태로. #위는 "우리가 확보 가능한 모든" 동시간대 등록 경쟁 프로그램(같은
// 채널 경쟁채널 시트 + 다른 채널 시트의 크로스룩업까지 전부 합친 competitorHighlights, 상위
// 3개로 자르지 않은 전체 목록)을 시청률로 비교해 정확히 매긴다 — 1 + (우리보다 높은 경쟁
// 프로그램 수). 회차 번호가 없는 프로그램(회차제로 관리하지 않는 것들)은 생략.
interface OriginalHeadline {
  text: string;
  rank: number | null;
  beatenBy: OriginalCompetitorHighlight[]; // 우리보다 시청률 높은 경쟁 프로그램(시청률 내림차순)
}
function buildOriginalHeadline(item: OriginalDailyItem): OriginalHeadline | null {
  if (item.episode_number === null) return null;
  const parts: string[] = [];
  if (item.prior_rating_change_pct !== null) {
    parts.push(item.prior_rating_change_pct >= 0 ? "전회 대비 상승" : "전회 대비 하락");
  }
  let rank: number | null = null;
  let beatenBy: OriginalCompetitorHighlight[] = [];
  if (item.matched_rating !== null) {
    beatenBy = item.competitorHighlights
      .filter((c) => c.competitor_rating !== null && c.competitor_rating > item.matched_rating!)
      .sort((a, b) => (b.competitor_rating ?? 0) - (a.competitor_rating ?? 0));
    rank = 1 + beatenBy.length;
    parts.push(`동시간대 타깃 ${rank}위`);
  }
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return { text: `<${item.matched_program_name}> ${item.episode_number}회 본방송 시청률${suffix}`, rank, beatenBy };
}

// 사용자 지시(2026-08-20): 문단 서술 대신 "핵심 요약 불릿 + [편성 인사이트]" 형태로 재구성.
// 본방 전 선행 재방(리드인)·동시간대 순위·본채널 당일 자체 재방·타 채널 직후재방까지 전부 이미
// SQL이 계산한 실측값이고, 여기서는 비율·문장만 조립한다(CLAUDE.md: 암산 대신 SQL 값 그대로
// 사용). 채널명을 하드코딩하지 않고 CHANNEL_NAME_BY_CODE로 그때그때 방송 채널을 반영해
// 어떤 오리지널 프로그램·채널 조합에도 같은 틀이 적용되도록 일반화했다.
interface OriginalInsightBlock {
  bullets: string[];
  schedulingNote: string | null;
}
function buildOriginalInsight(
  item: OriginalDailyItem,
  rank: number | null,
  beatenBy: OriginalCompetitorHighlight[]
): OriginalInsightBlock {
  const bullets: string[] = [];
  const broadcastChannelName = CHANNEL_NAME_BY_CODE[item.broadcast_channel_code] ?? item.broadcast_channel_code;

  // ① 리드인(선행 재방) — 있을 때만
  if (item.pre_rerun_rating !== null && item.matched_rating !== null && item.pre_rerun_rating > 0) {
    const upliftPct = ((item.matched_rating - item.pre_rerun_rating) / item.pre_rerun_rating) * 100;
    bullets.push(
      `리드인 효과: ${item.pre_rerun_start_time ? fmtTime(item.pre_rerun_start_time) : ""} 전주 회차 선행 재방(${formatRating(item.pre_rerun_rating)}%) 방영, 본방은 리드인 대비 ${Math.abs(upliftPct).toFixed(0)}% ${upliftPct >= 0 ? "높았음" : "낮았음"}`
    );
  }

  // ② 동시간대 순위(1위면 사수, 아니면 몇 위인지 + 앞선 경쟁 프로그램)
  if (item.matched_rating !== null) {
    const changeText =
      item.prior_rating_change_pct !== null
        ? `전회 대비 ${item.prior_rating_change_pct >= 0 ? "+" : "-"}${Math.abs(item.prior_rating_change_pct).toFixed(1)}% ${item.prior_rating_change_pct >= 0 ? "상승" : "하락"}`
        : null;
    if (rank === 1 && item.competitorHighlights.length > 0 && item.competitorHighlights[0].competitor_rating !== null && item.competitorHighlights[0].competitor_rating > 0) {
      const top = item.competitorHighlights[0]; // 이미 시청률 내림차순 정렬됨
      const ratio = item.matched_rating / top.competitor_rating!;
      bullets.push(
        `동시간대 1위 달성: 본방송 시청률 ${formatRating(item.matched_rating)}%${changeText ? `(${changeText})` : ""}로 경쟁사인 ${top.competitor_name}(${formatRating(top.competitor_rating)}%) 대비 ${ratio.toFixed(1)}배 높은 시청률을 기록하며 동시간대 타깃 1위 사수`
      );
    } else if (rank !== null && rank > 1 && beatenBy.length > 0) {
      const named = beatenBy.slice(0, 3).map((c) => `${c.competitor_name}(${formatRating(c.competitor_rating)}%)`).join(", ");
      const extra = beatenBy.length > 3 ? ` 외 ${beatenBy.length - 3}개` : "";
      bullets.push(
        `동시간대 ${rank}위 기록: 본방송 시청률 ${formatRating(item.matched_rating)}%${changeText ? `(${changeText})` : ""}로, ${named}${extra}보다 낮았음(동시에 관찰된 참고 정보 — 인과관계로 단정하지 않음)`
      );
    } else {
      bullets.push(`본방송 시청률 ${formatRating(item.matched_rating)}%${changeText ? `(${changeText})` : ""} 기록`);
    }
  }

  // ③ 본채널 당일 자체 재방 효과
  let selfRetentionPct: number | null = null;
  if (item.self_rerun_rating !== null && item.matched_rating !== null && item.matched_rating > 0) {
    selfRetentionPct = (item.self_rerun_rating / item.matched_rating) * 100;
    bullets.push(
      `${broadcastChannelName} 본채널 직재방 효과: 본방 종료 직후 ${broadcastChannelName} 본채널 자체 재방(${item.self_rerun_start_time ? fmtTime(item.self_rerun_start_time) : ""}) 시청률은 ${formatRating(item.self_rerun_rating)}%로, 본방 대비 ${selfRetentionPct.toFixed(1)}%의 시청 유입을 견인함`
    );
  }

  // ④ 타 채널(예: ENA Play) 직후재방 효과/한계 — 유지율 10% 미만이면 "한계"로 표현
  let crossRetentionPct: number | null = null;
  let rerunChannelName: string | null = null;
  if (item.rerun_rating !== null && item.retention_pct !== null && item.rerun_channel_code) {
    crossRetentionPct = item.retention_pct;
    rerunChannelName = CHANNEL_NAME_BY_CODE[item.rerun_channel_code] ?? item.rerun_channel_code;
    const isWeak = crossRetentionPct < 10;
    bullets.push(
      `${rerunChannelName} 직재방 ${isWeak ? "한계" : "효과"}: ${rerunChannelName} 직후 재방(${item.rerun_start_time ? fmtTime(item.rerun_start_time) : ""}) 시청률은 ${formatRating(item.rerun_rating)}%(본방 대비 ${crossRetentionPct.toFixed(1)}%)${isWeak ? "에 머무름" : "로 유입을 견인함"}`
    );
  }

  // [편성 인사이트] — 본채널 재방 유입이 타 채널 재방 유입보다 뚜렷하게(10%p 이상) 높을 때만
  // 카니발라이제이션 가능성을 짚는다. 패턴이 없으면 생성하지 않는다(단정 회피).
  let schedulingNote: string | null = null;
  if (selfRetentionPct !== null && crossRetentionPct !== null && rerunChannelName && selfRetentionPct - crossRetentionPct >= 10) {
    schedulingNote =
      `${broadcastChannelName} 직재방으로 인한 ${rerunChannelName} 카니발라이제이션 가능성 — ${broadcastChannelName} 본채널이 본방 종료 직후 자체 재방을 바로 배치함에 따라 재시청·유입 수요가 본채널로 집중되어, ${rerunChannelName}의 직후 재방 편성은 시청률 견인 효과를 거의 보지 못한 것으로 보입니다(동시에 관찰된 패턴 — 인과관계로 단정하지 않음). ${rerunChannelName}의 재방 시점 분산이나 타깃층 맞춤형 차별화 편성을 검토해볼 만합니다.`;
  }

  return { bullets, schedulingNote };
}

// 사용자 지시(2026-08-20): 안내 문구("동시간대 경쟁 프로그램은 Competitor Master에 등록되고...")
// 대신 오늘 분석된 오리지널 라인업 전체를 종합하는 인사이트 브리핑을 넣는다. 새 계산 없이
// 이미 각 항목이 갖고 있는 값(동시간대 순위는 buildOriginalHeadline과 같은 방식으로 재계산,
// 전회 대비·자체재방 유지율은 이미 있는 필드)만 집계한다.
function buildOriginalDailyBriefing(daily: OriginalDailyItem[]): string | null {
  const withRating = daily.filter((d) => d.matched_rating !== null && d.episode_number !== null);
  if (withRating.length === 0) return null;

  const withChange = withRating.filter((d) => d.prior_rating_change_pct !== null);
  const risingCount = withChange.filter((d) => d.prior_rating_change_pct! >= 0).length;
  const fallingCount = withChange.length - risingCount;

  // 사용자 지시(2026-08-20): "오늘 분석된 오리지널 N편 중 M편이 동시간대 1위를 기록했습니다"는
  // 화이트리스트가 보통 1~2편이라 어색하게 읽혀 삭제 — 개별 프로그램의 정확한 순위는 위 헤드라인
  // ("<프로그램> N회 본방송 시청률 ... 동시간대 타깃 #위")에서 이미 프로그램명·회차로 정확히 보여준다.
  const parts: string[] = [];
  // 사용자 피드백(2026-08-20): 화이트리스트가 보통 1~2편이라 "1편 상승, 0편 하락"처럼 표본 1개를
  // 집계 문장으로 말하면 당연한 소리를 부자연스럽게 반복하는 것으로 읽힌다 — 비교할 프로그램이
  // 2편 이상일 때만 이 집계 문장을 쓰고, 1편뿐이면 아래 mostMoved 문장이 그 프로그램의 등락을
  // 이미 개별적으로 설명하므로 생략한다.
  if (withChange.length >= 2) {
    parts.push(`전회 대비로는 ${risingCount}편 상승, ${fallingCount}편 하락했습니다.`);
  }
  const mostMoved = [...withChange].sort((a, b) => Math.abs(b.prior_rating_change_pct!) - Math.abs(a.prior_rating_change_pct!))[0];
  if (mostMoved && mostMoved.prior_rating_change_pct !== null && Math.abs(mostMoved.prior_rating_change_pct) >= 10) {
    parts.push(
      `'${mostMoved.matched_program_name}'${josaIga(mostMoved.matched_program_name)} 전회 대비 ${mostMoved.prior_rating_change_pct >= 0 ? "▲" : "▼"} ${Math.abs(mostMoved.prior_rating_change_pct).toFixed(1)}%로 가장 뚜렷하게 움직였습니다.`
    );
  }
  const withRerun = withRating.filter((d) => d.self_rerun_rating !== null && d.matched_rating! > 0);
  if (withRerun.length > 0) {
    const avgRetention = withRerun.reduce((sum, d) => sum + (d.self_rerun_rating! / d.matched_rating!) * 100, 0) / withRerun.length;
    parts.push(`당일 자체 재방이 있었던 ${withRerun.length}편은 평균 본방 대비 ${avgRetention.toFixed(0)}% 시청률을 유지했습니다.`);
  }
  return parts.join(" ");
}

function OriginalContentReportCard({ report }: { report: OriginalContentSummary }) {
  return (
    <div className={CARD}>
      <h2 className="mb-4 text-sm font-semibold text-indigo-600">Original 성과</h2>

      {report.mode === "daily" ? (
        report.daily.length === 0 ? (
          <p className="text-sm text-zinc-400">
            오늘 요일에 지정된 오리지널 프로그램이 실제로 방영된 기록을 찾지 못했습니다(조건부 편성일
            수 있음).
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {report.daily.map((h) => {
              const headline = buildOriginalHeadline(h);
              const insight = buildOriginalInsight(h, headline?.rank ?? null, headline?.beatenBy ?? []);
              const rowKey = `${h.broadcast_channel_code}-${h.matched_start_time}`;
              return (
                <div key={rowKey}>
                  {/* 사용자 지시(2026-08-20): 헤드라인 "<프로그램> N회 본방송 시청률 (전회 대비
                      상승/하락, 동시간대 타깃 #위)" + 태그(오리지널 예능/드라마/브랜디드 등)를
                      #위 다음 한 줄에 오른쪽 끝으로 배치. */}
                  {(headline || h.featured_category) && (
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-indigo-700">{headline ? headline.text : h.matched_program_name}</span>
                      {h.featured_category && (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                          {h.featured_category}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-zinc-400">
                          <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                          <th className="pb-1.5 pr-2 font-medium">본방</th>
                          <th className="pb-1.5 pr-2 font-medium">직후재방</th>
                          <th className="pb-1.5 font-medium">동시간대 경쟁</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-indigo-50 align-top">
                          <td className="py-2 pr-2">
                            <div className="font-medium text-zinc-800">{h.matched_program_name}</div>
                            {h.pre_rerun_rating !== null && (
                              <div className="mt-1 text-[10px] text-zinc-400">
                                선행재방 {h.pre_rerun_start_time ? fmtTime(h.pre_rerun_start_time) : ""} · {formatRating(h.pre_rerun_rating)}
                              </div>
                            )}
                            {h.self_rerun_rating !== null && (
                              <div className="text-[10px] text-zinc-400">
                                당일 자체재방 {h.self_rerun_start_time ? fmtTime(h.self_rerun_start_time) : ""} · {formatRating(h.self_rerun_rating)}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-zinc-600">
                            {CHANNEL_NAME_BY_CODE[h.broadcast_channel_code] ?? h.broadcast_channel_code}
                            <br />
                            {fmtTime(h.matched_start_time)} · {formatRating(h.matched_rating)}
                            {h.prior_rating_change_pct !== null && (
                              <div className="mt-0.5 text-[10px]">
                                <span className={h.prior_rating_change_pct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                  전회 대비 {h.prior_rating_change_pct >= 0 ? "▲" : "▼"} {Math.abs(h.prior_rating_change_pct).toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-zinc-600">
                            {h.rerun_program_name && h.rerun_start_time ? (
                              <>
                                {CHANNEL_NAME_BY_CODE[h.rerun_channel_code ?? ""] ?? h.rerun_channel_code}
                                <br />
                                {fmtTime(h.rerun_start_time)} · {formatRating(h.rerun_rating)}
                                {h.retention_pct !== null && <span className="text-zinc-400"> ({h.retention_pct.toFixed(1)}%)</span>}
                              </>
                            ) : (
                              <span className="text-zinc-300">—</span>
                            )}
                          </td>
                          <td className="py-2">
                            {h.competitorHighlights.length === 0 ? (
                              <span className="text-zinc-300">—</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {h.competitorHighlights.slice(0, 3).map((c, i) => (
                                  <span key={i} className="text-zinc-500">
                                    <span className="font-medium text-zinc-700">{c.competitor_name}</span> {fmtTime(c.competitor_start_time)} {formatRating(c.competitor_rating)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {insight.bullets.length > 0 && (
                    <ul className="mt-1.5 space-y-1 pb-1">
                      {insight.bullets.map((b, i) => (
                        <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-zinc-500">
                          <span className="shrink-0 text-zinc-300">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {insight.schedulingNote && (
                    <div className="mt-1 rounded-xl bg-amber-50 p-2.5">
                      <p className="mb-1 text-[10px] font-semibold text-amber-700">[편성 인사이트]</p>
                      <p className="flex gap-1.5 text-[11px] leading-relaxed text-amber-800">
                        <span className="shrink-0 text-amber-300">•</span>
                        <span>{insight.schedulingNote}</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : report.weekly.length === 0 ? (
        <p className="text-sm text-zinc-400">최근 7일간 오리지널 프로그램 방영 기록을 찾지 못했습니다.</p>
      ) : (
        <div>
          <p className="mb-2 text-xs text-zinc-400">
            오늘은 지정된 오리지널 프로그램이 없는 요일입니다 — 최근 7일 종합 리뷰를 대신 보여드립니다.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-zinc-400">
                  <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                  <th className="pb-1.5 pr-2 font-medium">채널</th>
                  <th className="pb-1.5 pr-2 font-medium">평균</th>
                  <th className="pb-1.5 pr-2 font-medium">최고</th>
                  <th className="pb-1.5 font-medium">최근</th>
                </tr>
              </thead>
              <tbody>
                {report.weekly.map((w) => (
                  <tr key={`${w.broadcast_channel_code}-${w.program_name}`} className="border-t border-indigo-50">
                    <td className="py-2 pr-2 font-medium text-zinc-800">{w.program_name}</td>
                    <td className="py-2 pr-2 text-zinc-600">{CHANNEL_NAME_BY_CODE[w.broadcast_channel_code] ?? w.broadcast_channel_code}</td>
                    <td className="py-2 pr-2 text-zinc-600">{formatRating(w.avg_rating)}</td>
                    <td className="py-2 pr-2 text-zinc-600">
                      {formatRating(w.best_rating)}
                      <span className="text-zinc-400"> ({w.best_date})</span>
                    </td>
                    <td className="py-2 text-zinc-600">
                      {formatRating(w.latest_rating)}
                      <span className="text-zinc-400"> ({w.latest_date})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.mode === "daily" &&
        report.daily.length > 0 &&
        (() => {
          const briefing = buildOriginalDailyBriefing(report.daily);
          return briefing ? <p className="mt-3 text-sm leading-relaxed text-zinc-700">{briefing}</p> : null;
        })()}
    </div>
  );
}

// ③ 채널별 인사이트(줄글) — R2C1. 사용자 지시(2026-08-20): 채널명은 그 채널 로고의 메인
// 색상(channels.theme_color)으로 굵게 표시.
function ChannelNarrativeCard({
  signals,
  themeColorByCode,
}: {
  signals: ChannelNarrativeSignal[];
  themeColorByCode: Map<string, string | null>;
}) {
  const byCode = new Map(signals.map((s) => [s.channelCode, s]));
  const lines: { channelName: string; text: string; color: string | null }[] = [];
  for (const code of INSIGHT_CHANNEL_ORDER) {
    const s = byCode.get(code);
    if (s) lines.push({ ...buildChannelNarrative(CHANNEL_NAME_BY_CODE[code], s), color: themeColorByCode.get(code) ?? null });
  }
  const skyuhdLine = buildSkyUhdNarrative(byCode.get("SKYUHD"));
  if (skyuhdLine) lines.push({ ...skyuhdLine, color: themeColorByCode.get("SKYUHD") ?? null });

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-indigo-600">채널별 인사이트</h2>
      <p className="mb-4 text-xs text-zinc-400">
        오늘 데이터를 최근 4주 평균과 비교해 눈에 띄는 변화만 짚었습니다(4주 넘게 반복되는 평소
        패턴은 가급적 언급을 피합니다).
      </p>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-700">
        {lines.length === 0 ? (
          <p className="text-zinc-400">아직 인사이트를 계산할 데이터가 부족합니다.</p>
        ) : (
          lines.map((line, i) => (
            <p key={i}>
              <span className="font-bold" style={{ color: line.color ?? undefined }}>
                {line.channelName}
              </span>
              : {line.text}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

// ④ 채널별 킬러 콘텐츠(강세/약세 시간대) — R2C2
function KillerContentCard({ rows }: { rows: KillerContentDaypartRow[] }) {
  const byChannel = new Map<string, KillerContentDaypartRow[]>();
  for (const r of rows) {
    if (!byChannel.has(r.channelCode)) byChannel.set(r.channelCode, []);
    byChannel.get(r.channelCode)!.push(r);
  }

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-sm font-semibold text-indigo-600">채널별 킬러 콘텐츠</h2>
      <p className="mb-4 text-xs text-zinc-400">최근 4주 평균 시청률 상위 프로그램 — 강세·약세 시간대가 있으면 함께 표시합니다.</p>
      <div className="flex flex-col gap-4 text-sm">
        {INSIGHT_CHANNEL_ORDER.map((code) => {
          const list = byChannel.get(code) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={code}>
              <p className="mb-1.5 text-xs font-semibold text-zinc-500">{CHANNEL_NAME_BY_CODE[code]}</p>
              <div className="flex flex-col gap-1.5">
                {list.map((k) => {
                  // 사용자 지시(2026-08-20): 시청률은 약해도 점유율이 채널 평균보다 상대적으로 좋거나
                  // (±15% 이상), 타깃(수도권 2049 등) 시청률은 약해도 유료가구 시청률이 채널의 유료가구
                  // 평균보다 좋으면(±15% 이상) 별도 코멘트. 후자는 KPI가 이미 유료가구인 채널은
                  // household_avg_rating이 SQL에서 NULL로 내려온다.
                  const shareNote =
                    k.avg_share !== null && k.channel_avg_share_baseline !== null && k.channel_avg_share_baseline > 0 && k.avg_share / k.channel_avg_share_baseline - 1 >= 0.15
                      ? `점유율이 채널 평균(${k.channel_avg_share_baseline.toFixed(2)}%)보다 좋습니다(${k.avg_share.toFixed(2)}%).`
                      : null;
                  const householdNote =
                    k.household_avg_rating !== null && k.household_baseline_avg_rating !== null && k.household_baseline_avg_rating > 0 && k.household_avg_rating / k.household_baseline_avg_rating - 1 >= 0.15
                      ? `타깃 시청률은 약해도 유료가구 시청률은 채널 유료가구 평균(${formatRating(k.household_baseline_avg_rating)})보다 좋습니다(${formatRating(k.household_avg_rating)}).`
                      : null;
                  return (
                    <div key={k.canonical_name} className="rounded-xl bg-indigo-50/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-zinc-800">{k.canonical_name}</span>
                        <span className="text-zinc-500">{formatRating(k.avg_rating)}</span>
                      </div>
                      {(k.best_daypart || k.worst_daypart) && (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {k.best_daypart && (
                            <span className="text-emerald-600">
                              강세 {DAYPART_LABEL[k.best_daypart] ?? k.best_daypart}({formatRating(k.best_daypart_avg)})
                            </span>
                          )}
                          {k.best_daypart && k.worst_daypart && "  ·  "}
                          {k.worst_daypart && (
                            <span className="text-rose-500">
                              약세 {DAYPART_LABEL[k.worst_daypart] ?? k.worst_daypart}({formatRating(k.worst_daypart_avg)})
                            </span>
                          )}
                        </p>
                      )}
                      {shareNote && <p className="mt-1 text-xs text-sky-600">{shareNote}</p>}
                      {householdNote && <p className="mt-1 text-xs text-sky-600">{householdNote}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-zinc-400">데이터가 아직 부족합니다.</p>}
      </div>
    </div>
  );
}

// 사용자 지시(2026-08-20): 채널명을 앞에, 🔴🟢🟡 상태 라벨은 채널명 뒤에 — 라벨은 영어
// (STRENGTHEN/WATCH/RISK) 대신 한국어로. 채널명 폰트 색은 그 채널 로고 색(bold)로 표시.
function InsightCard({
  channelName,
  themeColor,
  tone,
  text,
}: {
  channelName: string;
  themeColor: string | null;
  tone: "positive" | "watch" | "risk";
  text: string;
}) {
  const styles = {
    positive: { emoji: "🟢", bg: "bg-emerald-50", label: "강세" },
    watch: { emoji: "🟡", bg: "bg-amber-50", label: "주의" },
    risk: { emoji: "🔴", bg: "bg-rose-50", label: "위험" },
  }[tone];
  return (
    <div className={`rounded-2xl ${styles.bg} px-3 py-2 text-xs text-zinc-700`}>
      <span className="mr-1.5 font-bold" style={{ color: themeColor ?? undefined }}>
        {channelName}
      </span>
      <span className="mr-1">{styles.emoji}</span>
      <span className="mr-1.5 font-semibold text-zinc-500">{styles.label}</span>
      {text}
    </div>
  );
}

function buildQuickTags(channels: ChannelSummary[]) {
  return channels
    .filter((c) => c.achievementPct !== null)
    .map((c) => {
      const pct = c.achievementPct!;
      if (pct >= 100) return { channelName: c.name, themeColor: c.themeColor, tone: "positive" as const, text: `목표 대비 ${pct.toFixed(1)}% 달성` };
      if (pct >= 70) return { channelName: c.name, themeColor: c.themeColor, tone: "watch" as const, text: `목표 대비 ${pct.toFixed(1)}%` };
      return { channelName: c.name, themeColor: c.themeColor, tone: "risk" as const, text: `목표 대비 ${pct.toFixed(1)}%` };
    });
}

export default function Dashboard({ isAdmin }: { isAdmin?: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/dashboard/page1");
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "불러오지 못했습니다.");
    } else {
      setData(body);
      setErrorMessage(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch("/api/dashboard/page1");
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!res.ok || !body.ok) {
        setErrorMessage(body.message ?? "불러오지 못했습니다.");
      } else {
        setData(body);
        setErrorMessage(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byCode = new Map(data?.channels.map((c) => [c.code, c]) ?? []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-indigo-50 via-sky-50 to-violet-50 px-6 py-8">
      {/* 참고 이미지 톤앤매너: 흐릿한 파스텔 블롭 장식(고정 배경, 콘텐츠와 상호작용 없음) */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-200 opacity-40 blur-3xl" />
        <div className="absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-violet-200 opacity-40 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-sky-200 opacity-30 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* 사용자 지시(2026-08-20): 좌측 최상단은 채널별 로고가 아니라 고정 KT ENA CI 마크. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- 고정 정적 브랜드 마크(픽셀 크롭 불필요) */}
            <img src="/kt-ena-ci-black.png" alt="KT ENA" style={{ height: 36, width: "auto" }} />
            <h1 className="text-xl font-bold text-zinc-900">
              {formatDateWithDow(data?.asOfDate)} 채널 종합 리포트
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* 사용자 지시(2026-08-20): 7개 채널 서브 페이지로 바로 이동할 수 있는 작은 아이콘을
                관리자·새로고침 아이콘 왼쪽에 나열. */}
            {data && (
              <div className="flex items-center gap-1">
                {data.channels.map((c) => (
                  <Link
                    key={c.code}
                    href={`/channel/${c.code}`}
                    title={c.name}
                    aria-label={c.name}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-white/60 backdrop-blur hover:bg-white"
                  >
                    <ChannelLogo
                      channel={{ logoPath: c.logoPath, name: c.name, logoVisibleRatio: c.logoVisibleRatio, logoVisibleTopRatio: c.logoVisibleTopRatio }}
                      heightPx={14}
                      maxWidthPx={20}
                    />
                  </Link>
                ))}
              </div>
            )}
            {/* 사용자 지시: 관리자 화면 이동은 작은 아이콘으로만. */}
            {isAdmin && (
              <a
                href="/admin"
                title="관리자 화면"
                aria-label="관리자 화면"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-base shadow-sm ring-1 ring-white/60 backdrop-blur hover:bg-white"
              >
                ⚙
              </a>
            )}
            {/* 사용자 지시(2026-08-20): 새로고침도 관리자 아이콘처럼 작게. */}
            <button
              onClick={load}
              disabled={loading}
              title="새로고침"
              aria-label="새로고침"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-base text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? "…" : "🔄"}
            </button>
          </div>
        </div>

        {errorMessage && <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>}

        {loading && !data && <p className="text-sm text-zinc-500">불러오는 중...</p>}

        {data && (
          // 2열 × 3행 그리드(사용자 지시). 3행은 두 칸을 합쳐 빠른 요약 태그를 전체 폭으로 보여준다.
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChannelStatusCard channels={byCode} />
            <OriginalContentReportCard report={data.originalContentReport} />

            <ChannelNarrativeCard
              signals={data.narrativeSignals}
              themeColorByCode={new Map(data.channels.map((c) => [c.code, c.themeColor]))}
            />
            <KillerContentCard rows={data.killerContentDaypart} />

            <div className={`${CARD} lg:col-span-2`}>
              <h2 className="mb-3 text-sm font-semibold text-indigo-600">오늘의 빠른 요약</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {buildQuickTags(data.channels).map((tag, i) => (
                  <InsightCard key={i} channelName={tag.channelName} themeColor={tag.themeColor} tone={tag.tone} text={tag.text} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
