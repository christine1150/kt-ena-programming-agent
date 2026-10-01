// 시청률 자판기 전용 아이콘(사용자 지시 2026-09-30: "귀여운 자판기 아이콘") — 1페이지·2페이지 진입 버튼과
// 화면 안 "편성표 뽑기" 버튼에서 공용. currentColor를 쓰므로 버튼 글자색을 그대로 따른다.

/** 귀여운 자판기: 웃는 얼굴 창, 동전 투입구, 배출구, 버튼. */
export function VendingMachineIcon({ size = 14, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="3.5" />
      <rect x="7" y="5" width="10" height="8" rx="2" />
      <circle cx="10" cy="8.2" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="8.2" r="0.6" fill="currentColor" stroke="none" />
      <path d="M10.2 10.4c1 0.9 2.6 0.9 3.6 0" />
      <path d="M8 16h4" />
      <circle cx="15.5" cy="16" r="0.8" fill="currentColor" stroke="none" />
      <rect x="8" y="18.2" width="8" height="2" rx="1" />
    </svg>
  );
}

/** 캡슐 뽑기 기계: "편성표 뽑기" 버튼용(사용자 지시 2026-10-01: 뽑기 아이콘을 재미있는 것으로). 둥근 유리통 안
 *  알록달록한 캡슐, 손잡이, 떨어지는 캡슐. 버튼에 group 클래스가 있으면 마우스를 올릴 때 손잡이가 돌고 캡슐이 통통 튄다. */
export function GachaIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="9" r="7.2" fill="#fff" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9.4" cy="10.4" r="2.1" fill="#fb7185" />
      <circle cx="14.2" cy="11" r="2.1" fill="#facc15" />
      <circle cx="11.9" cy="6.9" r="2.1" fill="#38bdf8" />
      <circle cx="15.3" cy="6.6" r="1.5" fill="#a3e635" />
      <path d="M8.2 6.2a4.6 4.6 0 0 1 2.2-2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" strokeOpacity="0.8" />
      <path d="M6 15.2h12l-1 6.3H7z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <g className="origin-[12px_18.2px] transition-transform duration-500 group-hover:rotate-180">
        <circle cx="12" cy="18.2" r="1.7" fill="currentColor" />
        <path d="M10.6 18.2h2.8" stroke="#18181b" strokeWidth="0.9" strokeLinecap="round" />
      </g>
      <g className="group-hover:animate-bounce">
        <path d="M19.2 19.6a1.9 1.9 0 0 1 3.8 0z" fill="#fb7185" />
        <path d="M19.2 19.6a1.9 1.9 0 0 0 3.8 0z" fill="#fff" />
      </g>
    </svg>
  );
}

/** 동전: "편성표 뽑기" 버튼용. 자판기에 동전을 넣어 뽑는 느낌. */
export function VendingCoinIcon({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 9.3l0.8 1.7 1.8 0.2-1.3 1.2 0.4 1.8-1.7-0.9-1.7 0.9 0.4-1.8-1.3-1.2 1.8-0.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}
