// 비교 기준 기간을 아주 작고 흐리게 적는 한 줄. 같은 기준을 쓰는 여러 숫자는 이 줄 하나로 모아 적는다(baselines.ts).
// 가장 옅은 허용 글자색(zinc-500, 단계 15 대비 규칙 4.5:1)과 최소 글자 크기를 지킨다 — 더 옅게 하면 읽을 수 없는 사람이 생긴다.
export function BasisNote({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] leading-snug text-zinc-500 ${className}`} data-basis-note="">
      {children}
    </p>
  );
}
