// 편성 큐레이션 검증 — 자막(episode_subtitle)에서 여행지 지역과 <극한직업> 소재를 추출한다.
// 자막 원문에 국가명이 그대로 들어 있어 사전 매칭으로 지역을 판별한다.
import { readQ } from "./readq.mjs";

// 지역 → 키워드. 더 구체적인 표기가 먼저 오도록 순서를 지킨다.
const REGION = [
  ["한국", ["한국", "제주", "국내"]],
  ["아프리카", ["남아프리카", "동아프리카", "북아프리카", "아프리카", "이집트", "튀니지", "모로코", "나미비아", "케냐", "탄자니아", "에티오피아", "마다가스카르", "잠비아", "짐바브웨", "보츠와나", "우간다", "세네갈", "잠베지", "빅토리아폭포", "사하라"]],
  ["중남미", ["안데스", "멕시코", "과테말라", "페루", "볼리비아", "칠레", "아르헨티나", "브라질", "콜롬비아", "쿠바", "에콰도르", "코스타리카", "파나마", "우루과이", "파라과이", "아마존", "파타고니아", "마야", "잉카"]],
  ["북미", ["알래스카", "미국", "캐나다", "하와이"]],
  ["오세아니아", ["호주", "뉴질랜드", "피지", "타히티", "사모아"]],
  ["중동", ["아라비아", "아랍에미리트", "아부다비", "두바이", "오만", "이란", "튀르키예", "터키", "이스라엘", "요르단", "사우디", "카타르", "레바논", "쿠웨이트"]],
  ["중앙아시아", ["키르기스스탄", "카자흐스탄", "우즈베키스탄", "타지키스탄", "투르크메니스탄", "실크로드", "카라코람", "파미르"]],
  ["남아시아", ["히말라야", "네팔", "스리랑카", "부탄", "파키스탄", "방글라데시", "몰디브", "인도양", "인도"]],
  ["동남아시아", ["베트남", "라오스", "캄보디아", "태국", "미얀마", "말레이", "싱가포르", "인도네시아", "필리핀", "브루나이", "발리", "메콩", "골든 트라이앵글", "골든트라이앵글", "동티모르"]],
  ["유럽", ["북유럽", "동유럽", "서유럽", "남유럽", "발트", "그리스", "이탈리아", "프랑스", "스페인", "포르투갈", "독일", "오스트리아", "스위스", "체코", "폴란드", "헝가리", "루마니아", "불가리아", "크로아티아", "슬로베니아", "세르비아", "알바니아", "몰타", "몰도바", "라트비아", "리투아니아", "에스토니아", "조지아", "아르메니아", "아제르바이잔", "노르웨이", "스웨덴", "핀란드", "덴마크", "아이슬란드", "영국", "아일랜드", "네덜란드", "벨기에", "우크라이나", "러시아", "지중해", "피오르", "오로라", "로포텐", "산티아고"]],
  ["동아시아", ["중국", "일본", "몽골", "대만", "타이완", "홍콩", "마카오", "윈난", "쓰촨", "구이저우", "간쑤", "저장", "창장", "장안", "바이칼", "티베트", "시안", "만리장성", "태항산"]],
];

// <극한직업> 소재 분류
const TRADE = [
  ["바다·어업", ["멸치", "오징어", "어부", "어업", "조기", "굴", "전복", "해녀", "바다", "수산", "미역", "새우", "낙지", "장어", "고등어", "다시마", "조개", "선원", "참치", "젓갈", "어선", "양식장"]],
  ["공장·제조", ["공장", "제작", "가공", "생산", "제조", "설비", "기계", "부품", "제철", "주물", "용접", "조립", "인쇄", "섬유", "도금"]],
  ["농축산", ["농장", "축산", "한우", "돼지", "양계", "수확", "재배", "농부", "과수", "인삼", "버섯", "벌꿀", "양봉", "젖소", "우유"]],
  ["음식·식품", ["식당", "요리", "빵", "김치", "장류", "두부", "만두", "치킨", "커피", "제과", "제빵", "반찬", "국밥", "고기"]],
  ["건설·중장비", ["건설", "공사", "중장비", "크레인", "굴착", "철거", "타워", "터널", "교량", "도로", "비계"]],
  ["전통·공예", ["옹기", "도자", "장인", "공예", "한지", "대장", "목공", "가구", "칠기", "유기", "죽제품"]],
  ["물류·운송", ["물류", "택배", "운송", "항만", "창고", "배송", "화물", "컨테이너"]],
];

function pick(table, text) {
  const t = String(text || "");
  for (const [label, keys] of table) for (const k of keys) if (t.includes(k)) return { label, key: k };
  return null;
}
export const regionOf = (sub) => (pick(REGION, sub) || {}).label || null;
export const placeOf = (sub) => (pick(REGION, sub) || {}).key || null;
export const tradeOf = (sub) => (pick(TRADE, sub) || {}).label || null;

const TRAVEL = /세계테마기행|걸어서세계속으로|벌거벗은세계사|세계견문록|유네스코|대문밖은사파리/;

const rows = readQ("q15").rows.map((r) => ({
  nm: r.nm, bd: r.bd, hh: Number(r.hh), ep: r.ep, sub: r.sub, rating: Number(r.rating),
  region: TRAVEL.test(r.nm) ? regionOf(r.sub) : null,
  place: TRAVEL.test(r.nm) ? placeOf(r.sub) : null,
  trade: r.nm === "극한직업" ? tradeOf(r.sub) : null,
}));
export const ROWS = rows;

