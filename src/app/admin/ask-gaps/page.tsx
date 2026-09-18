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

  // 개선안(2026-09-19, Database Optimizer 제안): 300건을 시간순으로만 보여주면 어떤 질문
  // 유형이 자주 실패하는지 관리자가 눈으로 일일이 훑어야 했다 — 없는 값을 추정하는 유사도
  // 매칭 대신, (1) 사유별 정확한 건수 집계와 (2) 질문 문자열이 정확히 같은 것끼리만 묶는
  // 반복 질문 집계 두 가지를 추가한다(둘 다 이미 있는 300건 그대로 클라이언트에서 재집계 —
  // 새 쿼리·새 추정 없음).
  const reasonLabel = (reason: string) =>
    reason === "no_intent_matched" ? "매칭되는 Intent 없음" : reason === "missing_required_parameter" ? "필수 파라미터 부족" : reason;
  const reasonCounts = new Map<string, number>();
  const questionCounts = new Map<string, { question: string; count: number }>();
  for (const log of logs ?? []) {
    reasonCounts.set(log.reason, (reasonCounts.get(log.reason) ?? 0) + 1);
    const key = log.question.trim().toLowerCase();
    const existing = questionCounts.get(key);
    if (existing) existing.count += 1;
    else questionCounts.set(key, { question: log.question.trim(), count: 1 });
  }
  const topReasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);
  const repeatedQuestions = [...questionCounts.values()]
    .filter((q) => q.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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

        {!error && logs && logs.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
              <h2 className="mb-3 text-sm font-semibold text-zinc-700">사유별 건수</h2>
              <div className="flex flex-wrap gap-2">
                {topReasons.map(([reason, count]) => (
                  <span key={reason} className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                    {reasonLabel(reason)} <span className="font-semibold text-zinc-800">{count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
              <h2 className="mb-3 text-sm font-semibold text-zinc-700">자주 반복된 질문(동일 문구 2회 이상)</h2>
              {repeatedQuestions.length === 0 ? (
                <p className="text-xs text-zinc-400">아직 완전히 동일한 문구로 2회 이상 반복된 질문이 없습니다.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {repeatedQuestions.map((q) => (
                    <li key={q.question} className="flex items-center justify-between gap-3 text-xs text-zinc-600">
                      <span className="truncate">{q.question}</span>
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-700">{q.count}회</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

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
