// 사용자 지시(2026-08-26, 가독성 개선 제안 5번 "타이포그래피 기본기" 채택) — 문장 생성 로직
// (규칙 기반 buildChannelNarrative/buildOriginalInsight 등, LLM 프롬프트 전부)은 그대로 두고,
// 이미 만들어진 문자열 안에서 등락 수치·방향 단어만 찾아 굵게+색으로 강조하는 순수 표시 계층
// 유틸리티. 페이지마다 이미 정해둔 상승/하락 색이 다르므로(Dashboard.tsx는 "단순 빨강/초록 대신
// 세련된 톤"이라는 명시적 사용자 결정으로 ACCENT_UP/ACCENT_DOWN을 씀, ChannelDeepDive.tsx는
// DivergingDeltaBar 등에서 이미 emerald/rose를 씀) 색은 호출부에서 넘기게 한다 — 이 파일이
// 임의로 새 팔레트를 강제하지 않는다.
import type { ReactNode } from "react";

// ▲43% / ▼15.2% 같은 화살표+수치, "47.0% 상승" 같은 수치+방향 단어, "9.5위 하락" 같은
// 순위+방향 단어를 찾는다 — 전부 이 코드베이스의 여러 narrative 조립 함수가 이미 일관되게
// 쓰는 표현 패턴(▲/▼, "상승"/"하락"/"증가"/"감소")이라 새 표기 규칙을 만들지 않는다.
const HIGHLIGHT_RE = /(▲\s*[\d.]+%?|▼\s*[\d.]+%?|[\d.]+%\s*(?:상승|하락|증가|감소)한?|[\d.]+위\s*(?:상승|하락)한?)/g;
const UP_HINT_RE = /▲|상승|증가/;
const DOWN_HINT_RE = /▼|하락|감소/;

/**
 * 줄글 문장 하나(또는 여러 문장을 이어붙인 문단)에서 등락 수치·방향 단어만 굵게+색으로 강조한
 * React 노드 배열을 돌려준다. 문장 자체는 한 글자도 바꾸지 않는다 — split/강조만 한다.
 */
export function highlightNarrativeText(text: string, upColor: string, downColor: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  // exec를 직접 돌려야 매치 위치(index)를 알 수 있다 — split은 위치 정보를 안 줌.
  const re = new RegExp(HIGHLIGHT_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const chunk = match[0];
    const color = UP_HINT_RE.test(chunk) ? upColor : DOWN_HINT_RE.test(chunk) ? downColor : undefined;
    nodes.push(
      <b key={key++} style={color ? { color, fontWeight: 700 } : { fontWeight: 700 }}>
        {chunk}
      </b>
    );
    lastIndex = match.index + chunk.length;
    if (match[0].length === 0) re.lastIndex++; // 빈 매치 무한루프 방지(이 패턴에선 발생 안 하지만 방어적으로)
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
