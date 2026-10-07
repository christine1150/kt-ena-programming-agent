// 단계 15 — 사용자 문구 inventory. 소스를 TypeScript AST로 읽어 한글이 들어간 문자열·JSX 글자를 모은다.
// 주석은 AST에 문자열로 잡히지 않으므로 "사용자 지시(…)" 같은 개발 메모가 섞이지 않는다.
// 개발용 도구이며 앱 번들에는 들어가지 않는다(scripts/ 아래).
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type TextKind = "jsx" | "attr" | "string" | "template";
export interface TextItem {
  file: string; // ROOT 기준, 슬래시 경로
  line: number;
  kind: TextKind;
  text: string;
}

const HANGUL = /[가-힣]/;
/** 화면에 나가지 않는 호출의 인자 — 로그·에러·테스트 보조 */
const SILENT_CALLEES = new Set(["log", "warn", "error", "info", "debug", "trace"]);

export function listSourceFiles(root: string, dir = "src"): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

export function extractTexts(file: string, source: string): TextItem[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const items: TextItem[] = [];
  const push = (node: ts.Node, kind: TextKind, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t || !HANGUL.test(t)) return;
    items.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind, text: t });
  };
  const inSilentCall = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
        const obj = p.expression.expression;
        if (ts.isIdentifier(obj) && obj.text === "console" && SILENT_CALLEES.has(p.expression.name.text)) return true;
      }
      if (ts.isFunctionLike(p) || ts.isSourceFile(p)) break;
    }
    return false;
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) push(node, "jsx", node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) && !inSilentCall(node)) {
        push(node, ts.isJsxAttribute(node.parent) ? "attr" : "string", node.text);
      }
    } else if (ts.isTemplateExpression(node)) {
      if (!inSilentCall(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => `{}${s.literal.text}`)].join("");
        push(node, "template", parts);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return items;
}

export function collectInventory(root: string): TextItem[] {
  const all: TextItem[] = [];
  for (const f of listSourceFiles(root)) all.push(...extractTexts(f, fs.readFileSync(path.join(root, f), "utf8")));
  return all;
}

/** 파일 경로 → 영역(화면 경로·컴포넌트·계산 모듈·API) */
export function areaOf(file: string): string {
  if (file.startsWith("src/app/api/")) return "api";
  if (file.startsWith("src/app/")) {
    const m = file.match(/^src\/app\/([^/]+)\//);
    if (!m) return "route:/";
    return m[1] === "page.tsx" ? "route:/" : `route:/${m[1]}`;
  }
  if (file.startsWith("src/components/")) return `component:${file.split("/")[2]}`;
  if (file.startsWith("src/lib/")) return `lib:${file.split("/")[2].replace(/\.(ts|tsx)$/, "")}`;
  return "other";
}
