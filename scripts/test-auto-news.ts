// 주요 뉴스 자동 선정 순수 함수 검사 — 실행: npm run test:auto-news
import { CATEGORIES, OVERSEAS_CATEGORY, kstDayStartIso } from "../src/lib/autoNews/config";
import { buildCastQueries, castDisplayTitle, classifyCast, nameInTitle, pickCastIssues, type CastEntry } from "../src/lib/autoNews/cast";
import { fullTitleFromHtml, insertCastIssues } from "../src/lib/autoNews/collect";
import { decodeEntities, parseRssItems, pickByRules, rankAll, rankCategory, sameStory, stripPublisherSuffix, titleSimilarity, SAME_STORY, type NewsCandidate } from "../src/lib/autoNews/select";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${name}`);
  }
};

const NOW = Date.parse("2026-11-13T00:00:00Z");
const c = (category: string, title: string, publisher = "연합뉴스", url = `https://ex.com/${encodeURIComponent(title)}`): NewsCandidate => ({ category, title, url, publisher, publishedAt: "2026-11-12T20:00:00Z" });

// RSS·제목 정리
const xml = `<rss><channel><item><title>방미통위 &quot;청문 진행&quot; - 머니투데이 - 머니투데이</title><link>https://a.com/1?x=1&amp;y=2</link><pubDate>Sat, 14 Nov 2026 09:03:19 GMT</pubDate><source url="https://mt.co.kr">머니투데이</source></item><item><title><![CDATA[No link]]></title></item></channel></rss>`;
const items = parseRssItems(xml);
ok("RSS 항목 1건(링크 없는 항목 제외)", items.length === 1);
ok("엔티티 복원", items[0]?.link === "https://a.com/1?x=1&y=2" && items[0]?.title.includes('"청문 진행"'));
ok("발행 시각 ISO", items[0]?.pubDate === "2026-11-14T09:03:19.000Z");
ok("매체 꼬리표 제거(중복 포함)", stripPublisherSuffix(items[0].title, items[0].source) === '방미통위 "청문 진행"');
ok("태그 제거", decodeEntities("<b>KT</b> 실적") === "KT 실적");

// 같은 소식 묶기
ok("같은 소식 유사도", titleSimilarity("KT알파, 3분기 영업이익 115억원…전년비 1.5%↑", "KT알파 3분기 영업이익 115억원, 전년 대비 1.5% 증가") >= SAME_STORY);
ok("다른 소식 유사도", titleSimilarity("KT알파, 3분기 영업이익 115억원", "넷플릭스, 광고 요금제 개편") < SAME_STORY);

// 분류 필터
const kt = CATEGORIES.find((x) => x.category === "KT 및 계열사 소식")!;
const ranked = rankCategory(
  [c(kt.category, "KT스카이라이프 3분기 영업이익 흑자 전환"), c(kt.category, "KT스카이라이프, 3분기 영업이익 흑자전환 성공", "어느매체"), c(kt.category, "KT 위즈, 선발 투수 영입"), c(kt.category, "[포토] KT 사옥 전경"), c(kt.category, "삼성전자 주가 전망")],
  kt,
  NOW
);
ok("야구·사진·무관 기사 제외 후 대표 1건", ranked.length === 1);
ok("같은 소식 2건 → coverage 2, 신뢰 매체가 대표", ranked[0]?.coverage === 2 && ranked[0]?.publisher === "연합뉴스");

// 분류 간 중복 제거·상한
const pools = rankAll(
  [
    c("정책", "방미통위, 유료방송 채널 묶음판매 실태점검 착수"),
    c("업계동향", "방미통위, 유료방송 채널 묶음판매 실태점검 착수", "전자신문", "https://ex.com/dup"),
    c("OTT", "티빙·웨이브 합병 3년째 답보"),
    c(OVERSEAS_CATEGORY, "Netflix Strikes Streaming Deal With Paramount", "Variety"),
    c(OVERSEAS_CATEGORY, "Best Dressed on the Red Carpet", "Variety"),
  ],
  NOW
);
const picked = pickByRules(pools);
ok("분류 간 같은 기사는 앞 분류에만", picked.filter((p) => p.title.startsWith("방미통위")).length === 1 && picked.find((p) => p.title.startsWith("방미통위"))?.category === "정책");
ok("해외 가십 제외", picked.filter((p) => p.category === OVERSEAS_CATEGORY).length === 1);
ok("분류 순서 유지", picked.map((p) => p.category).join(">") === `정책>OTT>${OVERSEAS_CATEGORY}`);
const many = Array.from({ length: 10 }, (_, i) => c("OTT", `${"가나다라마바사아자차"[i].repeat(4)} 넷플릭스 ${["광고", "요금", "구독", "합병", "출시", "독점", "중계", "실적", "제휴", "글로벌"][i]} ${"가나다라마바사아자차"[i].repeat(8)}`));
ok("분류 상한 지킴", pickByRules(rankAll(many, NOW)).length === CATEGORIES.find((x) => x.category === "OTT")!.quota);

