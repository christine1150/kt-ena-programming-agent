# DB 스키마 설계 (개발 단위 2번)

> PRD.md·CLAUDE.md의 "최소 테이블부터" 원칙에 따라, 지금 당장 필요한 8개 테이블만 설계했다. 확장이 필요해지면 그때 테이블/컬럼을 추가한다 (예: Fit Score용 `MART_*` 테이블은 편성 추천 기능 만들 때 추가).

## 1. 테이블 목록

| 테이블 | 역할 |
|---|---|
| `channels` | 채널 마스터 (7개 채널 + 시장구분·목표·프라임타임·로고) |
| `competitors` | 채널별 경쟁채널 목록 (Competitor Master) |
| `programs` | 프로그램 마스터 (정규화된 이름 + 원본명 보존) |
| `targets` | 타깃 세그먼트 마스터 (2049, 남10대 등) |
| `ratings` | 시청률 데이터 (핵심 Fact 테이블 — Nielsen 일별/skyUHD/2025 연간, `source_type`으로 구분) |
| `target_goals` | 채널별 목표 시청률·목표 등위 |
| `featured_content` | 관리자가 지정한 주요 콘텐츠 (킬러 콘텐츠는 테이블 없이 `ratings`를 집계해서 계산) |
| `file_uploads` | 업로드된 원본 파일 이력 (데이터 품질 검증용) |
| `share_links` | PD 공유 링크 (발급·재발급·무효화) |

## 2. ERD (관계도)

```
channels ──┬──< competitors
           ├──< programs ──< featured_content
           ├──< target_goals
           └──< ratings >── targets
                  │
           (source_type: nielsen_daily / skyuhd / annual_2025)

file_uploads   (독립 — 업로드 이력만 기록)
share_links    (독립 — 접근 링크만 관리)
```

## 3. 테이블 상세

### `channels` — 채널 마스터
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| code | text, unique | 'ENA', 'ENA_DRAMA', 'ENA_PLAY', 'ENA_STORY', 'OLIFE', 'ONCE', 'SKYUHD' |
| name | text | 표시용 이름 |
| market | text | '수도권' \| '전국' |
| primary_target | text | KPI 타깃 (예: '수도권 개인2049') |
| is_full_analysis | boolean | 6개 채널=true, skyUHD=false (시청률만) |
| logo_path | text, nullable | 로고 파일 경로 |
| theme_color | text, nullable | 로고 대표색(hex) — Page 2 테마용 |
| prime_time_start / prime_time_end | time, nullable | 프라임타임 (자동 산출 또는 관리자 재정의) |
| created_at / updated_at | timestamptz | |

### `competitors` — 경쟁채널 마스터
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| channel_id | uuid FK → channels | |
| competitor_name | text | 경쟁채널명 (예: 'tvN', 'MBC every1') |
| is_internal_comparison | boolean | ENA↔ENA Play/Drama처럼 내부 채널 비교인지 |
| created_at | timestamptz | |

### `programs` — 프로그램 마스터
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| channel_id | uuid FK → channels | |
| canonical_name | text | 정규화된 이름 (회차·`<본>` 제거) |
| raw_name | text | 원본 그대로 보존 |
| episode_number | int, nullable | |
| first_run | boolean, nullable | `<본>` 표시가 있으면 true(본방) |
| created_at | timestamptz | |

### `targets` — 타깃 세그먼트 마스터
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| code | text, unique | '2049', 'M30', 'F20', '유료가구' 등 |
| label | text | 표시용 |
| gender | text, nullable | |
| age_min / age_max | int, nullable | |

