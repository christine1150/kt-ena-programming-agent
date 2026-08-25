"use client";

// 사용자 지시(2026-08-25): "요일 별 리뷰 프로그램" 화이트리스트를 채널기본정보.xlsx 시트와
// 같은 형태(분류|타이틀|본방 채널|동시방송|직후 재방|첫 방송일자|매주 반복 편성|예상 회차|
// 종영일)로 관리자 화면에서도 볼 수 있게. 편집은 여전히 ChannelMasterUploader(엑셀 재업로드,
// 매번 전체 교체)로만 하고, 이 컴포넌트는 조회 전용이다.
import { useEffect, useState } from "react";

interface ReviewProgramRow {
  id: string;
  dayLabel: string;
  programName: string;
  category: string | null;
  broadcastChannelName: string | null;
  simulcastChannelName: string | null;
  rerunChannelName: string | null;
  broadcastTime: string | null;
  note: string | null;
  firstBroadcastDate: string | null;
  expectedEpisodeCount: string | null;
  seriesEndDate: string | null;
}

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

export default function OriginalReviewProgramsManager() {
  const [rows, setRows] = useState<ReviewProgramRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/original-review-programs")
      .then((res) => res.json())
      .then((body) => {
        if (!body.ok) {
          setErrorMessage(body.message ?? "조회에 실패했습니다.");
        } else {
          setRows(body.rows);
        }
      })
      .catch(() => setErrorMessage("조회 중 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, []);

  // 요일 여러 개에 걸치는 프로그램(예: 월·화 22:00)은 원본 시트에서 요일별로 한 행씩 나뉘어
  // 들어오므로, 화면에서는 같은 프로그램명+시간을 다시 하나로 묶어 요일을 합쳐 보여준다
  // (시트 원형과 가장 가깝게).
  const grouped = new Map<string, ReviewProgramRow[]>();
  for (const r of rows ?? []) {
    const key = `${r.programName}__${r.broadcastTime ?? ""}`;
    (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(r);
  }
  const merged = [...grouped.values()].map((group) => ({
    ...group[0],
    days: [...new Set(group.map((g) => g.dayLabel))].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
  }));

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">요일 별 리뷰 프로그램 (현재 반영된 화이트리스트)</h2>
      <p className="mb-4 text-sm text-zinc-500">
        채널기본정보.xlsx의 &quot;요일 별 리뷰 프로그램&quot; 시트가 반영된 결과입니다(조회 전용 — 수정은 엑셀을 고쳐
        위 채널기본정보 업로드로 다시 올려주세요, 매번 전체 교체됩니다).
      </p>
      {loading && <p className="text-sm text-zinc-400">불러오는 중...</p>}
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-zinc-400">아직 반영된 화이트리스트가 없습니다.</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-400">
                <th className="py-1.5 pr-2 font-medium">분류</th>
                <th className="py-1.5 pr-2 font-medium">타이틀</th>
                <th className="py-1.5 pr-2 font-medium">본방 채널</th>
                <th className="py-1.5 pr-2 font-medium">동시방송</th>
                <th className="py-1.5 pr-2 font-medium">직후 재방</th>
                <th className="py-1.5 pr-2 font-medium">첫 방송일자</th>
                <th className="py-1.5 pr-2 font-medium">매주 반복 편성</th>
                <th className="py-1.5 pr-2 font-medium">예상 회차</th>
                <th className="py-1.5 font-medium">종영일</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 text-zinc-700">
                  <td className="py-1.5 pr-2">{r.category ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-medium text-zinc-900">{r.programName}</td>
                  <td className="py-1.5 pr-2">{r.broadcastChannelName ?? "—"}</td>
                  <td className="py-1.5 pr-2">{r.simulcastChannelName ?? "—"}</td>
                  <td className="py-1.5 pr-2">{r.rerunChannelName ?? "—"}</td>
                  <td className="py-1.5 pr-2">{r.firstBroadcastDate ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    매주 {r.days.join("·")} {r.broadcastTime ? r.broadcastTime.slice(0, 5) : "(시간 미인식)"}
                  </td>
                  <td className="py-1.5 pr-2">{r.expectedEpisodeCount ?? "—"}</td>
                  <td className="py-1.5">{r.seriesEndDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
