// "시청률 표" — 에이전트 화면과 따로 열어 두고 숫자만 빠르게 읽는 별도 창(2026-10-19 사용자 요청).
// 전역 메뉴 없이 표 중심으로 보여 주며, 값은 모두 이미 저장된 닐슨 자료를 읽기만 한다.
// 에이전트 화면의 링크가 ?tab=daily|ranks|trend&code=채널코드&date=YYYY-MM-DD 로 같은 문맥을 이어 준다.
import type { Metadata } from "next";
import RatingsViewer from "./RatingsViewer";

export const metadata: Metadata = { title: "시청률 표" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RatingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = first(sp.tab);
  const code = first(sp.code);
  const date = first(sp.date);
  return (
    <RatingsViewer
      initialTab={tab === "ranks" || tab === "trend" ? tab : "daily"}
      initialCode={code && /^[A-Z_]{2,12}$/.test(code) ? code : "ENA"}
      initialDate={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null}
    />
  );
}
