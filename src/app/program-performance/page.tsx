// 프로그램 성과 — 한 작품을 고르면 채널별 실적·채널 일평균 대비·동슬롯 대비를 한 표에서 비교한다.
// 다른 화면의 프로그램명 링크가 ?q=이름(또는 ?group=작품키)&channel=채널코드&from&to 로 같은 문맥을 이어 준다.
// 화면 상태(작품·기간·방송 구분·타깃·채널)는 주소가 원본이라 화면이 직접 읽는다(2026-10-23) — 여기서는 넘기지 않는다.
import { Suspense } from "react";
import ProgramPerformanceView from "./ProgramPerformanceView";

export default function ProgramPerformancePage() {
  return (
    <Suspense>
      <ProgramPerformanceView />
    </Suspense>
  );
}
