// 분당 시청률(program_minute_ratings)을 주요 콘텐츠 리뷰의 "분당 시청률" 그래프 모양으로 바꾸는 순수 함수.
// DB에 있는 값을 시간 창으로 자르고 형식만 맞출 뿐 새로 계산하지 않는다(CLAUDE.md 원칙 1). 시각은 방송일 기준(02:00~26:00)이라 00~01시는 +24시간으로 센다.
import { toChannelCode } from "@/lib/channelMaster";

export interface MinuteRatingRow {
  channel_name: string;
  minute_of_day: number;
  p2049_capital: number | null;
  /** 전국 가구(분당). 공식 프로그램 가구 값이 없는 타사의 괄호 값을 방영 구간 평균으로 보충할 때만 쓴다 */
  household_national?: number | null;
}

export interface MinutePoint {
  time: string; // "HH:MM" (자정 이후는 00:03처럼 시계 시각)
  rating: number;
}

export interface AutoMinuteCompetitor {
  rank: number | null;
  program_name: string;
  channel_name: string;
  start_time: string | null;
  end_time: string | null;
  target_rating: number | null;
  target_share: number | null;
  household_rating: number | null;
  /** 이 경쟁채널의 분당 값(있으면 그래프가 평균 가로선 대신 실제 선으로 그린다) */
  minutes: MinutePoint[];
}

export interface AutoMinute {
  minute_ratings: MinutePoint[];
  competitor_programs: AutoMinuteCompetitor[];
}

/** "22:30:00" → 방송일 기준 분(1350). 00~01시는 24~25시로 센다. */
export function clockToBroadcastMinute(clock: string): number | null {
  const m = clock.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return (h < 2 ? h + 24 : h) * 60 + Number(m[2]);
}

export function broadcastMinuteToClock(minute: number): string {
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

const sameChannel = (name: string, code: string) => toChannelCode(name) === toChannelCode(code);

export interface AutoMinuteInput {
  channelCode: string;
  startTime: string; // 본방 실제 시작(HH:MM:SS)
  endTime: string | null;
  simulcastChannel: string | null;
  simulcastProgram: string | null;
  simulcastStart: string | null;
  simulcastRating: number | null;
  /** 동시방송 채널의 같은 프로그램 가구 시청률(DB 그대로, 없으면 null) */
  simulcastHouseholdRating?: number | null;
  /** 같은 시간대 타사 프로그램(겹침 RPC가 준 값 그대로). 평균 가로선 또는 분당 선으로 함께 그린다 */
  otherCompetitors?: {
    channel_name: string;
    program_name: string;
    start_time: string;
    end_time: string | null;
    target_rating: number | null;
    household_rating: number | null;
  }[];
  /** 앞뒤로 더 보여 줄 분(리드인·리드아웃). PD 시트가 방송 앞뒤를 조금 넓게 자르는 것과 같은 방식 */
  leadInMinutes?: number;
  leadOutMinutes?: number;
}

/** 본방 구간 앞뒤로 조금 넓힌 창의 분당 선을 만든다. 자사 점이 2개 미만이면 null(그래프를 그리지 않음). */
export function buildAutoMinute(rows: MinuteRatingRow[], input: AutoMinuteInput): AutoMinute | null {
  const start = clockToBroadcastMinute(input.startTime);
  if (start === null) return null;
  const end = input.endTime ? clockToBroadcastMinute(input.endTime) : null;
  const from = start - (input.leadInMinutes ?? 15);
  const to = (end !== null && end > start ? end : start + 60) + (input.leadOutMinutes ?? 10);
  const inWindow = (r: MinuteRatingRow) => r.minute_of_day >= from && r.minute_of_day <= to && r.p2049_capital !== null;
  const series = (match: (name: string) => boolean): MinutePoint[] =>
    rows
      .filter((r) => match(r.channel_name) && inWindow(r))
      .sort((a, b) => a.minute_of_day - b.minute_of_day)
      .map((r) => ({ time: broadcastMinuteToClock(r.minute_of_day), rating: r.p2049_capital as number }));

  const own = series((n) => sameChannel(n, input.channelCode));
  if (own.length < 2) return null;

  // 타사 프로그램의 공식 가구 시청률이 DB에 없을 때(SBS Plus 등 경쟁채널 시트는 2049만 있음), 그 채널의 방영 구간 분당 전국 가구 값을 평균내 괄호 값으로 쓴다.
  // 2026-11-11 나는SOLO로 확인: ENA 분당 평균 2.0053 vs 공식 2.009(약 0.2% 차). 구간의 80% 이상 분당 값이 있을 때만 채운다(부족하면 null → 괄호 없음).
  const householdAvg = (channelName: string, startClock: string | null, endClock: string | null): number | null => {
    if (!startClock || !endClock) return null;
    const s = clockToBroadcastMinute(startClock);
    const e = clockToBroadcastMinute(endClock);
    if (s === null || e === null || e <= s) return null;
    const vals = rows.filter((r) => r.channel_name === channelName && r.minute_of_day >= s && r.minute_of_day < e && r.household_national !== null && r.household_national !== undefined).map((r) => r.household_national as number);
    if (vals.length < (e - s) * 0.8) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const competitors: AutoMinuteCompetitor[] = [];
  if (input.simulcastChannel && input.simulcastRating !== null) {
    const name = rows.map((r) => r.channel_name).find((n) => sameChannel(n, input.simulcastChannel as string));
    const minutes = name ? series((n) => n === name) : [];
    if (name && minutes.length >= 2) {
      competitors.push({
        rank: 1,
        program_name: input.simulcastProgram ?? "",
        channel_name: name,
        start_time: `${minutes[0].time}:00`,
        end_time: `${minutes[minutes.length - 1].time}:00`,
        target_rating: input.simulcastRating,
        target_share: null,
        household_rating: input.simulcastHouseholdRating ?? householdAvg(name, input.simulcastStart ?? input.startTime, input.endTime),
        minutes,
      });
    }
  }
  // 같은 시간대 타사 프로그램도 PD 수기 리포트와 같은 방식으로 더한다(분당 값이 있으면 선, 없으면 평균 가로선). 이미 넣은 채널·자사 채널은 건너뛴다.
  for (const c of input.otherCompetitors ?? []) {
    if (c.target_rating === null || !c.end_time) continue;
    if (sameChannel(c.channel_name, input.channelCode)) continue;
    if (competitors.some((x) => sameChannel(x.channel_name, c.channel_name))) continue;
    const name = rows.map((r) => r.channel_name).find((n) => sameChannel(n, c.channel_name));
    const minutes = name ? series((n) => n === name) : [];
    competitors.push({
      rank: competitors.length + 1,
      program_name: c.program_name,
      channel_name: c.channel_name,
      start_time: c.start_time,
      end_time: c.end_time,
      target_rating: c.target_rating,
      target_share: null,
      household_rating: c.household_rating ?? (name ? householdAvg(name, c.start_time, c.end_time) : null),
      minutes: minutes.length >= 2 ? minutes : [],
    });
  }
  return { minute_ratings: own, competitor_programs: competitors };
}
