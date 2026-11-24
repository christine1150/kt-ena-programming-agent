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

/** ENA 본방 주요 프로그램(방영 중·예정) — 편성이 바뀌면 여기를 고친다 */
export const ENA_MAIN_PROGRAMS = /크래시 ?2|혹하는 ?로맨스|홍말금|조련의 ?여왕|나의 ?트로이카|사짜 ?변호사|지구마불|니돈내산|카드 한 장에 우정|나는 ?SOLO|나솔|미스틱/i;

/** ENA 관련 기사 하루 게시 상한(사용자 지시 2026-11-16) — 'ENA'라는 이름 또는 본방 작품명이 제목에 있는 기사, 출연자 이슈는 별도 */
export const ENA_DAILY_MAX = 2;
export const ENA_RELATED = /(?<![A-Za-z])ENA(?![a-z])/;

export const CATEGORIES: CategoryConfig[] = [
  {
    category: "KT 및 계열사 소식",
    queries: ["KT스카이라이프", "KT ENA", "KT 지니TV", "KT스튜디오지니", "KT알파", "KT나스미디어", "KT지니뮤직", "KT 실적 통신", "kt HCN", "밀리의서재", "KT 김영섭", "KT 조직개편 인사", "KT 요금제 서비스", "KT클라우드", "KT 에이닷 AI", "ENA 채널", "ENA 방송", "스튜디오지니", "KT ENA 드라마", "KT PASS 패스", "KT 가입자 AI 사업", "KT 신사업 전망", "스카이라이프 목표가", "KT 노조 위원장 선거", "KT 임원인사 조직개편 지연"],
    quota: 4,
    // 사용자 수동 목록 대조(2026-11-16): SKT 등 타사 기사가 KT로 섞이지 않게 영문자 바로 뒤의 KT는 제외
    require: /(?<![A-Za-z])KT|케이티|스카이라이프|지니 ?TV|지니뮤직|나스미디어|밀리의서재|HCN|ENA/i,
    boost: [[/스카이라이프|ENA|지니 ?TV|스튜디오지니|HCN/i, 3], [/영업익|영업이익|실적|매출|인사|대표|사장/, 2], [/유료방송|IPTV|미디어|콘텐츠/, 2], [/가입자|AI|PASS|패스|요금|에이닷|AICC|청신호|호재/, 2],
      // 수동 클리핑 대조(2026-11-19): 그룹 계열사 투자심사·협업 논란처럼 KT 내부 평가·거버넌스 이슈는 놓치면 안 된다
      [/논란|도마|투자심사|감사|특혜|의혹|징계|국감|압수수색/, 4],
      // 수동 클리핑 대조(2026-11-20): 노조 위원장 선거 중단처럼 KT 임원인사·조직개편 일정에 걸리는 내부 소식은 우선
      [/노조|임원 ?인사|조직 ?개편|위원장 선거/, 4],
      // 수능 이벤트·제휴 혜택 홍보와 여러 회사를 나열한 업계 기사(카카오·네이버·SKT·KT …)는 뒤로
      [/이벤트|혜택|페스타|프로모션|경품|수능/, -4],
      // 다른 회사 인사 기사에 "KT 출신"으로만 걸린 것은 KT 소식이 아니다([신세계I&C 인사] … KT·CJ 출신 영입)
      [/출신/, -6],
      [/(?:SKT|네이버|카카오|삼성\S*)·KT|KT·(?:SKT|네이버|카카오|LG)/, -3]],
    // 주가·목표가는 계열사(스카이라이프·스튜디오지니·ENA) 기사만 허용 — 수동 목록(11/17)에 스카이라이프 목표가 하향 기사가 포함됨
    // 증권사 시황("KB證 … KT 약세")도 같은 기준(2026-11-20)
    exclude: /^(?!.*(?:스카이라이프|스튜디오지니|ENA)).*(?:주가|목표가|약세|강세|證)|위즈|wiz|소닉붐|롤스터|KT&G|KTX|프로야구|프로농구|선발|타자|투수|KT ?위즈/i,
  },
  {
    category: "정책",
    queries: ["방미통위", "방송미디어통신위원회", "문체부 콘텐츠", "유료방송 정책", "방발기금", "통합미디어법", "방미통위 승인 조건", "방미통위 홈쇼핑", "방미통위 합의제", "방미통위 청문", "방미통위 절차 보류", "국가 표준 문화지수 K콘텐츠", "한경협 K-OTT 지원", "문화산업 투자 과제 건의", "방송 미디어 AI 활용 실태", "K-FAST 국회 토론회", "K-FAST 활성화 해외 플랫폼", "시청률 시청데이터 집계 방식 정부", "시청률 조사 개편 토론회"],
    quota: 3,
    // 수동 목록 대조(2026-11-18): 한경협 K-OTT 해외 진출 지원 촉구·방송미디어 AI 경험률 조사처럼 경제단체·연구기관의 산업 제언도 정책으로 본다
    // 수동 클리핑 대조(2026-11-20): 국회 K-FAST 활성화 토론회·정부 주도 시청데이터 집계 방식 논의도 정책(자동 목록은 업계동향에 넣었다)
    require: /방미통위|방송미디어통신|문체부|과기정통부|방발기금|미디어법|국감|재승인|재허가|규제|과징금|진흥|공정위|한경협|한국경제인협회|K-OTT|토종 OTT|문화산업|AI 경험률|국회|토론회|K-FAST|시청 ?데이터|시청률 (?:조사|집계)|집계 방식/,
    boost: [[/방미통위|방송미디어통신/, 3], [/유료방송|케이블|OTT|PP|채널|콘텐츠/, 2], [/의결|착수|개최|확정|시정명령|과징금|청문/, 1], [/한경협|한국경제인협회|K-OTT|토종 OTT|문화산업|AI 경험률/, 4], [/촉구|건의|제언|과제|지원 필요/, 1],
      [/K-FAST|시청 ?데이터|시청률 (?:조사|집계)|집계 방식|시대 반영/, 5], [/국회|토론회|정부 주도/, 2]],
    // 문체부 이름만 걸린 지역·관광·행사 수상 소식은 방송 정책이 아니다(인제스피디움 MICE 장관상·송파구 장관 표창, 2026-11-20)
    exclude: /장관상|표창|MICE|유니크 베뉴|관광|축제|체육|구청|군청/,
  },
  {
    category: "방송가 소식",
    queries: ["ENA 예능", "ENA 드라마", "첫방송 편성 확정", "드라마 캐스팅 확정", "예능 MC 확정", "시청률 종영", "방송사 사장", "화제성 1위 예능", "나는 SOLO", "크래시2", "혹하는 로맨스", "이혼 조사관 홍말금", "조련의 여왕", "나의 트로이카", "사짜 변호사", "지구마불 세계여행", "니돈내산", "카드 한 장에 우정이 흔들리는 줄", "드라마 첫방 시청률 포문", "ENA 오디션 첫방", "K콘텐츠 밸류체인 투자", "안방극장 대작 호평", "복면가왕 첫 방송", "미스터트롯4 첫 방송", "수목극 월화극 편성 시청률", "어른 멜로 드라마 편성", "밴드 오디션 론칭 SBS", "JTBC IOC 계약해지 중계권", "신규 예능 MC 확정 시즌2", "방송사 중계권 계약 해지 배상", "부부의 세계 이후 7년 멜로", "치명적 멜로 드라마 온다", "새 시즌 첫 방송 12월"],
    quota: 5,
    require: /ENA|크래시|혹하는|홍말금|조련의|트로이카|사짜|지구마불|니돈내산|우정|SOLO|나솔|첫방|첫 방송|편성|캐스팅|출연 확정|시청률|종영|MC|예능|드라마|방송사|지상파|종편|tvN|JTBC|MBC|SBS|KBS|화제성|제작발표회|PD|멜로|트롯|복면가왕|수목극|월화극|금토극/,
    boost: [
      [/ENA/, 5],
      // 사용자 지시(2026-11-16): ENA 본방(주요 프로그램) 기사는 넣는다 — 방영 중·예정 작품명이 제목에 있으면 크게 가산
      [ENA_MAIN_PROGRAMS, 6],
      [/나는 ?SOLO|나솔|지구마불|니돈내산/i, 3],
      // 본방 첫방·시청률 기사는 우선, 나솔 출연자 사생활성 가십은 뒤로 (수동 목록 11/17: 크래시2 첫방·미스틱 첫방 선택)
      [/(?:크래시 ?2|미스틱|혹하는|홍말금|조련의|트로이카|사짜).*(?:첫방|첫 방송|포문|오늘)/, 4],
      [/(?:나솔|나는 ?SOLO).*(?:데이트|싫어|호감|커플|현커|언급|연급)/i, -6],
      [/편성|첫방|첫 방송|캐스팅|확정|시청률|화제성|종영/, 2], [/tvN|JTBC|MBC|SBS|KBS|채널A|MBN|TV ?조선/, 1],
      // 시청률 기사는 종영·첫방·기록처럼 편성 판단에 쓰이는 것만 — 줄거리 끝에 시청률만 붙인 회차 기사는 뒤로
      [/^(?!.*(?:종영|첫방|첫 방송|출발|자체 최고|최고|돌파|경신|1위|하락|급락|상승|급등)).*시청률/, -3],
      // 수동 목록 대조(2026-11-18): 신규·새 시즌 방송 날짜 확정(복면가왕 12/6·미스터트롯4 12/17)과 편성 판도 기사(수목극 부활 등)는 방송사 편성 판단에 직결되어 우선
      [/\d{1,2}월 ?\d{1,2}일.*(?:첫 방송|첫방|컴백|방송 시작)|(?:첫 방송|컴백).*\d{1,2}월 ?\d{1,2}일/, 4],
      [/수목극|월화극|금토극|주말극|일일극|편성 (?:부활|확대|개편|전쟁)|편성은 살아/, 6],
      [/어른 멜로|가 온다$|새 시즌/, 2],
      // 수동 클리핑 대조(2026-11-19): 주요 예능 MC 확정·톱스타 신작 캐스팅 확정·타사 신규 프로그램 론칭·방송사 중계권 계약 이슈는 우선, 시청률 급상승(껑충·반등)은 편성 판단 자료
      [/MC (?:확정|발탁|합류)|캐스팅 확정|주연 확정|론칭|중계권|계약 ?해지|배상/, 3],
      [/껑충|반등|급상승|상승세/, 3],
      // 출연자 화보·비하인드·역할 소개성 기사와 나솔 출연자 일상 단신은 뒤로
      [/활약ing|비하인드|눈빛|매력|존재감|카리스마|변신/, -4],
      // 따옴표로 감싼 약칭('나솔' 29기)도 같은 단신으로 본다(2026-11-20)
      [/(?:나솔|나는 ?SOLO)['’"」]?\s?\d{1,2}기|코털|방귀/, -9],
      // 기수+출연자 가명("7기 영식", "1기 영호")이 든 기사는 출연자 개인 단신 — 나솔 기사 기본 가산(+13 안팎)을 넘겨 뒤로 민다(2026-11-20).
      // "29기 시청률"처럼 기수 뒤가 가명이 아니면 해당 없음. 출연자 위험 기사는 출연자 이슈 분류가 따로 다룬다
      [/\d{1,2}기 (?:영[수호식철숙자]|광수|상철|경수|정숙|순자|옥순|현숙|정희|미경|미영|용수|종수)/, -14],
      // 나솔 출연자 외모·학력·목격담 단신(삼청동서 포착·청순 미모·탕웨이 후배)은 뒤로
      [/포착|미모|청순|후배 맞네|실감/, -6],
      [/활약ing|신본부장/, -4],
      // 포스터·티저 공개 단신은 날짜가 없으면 뒤로(날짜가 있으면 위 가산이 상쇄)
      [/포스터|티저/, -3],
    ],
    exclude: /몰아보기|스포|줄거리|몇부작|재방송 시간|인물관계도|결말|\[종합\]|눈물|충격|근황|오열|열애|재결합|결별|일축|결혼|임신|이혼|셀카|SNS|인스타|소감|비하인드|스틸|예고편|관전 ?포인트|일문일답|연기대상|연예대상|명장면|패션|공항/,
  },
  {
    category: "OTT",
    queries: ["넷플릭스", "티빙", "웨이브 OTT", "쿠팡플레이", "디즈니플러스", "OTT 시장", "워너브러더스 디스커버리", "파라마운트 스카이댄스", "디즈니 구조조정 경영진", "컴캐스트 NBC유니버설", "소니픽쳐스 BBC HBO", "글로벌 미디어 인수합병 할리우드", "OTT 통합 검색 추천", "OTT 기내 서비스", "OTT 구독 요금 인상", "애플TV 팟캐스트", "티빙 오리지널 캐스팅 주연", "OTT 구독료 지출 AI 구독 비중", "티빙 스마트TV 지원 종료", "웨이브 무료 채널 FAST", "OTT 광고형 요금제 출시",
      // 거래처 인물(KEY_PEOPLE) — 네이버 검색은 모든 단어가 있어야 걸려서 짧게 쓴다("워너브러더스"는 기사 표기 '워너브라더스'와 달라 0건이었다, 2026-11-24)
      "장재호 워너", "장재호 파라마운트", "장재호 스카이댄스", "최준이 파라마운트", "그린버그 파라마운트", "그린버그 스카이댄스"],
    quota: 3,
    require: /OTT|넷플릭스|티빙|웨이브|쿠팡플레이|디즈니|왓챠|스트리밍|워너|파라마운트|스카이댄스|HBO|디즈니|NBC|유니버설|컴캐스트|소니|BBC|CBS/,
    boost: [[/OTT/, 2], [/합병|이용자|구독|광고|요금|출시|독점|중계|실적|제휴|글로벌/, 2], [/티빙|웨이브|쿠팡플레이|넷플릭스/, 1], [/반토막|지출 비중|구독료 비중/, 3], [/장기전|체력전|롱게임/, 3], [/시즌\s?\d.*(?:제작|공개|확정)|(?:제작|공개|확정).*시즌\s?\d/, 2], [/적자|흑자|매출|인수|투자|계약|파트너십|동맹|맞손|손 ?잡|점유율|가입자|규제|망 ?사용료|지상파|유료방송/, 3],
      // 수동 클리핑 대조(2026-11-20): OTT 안 무료(FAST) 채널 확대는 채널 사업과 맞닿아 우선
      [/무료 채널|FAST|채널 \d+개|\d+개 채널/, 4]],
    // 공연·시상식 중계 안내와 주간 신작 모음은 사업 소식이 아니다
    // '정주행'은 몰아보기 추천 기사만 뺀다 — "인기작 정주행 채널 20개 추가"(웨이브 무료 채널 확대)는 사업 소식(2026-11-20)
    exclude: /스포|줄거리|몇부작|결말|후기|리뷰|추천작|이번 주 신작|볼만한|생중계|적발|무허가|유흥|어워드|시상식|콘서트|팬미팅|신작\]|\d편$|명화|정주행(?! ?채널)/,
  },
  {
    category: "업계동향",
    queries: ["케이블TV", "유료방송", "CJ ENM", "콘텐츠 사용료", "FAST 채널", "스튜디오드래곤", "IPTV", "K콘텐츠 IP", "방송 광고 시장", "LG헬로비전", "CJ ENM 실적 tvN", "SBS 실적 미디어", "JTBC 스튜디오", "MBC 사장 경영", "KBS 수신료 재원", "종편 재승인", "SK브로드밴드 LG유플러스 미디어", "방송사 대표 선임 취임", "미디어 콘텐츠 임원 인사 승진", "CJ ENM 대표 인사", "신임 사장 방송 OTT", "홈쇼핑 AI 방송", "TV조선 방미통위 재승인", "딜라이브 CJ ENM 채널", "드라마 제작 MOU 스튜디오", "지역방송 위기", "엔터 IP 사업 대표", "한한령 해제 엔터 미디어주", "SLL중앙 지분 매각 펀드", "콘텐츠 제작사 지분 할인 매각", "그룹 정기 인사 CEO 유임", "케이블TV CEO 선임 교체"],
    quota: 7,
    require: /케이블|유료방송|SO|PP|SLL|CJ ?ENM|사용료|FAST|스튜디오|IPTV|콘텐츠|미디어|방송|광고|헬로비전|딜라이브|제작사|tvN|SBS|JTBC|MBC|KBS|종편|SK브로드밴드|LG유플러스|티빙/,
    boost: [[/유료방송|케이블|SO|PP|사용료|IPTV/, 3], [/CJ ?ENM|tvN|스튜디오드래곤|헬로비전|딜라이브|SLL|콘텐트리|JTBC|SBS|MBC|KBS/, 3], [/영업익|영업이익|실적|매각|인수|합병|송출 중단|갈등|수출|FAST|사장|구조조정|재승인/, 2], [/취임|선임|승진|내정|영입|신임|임명|대표이사|부사장|본부장|국장/, 3], [/한한령|지분 .*매각|지분.*할인|벤처펀드|SLL/, 3],
      // 수동 클리핑 대조(2026-11-20): 유료방송·통신 그룹의 정기 인사(LG 주요 CEO 유임·LG헬로 CEO 교체)는 우선, 종목 수급·강세 시황은 뒤로
      [/유임|안정 인사|정기 인사|사장단 인사|CEO/, 3],
      [/수급|매수|매도|강세|약세|불기둥|코스닥|코스피|관련주|株|주가|(?:방송|엔터|콘텐츠|미디어)주|애프터마켓/, -4]],
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

/**
 * 꼭 보는 거래처 인물(사용자 지시 2026-11-24) — 이름이 제목에 나오면 분류·제외 규칙과 상관없이 크게 가산해 싣는다.
 * - 장재호(Jae Chang) — 워너브러더스 디스커버리 APAC 콘텐츠 라이선싱 총괄·한국 대표(소속이 바뀌었을 수 있어 회사는 워너·파라마운트·스카이댄스 모두 본다)
 * - 최준이(June Choi) — 파라마운트 픽처스 북아시아 지역 세일즈 VP(월드와이드 TV 라이선싱·배급)
 * - 조나단 그린버그(Jonathan Greenberg) — 파라마운트 인터내셔널 콘텐츠 라이선싱 EVP
 * 흔한 이름이라 같은 제목에 회사명이나 라이선싱·배급 표현이 함께 있을 때만 해당한다.
 */
const KEY_PEOPLE_NAME = String.raw`장재호|최준이|조나단 ?그린버그|조너선 ?그린버그|Jae Change?\b|June Choi\b|Jonathan Greenberg\b`;
const KEY_PEOPLE_CONTEXT = String.raw`워너|파라마운트|스카이댄스|WBD|라이선싱|라이센싱|판권|배급|Warner|WBD|Paramount|Skydance|licens|distribut`;
export const KEY_PEOPLE = new RegExp(`^(?=.*(?:${KEY_PEOPLE_NAME}))(?=.*(?:${KEY_PEOPLE_CONTEXT}))`, "i");
export const KEY_PEOPLE_BOOST = 15;
/** 제목 속 거래처 인물이 누구인지(같은 회사의 다른 인물 기사를 같은 소식으로 묶지 않으려고) */
export function keyPersonOf(title: string): string | null {
  if (!KEY_PEOPLE.test(title)) return null;
  if (/장재호|Jae Change?\b/i.test(title)) return "jae";
  if (/최준이|June Choi\b/i.test(title)) return "june";
  return "greenberg";
}

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
  // 사용자 지시(2026-11-17): 007 주연 확정 같은 대형 프랜차이즈 캐스팅은 놓치면 안 되므로 영화 부문 피드도 받는다
  { name: "Variety", url: "https://variety.com/v/film/feed/" },
  { name: "Deadline", url: "https://deadline.com/v/film/feed/" },
  { name: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/c/movies/feed/" },
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
  // 대형 프랜차이즈 주연·감독 확정(007·배트맨·스타워즈 등)은 업계 최대 화제 — 확정·발탁 표현과 함께 있을 때 크게 가산
  // 007 등 최상위 프랜차이즈 이름만 제목에 있어도 업계 대형 소식으로 본다(추측·반응 기사까지 함께 올라오므로 대표 1건만 남는다)
  [/James Bond|\b007\b/i, 8],
  [/(?:casting|cast(?:s|ed)?|chosen|choosing|named|picked|tapped|officially|confirm\w*).*(?:Bond|007)|(?:Bond|007).*(?:casting|chosen|officially|confirm\w*|announce\w*)/i, 4],
  [/(?:James Bond|\b007\b|Batman|Superman|Spider-Man|Star Wars|Harry Potter|Marvel|Avengers|Indiana Jones|Mission: Impossible).*(?:cast(?:s|ed)?\b|to play|to star|named|tapped|lead|new Bond|officially|confirm)|(?:cast(?:s|ed)?\b|named|tapped|confirm).*(?:James Bond|\b007\b|Batman|Superman|Spider-Man)/i, 8],
  // 영화제 상영작·공로상·펠로십 소식은 판도 소식이 아니라 뒤로 민다
  [/festival|award|honou?r|tribute|fellowship|legend/i, -3],
];
// 개인 범죄·추문, 소속사 계약, 홍보 영상 공개는 업계 판도 소식이 아니다(2026-11-15 시험 실행에서 섞임)
export const OVERSEAS_EXCLUDE =
  /in order\b|filmography|who could join|manifested|predicted|\(opinion\)|fans (?:already )?complain|red carpet|\bdies\b|obituar|trailer|first look|review:|recap|photos|best dressed|how to watch|where to watch|deal alert|shop|\bsale\b|signs with|\bclip\b|teaser|sneak peek|poster|\brape|raped|sexual|assault|accuser|affairs?\b|arrest|sentenc|murder|abuse|to host|hosts? ['‘]?saturday night live/i;
/** 해외 기사는 방송·영화 업계 표현이나 주요 미디어 그룹이 제목에 있어야 한다(업계지에 실린 타 업종 기사 제외) */
export const OVERSEAS_REQUIRE =
  /\bJames Bond|\b007\b|Batman|Superman|Spider-Man|Star Wars|Marvel|\bTV\b|television|film|movie|cinema|stream|studio|series|box office|broadcast|network|Hollywood|content|drama|animation|anime|Warner|WBD|Paramount|Skydance|Disney|NBCU|Universal|Comcast|Sony|CBS|BBC|ITV|Channel 4|Sky\b|HBO|Netflix|Amazon|MGM|Apple|Lionsgate|Fox\b|AMC|A24|Canal\+|Banijay|Fremantle|YouTube|Peacock|SAG-AFTRA|WGA|guild|MIPCOM|MIPTV|FilMart|Korea/i;

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
