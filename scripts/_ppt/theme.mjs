// 덱 팔레트 — 2026-09-09 ena-design 디자인 시스템 적용.
//
// 사용자 지시: 채널명·슬로건만 OLIFE로 두고 나머지 디자인은 모두 ena-design 스킬을 따른다.
// 스킬 규칙: 내용 배경은 항상 흰색, 강조색은 ENA Blue #2c24ce 단 하나,
//            그라디언트(#00009C→#3C32E1)는 표지·마무리 장표에만, 서체는 KT Flow.
//
// 색 역할
//   메인 강조   #2C24CE  ENA Blue    — 막대·링·강조 도형·큰 숫자
//   2계열       #6F69E2  blue-400    — 두 번째 계열·비교값
//   3계열       #A6A2EE  blue-300    — 세 번째 계열
//   기준선      #CFCFDA  gray-300    — 과거·기준값
//   본문/제목   #14141A  gray-900    — 쿨그레이 램프
export const T = {
  // 이름은 기존 코드 호환을 위해 유지하되 값은 ENA 팔레트를 가리킨다.
  lime: "#2C24CE",      // 메인 강조 = ENA Blue
  limeLt: "#6F69E2",
  limeXl: "#F3F3FD",    // 패널 배경
  limeBd: "#CDCBF6",    // 패널 테두리
  limeDk: "#241DA6",    // 획·작은 강조 텍스트

  navy: "#241DA6",      // 진한 블루(pressed)
  navyLt: "#4A43D8",
  navySt: "#A6A2EE",
  navyXl: "#E7E6FB",

  teal: "#6F69E2",      // 두 번째 계열
  tealDk: "#241DA6",    // 본문 강조 텍스트(가독성)
  tealLt: "#CDCBF6",
  tealXl: "#F3F3FD",

  sand: "#E2E2EA",
  sandDk: "#7C7C8C",
  orange: "#D98A1E",    // 경고·특수 상황 전용
  neg: "#D63B3B",       // 하락·미확인

  sky: "#A6A2EE",       // 세 번째 계열
  skyDk: "#6F69E2",     // 옅은 계열을 선으로 쓸 때

  ink: "#14141A",       // 큰 제목
  body: "#26262F",
  mute: "#7C7C8C",
  soft: "#A6A6B6",
  line: "#E2E2EA",      // 카드 테두리
  line2: "#CFCFDA",     // 표 구분선·기준값 막대
  bg: "#F7F7FA",
  white: "#FFFFFF",

  // 그라디언트(표지·마무리 전용)
  gradFrom: "#00009C",
  gradTo: "#3C32E1",
};

// 다계열 차트 색 순환 — ENA Blue 단색 램프.
export const SERIES = [T.lime, T.teal, T.sky, T.navyLt, T.navySt, T.tealLt, T.sandDk, T.sand];

// 계열이 3개 이하이면 시간 비교(과거→현재)로 보고 마지막 계열에 메인 강조를 준다.
export function colorAt(i, n) {
  return n <= 3 ? SERIES[n - 1 - i] : SERIES[i % SERIES.length];
}
// 가는 획은 한 단계 진한 색을 써야 흰 배경에서 묻히지 않는다.
export const strokeOf = (c) => (c === T.sky ? T.teal : c === T.navySt ? T.navyLt : c);

export const hex = (c) => c.replace("#", "").toUpperCase();
