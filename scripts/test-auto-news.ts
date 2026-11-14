// 주요 뉴스 자동 선정 순수 함수 검사 — 실행: npm run test:auto-news
import { CATEGORIES, OVERSEAS_CATEGORY } from "../src/lib/autoNews/config";
import { decodeEntities, parseRssItems, pickByRules, rankAll, rankCategory, stripPublisherSuffix, titleSimilarity, SAME_STORY, type NewsCandidate } from "../src/lib/autoNews/select";

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
const many = Array.from({ length: 10 }, (_, i) => c("OTT", `넷플릭스 ${["광고", "요금", "구독", "합병", "출시", "독점", "중계", "실적", "제휴", "글로벌"][i]} 관련 새 소식 ${"가나다라마바사아자차"[i].repeat(8)}`));
ok("분류 상한 지킴", pickByRules(rankAll(many, NOW)).length === CATEGORIES.find((x) => x.category === "OTT")!.quota);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
