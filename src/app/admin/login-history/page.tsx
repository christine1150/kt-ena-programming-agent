// 관리자 전용 — 관리자·PD 로그인 이력을 최신순으로 보여준다.
// (proxy.ts가 /admin/* 전체를 관리자 세션 기준으로 이미 막아주지만, 직접 접근 시나리오
//  대비 이중 확인은 다른 /admin 하위 화면과 동일하게 유지한다)
import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";

export default async function LoginHistoryPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const { data: logs, error } = await supabase
    .from("login_log")
    .select("id, role, actor_name, ip, user_agent, logged_in_at")
    .order("logged_in_at", { ascending: false })
    .limit(300);

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">로그인 이력</h1>
            <p className="text-sm text-zinc-500">관리자·PD 로그인 최근 300건 (최신순)</p>
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
              로그인 이력을 불러오지 못했습니다: {error.message}
            </p>
          ) : !logs || logs.length === 0 ? (
            <p className="p-6 text-sm text-zinc-400">아직 로그인 이력이 없습니다.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">시간</th>
                  <th className="px-4 py-3 font-medium">구분</th>
                  <th className="px-4 py-3 font-medium">이름</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">기기/브라우저</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                      {new Date(log.logged_in_at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          log.role === "admin"
                            ? "bg-zinc-900 text-white"
                            : "bg-zinc-100 text-zinc-700"
                        }`}
                      >
                        {log.role === "admin" ? "관리자" : "PD"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-900">{log.actor_name}</td>
                    <td className="px-4 py-3 text-zinc-500">{log.ip ?? "-"}</td>
                    <td
                      className="max-w-xs truncate px-4 py-3 text-zinc-400"
                      title={log.user_agent ?? undefined}
                    >
                      {log.user_agent ?? "-"}
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
