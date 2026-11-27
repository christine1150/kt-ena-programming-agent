import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 소개 발표의 예비 캡처(로그인 확인 API로만 제공)를 배포 함수에 함께 싣는다(2026-11-27)
  outputFileTracingIncludes: {
    "/api/intro/fallback/[name]": ["./src/content/intro/fallback/**"],
  },
  // 소개 발표 만화 그림은 한 시간 동안 다시 묻지 않고 쓴다 — 실제 화면(iframe)을 불러오는 동안 그림 재확인 요청이 밀려 늦게 뜨던 문제
  async headers() {
    return [{ source: "/intro/comics/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] }];
  },
};

export default nextConfig;
