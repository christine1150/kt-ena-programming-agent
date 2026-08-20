"use client";

// 채널별 연도별 목표 시청률을 직접 보고 수정하는 위젯.
// (아직 실제 "목표 시청률 업로드 파일" 형식이 없어서, 화면에서 직접 입력하는 방식으로 만들었다.
//  2026년 값은 Channel Master 업로드로 이미 채워져 있고, 그다음 해부터는 이 화면에서 관리한다.)
import { useEffect, useState } from "react";

type Row = {
  channelId: string;
  code: string;
  name: string;
  primaryTarget: string;
  targetRank: string | null;
  targetRating: number | null;
};

export default function TargetGoalsManager() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, { rank: string; rating: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/admin/target-goals?year=${year}`);
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!res.ok || !body.ok) {
        setErrorMessage(body.message ?? "불러오지 못했습니다.");
      } else {
        setRows(body.rows);
        setErrorMessage(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  function startEdit(row: Row) {
    setEditing((prev) => ({
      ...prev,
      [row.channelId]: {
        rank: row.targetRank ?? "",
        rating: row.targetRating !== null ? String(row.targetRating) : "",
      },
    }));
  }

  async function save(row: Row) {
    const draft = editing[row.channelId];
    if (!draft) return;
    const rating = parseFloat(draft.rating);
    if (Number.isNaN(rating)) {
      setErrorMessage(`${row.name}: 목표 시청률은 숫자로 입력해주세요.`);
      return;
    }

    setSavingId(row.channelId);
    const res = await fetch("/api/admin/target-goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: row.channelId, year, targetRank: draft.rank, targetRating: rating }),
    });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "저장 실패");
    } else {
      setRows((prev) =>
        prev.map((r) =>
          r.channelId === row.channelId ? { ...r, targetRank: draft.rank || null, targetRating: rating } : r
        )
      );
      setEditing((prev) => {
        const next = { ...prev };
        delete next[row.channelId];
        return next;
      });
      setErrorMessage(null);
    }
    setSavingId(null);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">목표 시청률 관리</h2>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setYear((y) => y - 1)}
            className="rounded border border-zinc-200 px-2 py-1 text-zinc-600 hover:bg-zinc-50"
          >
            ◀
          </button>
          <span className="font-medium text-zinc-800">{year}년</span>
          <button
            onClick={() => setYear((y) => y + 1)}
            className="rounded border border-zinc-200 px-2 py-1 text-zinc-600 hover:bg-zinc-50"
          >
            ▶
          </button>
        </div>
      </div>
      <p className="mb-4 text-sm text-zinc-500">
        채널별 목표 시청률·목표 등위를 연도별로 직접 입력/수정합니다. 2026년 값은 Channel Master
        업로드로 이미 채워져 있습니다.
      </p>

      {loading ? (
        <p className="text-sm text-zinc-400">불러오는 중...</p>
      ) : (
        <>
          {errorMessage && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th className="pb-1 font-medium">채널</th>
                <th className="pb-1 font-medium">KPI 타깃</th>
                <th className="pb-1 font-medium">목표 등위</th>
                <th className="pb-1 font-medium">목표 시청률</th>
                <th className="pb-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = editing[row.channelId];
                return (
                  <tr key={row.channelId} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-800">{row.name}</td>
                    <td className="py-1.5 text-zinc-500">{row.primaryTarget}</td>
                    {draft ? (
                      <>
                        <td className="py-1.5">
                          <input
                            value={draft.rank}
                            onChange={(e) =>
                              setEditing((p) => ({ ...p, [row.channelId]: { ...draft, rank: e.target.value } }))
                            }
                            className="w-20 rounded border border-zinc-200 px-1.5 py-0.5"
                          />
                        </td>
                        <td className="py-1.5">
                          <input
                            value={draft.rating}
                            onChange={(e) =>
                              setEditing((p) => ({ ...p, [row.channelId]: { ...draft, rating: e.target.value } }))
                            }
                            className="w-24 rounded border border-zinc-200 px-1.5 py-0.5"
                          />
                        </td>
                        <td className="py-1.5">
                          <button
                            onClick={() => save(row)}
                            disabled={savingId === row.channelId}
                            className="rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
                          >
                            저장
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-1.5 text-zinc-600">{row.targetRank ?? "—"}</td>
                        <td className="py-1.5 text-zinc-600">{row.targetRating ?? "—"}</td>
                        <td className="py-1.5">
                          <button
                            onClick={() => startEdit(row)}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                          >
                            수정
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
