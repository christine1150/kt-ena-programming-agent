// 홈 일간·주간·월간 보기의 섹션 구성(단계 07) — 세 보기가 섹션 제목만 바꾼 같은 내용이 되지 않도록 질문을 분리하고,
// 각 섹션이 어떤 데이터(contentKey)를 쓰는지 명시한다. 같은 contentKey를 서로 다른 보기에 다른 제목으로 두면
// "제목만 바꾼 복제"이므로 공통 섹션(SHARED_KEYS)만 허용한다(테스트가 검사).
import type { HomeView } from "./viewContext";

export interface HomeSectionDef {
  id: string;
  title: string;
  /** 이 섹션이 답하는 질문 */
  question: string;
  /** 쓰는 데이터의 종류(보기 사이에서 겹치면 같은 내용) */
  contentKey: string;
}

/** 모든 보기가 공유하는 섹션 — 같은 데이터를 같은 제목으로 보여 준다. */
export const SHARED_KEYS = ["data_status", "followups"];

export const HOME_SECTIONS: Record<HomeView, HomeSectionDef[]> = {
  daily: [
    { id: "data_status", title: "데이터 상태", question: "오늘 숫자를 믿어도 되는가", contentKey: "data_status" },
    { id: "decisions", title: "오늘 결정할 사항", question: "무엇부터 확인·결정해야 하는가", contentKey: "daily_decisions" },
    { id: "kpi", title: "채널 KPI", question: "채널별 시청률·순위·목표 격차·전기 변화는", contentKey: "daily_kpi" },
    { id: "change", title: "변화 근거(이상징후·본방·긴급 슬롯)", question: "어제 무엇이 달라졌고 어느 슬롯을 먼저 볼까", contentKey: "daily_change_evidence" },
    { id: "original", title: "오리지널 콘텐츠 리뷰", question: "오리지널 본방 회차는 어땠는가", contentKey: "daily_original_review" },
    { id: "followups", title: "후속 액션", question: "이전에 검토한 것 중 오늘 처리할 후속은", contentKey: "followups" },
    { id: "aux", title: "참고(뉴스·킬러 콘텐츠·상세)", question: "보조로 볼 자료는", contentKey: "daily_aux" },
  ],
  weekly: [
    { id: "data_status", title: "데이터 상태", question: "이번 주 숫자를 믿어도 되는가", contentKey: "data_status" },
    { id: "week_review", title: "주간 성적과 기여 분해", question: "완결된 주의 순위·시청률이 전주 대비 어땠고, 변화는 편성량 효과인가 작품 성과 효과인가", contentKey: "weekly_review" },
    { id: "next_week", title: "다음 주 대안", question: "다음 주에 바꿀 최소 변경안은", contentKey: "weekly_next_week" },
    { id: "followups", title: "후속 액션", question: "이전에 검토한 것 중 이번 주 처리할 후속은", contentKey: "followups" },
  ],
  monthly: [
    { id: "data_status", title: "데이터 상태", question: "이번 달 숫자는 확정인가", contentKey: "data_status" },
    { id: "month_review", title: "월간 성적", question: "월별 채널 순위·시청률 추이와 등락 요인은", contentKey: "monthly_review" },
    { id: "roles", title: "채널 역할·라인업", question: "채널 역할에 맞는 라인업이 유지되는가", contentKey: "monthly_roles_lineup" },
    { id: "rights", title: "권리 소진", question: "곧 만료되거나 잔여가 부족한 권리는", contentKey: "monthly_rights" },
    { id: "strategy", title: "차월 전략", question: "다음 달에 확인·결정할 항목은", contentKey: "monthly_strategy" },
    { id: "followups", title: "후속 액션", question: "이전에 검토한 것 중 이번 달 처리할 후속은", contentKey: "followups" },
  ],
};

/** 보기 사이에서 공유 섹션이 아닌데 같은 contentKey를 쓰는 경우(제목만 바꾼 복제)를 찾는다. */
export function findDuplicatedContent(): string[] {
  const seen = new Map<string, HomeView>();
  const problems: string[] = [];
  (Object.keys(HOME_SECTIONS) as HomeView[]).forEach((view) => {
    HOME_SECTIONS[view].forEach((s) => {
      if (SHARED_KEYS.includes(s.contentKey)) return;
      const prev = seen.get(s.contentKey);
      if (prev && prev !== view) problems.push(`${s.contentKey}: ${prev}와 ${view}가 같은 데이터를 다른 제목으로 보여 줌`);
      seen.set(s.contentKey, view);
    });
  });
  return problems;
}
