// 주요 뉴스 자동 선정 순수 함수 검사 — 실행: npm run test:auto-news
import { CATEGORIES, OVERSEAS_CATEGORY, kstDayStartIso } from "../src/lib/autoNews/config";
import { isCleanTranslation } from "../src/lib/autoNews/collect";
import { buildCastQueries, castDisplayTitle, castLabel, isLowValueCastTitle, isShowRecapRisk, classifyCast, nameInTitle, pickCastIssues, type CastEntry } from "../src/lib/autoNews/cast";
import { fullTitleFromHtml, insertCastIssues, stripTitleTags } from "../src/lib/autoNews/collect";
import { CAST_ROSTER } from "../src/lib/autoNews/roster";
import { parseRosterText, rosterToText } from "../src/lib/autoNews/rosterText";
import { ONE_DAY_TOPICS, decodeEntities, parseRssItems, pickByRules, rankAll, rankCategory, sameStory, stripPublisherSuffix, titleSimilarity, SAME_STORY, type NewsCandidate } from "../src/lib/autoNews/select";

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
ok("말머리 제거", stripTitleTags("[단독] 고경표 소속사 입장 발표") === "고경표 소속사 입장 발표" && stripTitleTags("[문화연예 플러스] [진단] 방송가 개편 흐름") === "방송가 개편 흐름" && stripTitleTags("조윤희 이혼 셀링 우려 [TEN피플]") === "조윤희 이혼 셀링 우려" && stripTitleTags("[단독] 짧음") === "[단독] 짧음");

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
ok("자사 예정작 출연자 위험 기사", classifyCast("배우 김가나, 음주운전 혐의 입건", roster)?.signal === "risk");
ok("자사 출연자 흥행 기사", classifyCast("이다라 주연 예능 시청률 자체 최고 경신", roster)?.signal === "rise");
ok("타사 출연자 위험 기사는 포함", classifyCast("배우 박마바 폭행 논란", roster)?.signal === "risk");
ok("명단 밖 타사 배우 중대 사안(방송 맥락 있음)", classifyCast("인기 드라마 주연 배우 음주운전 입건", roster)?.entry.scope === "other");
ok("명단 밖 인물 가벼운 논란은 제외", classifyCast("홍길동 SNS 논란", roster) === null);
ok("명단 밖 방송 맥락 없는 사건 제외", classifyCast("회사원 음주운전 입건", roster) === null);
ok("타사 작품 역대 최고 시청률 기사", classifyCast("타사 드라마 역대 최고 시청률 경신", roster)?.signal === "rise");
ok("타사 일반 흥행 표현만으로는 제외", classifyCast("타사 드라마 시청률 상승", roster) === null);
ok("나는 SOLO 일반인 기사(프로그램명 매칭)", classifyCast("'나는 SOLO' 출연자 논란 확산…제작진 입장", roster)?.signal === "risk");
const issues = pickCastIssues([cc("배우 박마바 폭행 논란"), cc("배우 김가나, 음주운전 혐의 입건"), cc("배우 김가나 음주운전 혐의로 입건")], roster, 5);
ok("같은 소식 묶고 자사 예정작이 앞", issues.length === 2 && issues[0].entry.name === "김가나");
ok("중대 범죄 표시 문구", castDisplayTitle(issues[0]).endsWith("(중대 사안 · 편성 제외 검토)"));
const sev = pickCastIssues([cc("배우 김가나 SNS 논란"), cc("배우 박마바 폭행 혐의 입건"), cc("\"음주운전 안 된다\" 외치던 박마바 배신에 방송가 초비상"), cc("이다라 주연 예능 시청률 자체 최고 경신")], roster, 5);
ok("중대 범죄는 자사·타사 구분보다 먼저(맨 위)", sev[0].entry.name === "박마바" && sev[0].severe);
ok("같은 사람 같은 사건 기사는 하나로", sev.filter((h) => h.severe).length === 1);
ok("가벼운 논란은 확인 필요 표시", castLabel(sev.find((h) => h.entry.name === "김가나")!) === "확인 필요");
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
const ins = insertCastIssues(base, { candidates: [], castCandidates: [cc("배우 김가나, 음주운전 혐의 입건"), c("방송가 소식", "크래시2 첫 방송", "연합뉴스", "u2")] }, roster);
ok("출연자 이슈는 방송가 소식 바로 뒤", ins.items[2]?.category === "출연자 이슈" && ins.items[3]?.category === OVERSEAS_CATEGORY);
ok("이미 실린 기사는 출연자 이슈로 중복 게시하지 않음", ins.castCount === 1);
ok("위험 기사는 확인 필요 표시 대상", ins.labels.get(ins.items[2].url) === "중대 사안 · 편성 제외 검토");
ok("출연자 기사 없으면 목록 그대로", insertCastIssues(base, { candidates: [], castCandidates: [] }, roster).items === base);

