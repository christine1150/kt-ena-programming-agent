-- 사용자 지시(2026-11-15): 주요 뉴스 "출연자 이슈"의 감시 명단을 코드(src/lib/autoNews/roster.ts)에서 DB로 옮기고 관리자 화면에서 고친다.
-- 한 행 = 출연자 한 명(나는 SOLO 같은 일반인 프로그램은 name='' 한 행으로 프로그램 단위 감시). 관리자 저장은 전체 교체.
-- 표가 비었거나 읽지 못하면 수집은 코드 명단(roster.ts)으로 돌아간다.
create table if not exists news_cast_roster (
  id uuid primary key default gen_random_uuid(),
  program text not null,
  name text not null default '',
  scope text not null check (scope in ('own_upcoming', 'own_past', 'solo')),
  display_order int not null default 0,
  updated_by text,
  created_at timestamptz not null default now()
);
comment on table news_cast_roster is '주요 뉴스 출연자 이슈 감시 명단(2026-11-15). scope: own_upcoming=방영 중·예정 자사 작품, own_past=지난 자사 작품, solo=일반인 프로그램 단위.';
alter table news_cast_roster enable row level security;

-- 첫 명단: roster.ts(2026-11-15판)와 같은 내용
insert into news_cast_roster (program, name, scope, display_order)
select v.program, v.name, v.scope, v.ord
from (values
  ('크래시2','이민기','own_upcoming',1),('크래시2','곽선영','own_upcoming',2),('크래시2','허성태','own_upcoming',3),('크래시2','이호철','own_upcoming',4),('크래시2','박지영','own_upcoming',5),
  ('혹하는 로맨스','정경호','own_upcoming',6),('혹하는 로맨스','전여빈','own_upcoming',7),('혹하는 로맨스','최대훈','own_upcoming',8),('혹하는 로맨스','강말금','own_upcoming',9),('혹하는 로맨스','최우진','own_upcoming',10),
  ('이혼 조사관 홍말금','이보영','own_upcoming',11),('이혼 조사관 홍말금','강태오','own_upcoming',12),
  ('조련의 여왕','김영광','own_upcoming',13),('조련의 여왕','이주명','own_upcoming',14),
  ('나의 트로이카','유연석','own_upcoming',15),('나의 트로이카','차주영','own_upcoming',16),
  ('사짜 변호사','김남길','own_upcoming',17),('사짜 변호사','이주빈','own_upcoming',18),
  ('미스틱','산다라박','own_upcoming',19),('미스틱','강승윤','own_upcoming',20),('미스틱','장리인','own_upcoming',21),
  ('지구마불 세계여행 4','노홍철','own_upcoming',22),('지구마불 세계여행 4','규현','own_upcoming',23),('지구마불 세계여행 4','빠니보틀','own_upcoming',24),('지구마불 세계여행 4','곽튜브','own_upcoming',25),('지구마불 세계여행 4','박명수','own_upcoming',26),('지구마불 세계여행 4','천우희','own_upcoming',27),('지구마불 세계여행 4','강소라','own_upcoming',28),
  ('니돈내산','김숙','own_upcoming',29),('니돈내산','이준','own_upcoming',30),('니돈내산','최미나수','own_upcoming',31),
  ('나는 SOLO','','solo',32),('나솔사계','','solo',33),
  ('니돈내산','현봉식','own_past',34),('니돈내산','박준면','own_past',35),('니돈내산','윤은혜','own_past',36),('니돈내산','조나단','own_past',37),
  ('연애박사','추영우','own_past',38),('연애박사','김소현','own_past',39),('연애박사','김민석','own_past',40),('연애박사','이창훈','own_past',41),('연애박사','임진효','own_past',42),
  ('신병4','김민호','own_past',43),('신병4','남태우','own_past',44),('신병4','이원정','own_past',45),('신병4','이현균','own_past',46),('신병4','김동준','own_past',47),('신병4','오대환','own_past',48),('신병4','이상진','own_past',49),('신병4','김요한','own_past',50),('신병4','조진세','own_past',51),('신병4','이충구','own_past',52),('신병4','이수지','own_past',53),('신병4','한가인','own_past',54),
  ('그대에게 드림','황인엽','own_past',55),('그대에게 드림','이혜리','own_past',56),('그대에게 드림','백성철','own_past',57),('그대에게 드림','이열음','own_past',58),('그대에게 드림','이상엽','own_past',59),('그대에게 드림','이지민','own_past',60),('그대에게 드림','이주안','own_past',61),
  ('닥터 섬보이','이재욱','own_past',62),('닥터 섬보이','신예은','own_past',63),('닥터 섬보이','홍민기','own_past',64),('닥터 섬보이','이수경','own_past',65),('닥터 섬보이','김윤우','own_past',66),('닥터 섬보이','주인영','own_past',67),('닥터 섬보이','박준서','own_past',68),
  ('허수아비','박해수','own_past',69),('허수아비','이희준','own_past',70),('허수아비','유승목','own_past',71),('허수아비','송건희','own_past',72),('허수아비','서지혜','own_past',73),('허수아비','정문성','own_past',74),('허수아비','백현진','own_past',75),('허수아비','허정도','own_past',76),('허수아비','김환희','own_past',77),
  ('클라이맥스','주지훈','own_past',78),('클라이맥스','하지원','own_past',79),('클라이맥스','오정세','own_past',80),('클라이맥스','서현우','own_past',81),
  ('아너','이나영','own_past',82),('아너','정은채','own_past',83),('아너','이청아','own_past',84),
  ('크레이지투어','정지훈','own_past',85),('크레이지투어','김무열','own_past',86),('크레이지투어','이승훈','own_past',87)
) as v(program, name, scope, ord)
where not exists (select 1 from news_cast_roster);