// 선정 품질 보강(2026-11-15 시험 실행에서 본 잡음)
ok("같은 작품 종영 기사는 표현이 달라도 같은 소식", sameStory("김지원 '닥터X', 15.2%로 종영…최고 시청률은 19.5%", "‘닥터X’ 정석용, 훈훈한 종영 소감"));
ok("부제가 붙은 작품명도 같은 소식", sameStory("ENA ‘크래시2’ 16일 첫 방송", "'크래시2 : 분노의 도로' 제작발표회 현장"));
ok("주어가 양쪽에 있고 단어가 겹치면 같은 소식", sameStory("LG헬로비전 이어 딜라이브도…CJ ENM 채널 송출 갈등 확산", "CJ ENM 채널 끊기나…케이블TV '사용료 전쟁' 확산"));
ok("회사가 다른 실적 기사는 다른 소식", !sameStory("LG헬로비전 3분기 영업이익 흑자 전환", "KT스카이라이프 3분기 영업이익 흑자 전환 성공"));
ok("같은 회사의 다른 소식은 묶지 않음", !sameStory("CJ ENM 채널 송출 갈등 확산…딜라이브도 계약 종료", "CJENM 피프스시즌 넷플릭스 1위 작품에도 적자 여전"));
ok("소유격 따옴표는 작품명으로 보지 않음", !sameStory("Hollywood’s Next Big Deal: Will Netflix Buy NBCU?", "Disney’s Next Big Deal With Sony Explained"));
const bc = CATEGORIES.find((x) => x.category === "방송가 소식")!;
const rb = rankCategory(
  [
    c(bc.category, "천재 의사로 변신… '강하늘' 출연 확정 지어 난리 난 한국 드라마", "wikitree.co.kr"),
    c(bc.category, "'100일의 거짓말' 김유정, 서로의 진짜 이름 불렀다⋯8%대 시청률", "joynews24.com"),
    c(bc.category, "대하드라마 '문무', 시청률 4.7%로 출발", "yna.co.kr"),
  ],
  bc,
  NOW
);
ok("기록·출발 시청률 기사가 회차 기사·낚시 제목보다 앞", rb[0]?.title.includes("문무") && rb[rb.length - 1]?.title.includes("난리"));
ok("주소로 온 매체도 신뢰 매체 가산", rankCategory([c("OTT", "넷플릭스 광고 요금제 개편", "yna.co.kr")], CATEGORIES.find((x) => x.category === "OTT")!, NOW)[0].score > rankCategory([c("OTT", "넷플릭스 광고 요금제 개편", "example.kr")], CATEGORIES.find((x) => x.category === "OTT")!, NOW)[0].score);
const q2 = pickByRules(
  rankAll(
    [
      c("업계동향", "안효섭 ‘파이널 테이블’ JTBC 구하지 못했다‥1%대 시청률 하락", "newsen.com"),
      c("업계동향", "[이내찬교수의 광고로 보는 통신역사]〈70〉한국 초고속인터넷", "etnews.com"),
      c("KT 및 계열사 소식", "[통신] KT 품질만족지수 1위, LG유플러스 액체냉각 표준 개발", "webeconomy.co.kr"),
      c("OTT", "'2026 멜론뮤직어워드' 2일차 라인업…웨이브 중계", "etoday.co.kr"),
      c(OVERSEAS_CATEGORY, "Nvidia CEO Jensen Huang Resigns After Multiple Scandals", "Variety"),
      c(OVERSEAS_CATEGORY, "Penn Badgley Signs With WME & Range Media Partners", "Deadline"),
      c(OVERSEAS_CATEGORY, "Paramount Skydance Names New Streaming Chief", "Deadline"),
    ],
    NOW
  )
);
ok("시청률 기사는 업계동향이 아니라 방송가 소식으로", q2.find((p) => p.title.includes("파이널 테이블"))?.category === "방송가 소식");
ok("연재 칼럼·묶음 시황·시상식 중계 제외", !q2.some((p) => /이내찬|\[통신\]|멜론/.test(p.title)));
ok("해외: 타 업종·소속사 계약 제외, 경영진 교체는 포함", q2.filter((p) => p.category === OVERSEAS_CATEGORY).map((p) => p.title).join("|") === "Paramount Skydance Names New Streaming Chief");
const html = `<html><head><meta property="og:title" content="KT텔레캅, 창립 20주년 비전 선포…“AI·돌봄 결합한 AX 보안기업 도약” - 전자신문"></head></html>`;
ok("잘린 제목 복원(매체 꼬리표 제거)", fullTitleFromHtml(html, "KT텔레캅, 창립 20주년 비전 선포…“AI·돌봄 결합한 AX 보안기업 도약...") === "KT텔레캅, 창립 20주년 비전 선포…“AI·돌봄 결합한 AX 보안기업 도약”");
ok("다른 기사 제목이면 복원하지 않음", fullTitleFromHtml(html, "넷플릭스 광고 요금제 개편 발표...") === null);

