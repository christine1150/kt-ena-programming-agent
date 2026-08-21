import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // trash-can/은 삭제 대기 중인 임시/보관 파일 폴더(CLAUDE.md 규칙) — 실제 코드가 아니므로
    // lint 대상에서 제외한다(2026-08-21, 빌드도 tsconfig.json exclude로 이미 제외해둠).
    "trash-can/**",
  ]),
]);

export default eslintConfig;
