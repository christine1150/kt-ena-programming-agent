// 주요 뉴스 자동 선정 순수 함수 검사 — 실행: npm run test:auto-news
import { CATEGORIES, OVERSEAS_CATEGORY } from "../src/lib/autoNews/config";
import { buildCastQueries, castDisplayTitle, classifyCast, pickCastIssues, type CastEntry } from "../src/lib/autoNews/cast";
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

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
