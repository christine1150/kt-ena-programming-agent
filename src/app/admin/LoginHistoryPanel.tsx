// 관리자 화면 안의 접이식 로그인 이력(서버 컴포넌트) — 별도 페이지(/admin/login-history)를 없애고 옮겨 왔다(사용자 요청 2026-10-22).
// 핵심은 "누가 언제 접속했는가"라 시간·이름·구분·유형만 크게, 자료·IP·기기는 작은 글씨+말줄임(전체는 마우스오버)로 한 줄에 한 건씩 보여 준다.
import { supabase } from "@/lib/supabase";

const EVENT_LABEL: Record<string, { text: string; cls: string }> = {
  access: { text: "접속(세션)", cls: "bg-amber-50 text-amber-700" },
  download: { text: "다운로드", cls: "bg-sky-50 text-sky-700" },
  login: { text: "로그인", cls: "bg-emerald-50 text-emerald-700" },
};

// "10/22 11:03:57" — 연도는 생략하고 KST 24시간제로 짧게.
function formatKst(iso: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export default async function LoginHistoryPanel() {
  const { data: logs, error } = await supabase
    .from("login_log")
    .select("id, role, actor_name, ip, user_agent, logged_in_at, event_type, detail")
    .order("logged_in_at", { ascending: false })
    .limit(300);

  return (
    <details className="group rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4">
        <span>
          <span className="text-lg font-semibold text-zinc-900">로그인 이력</span>
          <span className="ml-2 text-xs text-zinc-400">관리자·PD 접속 최근 300건 (최신순)</span>
        </span>
        <span className="text-xs text-zinc-400 group-open:hidden">펼치기 ▾</span>
        <span className="hidden text-xs text-zinc-400 group-open:inline">접기 ▴</span>
      </summary>

      <div className="border-t border-zinc-100">
        {error ? (
          <p className="p-6 text-sm text-red-600">로그인 이력을 불러오지 못했습니다: {error.message}</p>
        ) : !logs || logs.length === 0 ? (
          <p className="p-6 text-sm text-zinc-400">아직 로그인 이력이 없습니다.</p>
        ) : (
          // dense-grid: 전역 표 줄바꿈 규칙의 예외(한 줄 유지). 세로로 길어지므로 안에서 스크롤한다.
          <div className="dense-grid max-h-[28rem] overflow-auto" tabIndex={0} role="region" aria-label="로그인 이력 표">
            <table className="w-full min-w-[760px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[8.5rem]" />
                <col className="w-[11rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-[6rem]" />
                <col className="w-[7.5rem]" />
                <col />
              </colgroup>
              <thead className="sticky top-0 bg-white text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th className="whitespace-nowrap px-4 py-2 font-medium">시간</th>
                  <th className="whitespace-nowrap px-2 py-2 font-medium">이름</th>
                  <th className="whitespace-nowrap px-2 py-2 font-medium">구분</th>
                  <th className="whitespace-nowrap px-2 py-2 font-medium">유형</th>
                  <th className="whitespace-nowrap px-2 py-2 font-medium">IP</th>
                  <th className="whitespace-nowrap px-2 py-2 font-medium">자료 · 기기</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const ev = EVENT_LABEL[log.event_type ?? "login"] ?? EVENT_LABEL.login;
                  const extra = [log.detail, log.user_agent].filter(Boolean).join(" · ");
                  return (
                    <tr key={log.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50">
                      <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-zinc-700">{formatKst(log.logged_in_at)}</td>
                      <td className="truncate whitespace-nowrap px-2 py-1.5 font-medium text-zinc-900" title={log.actor_name ?? undefined}>
                        {log.actor_name}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${log.role === "admin" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"}`}>
                          {log.role === "admin" ? "관리자" : "PD"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ev.cls}`}>{ev.text}</span>
                      </td>
                      <td className="truncate whitespace-nowrap px-2 py-1.5 text-xs tabular-nums text-zinc-500">{log.ip ?? "-"}</td>
                      <td className="truncate whitespace-nowrap px-2 py-1.5 text-[11px] text-zinc-400" title={extra || undefined}>
                        {extra || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
