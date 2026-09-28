// 2026 추석 연휴 시청률 성과 분석 보고서(핵심판/상세판 PDF)를 내려주는 라우트.
// 사용자 지시(2026-09-28): "다운을 받으면 관리자 모드에서 로그인 이력 내에서 누가 다운로드를
// 받았는지도 로그를 남겨줘" — 그래서 파일을 public/에 두지 않고(정적 파일은 proxy.ts의
// matcher에서 애초에 제외돼 인증·로그 없이 그대로 받힐 수 있음) 이 라우트를 거치게 한다.
// mode=view는 미리보기(로그 없음), mode=download는 첨부 다운로드(로그인 이력에 기록).
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getCurrentSession } from "@/lib/adminAuth";
import { recordDownload } from "@/lib/loginLog";

const REPORT_LABEL = "2026 추석 연휴 시청률 성과 분석";

const FILES: Record<string, { path: string; label: string; filename: string }> = {
  summary: {
    path: path.join(process.cwd(), "assets", "reports", "chuseok-2026", "summary.pdf"),
    label: `${REPORT_LABEL}(핵심판)`,
    filename: "ENA_2026추석_시청률분석_핵심판.pdf",
  },
  detail: {
    path: path.join(process.cwd(), "assets", "reports", "chuseok-2026", "detail.pdf"),
    label: `${REPORT_LABEL}(상세판)`,
    filename: "ENA_2026추석_시청률분석_상세판.pdf",
  },
};

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant");
  const file = variant ? FILES[variant] : undefined;
  if (!file) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const isDownload = searchParams.get("mode") === "download";

  let buffer: Buffer;
  try {
    buffer = await readFile(file.path);
  } catch (err) {
    console.error("추석 보고서 파일 읽기 실패:", err);
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  if (isDownload) {
    const actorId = session.role === "admin" ? session.adminId : session.pdId;
    const actorName = session.role === "admin" ? session.email : session.name;
    await recordDownload({
      role: session.role,
      actorId,
      actorName,
      detail: file.label,
      request,
    });
  }

  const disposition = isDownload
    ? `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`
    : "inline";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
      // mode=download는 캐시하면 안 된다 — 캐시되면 두 번째 클릭부터 브라우저가 서버를 다시
      // 부르지 않고 캐시에서 바로 내려줘 다운로드 이력이 전혀 쌓이지 않는다(로컬 검토 중 실측:
      // 같은 URL로 4번 눌러도 login_log에 1건도 안 남았음). mode=view는 어차피 페이지 넘길
      // 때마다 URL(fragment)이 달라 캐시 이득이 있으니 그대로 둔다.
      "Cache-Control": isDownload ? "no-store" : "private, max-age=3600",
    },
  });
}
