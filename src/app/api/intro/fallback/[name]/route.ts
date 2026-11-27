// 소개 발표(/intro)의 예비 캡처 — 실제 시청률·실명이 담긴 화면이라 public/에 두지 않고, 로그인한 사람에게만 이 경로로 준다(2026-11-27).
// 파일은 src/content/intro/fallback/ 에 있고, next.config.ts의 outputFileTracingIncludes로 배포 함수에 함께 실린다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/reportSnapshot/http";

const NAME_RE = /^[a-z0-9-]{1,40}\.png$/;

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { name } = await ctx.params;
  if (!NAME_RE.test(name)) return NextResponse.json({ ok: false, message: "잘못된 파일 이름입니다." }, { status: 400 });
  try {
    const buf = await readFile(path.join(process.cwd(), "src", "content", "intro", "fallback", name));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return NextResponse.json({ ok: false, message: "캡처를 찾지 못했습니다." }, { status: 404 });
  }
}
