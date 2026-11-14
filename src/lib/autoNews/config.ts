// 주요 뉴스 자동 수집 설정(사용자 지시 2026-11-15: 매일 수동으로 올리던 뉴스를 자동화, 해외 방송·영화 소식과 출연자 이슈 분류 추가).
// 분류·건수·검색어는 사용자가 2026-10-23~11-13에 직접 올린 196건의 제목을 보고 정했다. 화면에는 지금처럼 제목과 링크만 나간다.

export interface CategoryConfig {
  /** 화면에 나가는 분류명 — 기존 5개는 사용자가 쓰던 이름 그대로 */
  category: string;
  /** 국내 뉴스 검색어(해외 분류는 비움 — 피드로 받는다) */
  queries: string[];
  /** 하루 게시 건수 상한 */
  quota: number;
  /** 제목에 있으면 가산(가중치) */
  boost: [RegExp, number][];
  /** 제목에 있으면 제외 */
  exclude?: RegExp;
  /** 제목에 반드시 있어야 하는 표현(검색어가 넓어 엉뚱한 기사가 섞이는 분류용) */
  require?: RegExp;
}

/** 모든 분류에서 빼는 기사(사진·부고·인사·주가 단신·운세 등) */
export const GLOBAL_EXCLUDE = /\[포토\]|\[사진\]|포토뉴스|화보|\[부고\]|\[인사\]|부음|운세|특징주|\[표\]|급등주|상한가|\[날씨\]|로또|\[게시판\]|보도자료|\[영상\]|포토엔|포토S|증시|주식정보|하락 마감|상승 마감|\.gif/;

export const CATEGORIES: CategoryConfig[] = [
  {
    category: "KT 및 계열사 소식",
    queries: ["KT스카이라이프", "KT ENA", "KT 지니TV", "KT스튜디오지니", "KT알파", "KT나스미디어", "KT지니뮤직", "KT 실적 통신", "kt HCN", "밀리의서재", "KT 김영섭", "KT 조직개편 인사", "KT 요금제 서비스", "KT클라우드", "KT 에이닷 AI"],
    quota: 4,
    require: /KT|케이티|스카이라이프|지니 ?TV|지니뮤직|나스미디어|밀리의서재|HCN|ENA/i,
    boost: [[/스카이라이프|ENA|지니 ?TV|스튜디오지니|HCN/i, 3], [/영업익|영업이익|실적|매출|인사|대표|사장/, 2], [/유료방송|IPTV|미디어|콘텐츠/, 2]],
    exclude: /위즈|wiz|소닉붐|롤스터|KT&G|KTX|프로야구|프로농구|선발|타자|투수|KT ?위즈/i,
  },
  {
    category: "정책",
    queries: ["방미통위", "방송미디어통신위원회", "문체부 콘텐츠", "유료방송 정책", "방발기금", "통합미디어법"],
    quota: 3,
    require: /방미통위|방송미디어통신|문체부|과기정통부|방발기금|미디어법|국감|재승인|재허가|규제|과징금|진흥|공정위/,
    boost: [[/방미통위|방송미디어통신/, 3], [/유료방송|케이블|OTT|PP|채널|콘텐츠/, 2], [/의결|착수|개최|확정|시정명령|과징금|청문/, 1]],
  },
  {
    category: "방송가 소식",
    queries: ["ENA 예능", "ENA 드라마", "첫방송 편성 확정", "드라마 캐스팅 확정", "예능 MC 확정", "시청률 종영", "방송사 사장", "화제성 1위 예능", "나는 SOLO"],
    quota: 5,
    require: /ENA|첫방|첫 방송|편성|캐스팅|출연 확정|시청률|종영|MC|예능|드라마|방송사|지상파|종편|tvN|JTBC|MBC|SBS|KBS|화제성|제작발표회|PD/,
    boost: [[/ENA/, 5], [/나는 ?SOLO|나솔|지구마불|니돈내산/i, 3], [/편성|첫방|첫 방송|캐스팅|확정|시청률|화제성|종영/, 2], [/tvN|JTBC|MBC|SBS|KBS|채널A|MBN|TV ?조선/, 1]],
    exclude: /스포|줄거리|몇부작|재방송 시간|인물관계도|결말|\[종합\]|눈물|충격|근황|오열|열애|결혼|임신|이혼|셀카|SNS|인스타/,
  },
  {
    category: "OTT",
    queries: ["넷플릭스", "티빙", "웨이브 OTT", "쿠팡플레이", "디즈니플러스", "OTT 시장"],
    quota: 3,
    require: /OTT|넷플릭스|티빙|웨이브|쿠팡플레이|디즈니|왓챠|스트리밍/,
    boost: [[/OTT/, 2], [/합병|이용자|구독|광고|요금|출시|독점|중계|실적|제휴|글로벌/, 2], [/티빙|웨이브|쿠팡플레이|넷플릭스/, 1]],
    exclude: /스포|줄거리|몇부작|결말|후기|리뷰|추천작|이번 주 신작|볼만한/,
  },
  {
    category: "업계동향",
    queries: ["케이블TV", "유료방송", "CJ ENM", "콘텐츠 사용료", "FAST 채널", "스튜디오드래곤", "IPTV", "K콘텐츠 IP", "방송 광고 시장", "LG헬로비전", "CJ ENM 실적 tvN", "SBS 실적 미디어", "JTBC 스튜디오", "MBC 사장 경영", "KBS 수신료 재원", "종편 재승인", "SK브로드밴드 LG유플러스 미디어"],
    quota: 6,
    require: /케이블|유료방송|SO|PP|CJ ?ENM|사용료|FAST|스튜디오|IPTV|콘텐츠|미디어|방송|광고|헬로비전|딜라이브|제작사|tvN|SBS|JTBC|MBC|KBS|종편|SK브로드밴드|LG유플러스|티빙/,
    boost: [[/유료방송|케이블|SO|PP|사용료|IPTV/, 3], [/CJ ?ENM|tvN|스튜디오드래곤|헬로비전|딜라이브|SLL|콘텐트리|JTBC|SBS|MBC|KBS/, 3], [/영업익|영업이익|실적|매각|인수|합병|송출 중단|갈등|수출|FAST|사장|구조조정|재승인/, 2]],
    exclude: /스포|줄거리|몇부작|결말/,
  },
];

