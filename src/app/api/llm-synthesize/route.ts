// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2의
// WHY?/OPPORTUNITY?/COMPARED WITH?/WHAT TO SCHEDULE? 해석 문단을 규칙 기반 대신 OpenAI로
// 종합하기 위한 공용 엔드포인트. 이 섹션들의 입력값(candidates/daypartOpportunity/
// competitorInsightReport/fitScoreItem)은 이미 채널 상세 페이지에서 별도 API로 가져와 클라이언트
// state에 있는 검증된 값이라(fit-score API는 channel API와 별도 무거운 계산이라 여기서 다시
// 조회하지 않는다), 여기서는 새로 계산하지 않고 그 값을 그대로 받아 OpenAI에 전달만 한다 —
// API 키는 서버에만 있으므로 이 라우트를 거쳐야 한다. 로그인 세션(PD 공유 링크 포함)이 있어야만
// 호출 가능(무단 호출로 인한 비용 남용 방지). 여러 섹션을 한 번에 요청할 수 있게 jobs 배열로
// 받아 서버에서 병렬 처리한다(요청 왕복 횟수를 줄이기 위함).
import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/adminAuth";
import { buildWhyDiagnosisViaLlm, type WhyDiagnosisLlmInput } from "@/lib/whyDiagnosisLlm";
import { buildOpportunityNarrativeViaLlm, type OpportunityNarrativeLlmInput } from "@/lib/opportunityNarrativeLlm";
import { buildCompetitorNarrativeViaLlm, type CompetitorNarrativeLlmInput } from "@/lib/competitorNarrativeLlm";
import { buildFitScoreInterpretationViaLlm, type FitScoreInterpretationLlmInput } from "@/lib/fitScoreInterpretationLlm";
import { cachedLlmText } from "@/lib/llmTextCache";

type Job =
  | { section: "why"; input: WhyDiagnosisLlmInput }
  | { section: "opportunity"; input: OpportunityNarrativeLlmInput }
  | { section: "competitor"; input: CompetitorNarrativeLlmInput }
  | { section: "fit_score"; input: FitScoreInterpretationLlmInput };

// 단계 15: 같은 입력(기간·타깃·수치가 모두 들어 있는 검증된 값)이면 같은 문장을 다시 쓰지 않는다. 입력이 하나라도 바뀌면 지문이 달라져
// 새로 생성되므로 옛 문장이 남을 수 없고, 프롬프트·모델 규칙을 바꾸면 버전 문자열을 올려 캐시를 무효화한다.
// 이전에는 채널 화면을 열 때마다 OpenAI를 다시 불렀다(측정: 한 번에 약 3.4초).
const LLM_SYNTH_CACHE_VERSION = "v1";

async function runJob(job: Job): Promise<string | null> {
  return cachedLlmText(`llm_synth:${LLM_SYNTH_CACHE_VERSION}:${job.section}`, null, job.input, () => runJobUncached(job));
}

async function runJobUncached(job: Job): Promise<string | null> {
  switch (job.section) {
    case "why":
      return buildWhyDiagnosisViaLlm(job.input);
    case "opportunity":
      return buildOpportunityNarrativeViaLlm(job.input);
    case "competitor":
      return buildCompetitorNarrativeViaLlm(job.input);
    case "fit_score":
      return buildFitScoreInterpretationViaLlm(job.input);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
  }

  let jobs: Job[];
  try {
    const body = await request.json();
    jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  } catch {
    return NextResponse.json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  // 남용 방지 — 한 요청에 너무 많은 job을 넣을 수 없게 상한.
  if (jobs.length === 0 || jobs.length > 10) {
    return NextResponse.json({ ok: false, message: "jobs는 1~10개여야 합니다." }, { status: 400 });
  }

  const results = await Promise.all(jobs.map((job) => runJob(job).catch(() => null)));

  return NextResponse.json({ ok: true, results });
}
