// 프로그램 성과 — 한 작품을 고르면 채널별 실적·채널 일평균 대비·동슬롯 대비를 한 표에서 비교한다.
// 다른 화면의 프로그램명 링크가 ?q=이름(또는 ?group=작품키)&channel=채널코드&from&to 로 같은 문맥을 이어 준다.
import { Suspense } from "react";
import ProgramPerformanceView from "./ProgramPerformanceView";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function ProgramPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const channel = first(sp.channel);
  const from = first(sp.from);
  const to = first(sp.to);
  return (
    <Suspense>
      <ProgramPerformanceView
        initialQuery={(first(sp.q) ?? "").slice(0, 60)}
        initialGroup={(first(sp.group) ?? "").slice(0, 120) || null}
        focusChannel={channel && /^[A-Z_]{2,12}$/.test(channel) ? channel : null}
        initialFrom={from && ISO.test(from) ? from : null}
        initialTo={to && ISO.test(to) ? to : null}
      />
    </Suspense>
  );
}