/* ---------- 1. 여행 편성의 지역 다양성 ---------- */
const travel = rows.filter((r) => TRAVEL.test(r.nm));
export const TRAVEL_COV = {
  total: travel.length,
  matched: travel.filter((r) => r.region).length,
  pct: +((travel.filter((r) => r.region).length / travel.length) * 100).toFixed(1),
};

const regCount = {};
travel.forEach((r) => { if (r.region) regCount[r.region] = (regCount[r.region] || 0) + 1; });
export const REGION_COUNT = Object.entries(regCount).map(([k, v]) => ({ region: k, n: v })).sort((a, b) => b.n - a.n);

const byDay = {};
travel.forEach((r) => { if (r.region) (byDay[r.bd] = byDay[r.bd] || new Set()).add(r.region); });
const dayCounts = Object.values(byDay).map((s) => s.size);
export const DAY_REGIONS = {
  days: dayCounts.length,
  avg: +(dayCounts.reduce((a, b) => a + b, 0) / dayCounts.length).toFixed(1),
  max: Math.max(...dayCounts),
  dist: [1, 2, 3, 4, 5, 6].map((k) => ({ k: k === 6 ? "6개+" : `${k}개`, n: dayCounts.filter((c) => (k === 6 ? c >= 6 : c === k)).length })),
};

// 같은 날 이어지는 여행 편성에서 지역이 바뀐 비율
let switched = 0, pairs = 0;
Object.keys(byDay).forEach((d) => {
  const seq = travel.filter((r) => r.bd === d && r.region).sort((a, b) => a.hh - b.hh);
  for (let i = 1; i < seq.length; i++) { pairs++; if (seq[i].region !== seq[i - 1].region) switched++; }
});
export const REGION_SWITCH = { pairs, switched, pct: +((switched / pairs) * 100).toFixed(1) };

const DP = (h) => (h <= 8 ? "새벽 02-08" : h <= 13 ? "오전 09-13" : h <= 18 ? "오후 14-18" : "저녁·심야 19-25");
const dpReg = {};
travel.forEach((r) => {
  if (!r.region) return;
  const d = DP(r.hh);
  dpReg[d] = dpReg[d] || {};
  dpReg[d][r.region] = (dpReg[d][r.region] || 0) + 1;
});
export const DAYPART_REGION = ["새벽 02-08", "오전 09-13", "오후 14-18", "저녁·심야 19-25"].map((d) => {
  const m = dpReg[d] || {};
  const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  return { d, tot, top: Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ region: k, n: v, pct: +((v / tot) * 100).toFixed(1) })) };
});

/* ---------- 2. <극한직업> 소재 배치 ---------- */
const geuk = rows.filter((r) => r.nm === "극한직업");
export const TRADE_COV = {
  total: geuk.length, matched: geuk.filter((r) => r.trade).length,
  pct: +((geuk.filter((r) => r.trade).length / geuk.length) * 100).toFixed(1),
};
const trCount = {};
geuk.forEach((r) => { if (r.trade) trCount[r.trade] = (trCount[r.trade] || 0) + 1; });
export const TRADE_COUNT = Object.entries(trCount).map(([k, v]) => ({ trade: k, n: v })).sort((a, b) => b.n - a.n);

let tSwitch = 0, tPairs = 0;
[...new Set(geuk.map((r) => r.bd))].forEach((d) => {
  const seq = geuk.filter((r) => r.bd === d && r.trade).sort((a, b) => a.hh - b.hh);
  for (let i = 1; i < seq.length; i++) { tPairs++; if (seq[i].trade !== seq[i - 1].trade) tSwitch++; }
});
export const TRADE_SWITCH = { pairs: tPairs, switched: tSwitch, pct: tPairs ? +((tSwitch / tPairs) * 100).toFixed(1) : null };

// 회차를 순서대로 트는지 — 같은 날 이어지는 편성의 회차 간격
let seqAdj = 0, seqPairs = 0;
const gaps = [];
[...new Set(geuk.map((r) => r.bd))].forEach((d) => {
  const seq = geuk.filter((r) => r.bd === d && r.ep != null).sort((a, b) => a.hh - b.hh);
  for (let i = 1; i < seq.length; i++) {
    seqPairs++;
    const g = Math.abs(seq[i].ep - seq[i - 1].ep);
    gaps.push(g);
    if (g === 1) seqAdj++;
  }
});
gaps.sort((a, b) => a - b);
export const EP_SEQ = {
  pairs: seqPairs, adjacent: seqAdj,
  adjPct: seqPairs ? +((seqAdj / seqPairs) * 100).toFixed(1) : null,
  medianGap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
};

/* ---------- 3. 하루 편성표 예시 ---------- */
export function dayLineup(date) {
  return rows.filter((r) => r.bd === date).sort((a, b) => a.hh - b.hh)
    .map((r) => ({ hh: r.hh, nm: r.nm, sub: r.sub, region: r.region, place: r.place, trade: r.trade, rating: r.rating }));
}
export const SAMPLE_DAY = (() => {
  let best = null, bestN = -1;
  Object.entries(byDay).forEach(([d, s]) => { if (s.size > bestN) { bestN = s.size; best = d; } });
  return { date: best, regions: bestN, rows: dayLineup(best).filter((r) => r.region || r.trade) };
})();
export const COVER = { days: [...new Set(rows.map((r) => r.bd))].length, d0: rows[0].bd, d1: rows[rows.length - 1].bd };
