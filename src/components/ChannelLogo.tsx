// 채널 로고 표시 공통 컴포넌트 (Page 1 대시보드 + Page 2 채널 헤더에서 공용으로 쓴다).
//
// 로고 PNG마다 투명 여백 비율이 달라(사용자 확인: ENA/OLIFE/skyUHD는 여백이 거의 없는 반면
// ENA Play/ENA Drama/ENA Story/ONCE는 이미지의 70~85%가 투명 여백), 같은 렌더링 높이로
// 그리면 실제 "색이 있는 부분"의 높이가 채널마다 다르게 보인다. channels.logo_visible_ratio/
// logo_visible_top_ratio(관리자 화면에서 Channel Master 업로드 시 자동 계산, src/lib/logoColor.ts
// 참고)를 이용해 이미지를 확대한 뒤 overflow:hidden으로 잘라내, "보이는 부분"의 높이를
// 기준 채널(ENA)과 동일하게 맞춘다. 픽셀 단위로 잘라내는 크롭이 필요해 next/image 대신
// 일반 img 태그를 쓴다(로고 파일 자체가 작아 최적화 이득이 크지 않음).
export interface ChannelLogoInfo {
  logoPath: string | null;
  name: string;
  logoVisibleRatio: number | null;
  logoVisibleTopRatio: number | null;
  /** 사용자 지시(2026-09-02): 1페이지 전용 가로형 로고 교체에 채널 코드로 매칭하기 위해 추가.
   * Page 2(사이드바/채널 헤더)는 이 필드를 안 넘기거나 preferWideLogo를 안 켜면 기존 그대로다. */
  code?: string;
}

// 사용자 지시(2026-09-02): "ENA Drama, ENA Play, ENA Story는 1페이지에서만... 가로형 로고를
// 사용할 것" — 세로/정방형 로고는 투명 여백 비율(logoVisibleRatio 등)이 DB에 그 파일 기준으로
// 계산돼 있어, 다른 파일(가로형)로 바꿔치기하면 그 크롭 수치가 안 맞는다. 가로형 로고는 크롭
// 계산 없이 그냥 object-fit: contain으로 통째로 보여주는 별도 분기로 처리해 이 문제를 피한다.
const WIDE_LOGO_OVERRIDE: Record<string, string> = {
  ENA_DRAMA: "/channel-logos/ENA_DRAMA_H.png",
  ENA_PLAY: "/channel-logos/ENA_PLAY_H.png",
  ENA_STORY: "/channel-logos/ENA_STORY_H.png",
};

export function ChannelLogo({
  channel,
  reference,
  heightPx = 32,
  maxWidthPx,
  className,
  preferWideLogo,
}: {
  channel: ChannelLogoInfo;
  /** "보이는 부분" 높이의 기준이 되는 채널(보통 ENA). 없으면 이 채널 자신을 기준으로 삼는다. */
  reference?: ChannelLogoInfo | null;
  heightPx?: number;
  /** 사용자 지시(2026-08-20): ONCE/skyUHD처럼 원본 로고 가로 비율이 유난히 넓어(§텅 빈
   * 여백 아니라 실제 워드마크가 옆으로 긺) 높이 맞춤만으로는 좁은 flex 줄에서 오른쪽이
   * 잘리는 채널을 위해, 폭 상한을 지정하면 그 폭 안에 꽉 채워(object-fit: contain) 넣는다
   * — 이 경우 "보이는 부분 높이 통일" 대신 "폭 통일"을 우선한다(잘림 방지가 목적). */
  maxWidthPx?: number;
  className?: string;
  /** 사용자 지시(2026-09-02): 1페이지에서만 켠다(Page 2는 안 켜서 기존 세로형 로고 그대로 유지). */
  preferWideLogo?: boolean;
}) {
  if (!channel.logoPath) {
    return (
      <div style={{ height: heightPx }} className={`flex items-center text-sm font-semibold text-zinc-700 ${className ?? ""}`}>
        {channel.name}
      </div>
    );
  }

  const wideOverrideSrc = preferWideLogo && channel.code ? WIDE_LOGO_OVERRIDE[channel.code] : undefined;
  if (wideOverrideSrc) {
    return (
      <div
        style={{ height: heightPx, ...(maxWidthPx ? { width: maxWidthPx } : {}) }}
        className={`flex items-center ${maxWidthPx ? "justify-center" : ""} ${className ?? ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 가로형 로고는 크롭 없이 통째로 표시 */}
        <img
          src={wideOverrideSrc}
          alt={channel.name}
          style={{ height: "100%", width: "auto", maxWidth: maxWidthPx ? "100%" : "none", objectFit: "contain", display: "block" }}
        />
      </div>
    );
  }

  const referenceRatio = reference?.logoVisibleRatio ?? channel.logoVisibleRatio ?? 1;
  const ratio = channel.logoVisibleRatio ?? 1;
  const topRatio = channel.logoVisibleTopRatio ?? 0;

  const targetVisiblePx = heightPx * referenceRatio;

  if (maxWidthPx) {
    return (
      <div style={{ height: targetVisiblePx, width: maxWidthPx, overflow: "hidden" }} className={`flex items-center justify-center ${className ?? ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- 폭 상한 안에 object-fit으로 맞춰야 함 */}
        <img
          src={channel.logoPath}
          alt={channel.name}
          style={{ maxHeight: "100%", maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block" }}
        />
      </div>
    );
  }

  const scaledImageHeight = ratio > 0 ? targetVisiblePx / ratio : heightPx;
  const offsetPx = topRatio * scaledImageHeight;

  return (
    <div style={{ height: targetVisiblePx, overflow: "hidden" }} className={`flex items-center ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 픽셀 단위 크롭이 필요해 next/image 대신 사용 */}
      <img
        src={channel.logoPath}
        alt={channel.name}
        style={{ height: scaledImageHeight, width: "auto", marginTop: -offsetPx, display: "block", maxWidth: "none" }}
      />
    </div>
  );
}
