// 분당 시청률(program_minute_ratings)을 주요 콘텐츠 리뷰의 "분당 시청률" 그래프 모양으로 바꾸는 순수 함수.
// DB에 있는 값을 시간 창으로 자르고 형식만 맞출 뿐 새로 계산하지 않는다(CLAUDE.md 원칙 1). 시각은 방송일 기준(02:00~26:00)이라 00~01시는 +24시간으로 센다.
import { toChannelCode } from "@/lib/channelMaster";

export interface MinuteRatingRow {
  channel_name: string;
  minute_of_day: number;
  p2049_capital: number | null;
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
        household_rating: null,
        minutes,
      });
    }
  }
  return { minute_ratings: own, competitor_programs: competitors };
}
