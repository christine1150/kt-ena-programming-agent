// "시청률 표" — 에이전트 화면과 따로 열어 두고 숫자만 빠르게 읽는 별도 창(2026-10-19 사용자 요청).
// 표 중심으로 보여 주되, 다른 화면으로 돌아갈 수 있게 전역 메뉴는 layout.tsx가 위에 둔다(2026-11-23). 값은 모두 이미 저장된 닐슨 자료를 읽기만 한다.
// 에이전트 화면의 링크가 ?tab=daily|ranks|trend&code=채널코드&date=YYYY-MM-DD(&target=p2049|hh는 채널 순위 추이의 타깃) 로 같은 문맥을 이어 준다.
import type { Metadata } from "next";
import RatingsViewer from "./RatingsViewer";

export const metadata: Metadata = { title: "시청률 표" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RatingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = first(sp.tab);
  const code = first(sp.code);
  const date = first(sp.date);
  const target = first(sp.target);
  return (
    <RatingsViewer
      initialTab={tab === "ranks" || tab === "trend" ? tab : "daily"}
      initialCode={code && /^[A-Z_]{2,12}$/.test(code) ? code : "ENA"}
      initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null}
      initialTrendTarget={target === "hh" ? "hh" : "p2049"}
    />
  );
}