// 동명이인: 정치 기사(연예 맥락 없음)는 명단 이름이 맞아도 제외
const polRoster: CastEntry[] = [{ name: "김민석", program: "연애박사", scope: "own_past" }];
ok("동명이인 정치 기사 제외", classifyCast("최민희 논란에 칼 빼든 김민석... 친명 \"중징계 불가피\"", polRoster) === null);
ok("연예 맥락 있으면 명단 일치", classifyCast("배우 김민석, 음주 논란 사과", polRoster)?.entry.program === "연애박사");

ok("승하차 교통 기사 제외", classifyCast("수도권~세종 통근버스 재추진⋯승하차지점 분산 과제 방송", polRoster) === null);

// 짜깁기(여러 스타 묶음) 제외, 지금 건강 문제·기자 의견 기사는 통과(사용자 지시 2026-11-15)
ok("질환 묶음 짜깁기 기사 제외", isLowValueCastTitle("활동 중단→대인기피증까지…이정재·이수경·이유비, 피부 질환에 발목 잡힌 ★들 [종합]"));
ok("기자 의견 꼬리표만으로는 제외하지 않음", !isLowValueCastTitle("황정음 하차 빈자리 채웠다…'싱글맘' 조윤희, 계속되는 이혼 셀링에 쏠린 우려 [TEN피플]"));
ok("중대 범죄는 거르지 않음", !isLowValueCastTitle("고경표 음주운전 사고… 예능에서 ‘통편집’"));
// 사용자 지적(2026-11-17): 회차 줄거리를 자극적으로 옮긴 리뷰 기사는 실제 논란이 아니다
ok("방송 리뷰형 '의혹' 기사 제외", isShowRecapRisk("34기 광수, 진정성 의혹 터졌다…\"방송쟁이 싫어져\" 분량 욕심 일침 ('나솔')"));
ok("리뷰 꼬리표 '논란' 기사 제외", isShowRecapRisk("영숙, 데이트 중 돌직구 논란 [어제TV]"));
ok("실제 사건(하차·사과문)은 리뷰 꼬리표가 있어도 유지", !isShowRecapRisk("34기 광수, 과거 논란에 사과문…방송 하차 ('나솔')"));
ok("토크쇼 발언 속 지난 하차 언급은 새 사건 아님", isShowRecapRisk("장나라, 남지현 하차 후 김혜윤 캐스팅 간절히 원했다…\"물 떠 놓고 기도하자고\" ('살롱드립')"));
ok("제목이 잘려 꼬리표가 없어도 후임 캐스팅 언급은 새 사건 아님", isShowRecapRisk("장나라, 남지현 하차 후 김혜윤 캐스팅 간절히 원했다…\"물 떠 놓고 기도..."));
// 사용자 지적(2026-11-18): 출연자 이슈에 같은 사건 기사가 두 건씩 올라옴
ok("시즌 번호 표기가 달라도 같은 작품(데블스플랜) 기사는 같은 소식", sameStory("정현규, '데블스플랜' 촬영 중 공황 증상으로 주저앉아... 결국 하차", "“게임 도중 현장 의료진 조치”…결국 ‘데블스 플랜3’ 중도 하차한 출연자"));
{
  const r: CastEntry[] = [{ name: "", program: "타사 작품", scope: "other" }];
  const cc = (title: string) => ({ category: "x", title, url: title, publisher: "", publishedAt: null });
  const picked = pickCastIssues([cc("고경표 음주운전 ‘민폐 6연타’…박보검·유재석 예능 줄편집"), cc("“짧은 자숙 후 복귀?…음주운전 벌금형 연예인 출연 제한해야” 국회 청원 등장")], r, 4);
  ok("같은 범죄 낱말의 위험 기사는 1건만", picked.length === 1);
}
ok("전임 하차를 배경으로 후임 활약을 칭찬하는 기사는 위험 아님", isShowRecapRisk("윤보미 하차 후 '리액션 구설' 휩싸였는데…정혜성, 7개월 차에 보여준 '나솔사계' MC 존재감"));
ok("제목이 잘려도 '전임 구설 배경 + 새 주어' 형태는 위험 아님", isShowRecapRisk("윤보미 하차 후 '리액션 구설' 휩싸였는데…정혜성, 7개월 차에 보여준..."));
ok("하차 후 본인 사과 기사는 위험 유지", !isShowRecapRisk("배우 김가나 논란 휩싸였는데…결국 하차 후 사과"));
ok("꼬리표 없는 실제 논란 기사는 유지", !isShowRecapRisk("'나는 SOLO' 출연자 논란 확산…제작진 입장"));
{
  const r: CastEntry[] = [{ name: "김가나", program: "자사극", scope: "own_upcoming" }];
  const c = (title: string) => ({ category: "x", title, url: title, publisher: "", publishedAt: null });
  const [comeback] = pickCastIssues([c("배우 김가나, 음주운전 논란 딛고 2년 만에 예능 복귀")], r, 4);
  ok("지난 범죄 뒤 복귀 기사는 '편성 제외 검토'가 아님", !!comeback && !comeback.severe && comeback.signal === "risk");
  const [past] = pickCastIssues([c("배우 김가나, '뮤직뱅크' 하차 설움 씻는다…연기대상 MC 발탁")], r, 4);
  ok("지난 하차를 넘어선 기사는 흥행·화제로", past?.signal === "rise");
}
// 사용자 지적(2026-11-17): "하arlan 코벤의 '더 이노센트'…" 같은 섞인 표기는 버린다
ok("한글·로마자 섞인 번역 거부", !isCleanTranslation("하arlan 코벤의 ‘더 이노센트’, 넷플릭스에서 제작 승인"));
ok("영어 기능어 남은 반쪽 번역 거부", !isCleanTranslation("넷플릭스, deal with 파라마운트"));
ok("같은 시리즈(제임스 본드) 해외 기사는 한 소식", sameStory("Robert Pattinson James Bond Casting Reactions From Industry", "James Bond Casting Shows Challenge of the Social Media Era"));
ok("다른 소식 영문 기사는 묶지 않음", !sameStory("Amazon Developing 'Terminal List' Prequel", "CAA Signs Hybe to Represent Korean Artists"));
// 사용자 수동 목록 대조(2026-11-18)
ok("같은 큰 수치(7609억)를 쓴 케이블TV 기사는 한 소식", sameStory("“케이블TV 퇴출 땐 가계 통신비 최대 7609억 증가”…지역 공공성도 흔들", "\"케이블TV 소멸 시 가계 부담 최대 7609억원…저가방송 대체 난항\""));
ok("수치만 같고 주제어 없으면 다른 소식", !sameStory("A사 매출 1,500억 돌파", "B연구원 보고서 1,500억 규모 전망"));
ok("주어가 달라도 단어가 대부분 겹치면 같은 소식", sameStory("아이와 놀고 검사 절차 설명…KT·서울대병원, AI 로봇 실증", "어린이 환자와 놀고 검사 안내까지…KT, 병원 AI 로봇 실증"));
ok("한경협 K-OTT 제언은 정책으로 선정", rankCategory([c("정책", "한경협, K-OTT 해외 진출 지원 촉구…문화산업 투자 과제 20개 제시")], CATEGORIES.find((x) => x.category === "정책")!, NOW).length === 1);
{
  const cfg = CATEGORIES.find((x) => x.category === "방송가 소식")!;
  const r = rankCategory([c("방송가 소식", "'복면가왕: 황금마스크' 12월 6일 첫 방송 확정…메인 포스터 공개"), c("방송가 소식", "'부부의 세계' 후 7년… 더 치명적인 '어른 멜로'가 온다"), c("방송가 소식", "4개 방송사 수목극 부활시켰다…편성은 살아났는데, 시청률 회복은 '숙제'")], cfg, NOW);
  ok("새 시즌 방송일 확정·편성 판도 기사 선정", r.length === 3 && r.every((x) => x.score >= 4));
}
{
  const cfg = CATEGORIES.find((x) => x.category === "업계동향")!;
  const cands = ["'갑질'인가 '생존'인가 벼랑 끝 케이블TV CJ ENM 송출 중단", "KCTA 케이블TV 없어지면 저가 방송 이용자 부담 확대", "SO 위기는 지역정보 위기 케이블TV 공적 책무 지원", "케이블TV 위기에 고령·저소득층 직격 대체 서비스 없다", "LG헬로비전 외국인 전용 알뜰폰 요금제 출시"].map((t) => c("업계동향", t));
  const picked = pickByRules([{ category: "업계동향", quota: 7, ranked: rankCategory(cands, cfg, NOW) }]);
  ok("같은 주제(케이블TV)는 한 분류에 2건까지", picked.filter((p) => /케이블/.test(p.title)).length === 2 && picked.length === 3);
}
// 수동 클리핑 대조(2026-11-19)
{
  const cfg = CATEGORIES.find((x) => x.category === "정책")!;
  const ts = ["방송사 '팩트체크 노력'에 최대 10점 가점…27년부터 방송평가 바뀐다", "방미통위, 방송평가에 '팩트체크 노력' 10점 가점 신설", "방송평가에 팩트체크 노력 반영…방미통위, 규칙 개정안 의결", "방미통위, 방송사 팩트체크 노력에 최대 10점 가점 준다"];
  ok("같은 정책 소식은 표현이 달라도 한 묶음(이어 붙은 제목까지 비교)", rankCategory(ts.map((t) => c("정책", t)), cfg, NOW).length === 1);
}
{
  const kt = CATEGORIES.find((x) => x.category === "KT 및 계열사 소식")!;
  const r = rankCategory([c("KT 및 계열사 소식", "영화 이어 드라마까지…정근욱·김원국 협업 논란 KT 투자심사 도마에"), c("KT 및 계열사 소식", "\"수능 끝난 수험생 모여라\"…KT, AI·쇼핑·여행 혜택 쏜다")], kt, NOW);
  ok("KT 투자심사 논란은 혜택 홍보보다 앞", r[0].title.includes("투자심사"));
}
{
  const bs = CATEGORIES.find((x) => x.category === "방송가 소식")!;
  const r = rankCategory(["[단독] 전현무·황광희, ‘엑스더리그’ 시즌2 MC 확정…글로벌 서바이벌 이끈다", "이번에는 한일 밴드 오디션이다… SBS '밴드왕' 론칭", "JTBC, IOC와 계약해지했지만..배상 부담은 미확정", "박지영, ‘크래시2’서 공과 사 구분하는 ‘신본부장’ 활약ing", "'나솔' 16기 상철, 코털 이어 방귀 사고까지⋯\"레전드로 남을 것\""].map((t) => c("방송가 소식", t)), bs, NOW);
  ok("MC 확정·론칭·중계권 이슈가 출연자 소개·일상 단신보다 앞", r.slice(0, 3).every((x) => /MC 확정|론칭|IOC/.test(x.title)));
}
ok("하루 지나면 다시 싣지 않는 주제(한경협 K-OTT·케이블TV 가계 부담)", ONE_DAY_TOPICS.some((re) => re.test("한경협, K-OTT 해외 진출 지원 촉구") && re.test("“K-콘텐츠 흥행에도 영화·방송은 역성장…K-OTT 키워야”")) && ONE_DAY_TOPICS.some((re) => re.test("“케이블TV 퇴출 땐 가계 통신비 최대 7609억 증가”") && re.test("\"케이블TV 사라지면 지역 일자리도 위기\"")));
ok("정상 번역 통과(원제·HBO맥스 표기)", isCleanTranslation("넷플릭스, 할런 코벤 원작 'The Innocent' 제작 확정…HBO맥스와 경쟁"));
ok("지금 건강 문제 기사는 위험 신호로 선정", !isLowValueCastTitle("배우 김가나, 촬영 중 쓰러져 입원") && classifyCast("배우 김가나, 촬영 중 쓰러져 입원", roster)?.signal === "risk");

// 관리자 명단 글 형식
const pr = parseRosterText("# 주석\n예정 | 크래시2 | 이민기, 곽선영\n지난 | 연애박사 | 추영우\n솔로 | 나는 SOLO\n\n예정 | 크래시2 | 이민기");
ok("명단 글 읽기(중복 이름 한 번만)", pr.errors.length === 0 && pr.entries.length === 4 && pr.entries[3].scope === "solo" && pr.entries[3].name === "");
ok("잘못된 구분·한 글자 이름은 오류", parseRosterText("방송중 | 크래시2 | 이민기\n예정 | 크레이지투어 | 비").errors.length === 2);
ok("명단 → 글 → 명단 왕복", JSON.stringify(parseRosterText(rosterToText(CAST_ROSTER)).entries) === JSON.stringify(CAST_ROSTER));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
