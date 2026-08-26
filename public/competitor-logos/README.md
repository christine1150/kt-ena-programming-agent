# 경쟁채널(방송사) 로고 폴더

1페이지 "분당 시청률(PD 실측)" 그래프의 동시간대 경쟁 프로그램 목록에서 채널 로고로 씁니다.
파일이 없으면 자동으로 채널명 앞 2글자 이니셜 배지로 대체되므로(코드 수정 불필요), 아래
파일명 그대로 이 폴더에 이미지 파일(PNG 권장, 정사각형에 가까울수록 잘 보임)만 추가하면
다음 배포부터 바로 반영됩니다.

| 채널명 | 파일명 | 상태 |
|---|---|---|
| SBS | `SBS.png` | ✅ 확보 |
| MBC | `MBC.png` | ✅ 확보 |
| KBS1 | `KBS1.webp` | ✅ 확보 |
| KBS2 | `KBS2.png` | 미확보 |
| JTBC | `JTBC.png` | ✅ 확보 |
| tvN | `tvN.png` | ✅ 확보 |
| Mnet | `Mnet.png` | 미확보 |
| KBSN스포츠 | `KBSN_SPORTS.jpg` | ✅ 확보 |
| SBS Plus | `SBS_Plus.png` | ✅ 확보 |
| MBC SPORTS+ | `MBC_SPORTS_PLUS.png` | 미확보 |
| 채널S | `CHANNEL_S.png` | 미확보 |
| SPOTV2 | `SPOTV2.png` | 미확보 |
| 채널나우 | `CHANNEL_NOW.png` | 미확보 |
| TV CHOSUN | `TV_CHOSUN.png` | 미확보 |
| MBN | `MBN.png` | 미확보 |
| 채널A | `CHANNEL_A.png` | 미확보 |

"미확보" 채널은 파일이 도착하기 전까지 이니셜 배지로 자동 대체됩니다.

목록에 없는 새 방송사가 나오면 `src/app/Dashboard.tsx`의 `COMPETITOR_LOGO_FILE`에 한 줄만
추가하거나, 채널명에서 특수문자를 `_`로 바꾼 파일명(예: "OO+" → `OO_.png`)을 그대로 올려도
자동 매칭됩니다.
