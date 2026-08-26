// 관리자 전용 — /api/ask가 답을 못 찾은 질문(사각지대)을 최신순으로 보여준다.
// (2026-08-26 사용자 지시: /api/ask Intent 확장 프로젝트의 주간 점검 자료)
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";

export default async function AskGapsPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const { data: logs, error } = await supabase
    .from("ask_unsupported_log")
    .select("id, question, reason, asker_role, asker_name, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">질문하기 사각지대</h1>
            <p className="text-sm text-zinc-500">
              AI 편성 비서가 답을 못 찾은 질문 최근 300건 (최신순) — Intent 확장 우선순위 판단용
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            관리자 화면으로
          </Link>
        </div>

        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
          {error ? (
            <p className="p-6 text-sm text-red-600">
              사각지대 로그를 불러오지 못했습니다: {error.message}
            </p>
          ) : !logs || logs.length === 0 ? (
            <p className="p-6 text-sm text-zinc-400">아직 쌓인 미지원 질문이 없습니다.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">시간</th>
                  <th className="px-4 py-3 font-medium">질문한 사람</th>
                  <th className="px-4 py-3 font-medium">질문</th>
                  <th className="px-4 py-3 font-medium">사유</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                      {new Date(log.created_at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {log.asker_name ?? "-"}
                      {log.asker_role ? ` (${log.asker_role === "admin" ? "관리자" : "PD"})` : ""}
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{log.question}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {log.reason === "no_intent_matched"
                        ? "매칭되는 Intent 없음"
                        : log.reason === "missing_required_parameter"
                          ? "필수 파라미터 부족"
                          : log.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
