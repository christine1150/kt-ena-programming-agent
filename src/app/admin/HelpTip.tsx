// 관리자 화면의 긴 설명을 평소에는 숨기고 ⓘ에 마우스를 올리거나 키보드로 포커스할 때만 보여 주는 말풍선(사용자 요청 2026-10-22).
// 훅이 없어 서버·클라이언트 컴포넌트 어디서나 쓴다.
import type { ReactNode } from "react";

export default function HelpTip({ children, label = "설명" }: { children: ReactNode; label?: string }) {
  return (
    <span className="group relative ml-1.5 inline-block align-middle">
      <span
        tabIndex={0}
        role="note"
        aria-label={label}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-300 text-[10px] font-normal leading-none text-zinc-400 outline-none transition hover:border-zinc-500 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1.5 w-[22rem] max-w-[80vw] rounded-lg bg-zinc-900 px-3 py-2.5 text-left text-xs font-normal leading-relaxed text-zinc-100 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 [&_b]:font-semibold [&_b]:text-white [&_code]:rounded [&_code]:bg-zinc-700 [&_code]:px-1"
      >
        {children}
      </span>
    </span>
  );
}
