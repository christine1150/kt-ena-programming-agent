-- SBS NEX·UXN 추정(GUESS) 상위 작품 검토 반영(2026-11-11): 웹 검색·알려진 작품 정보로 장르 정정. 추정 불가는 '미분류'로 되돌려 질문 대상으로 둔다.
UPDATE program_genre_map m SET genre = v.genre, rule_note = '상위 작품 검토 후 정정 — 2026-11-11', updated_by = 'review:uhd-genre-top-2026-11-11', updated_at = now()
FROM (VALUES
('SBS NEX','더트롯연예뉴스','예능'),
('SBS NEX','SCOOL','음악'),
('UXN','사랑은외나무다리에서','드라마'),
('UXN','원경','드라마'),
('UXN','손해보기싫어서','드라마'),
('UXN','졸업','드라마'),
('UXN','구해줘시즌2','드라마'),
('UXN','꿈속의당신처럼','중국 드라마'),
('UXN','라이브','드라마'),
('UXN','특수사건전담반TEN시즌2','드라마'),
('UXN','백패커2','예능'),
('UXN','태고신왕','중국 드라마'),
('UXN','알아두면쓸데없는신비한인간잡학사전','예능'),
('UXN','대탈출2','예능'),
('UXN','아파트404','예능'),
('UXN','만두명가','예능'),
('UXN','안녕오랜만이야','미분류'),
('UXN','정보정','미분류')
) AS v(owner_key, canonical_name, genre)
WHERE m.scope = 'COMPETITOR' AND m.owner_key = v.owner_key AND m.canonical_name = v.canonical_name AND m.source = 'GUESS';