/** 해외 방송·영화 업계지 공개 피드(제목은 한국어로 옮겨 싣고 링크는 원문) */
export const OVERSEAS_CATEGORY = "해외 방송·영화";
export const OVERSEAS_QUOTA = 4;
export const OVERSEAS_FEEDS: { name: string; url: string }[] = [
  // 전체 피드는 가십·시상식 기사가 많아 산업·TV·국제 부문 피드만 받는다(2026-11-15 접속 확인)
  { name: "Variety", url: "https://variety.com/v/biz/feed/" },
  { name: "Variety", url: "https://variety.com/v/global/feed/" },
  { name: "Variety", url: "https://variety.com/v/tv/feed/" },
  { name: "Deadline", url: "https://deadline.com/v/business/feed/" },
  { name: "Deadline", url: "https://deadline.com/v/international/feed/" },
  { name: "Deadline", url: "https://deadline.com/v/tv/feed/" },
  { name: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/c/business/feed/" },
];
/** 해외 기사는 이 시간 안의 것만(부문 피드는 하루 몇 건뿐이고 주말엔 비어 넉넉히 둔다) */
export const OVERSEAS_MAX_AGE_HOURS = 72;
/** 해외 기사 가산 — 산업·거래·플랫폼·한국 관련을 앞에 둔다(가십·시상식 패션은 뒤로) */
export const OVERSEAS_BOOST: [RegExp, number][] = [
  [/\bKorea|K-drama|K-pop|CJ ENM|Squid Game/i, 5],
  [/Netflix|Disney|Warner|Paramount|Skydance|Comcast|Amazon|Apple TV|HBO|Peacock|YouTube|Sony/i, 3],
  [/merger|acquisition|acquire|deal|layoff|earnings|revenue|subscriber|streaming|box office|ratings|strike|AI\b|licens|ad tier|bundle|CEO/i, 3],
  [/renew|cancel|greenlit|orders|series order|format|adaptation|remake/i, 2],
];
export const OVERSEAS_EXCLUDE = /red carpet|dies at|obituar|trailer|first look|review:|recap|photos|best dressed|how to watch|where to watch|deal alert|shop|sale/i;

/** 출연자 이슈 분류(4단계에서 명단과 함께 사용) — 제목에 이 표현이 있을 때만 후보가 된다 */
export const CAST_RISK_CATEGORY = "출연자 이슈";
export const CAST_RISK_TERMS = /논란|의혹|혐의|입건|송치|기소|구속|음주운전|마약|학폭|폭행|사기|탈세|하차|사과문|자숙|활동 중단|고소|피소|성추행|성희롱|도박|갑질/;

/** 통신사·일간지·경제지·IT 전문지 — 같은 소식이면 이쪽 기사를 대표로 고른다(사용자가 실제로 올린 매체 위주) */
export const TRUSTED_PUBLISHERS = /연합뉴스|뉴스1|뉴시스|전자신문|지디넷|ZDNet|디지털데일리|디지털투데이|머니투데이|매일경제|한국경제|서울경제|파이낸셜뉴스|아시아경제|이데일리|동아일보|중앙일보|조선일보|경향신문|한겨레|한국일보|더벨|아이뉴스24|조이뉴스24|일간스포츠|스포츠조선|엑스포츠뉴스|마이데일리|더팩트|이투데이|헤럴드경제|미디어오늘|PD저널|스포츠서울|스타뉴스|OSEN|텐아시아|뉴스핌|데일리안|블로터|IT조선|조선비즈/i;
