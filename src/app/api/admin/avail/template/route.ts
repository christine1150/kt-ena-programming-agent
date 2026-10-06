// 표준 Avail 양식(CSV) 내려받기 (관리자 전용, 단계 06). 예시 행은 합성 데이터이며 실제 계약이 아니다.
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { standardTemplateCsv } from "@/lib/avail/adapters/standard";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  return new NextResponse(standardTemplateCsv(), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="avail-standard-template.csv"` } });
}
