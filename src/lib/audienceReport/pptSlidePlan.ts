// 값이 실제로 들어 있는 블록만 남기는 공용 필터.
//
// 단계 14에서 슬라이드 구성 계획은 reportSnapshot/deckPlan.ts로 옮겨졌다(구형 planReportPpt·미리보기 payload는
// trash-can/2026-10-07-단계14-구형-렌더러/ 로 이동). 여기에는 Word·PPT·인쇄가 함께 쓰는 "빈 블록 제거" 규칙만 남는다.
import type { DocBlock, FlatReport } from "./reportFlatten";

/**
 * 값이 실제로 들어 있는 블록인지 — 사용자 지시(문서 산출물 공통 규칙): 데이터가 없어 분석할 수 없는 항목은 "데이터 없음"이라고
 * 적지 말고 **항목 자체를 뺀다**. 소스에서 영구 삭제하는 것이 아니라 값이 없는 그 회차에만 조건부로 생략하는 것이라, 데이터가
 * 들어오면 다시 나타난다. (뺀 사유는 템플릿이 "전제·한계"에 남긴다.)
 */
function hasContent(b: DocBlock): boolean {
  switch (b.kind) {
    case "note":
      return false; // 빈 상태 사유 그 자체 — 문서 본문에서는 생략(사유는 전제·한계/방법 주석으로 옮겨 남김)
    case "text":
      return b.text.trim().length > 0;
    case "bullets":
      return b.items.some((t) => t.trim().length > 0);
    case "table":
      return b.rows.length > 0;
    case "kpi":
      return b.items.length > 0;
    case "chart":
      return b.values.some((v) => v !== null);
  }
}

/** 내용이 없는 블록과, 그 결과 통째로 비게 된 섹션을 걷어낸 FlatReport를 돌려준다. */
export function omitEmptyBlocks(flat: FlatReport): FlatReport {
  return {
    ...flat,
    sections: flat.sections.map((s) => ({ ...s, blocks: s.blocks.filter(hasContent) })).filter((s) => s.blocks.length > 0),
  };
}
