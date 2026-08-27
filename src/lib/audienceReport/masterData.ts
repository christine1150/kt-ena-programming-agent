// Phase 1(2026-08-28, Audience Intelligence Report 계획서 J절 5번) — "채널기본정보 엑셀"(목표
// 시청률·목표 순위·경쟁 채널)을 리포트에 반영하기 위한 조회 헬퍼. 사용자 지시: "목표 시청률과
// 순위, 경쟁 채널은 채널기본정보 엑셀 파일에 있는 내용들을 참고하여 보고서에 작성한다." 이미
// `채널기본정보.xlsx`("채널 별 경쟁채널" 시트)가 channelMaster.ts 파서 + 관리자 업로드 라우트를
// 통해 target_goals/competitors 테이블에 적재되어 있음을 실측 확인했다(2026-08-27) — 새 파일
// 파싱을 만들지 않고 이 두 테이블을 그대로 조회한다.
import { supabase } from "@/lib/supabase";
import { TARGET_GOAL_YEAR } from "@/lib/channelMaster";

export interface ChannelMasterInfo {
  targetRank: string | null; // "6" 또는 "경쟁채널 중 2위"처럼 자유 텍스트인 경우가 있어 문자열 그대로 보관
  targetRating: number | null;
  competitors: string[]; // competitor_name 목록(등록 순서)
}

/** 채널 코드로 목표 시청률/순위와 등록된 경쟁 채널 목록을 가져온다. year 생략 시 channelMaster.ts의
 *  TARGET_GOAL_YEAR(현재 업로드분 기준 연도)를 쓴다. 해당 채널의 channels 행이 없으면 예외. */
export async function getChannelMasterInfo(channelCode: string, year: number = TARGET_GOAL_YEAR): Promise<ChannelMasterInfo> {
  const { data: channel, error: channelError } = await supabase.from("channels").select("id").eq("code", channelCode).maybeSingle();
  if (channelError || !channel) {
    throw new Error(`채널을 찾을 수 없습니다: ${channelCode}`);
  }

  const [goalRes, competitorsRes] = await Promise.all([
    supabase.from("target_goals").select("target_rank, target_rating").eq("channel_id", channel.id).eq("year", year).maybeSingle(),
    supabase.from("competitors").select("competitor_name").eq("channel_id", channel.id).order("competitor_name"),
  ]);

  return {
    targetRank: goalRes.data?.target_rank ?? null,
    targetRating: goalRes.data?.target_rating ?? null,
    competitors: (competitorsRes.data ?? []).map((r) => r.competitor_name),
  };
}