// 자동 게시 — "오늘"은 KST 기준
ok("KST 하루 시작(07:30 KST 실행)", kstDayStartIso(Date.parse("2026-11-15T22:30:00Z")) === "2026-11-15T15:00:00.000Z");
ok("KST 자정 직전은 전날", kstDayStartIso(Date.parse("2026-11-15T14:59:00Z")) === "2026-11-14T15:00:00.000Z");

// 출연자 이슈
const roster: CastEntry[] = [
  { name: "김가나", program: "자사 신작 드라마", scope: "own_upcoming" },
  { name: "이다라", program: "자사 지난 예능", scope: "own_past" },
  { name: "박마바", program: "타사 드라마", scope: "other" },
  { name: "", program: "나는 SOLO", scope: "solo" },
];
const cc = (title: string) => c("출연자 이슈", title, "연합뉴스");
ok("자사 예정작 출연자 위험 기사", classifyCast("김가나, 음주운전 혐의 입건", roster)?.signal === "risk");
ok("자사 출연자 흥행 기사", classifyCast("이다라 주연 예능 시청률 자체 최고 경신", roster)?.signal === "rise");
ok("타사 출연자 위험 기사는 포함", classifyCast("박마바 폭행 논란", roster)?.signal === "risk");
ok("명단 밖 타사 배우 중대 사안(방송 맥락 있음)", classifyCast("인기 드라마 주연 배우 음주운전 입건", roster)?.entry.scope === "other");
ok("명단 밖 인물 가벼운 논란은 제외", classifyCast("홍길동 SNS 논란", roster) === null);
ok("명단 밖 방송 맥락 없는 사건 제외", classifyCast("회사원 음주운전 입건", roster) === null);
ok("타사 작품 역대 최고 시청률 기사", classifyCast("타사 드라마 역대 최고 시청률 경신", roster)?.signal === "rise");
ok("타사 일반 흥행 표현만으로는 제외", classifyCast("타사 드라마 시청률 상승", roster) === null);
ok("나는 SOLO 일반인 기사(프로그램명 매칭)", classifyCast("'나는 SOLO' 출연자 논란 확산…제작진 입장", roster)?.signal === "risk");
const issues = pickCastIssues([cc("박마바 폭행 논란"), cc("김가나, 음주운전 혐의 입건"), cc("김가나 음주운전 혐의로 입건")], roster, 5);
ok("같은 소식 묶고 자사 예정작이 앞", issues.length === 2 && issues[0].entry.name === "김가나");
ok("위험 기사 표시 문구", castDisplayTitle(issues[0]).endsWith("(확인 필요)"));
ok("검색어 생성(솔로는 프로그램 단위)", buildCastQueries(roster).filter((q) => q.entry.scope === "solo").every((q) => q.query.startsWith("나는 SOLO")));

// 이름 경계(동명·부분 일치 오탐 방지)
ok("이름 + 조사는 일치", nameInTitle("이준이 하차 논란", "이준") && nameInTitle("이준, 음주운전", "이준"));
ok("다른 이름의 일부는 불일치", !nameInTitle("이준석 대표 논란", "이준") && !nameInTitle("김이준 논란", "이준"));
// 출연자 이슈 끼워 넣기: 방송가 소식 뒤, 이미 실린 소식 제외, 상한
const base = [
  { category: "KT 및 계열사 소식", title: "KT 실적 발표", url: "u1" },
  { category: "방송가 소식", title: "크래시2 첫 방송", url: "u2" },
  { category: OVERSEAS_CATEGORY, title: "Netflix deal", url: "u3" },
];
const ins = insertCastIssues(base, { candidates: [], castCandidates: [cc("김가나, 음주운전 혐의 입건"), c("방송가 소식", "크래시2 첫 방송", "연합뉴스", "u2")] }, roster);
ok("출연자 이슈는 방송가 소식 바로 뒤", ins.items[2]?.category === "출연자 이슈" && ins.items[3]?.category === OVERSEAS_CATEGORY);
ok("이미 실린 기사는 출연자 이슈로 중복 게시하지 않음", ins.castCount === 1);
ok("위험 기사는 확인 필요 표시 대상", ins.riskUrls.size === 1);
ok("출연자 기사 없으면 목록 그대로", insertCastIssues(base, { candidates: [], castCandidates: [] }, roster).items === base);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
