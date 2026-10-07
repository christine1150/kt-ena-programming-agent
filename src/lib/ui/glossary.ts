// 단계 15 — 한국어 용어 사전과 문구 검사(순수 함수). 화면·보고서 문구가 같은 말을 쓰게 하고,
// 사용자에게 보이면 안 되는 내부 이름(DB 테이블·환경 변수·영문 코드)을 걸러낸다.
// 원본 용어(공급자 정의, 파일 컬럼명 등)는 "출처·정의" 패널에는 남길 수 있다 — 그 경우 해당 줄에 ALLOW_SOURCE_PANEL 표식을 둔다.

export interface TermRule {
  id: string;
  /** 표준 표기 */
  preferred: string;
  /** 쓰지 않을 표기 */
  avoid: RegExp;
  /** 왜 이 표기인지 */
  note: string;
}

export const TERM_RULES: TermRule[] = [
  { id: "contents", preferred: "콘텐츠", avoid: /컨텐츠/, note: "표준국어대사전 표기는 '콘텐츠'" },
  { id: "reach-rate", preferred: "도달률", avoid: /도달\s*율/, note: "'률/율' 표기 규칙(모음·ㄴ 받침 뒤는 '율', 그 외는 '률') — 도달은 ㄹ 받침이므로 '도달률'" },
  { id: "watch-time-ratio", preferred: "시청시간 비율", avoid: /시청\s*시간비율/, note: "지표 계약의 이름은 '시청시간 비율'(띄어쓰기 포함)" },
  { id: "tv-rating", preferred: "시청률", avoid: /시청\s율/, note: "시청률은 붙여 쓴다" },
];

/** 화면 문구 안에서 쓰지 않는 영문·내부 표현(사용자 화면 기준) */
export const INTERNAL_LEAK_RULES: { id: string; re: RegExp; note: string }[] = [
  { id: "env-name", re: /\b(?:NEXT_PUBLIC|SUPABASE|OPENAI|GMAIL|NAVER_MAIL|ADMIN_SESSION|USE_ADVANCED|VERCEL|CRON)_[A-Z0-9_]+\b/, note: "환경 변수 이름은 화면에 노출하지 않는다" },
  { id: "env-file", re: /\.env(?:\.local)?\b/, note: ".env 파일 이름은 화면에 노출하지 않는다" },
  { id: "migration", re: /마이그레이션|migration/i, note: "운영자 화면이 아닌 곳에서는 '적용 대기' 같은 상태 문장으로 바꾼다" },
  { id: "enum-code", re: /\b(?:ZAPPING_RISK|ACQUISITION|SLOT_IMPROVEMENT_[A-Z_]+|PORTFOLIO_[A-Z_]+|RISING|FALLING)\b/, note: "내부 분류 코드는 한국어 이름으로 바꿔 보여준다" },
];

export interface WordingIssue {
  rule: string;
  excerpt: string;
  note: string;
}

export interface WordingOptions {
  /** 이 이름이 글에 나오면 DB 테이블 이름 노출로 본다(테이블 목록은 호출하는 쪽이 마이그레이션에서 읽어 넘긴다) */
  tableNames?: ReadonlySet<string>;
  /** 내부 이름 검사(환경·코드)를 할지 — 운영자 전용 화면은 끄지 않는다(운영자도 .env 이름은 몰라도 된다) */
  internal?: boolean;
}

export const ALLOW_SOURCE_PANEL = "원본 용어:";

const around = (text: string, index: number, len: number) => text.slice(Math.max(0, index - 8), Math.min(text.length, index + len + 12)).trim();

export function findWordingIssues(text: string, opts: WordingOptions = {}): WordingIssue[] {
  const issues: WordingIssue[] = [];
  // 출처 패널에서 원본 용어를 그대로 보여주는 줄은 용어 규칙에서 제외
  const scanTerms = !text.includes(ALLOW_SOURCE_PANEL);
  if (scanTerms) {
    for (const r of TERM_RULES) {
      const m = r.avoid.exec(text);
      if (m) issues.push({ rule: r.id, excerpt: around(text, m.index, m[0].length), note: `'${r.preferred}'로 쓴다. ${r.note}` });
    }
  }
  if (opts.internal !== false) {
    for (const r of INTERNAL_LEAK_RULES) {
      const m = r.re.exec(text);
      if (m) issues.push({ rule: r.id, excerpt: around(text, m.index, m[0].length), note: r.note });
    }
    if (opts.tableNames) {
      for (const name of opts.tableNames) {
        const idx = text.indexOf(name);
        if (idx < 0) continue;
        const before = idx === 0 ? "" : text[idx - 1];
        const after = text[idx + name.length] ?? "";
        if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(after)) continue;
        issues.push({ rule: "table-name", excerpt: around(text, idx, name.length), note: "DB 테이블 이름은 화면에 노출하지 않는다" });
        break;
      }
    }
  }
  // '평소'는 비교 기준이 함께 있어야 한다(최근 4주 평균·같은 요일 평균 등). 단독 라벨 '평소'는 모호하다.
  if (/^평소$/.test(text.trim())) {
    issues.push({ rule: "ambiguous-usual", excerpt: "평소", note: "비교 기준을 쓴다(예: '최근 4주 평균', '같은 요일 평균')" });
  }
  return issues;
}

/** '평소'가 들어 있는데 같은 문구 안에 기준(최근 N주·N주 평균·같은 요일·평균·과거 평균 등)이 없는 경우 */
export function usualWithoutBasis(text: string): boolean {
  if (!/평소/.test(text)) return false;
  if (/최근\s*\d+\s*(?:주|일|개월)|\d+\s*주|같은 요일|전체 평균|평균\s*\{?\}?|과거 평균|동일 요일|기준/.test(text)) return false;
  return true;
}

/** 저장·검토·확정·내보내기의 효과 구분 — 버튼·안내 문구는 이 정의를 따른다 */
export const ACTION_EFFECTS = {
  save: { word: "저장", effect: "이 서비스에 기록해 다시 열 수 있다. 외부 시스템에는 반영하지 않는다." },
  review: { word: "검토", effect: "읽고 확인만 한다. 어떤 값도 바뀌지 않는다." },
  confirm: { word: "확정", effect: "이 서비스 안에서 '확정 준비' 상태로 표시하는 것까지다. 방송사 편성 시스템에는 반영하지 않는다." },
  export: { word: "내보내기", effect: "파일을 내 PC로 내려받는다. 서비스에 기록하지 않는다." },
} as const;

/** 버튼 글자가 효과를 틀리게 말하는 경우를 잡는다: 파일을 받는 동작에 '저장'만 쓰는 것 등 */
export function misleadingActionLabel(label: string): string | null {
  const t = label.trim();
  if (/^(?:엑셀|Excel|PDF|JSON|Word|PPT)\s*저장$/i.test(t)) return "파일을 내려받는 동작은 '내려받기'로 쓴다(저장은 서비스 기록)";
  return null;
}
