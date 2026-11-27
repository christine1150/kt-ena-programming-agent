import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 소개 발표의 예비 캡처(로그인 확인 API로만 제공)를 배포 함수에 함께 싣는다(2026-11-27)
  outputFileTracingIncludes: {
    "/api/intro/fallback/[name]": ["./src/content/intro/fallback/**"],
  },
};

export default nextConfig;
