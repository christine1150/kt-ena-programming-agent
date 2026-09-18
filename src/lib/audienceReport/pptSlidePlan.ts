// 2026-09-17(사용자 지시 — "P를 누르면 상세버전 PPT 미리보기가 나오게") — 상세 .pptx의
// **슬라이드 구성 계획**을 한 곳에서만 정한다.
//
// 배경: 지금까지 P(미리보기 화면)는 6~9장짜리 임원 요약 덱(deckModel.ts)을 보여주고, 실제로
// 내려받는 .pptx는 FlatReport 기반 상세 리포트라서 **화면과 파일이 서로 다른 문서**였다.
// 사용자가 요구한 최종 구성은 보고서 4종(채널 Word/PPT, 종합 Word/PPT)뿐이므로, 요약 덱을
// 걷어내고 미리보기가 상세 .pptx와 같은 내용을 보여주게 바꾼다.
//
// 그래서 "FlatReport의 어떤 블록이 몇 번째 슬라이드에 들어가는가"를 이 파일이 단독으로 결정하고,
// 서버의 pptxgenjs 렌더러(exportRenderers.renderReportPptx)와 브라우저 미리보기
// (components/audienceReport/pptPreview.tsx)가 **같은 계획 배열**을 그린다. reportFlatten.ts가
// "내용 결정은 한 곳", enaColorTokens.ts가 "색 계산은 한 곳"인 것과 같은 원칙이고, 여기는
// "슬라이드 분할은 한 곳"이다 — 화면에서 본 장수·순서와 받은 파일이 다를 수 없다.
//
// 이 파일은 Node API(fs 등)를 쓰지 않는 순수 모듈이다("use client" 화면에서도 import 가능).
import type { FlatReport, DocBlock } from "./reportFlatten";

/** 한 슬라이드에 넣을 수 있는 표 행 수 — 넘으면 같은 제목으로 슬라이드를 이어서 만든다. */
export const PPT_ROWS_PER_SLIDE = 11;

export const PPT_AUTHOR = "KT ENA 편성 AI Agent";

export type PptSlidePlan =
  | { kind: "cover"; eyebrow: string; title: string; subtitle: string; dateLabel: string; author: string }
  /** 본문 슬라이드 — 블록 하나당 한 장(겹침 방지). caption은 표가 여러 장으로 나뉠 때만 붙는다. */
  | { kind: "content"; eyebrow: string; title: string; caption: string | null; block: DocBlock }
  | { kind: "eod" };

/** 미리보기 화면과 다운로드가 주고받는 payload — 계획 + 브랜딩(액센트·로고 계산에 필요). */
export interface PptPreviewPayload {
  brand: FlatReport["brand"];
  title: string;
  subtitle: string;
  slides: PptSlidePlan[];
}

