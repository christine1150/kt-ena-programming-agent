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
export const GLOBAL_EXCLUDE =
  /\[포토\]|\[사진\]|포토뉴스|화보|\[부고\]|부음|운세|특징주|\[표\]|급등주|상한가|\[날씨\]|로또|\[게시판\]|보도자료|\[영상\]|포토엔|포토S|증시|주식정보|하락 마감|상승 마감|\.gif|\[[^\]]*(?:칼럼|기고|사설|기자수첩|시론|데스크|연재|위클리|금주|주간)[^\]]*\]|교수의|[〈<(]\d{1,3}[〉>)]|소식_|주말n|\[오늘의|\[주말/;

/** 낚시성 제목 — 주어를 숨기거나 감탄으로 끄는 기사는 정보가 적어 뒤로 민다(2026-11-15 시험 실행에서 방송가 상위에 섞임) */
export const CLICKBAIT = /난리 ?난|일냈다|초호화|경악|소름|발칵|술렁|뭐길래|알고 ?보니|떴다|터졌다|깜짝|화들짝|눈길|시선 ?집중|이유는\??$|누구\??$|정체는/;
export const CLICKBAIT_PENALTY = 4;
/** 여러 소식을 한 제목에 묶은 시황 기사("[통신] A, B·…") — 한 건의 소식이 아니라 뒤로 민다 */
export const ROUNDUP = /^\[(?:통신|이통|KT|SKT|LG유플러스|IT|ICT|산업|유통|방송|미디어|재계|기업)[^\]]*\]/;
export const ROUNDUP_PENALTY = 3;

/** 프로그램 성과·편성 기사 — 어느 검색어로 걸렸든 '방송가 소식'으로 옮겨 그 분류 기준으로 겨룬다(업계동향·OTT에 시청률 기사가 섞이지 않게) */
export const PROGRAM_NEWS = /시청률|종영|첫방|첫 방송|캐스팅|출연 확정|제작발표회|편성 확정|최종화|최종회/;
export const PROGRAM_NEWS_CATEGORY = "방송가 소식";

export const CATEGORIES: CategoryConfig[] = [
  {
    category: "KT 및 계열사 소식",
    queries: ["KT스카이라이프", "KT ENA", "KT 지니TV", "KT스튜디오지니", "KT알파", "KT나스미디어", "KT지니뮤직", "KT 실적 통신", "kt HCN", "밀리의서재", "KT 김영섭", "KT 조직개편 인사", "KT 요금제 서비스", "KT클라우드", "KT 에이닷 AI", "KT PASS 패스", "KT 가입자 AI 사업", "KT 신사업 전망"],
    quota: 4,
    // 사용자 수동 목록 대조(2026-11-16): SKT 등 타사 기사가 KT로 섞이지 않게 영문자 바로 뒤의 KT는 제외
    require: /(?<![A-Za-z])KT|케이티|스카이라이프|지니 ?TV|지니뮤직|나스미디어|밀리의서재|HCN|ENA/i,
    boost: [[/스카이라이프|ENA|지니 ?TV|스튜디오지니|HCN/i, 3], [/영업익|영업이익|실적|매출|인사|대표|사장/, 2], [/유료방송|IPTV|미디어|콘텐츠/, 2], [/가입자|AI|PASS|패스|요금|에이닷|AICC|청신호|호재/, 2]],
    exclude: /주가|목표가|위즈|wiz|소닉붐|롤스터|KT&G|KTX|프로야구|프로농구|선발|타자|투수|KT ?위즈/i,
  },
  {
    category: "정책",
    queries: ["방미통위", "방송미디어통신위원회", "문체부 콘텐츠", "유료방송 정책", "방발기금", "통합미디어법", "방미통위 승인 조건", "방미통위 홈쇼핑", "방미통위 합의제"],
    quota: 3,
    require: /방미통위|방송미디어통신|문체부|과기정통부|방발기금|미디어법|국감|재승인|재허가|규제|과징금|진흥|공정위/,
    boost: [[/방미통위|방송미디어통신/, 3], [/유료방송|케이블|OTT|PP|채널|콘텐츠/, 2], [/의결|착수|개최|확정|시정명령|과징금|청문/, 1]],
  },
  {
    category: "방송가 소식",
    queries: ["ENA 예능", "ENA 드라마", "첫방송 편성 확정", "드라마 캐스팅 확정", "예능 MC 확정", "시청률 종영", "방송사 사장", "화제성 1위 예능", "나는 SOLO"],
    quota: 5,
    require: /ENA|첫방|첫 방송|편성|캐스팅|출연 확정|시청률|종영|MC|예능|드라마|방송사|지상파|종편|tvN|JTBC|MBC|SBS|KBS|화제성|제작발표회|PD/,
    boost: [
      [/ENA/, 5],
      [/나는 ?SOLO|나솔|지구마불|니돈내산/i, 3],
      [/편성|첫방|첫 방송|캐스팅|확정|시청률|화제성|종영/, 2], [/tvN|JTBC|MBC|SBS|KBS|채널A|MBN|TV ?조선/, 1],
      // 시청률 기사는 종영·첫방·기록처럼 편성 판단에 쓰이는 것만 — 줄거리 끝에 시청률만 붙인 회차 기사는 뒤로
      [/^(?!.*(?:종영|첫방|첫 방송|출발|자체 최고|최고|돌파|경신|1위|하락|급락|상승|급등)).*시청률/, -3],
    ],
    exclude: /몰아보기|스포|줄거리|몇부작|재방송 시간|인물관계도|결말|\[종합\]|눈물|충격|근황|오열|열애|결혼|임신|이혼|셀카|SNS|인스타|소감|비하인드|스틸|포스터|예고편|티저|관전 ?포인트|일문일답|연기대상|연예대상|명장면|패션|공항/,
  },
  {
    category: "OTT",
    queries: ["넷플릭스", "티빙", "웨이브 OTT", "쿠팡플레이", "디즈니플러스", "OTT 시장", "워너브러더스 디스커버리", "파라마운트 스카이댄스", "디즈니 구조조정 경영진", "컴캐스트 NBC유니버설", "소니픽쳐스 BBC HBO", "글로벌 미디어 인수합병 할리우드", "OTT 통합 검색 추천", "OTT 기내 서비스", "OTT 구독 요금 인상"],
    quota: 3,
    require: /OTT|넷플릭스|티빙|웨이브|쿠팡플레이|디즈니|왓챠|스트리밍|워너|파라마운트|스카이댄스|HBO|디즈니|NBC|유니버설|컴캐스트|소니|BBC|CBS/,
    boost: [[/OTT/, 2], [/합병|이용자|구독|광고|요금|출시|독점|중계|실적|제휴|글로벌/, 2], [/티빙|웨이브|쿠팡플레이|넷플릭스/, 1], [/적자|흑자|매출|인수|투자|계약|파트너십|동맹|맞손|손 ?잡|점유율|가입자|규제|망 ?사용료|지상파|유료방송/, 3]],
    // 공연·시상식 중계 안내와 주간 신작 모음은 사업 소식이 아니다
    exclude: /스포|줄거리|몇부작|결말|후기|리뷰|추천작|이번 주 신작|볼만한|생중계|적발|무허가|유흥|어워드|시상식|콘서트|팬미팅|신작\]|\d편$|명화|정주행/,
  },
  {
    category: "업계동향",
    queries: ["케이블TV", "유료방송", "CJ ENM", "콘텐츠 사용료", "FAST 채널", "스튜디오드래곤", "IPTV", "K콘텐츠 IP", "방송 광고 시장", "LG헬로비전", "CJ ENM 실적 tvN", "SBS 실적 미디어", "JTBC 스튜디오", "MBC 사장 경영", "KBS 수신료 재원", "종편 재승인", "SK브로드밴드 LG유플러스 미디어", "방송사 대표 선임 취임", "미디어 콘텐츠 임원 인사 승진", "CJ ENM 대표 인사", "신임 사장 방송 OTT", "홈쇼핑 AI 방송", "TV조선 방미통위 재승인", "딜라이브 CJ ENM 채널"],
    quota: 7,
    require: /케이블|유료방송|SO|PP|CJ ?ENM|사용료|FAST|스튜디오|IPTV|콘텐츠|미디어|방송|광고|헬로비전|딜라이브|제작사|tvN|SBS|JTBC|MBC|KBS|종편|SK브로드밴드|LG유플러스|티빙/,
    boost: [[/유료방송|케이블|SO|PP|사용료|IPTV/, 3], [/CJ ?ENM|tvN|스튜디오드래곤|헬로비전|딜라이브|SLL|콘텐트리|JTBC|SBS|MBC|KBS/, 3], [/영업익|영업이익|실적|매각|인수|합병|송출 중단|갈등|수출|FAST|사장|구조조정|재승인/, 2], [/취임|선임|승진|내정|영입|신임|임명|대표이사|부사장|본부장|국장/, 3]],
    exclude: /스포|줄거리|몇부작|결말/,
  },
  {
    // 국제 방송 마켓·페어(MIPCOM·BCWW·ATF·홍콩 필마트 등) — 열리는 시기에만 후보가 생긴다(require)
    category: "해외 마켓·페어",
    queries: ["MIPCOM 미프컴", "BCWW 방송영상산업전", "ATF 아시아TV포럼", "홍콩 필마트 FILMART", "MIPTV 칸 방송 마켓", "TV 콘텐츠 마켓 한국 수출 상담", "IDFA 다큐 한국"],
    quota: 2,
    require: /MIPCOM|MIPTV|미프컴|미프TV|BCWW|방송영상산업전|ATF|아시아TV|필마트|FILMART|콘텐츠 ?마켓|IDFA/i,
    boost: [[/MIPCOM|미프컴|BCWW|ATF|필마트|FILMART/i, 3], [/수출|계약|상담|참가|공개|쇼케이스|K-?콘텐츠|한국/, 2]],
    exclude: /포스터|관람객 후기/,
  },
];