### `ratings` — 시청률 (핵심 Fact 테이블)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| source_type | text | 'nielsen_daily' \| 'skyuhd' \| 'annual_2025' |
| channel_id | uuid FK → channels | |
| program_id | uuid FK → programs, nullable | 채널 전체 집계 행은 null 가능 |
| target_id | uuid FK → targets, nullable | |
| broadcast_date | date | |
| start_time / end_time | time, nullable | 연간 집계 데이터는 null |
| rating | numeric, nullable | |
| share | numeric, nullable | |
| reach | numeric, nullable | |
| time_spent_seconds | int, nullable | |
| time_spent_share | numeric, nullable | |
| rank | int, nullable | 전체 채널 랭킹 저장 시 |
| created_at | timestamptz | |

> **NULL ≠ 0 원칙**: 값이 없으면 반드시 NULL로 두고 0으로 바꾸지 않는다 (skyUHD는 rating 외 전부 NULL).

### `target_goals` — 목표 시청률
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| channel_id | uuid FK → channels | |
| year | int | 예: 2026 |
| target_rank | text, nullable | 목표 등위 (숫자 또는 "경쟁채널 중 2위" 같은 텍스트) |
| target_rating | numeric, nullable | 목표 시청률 값 |
| created_at | timestamptz | |

### `featured_content` — 관리자 지정 주요 콘텐츠
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| program_id | uuid FK → programs | |
| category | text | 오리지널드라마 \| 독점예능 \| 오리지널예능 \| 브랜디드 \| 구매예능 |
| broadcast_schedule_text | text, nullable | 원문 그대로 (예: "매주월화 밤 10:00") |
| broadcast_day_of_week | text[], nullable | 파싱된 요일 배열 |
| broadcast_time | time, nullable | 파싱된 시각 |
| broadcast_start_date / broadcast_end_date | date, nullable | |
| created_at | timestamptz | |

### `file_uploads` — 업로드 파일 이력 (데이터 품질 검증)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| file_name | text | |
| file_type | text | 'nielsen_daily' \| 'skyuhd' \| 'annual_2025' \| 'target_rating' \| 'channel_master' \| 'competitor_master' |
| reference_date | date, nullable | |
| file_hash | text, nullable | 중복 업로드 감지용 |
| status | text | 'pending' \| 'processed' \| 'error' |
| error_message | text, nullable | |
| uploaded_at | timestamptz | |

### `share_links` — PD 공유 링크
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| token | text, unique | 링크에 쓰이는 토큰 |
| is_active | boolean | |
| created_at | timestamptz | |
| revoked_at | timestamptz, nullable | |

## 4. 지금 만들지 않는 것 (나중에 확장)

- **`MART_*` 테이블** (Fit Score 계산용): 편성 추천 기능(개발 단위 17번) 만들 때 추가
- **PRD 원안의 전체 DIM/FACT 모델**: 지금은 위 8개 테이블로 충분, 필요해지면 그때 추가
- **RLS(행 단위 보안 정책)**: 지금은 모든 DB 접근이 서버(Next.js API Route)를 통해서만 이뤄지므로 비활성 상태로 시작. 클라이언트에서 직접 DB를 조회하는 기능이 생기면 그때 추가

## 5. 이후 추가된 것 (개발 단위 3~5번)

- **`admins`** 테이블 (개발 단위 3번): 이메일 + bcrypt 비밀번호 해시. 회원가입 화면 없이 `scripts/seed-admin.mjs`로만 추가.
- **`programs(channel_id, canonical_name)` 유니크 제약, `featured_content(program_id)` 유니크 제약** (개발 단위 5번): Channel Master 파일을 재업로드하거나 관리자가 같은 콘텐츠를 다시 저장해도 중복 행이 생기지 않고 덮어써지도록.
- **`killer_content_v` 뷰** (개발 단위 5번): 최근 28일 자사 프로그램 평균 시청률 기준 채널별 순위를 계산하는 SQL 뷰 ("킬러 콘텐츠 자동 산출"). `ratings`가 비어있으면 결과도 비어있다.

## 6. 다음 단계

이 설계를 기준으로 `supabase/migrations/`에 SQL 마이그레이션을 만들어 Supabase에 실제로 적용한다.