/** 오늘 날짜(KST) — 표지 발행일. 이 프로젝트 관례대로 toISOString을 쓰지 않고 로컬 값으로 조립. */
export function todayLabel(date = new Date()): string {
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

/**
 * 값이 실제로 들어 있는 블록인지 — 사용자 지시(문서 산출물 공통 규칙): 데이터가 없어 분석할 수
 * 없는 항목은 "데이터 없음"이라고 적지 말고 **항목 자체를 뺀다**. 소스에서 영구 삭제하는 것이
 * 아니라 값이 없는 그 회차에만 조건부로 생략하는 것이라, 데이터가 들어오면 다시 나타난다.
 */
function hasContent(b: DocBlock): boolean {
  switch (b.kind) {
    case "note":
      return false; // 빈 상태 사유 그 자체 — 문서에서는 통째로 생략
    case "text":
      return b.text.trim().length > 0;
    case "bullets":
      return b.items.some((t) => t.trim().length > 0);
    case "table":
      return b.rows.length > 0;
    case "kpi":
      return b.items.length > 0;
  }
}

/** 내용이 없는 블록과, 그 결과 통째로 비게 된 섹션을 걷어낸 FlatReport를 돌려준다. */
export function omitEmptyBlocks(flat: FlatReport): FlatReport {
  return {
    ...flat,
    sections: flat.sections
      .map((s) => ({ ...s, blocks: s.blocks.filter(hasContent) }))
      .filter((s) => s.blocks.length > 0),
  };
}

/**
 * 섹션 하나를 콘텐츠 슬라이드 배열로 변환(표는 PPT_ROWS_PER_SLIDE행씩 이어서 분할) — 아래
 * planReportPpt의 본문 루프와 규칙이 완전히 같다. 표지 다음 고정 요약 슬라이드를 만들 때만
 * 재사용하는 헬퍼이고, 본문 루프 자체(이미 있던 인라인 코드)는 이번 변경에서 손대지 않았다.
 */
function sectionToContentSlides(eyebrow: string, section: FlatReport["sections"][number]): PptSlidePlan[] {
  const out: PptSlidePlan[] = [];
  for (const block of section.blocks) {
    if (block.kind === "table" && block.rows.length > PPT_ROWS_PER_SLIDE) {
      const total = Math.ceil(block.rows.length / PPT_ROWS_PER_SLIDE);
      for (let i = 0; i < block.rows.length; i += PPT_ROWS_PER_SLIDE) {
        const part = Math.floor(i / PPT_ROWS_PER_SLIDE) + 1;
        out.push({
          kind: "content",
          eyebrow,
          title: section.title,
          caption: `${part} / ${total}  ·  전체 ${block.rows.length}행`,
          block: { kind: "table", headers: block.headers, rows: block.rows.slice(i, i + PPT_ROWS_PER_SLIDE) },
        });
      }
      continue;
    }
    out.push({ kind: "content", eyebrow, title: section.title, caption: null, block });
  }
  return out;
}

// 사용자 지시(2026-09-18) — R_FRONTLOAD가 reportFlatten.ts/portfolioFlatten.ts에서 FlatReport
// 맨 앞에 이미 추가해 둔 두 섹션("AI Executive Summary", "OOO — 요약"(편성 제언 상위 3건))을
// 표지 바로 뒤 고정 슬라이드로 한 번 더 배치한다. 임원이 표지 다음 1~2장만 보고도 핵심을 파악할
// 수 있게 하려는 목적. 아래 본문 루프는 그대로 두므로 이 두 섹션은 본문 제자리에서도 다시
// 슬라이드가 된다 — §08 전체 "편성 제언"과 앞머리 요약이 이미 의도적으로 중복인 것과 같은
// 이유로 허용된 중복이며, 새 자료를 만드는 게 아니라 FlatReport의 실제 섹션을 그대로 한 번 더
// 슬라이드화하는 것뿐이라 "미리보기=실제 파일" 원칙도 깨지 않는다.
const FRONTLOAD_SECTION_TITLE_RE = /^AI Executive Summary$| — 요약$/;

/**
 * FlatReport → 슬라이드 계획. 표지 1장 + [AI Executive Summary/편성 제언 요약 고정 1~2장] +
 * 본문(블록당 1장, 긴 표는 11행씩 이어서) + 마무리 1장.
 * 제목 뒤에 붙는 부제(" — Audience Intelligence Report")는 표지에서 제거한다(부제 줄이 따로 있음).
 */
export function planReportPpt(flat: FlatReport, opts?: { dateLabel?: string }): PptSlidePlan[] {
  const trimmed = omitEmptyBlocks(flat);
  const eyebrow = trimmed.brand.channelName.toUpperCase();
  const slides: PptSlidePlan[] = [
    {
      kind: "cover",
      eyebrow,
      title: trimmed.title.replace(/\s—\s.*$/, ""),
      subtitle: trimmed.subtitle,
      dateLabel: opts?.dateLabel ?? todayLabel(),
      author: PPT_AUTHOR,
    },
  ];

  for (const section of trimmed.sections) {
    if (FRONTLOAD_SECTION_TITLE_RE.test(section.title)) {
      slides.push(...sectionToContentSlides(eyebrow, section));
    }
  }

  for (const section of trimmed.sections) {
    for (const block of section.blocks) {
      if (block.kind === "table" && block.rows.length > PPT_ROWS_PER_SLIDE) {
        const total = Math.ceil(block.rows.length / PPT_ROWS_PER_SLIDE);
        for (let i = 0; i < block.rows.length; i += PPT_ROWS_PER_SLIDE) {
          const part = Math.floor(i / PPT_ROWS_PER_SLIDE) + 1;
          slides.push({
            kind: "content",
            eyebrow,
            title: section.title,
            caption: `${part} / ${total}  ·  전체 ${block.rows.length}행`,
            block: { kind: "table", headers: block.headers, rows: block.rows.slice(i, i + PPT_ROWS_PER_SLIDE) },
          });
        }
        continue;
      }
      slides.push({ kind: "content", eyebrow, title: section.title, caption: null, block });
    }
  }

  slides.push({ kind: "eod" });
  return slides;
}

/** 미리보기 API가 그대로 돌려주는 payload 조립 — 화면이 별도 계산을 하지 않게 한다. */
export function buildPptPreviewPayload(flat: FlatReport): PptPreviewPayload {
  return { brand: flat.brand, title: flat.title, subtitle: flat.subtitle, slides: planReportPpt(flat) };
}