/** 해외 방송·영화 업계지 공개 피드(제목은 한국어로 옮겨 싣고 링크는 원문) */
export const OVERSEAS_CATEGORY = "해외 방송·영화";
export const OVERSEAS_QUOTA = 6;
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
  // 세계 방송·영화 업계에 영향을 주는 대형 그룹 전체(특정 회사 편중 없이 같은 가산)
  [/Warner|WBD|Paramount|Skydance|Disney|ESPN|Pixar|Lucasfilm|NBCUniversal|NBCU|Universal|Comcast|Versant|Sony|CBS|BBC|ITV|Channel 4|Sky\b|HBO|Netflix|Amazon|MGM|Apple|Lionsgate|Fox\b|AMC|A24|Canal\+|RTL|ProSieben|Banijay|Fremantle|Endeavor|WME|CAA|Tencent|iQiyi|Toho|Studio Ghibli|TF1|Mediaset|Globo|Televisa|JioStar|Reliance/i, 4],
  // 경영진 교체·구조조정·M&A·신작 라인업 발표 — 업계 판도를 바꾸는 소식
  [/CEO|chief|chairman|president|exits?|steps down|appoint|names? new|promot|succeed|ousted|hires?|taps?|restructur|layoffs?|reorg|spin-?off|merge|acquir|acquisition|takeover|buyout|bid|sells?|sale of|upfront|slate|lineup|greenlights? slate|unveils?/i, 3],
  [/MIPCOM|MIPTV|BCWW|Asia TV Forum|\bATF\b|FilMart|Hong Kong/i, 4],
  [/Netflix|Disney|Warner|Paramount|Skydance|Comcast|Amazon|Apple TV|HBO|Peacock|YouTube|Sony/i, 3],
  [/merger|acquisition|acquire|deal|layoff|earnings|revenue|subscriber|streaming|box office|ratings|strike|AI\b|licens|ad tier|bundle|CEO/i, 3],
  [/renew|cancel|greenlit|orders|series order|format|adaptation|remake/i, 2],
  // 업계 전체에 걸리는 정책·규제
  [/tax incentive|tax credit|tariff|regulat|\bFCC\b|antitrust|Congress|\bDOJ\b|quota/i, 3],
  // 영화제 상영작·공로상·펠로십 소식은 판도 소식이 아니라 뒤로 민다
  [/festival|award|honou?r|tribute|fellowship|legend/i, -3],
];
// 개인 범죄·추문, 소속사 계약, 홍보 영상 공개는 업계 판도 소식이 아니다(2026-11-15 시험 실행에서 섞임)
export const OVERSEAS_EXCLUDE =
  /red carpet|\bdies\b|obituar|trailer|first look|review:|recap|photos|best dressed|how to watch|where to watch|deal alert|shop|\bsale\b|signs with|\bclip\b|teaser|sneak peek|poster|\brape|raped|sexual|assault|accuser|affairs?\b|arrest|sentenc|murder|abuse|to host|hosts? ['‘]?saturday night live/i;
/** 해외 기사는 방송·영화 업계 표현이나 주요 미디어 그룹이 제목에 있어야 한다(업계지에 실린 타 업종 기사 제외) */
export const OVERSEAS_REQUIRE =
  /\bTV\b|television|film|movie|cinema|stream|studio|series|box office|broadcast|network|Hollywood|content|drama|animation|anime|Warner|WBD|Paramount|Skydance|Disney|NBCU|Universal|Comcast|Sony|CBS|BBC|ITV|Channel 4|Sky\b|HBO|Netflix|Amazon|MGM|Apple|Lionsgate|Fox\b|AMC|A24|Canal\+|Banijay|Fremantle|YouTube|Peacock|SAG-AFTRA|WGA|guild|MIPCOM|MIPTV|FilMart|Korea/i;

/** 출연자 이슈 분류(4단계에서 명단과 함께 사용) — 제목에 이 표현이 있을 때만 후보가 된다 */
export const CAST_RISK_CATEGORY = "출연자 이슈";
export const CAST_RISK_TERMS = /논란|의혹|혐의|입건|송치|기소|구속|음주운전|마약|학폭|폭행|사기|탈세|하차|사과문|자숙|활동 중단|고소|피소|성추행|성희롱|도박|갑질/;

/** 통신사·일간지·경제지·IT 전문지 — 같은 소식이면 이쪽 기사를 대표로 고른다(사용자가 실제로 올린 매체 위주) */
/** 네이버 검색은 매체명이 아니라 원문 주소를 주므로 같은 매체를 주소로도 알아본다(주소로 오면 위 이름 목록이 한 번도 맞지 않았다 — 2026-11-15) */
export const TRUSTED_HOSTS =
  /(?:^|\.)(?:yna\.co\.kr|news1\.kr|newsis\.com|etnews\.com|zdnet\.co\.kr|ddaily\.co\.kr|digitaltoday\.co\.kr|mt\.co\.kr|mk\.co\.kr|hankyung\.com|sedaily\.com|fnnews\.com|asiae\.co\.kr|edaily\.co\.kr|donga\.com|joongang\.co\.kr|chosun\.com|khan\.co\.kr|hani\.co\.kr|hankookilbo\.com|thebell\.co\.kr|inews24\.com|joynews24\.com|isplus\.com|sportschosun\.com|xportsnews\.com|mydaily\.co\.kr|tf\.co\.kr|etoday\.co\.kr|heraldcorp\.com|mediatoday\.co\.kr|pdjournal\.com|sportsseoul\.com|starnewskorea\.com|osen\.co\.kr|tenasia\.co\.kr|newspim\.com|dailian\.co\.kr|bloter\.net|sbs\.co\.kr|kbs\.co\.kr|imbc\.com|jtbc\.co\.kr|ytn\.co\.kr|mbn\.co\.kr|businesspost\.co\.kr|techm\.kr|dt\.co\.kr|ajunews\.com|nocutnews\.co\.kr|seoul\.co\.kr|munhwa\.com|segye\.com|kmib\.co\.kr|mediaus\.co\.kr|journalist\.or\.kr|newstomato\.com)$/i;
export const TRUSTED_PUBLISHERS =/연합뉴스|뉴스1|뉴시스|전자신문|지디넷|ZDNet|디지털데일리|디지털투데이|머니투데이|매일경제|한국경제|서울경제|파이낸셜뉴스|아시아경제|이데일리|동아일보|중앙일보|조선일보|경향신문|한겨레|한국일보|더벨|아이뉴스24|조이뉴스24|일간스포츠|스포츠조선|엑스포츠뉴스|마이데일리|더팩트|이투데이|헤럴드경제|미디어오늘|PD저널|스포츠서울|스타뉴스|OSEN|텐아시아|뉴스핌|데일리안|블로터|IT조선|조선비즈/i;

/** 오늘(KST) 0시의 UTC 시각 */
export function kstDayStartIso(now: number): string {
  const KST = 9 * 3_600_000;
  return new Date(Math.floor((now + KST) / 86_400_000) * 86_400_000 - KST).toISOString();
}
