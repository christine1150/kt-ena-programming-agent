"use client";

// 사용자 지시(2026-09-02): "전체 채널 월간 추이(26년8월업데이트).xlsx" 같은 자료를 관리자
// 화면에서 반영 — 원본이 사내 문서보안(DRM)으로 암호화돼 코드로 직접 열 수 없어(원본 복호화
// 사본은 다음 세션에 별도 전달 예정), 당분간은 파일 업로드 파서 대신 이 화면에서 직접 입력하는
// 폼으로 channel_monthly_content_review(20260902150000)를 채운다. 원본 사본이 오면 이 폼을
// 그대로 두고 "파일 올리면 이 폼에 자동으로 채워주는" 파서를 추가로 붙일 수 있다(폼 유지 +
// 업로드 추가).
import { useEffect, useState } from "react";

type Channel = { id: string; code: string; name: string };
type GenreRow = { category: string; avg_rating: string; comparison_pct: string };
type ProgramRow = { category: string; program_name: string; avg_rating: string; comparison_pct: string; note: string };
type MarketRow = { rank: string; channel_name: string; rating: string; change: string };
type SavedEntry = {
  id: string;
  year: number;
  month: number;
  channels: { code: string; name: string } | { code: string; name: string }[] | null;
  updated_at: string;
};

const EMPTY_GENRE: GenreRow = { category: "", avg_rating: "", comparison_pct: "" };
const EMPTY_PROGRAM: ProgramRow = { category: "자체드라마", program_name: "", avg_rating: "", comparison_pct: "", note: "" };
const EMPTY_MARKET: MarketRow = { rank: "", channel_name: "", rating: "", change: "" };

function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function MonthlyContentReviewManager() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelCode, setChannelCode] = useState("");
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [genreRows, setGenreRows] = useState<GenreRow[]>([{ ...EMPTY_GENRE }]);
  const [programRows, setProgramRows] = useState<ProgramRow[]>([{ ...EMPTY_PROGRAM }]);
  const [marketRows, setMarketRows] = useState<MarketRow[]>([{ ...EMPTY_MARKET }]);
  const [narrativeText, setNarrativeText] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedEntries, setSavedEntries] = useState<SavedEntry[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
    loadEntries();
  }, []);

  function loadEntries() {
    fetch("/api/admin/monthly-content-review")
      .then((r) => r.json())
      .then((body) => setSavedEntries(body.ok ? body.entries : []))
      .catch(() => setSavedEntries([]));
  }

  async function loadForEdit(entryId: string) {
    const res = await fetch("/api/admin/monthly-content-review");
    const body = await res.json().catch(() => ({ ok: false }));
    if (!body.ok) return;
    const entry = (body.entries ?? []).find((e: { id: string }) => e.id === entryId);
    if (!entry) return;
    const ch = Array.isArray(entry.channels) ? entry.channels[0] : entry.channels;
    setChannelCode(ch?.code ?? "");
    setYear(entry.year);
    setMonth(entry.month);
    setGenreRows(
      (entry.genre_breakdown ?? []).length > 0
        ? entry.genre_breakdown.map((r: { category: string; avg_rating: number | null; comparison_pct: number | null }) => ({
            category: r.category ?? "",
            avg_rating: r.avg_rating?.toString() ?? "",
            comparison_pct: r.comparison_pct?.toString() ?? "",
          }))
        : [{ ...EMPTY_GENRE }]
    );
    setProgramRows(
      (entry.program_breakdown ?? []).length > 0
        ? entry.program_breakdown.map(
            (r: { category: string; program_name: string; avg_rating: number | null; comparison_pct: number | null; note: string | null }) => ({
              category: r.category ?? "자체드라마",
              program_name: r.program_name ?? "",
              avg_rating: r.avg_rating?.toString() ?? "",
              comparison_pct: r.comparison_pct?.toString() ?? "",
              note: r.note ?? "",
            })
          )
        : [{ ...EMPTY_PROGRAM }]
    );
    setMarketRows(
      (entry.market_top_channels ?? []).length > 0
        ? entry.market_top_channels.map((r: { rank: number | null; channel_name: string; rating: number | null; change: string | null }) => ({
            rank: r.rank?.toString() ?? "",
            channel_name: r.channel_name ?? "",
            rating: r.rating?.toString() ?? "",
            change: r.change ?? "",
          }))
        : [{ ...EMPTY_MARKET }]
    );
    setNarrativeText(entry.narrative_text ?? "");
    setSourceNote(entry.source_note ?? "");
    setMessage(null);
  }

  async function handleSave() {
    if (!channelCode) {
      setMessage("채널을 선택해주세요.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/monthly-content-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelCode,
        year,
        month,
        genreBreakdown: genreRows
          .filter((r) => r.category.trim() !== "")
          .map((r) => ({ category: r.category.trim(), avg_rating: toNum(r.avg_rating), comparison_pct: toNum(r.comparison_pct) })),
        programBreakdown: programRows
          .filter((r) => r.program_name.trim() !== "")
          .map((r) => ({
            category: r.category.trim(),
            program_name: r.program_name.trim(),
            avg_rating: toNum(r.avg_rating),
            comparison_pct: toNum(r.comparison_pct),
            note: r.note.trim() || null,
          })),
        marketTopChannels: marketRows
          .filter((r) => r.channel_name.trim() !== "")
          .map((r) => ({ rank: toNum(r.rank), channel_name: r.channel_name.trim(), rating: toNum(r.rating), change: r.change.trim() || null })),
        narrativeText: narrativeText.trim() || null,
        sourceNote: sourceNote.trim() || null,
      }),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "저장 응답을 읽지 못했습니다." }));
    setSaving(false);
    if (!res.ok || !body.ok) {
      setMessage(body.message ?? "저장에 실패했습니다.");
    } else {
      setMessage(`${year}년 ${month}월 저장 완료.`);
      loadEntries();
    }
  }

  const inputCls = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">월간 콘텐츠 리뷰(장르별·프로그램별 추이)</h2>
      <p className="mb-4 text-sm text-zinc-500">
        PD가 정리한 채널의 월간 시청률 추이(자체드라마·자체예능 본/재방·구매드라마 등 장르별 평균,
        오리지널 타이틀별 월간 추이, 서술형 하이라이트, 시장 TOP10 채널 순위)를 채널+연+월 단위로
        직접 입력합니다. 회차 단위 리포트는 위 &ldquo;PD 수동 회차 리포트&rdquo; 카드를 그대로
        쓰고, 이 카드는 월간 집계용입니다.
      </p>

      {savedEntries !== null && savedEntries.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-medium text-zinc-500">저장된 월(불러와서 수정)</p>
          <div className="flex flex-wrap gap-1.5">
            {savedEntries.map((e) => {
              const ch = Array.isArray(e.channels) ? e.channels[0] : e.channels;
              return (
                <button
                  key={e.id}
                  onClick={() => loadForEdit(e.id)}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                >
                  {ch?.name ?? ch?.code ?? "?"} {e.year}.{e.month}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">채널</p>
          <select value={channelCode} onChange={(e) => setChannelCode(e.target.value)} className={inputCls}>
            <option value="">선택</option>
            {channels.map((c) => (
              <option key={c.id} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">연도</p>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputCls} />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-500">월</p>
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      {/* 장르별 채널 평균 */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-zinc-500">
          장르별 채널 평균 (예: 자체드라마(본), 자체드라마(재), 자체예능(본), 자체예능(재), 구매 드라마, 기타, 채널평균)
        </p>
        {genreRows.map((row, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[2fr_1fr_1fr_auto] gap-1.5">
            <input
              placeholder="카테고리"
              value={row.category}
              onChange={(e) => setGenreRows(genreRows.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="시청률"
              value={row.avg_rating}
              onChange={(e) => setGenreRows(genreRows.map((r, j) => (j === i ? { ...r, avg_rating: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="전월비 %"
              value={row.comparison_pct}
              onChange={(e) => setGenreRows(genreRows.map((r, j) => (j === i ? { ...r, comparison_pct: e.target.value } : r)))}
              className={inputCls}
            />
            <button onClick={() => setGenreRows(genreRows.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-400 hover:text-red-500">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setGenreRows([...genreRows, { ...EMPTY_GENRE }])} className="text-xs text-zinc-500 hover:text-zinc-800">
          + 행 추가
        </button>
      </div>

      {/* 프로그램별 월간 추이 */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-zinc-500">프로그램별 월간 추이(오리지널 드라마·예능 타이틀)</p>
        {programRows.map((row, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[1fr_1.6fr_1fr_1fr_1.6fr_auto] gap-1.5">
            <select
              value={row.category}
              onChange={(e) => setProgramRows(programRows.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))}
              className={inputCls}
            >
              <option value="자체드라마">자체드라마</option>
              <option value="자체예능">자체예능</option>
            </select>
            <input
              placeholder="프로그램명"
              value={row.program_name}
              onChange={(e) => setProgramRows(programRows.map((r, j) => (j === i ? { ...r, program_name: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="시청률"
              value={row.avg_rating}
              onChange={(e) => setProgramRows(programRows.map((r, j) => (j === i ? { ...r, avg_rating: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="전월비 %"
              value={row.comparison_pct}
              onChange={(e) => setProgramRows(programRows.map((r, j) => (j === i ? { ...r, comparison_pct: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="비고"
              value={row.note}
              onChange={(e) => setProgramRows(programRows.map((r, j) => (j === i ? { ...r, note: e.target.value } : r)))}
              className={inputCls}
            />
            <button onClick={() => setProgramRows(programRows.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-400 hover:text-red-500">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setProgramRows([...programRows, { ...EMPTY_PROGRAM }])} className="text-xs text-zinc-500 hover:text-zinc-800">
          + 행 추가
        </button>
      </div>

      {/* 시장 TOP10 채널 순위 */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-zinc-500">시장 TOP 채널 순위(참고용)</p>
        {marketRows.map((row, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[0.6fr_1.4fr_1fr_1fr_auto] gap-1.5">
            <input
              placeholder="순위"
              value={row.rank}
              onChange={(e) => setMarketRows(marketRows.map((r, j) => (j === i ? { ...r, rank: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="채널명"
              value={row.channel_name}
              onChange={(e) => setMarketRows(marketRows.map((r, j) => (j === i ? { ...r, channel_name: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="시청률"
              value={row.rating}
              onChange={(e) => setMarketRows(marketRows.map((r, j) => (j === i ? { ...r, rating: e.target.value } : r)))}
              className={inputCls}
            />
            <input
              placeholder="전월대비(예: ▲1)"
              value={row.change}
              onChange={(e) => setMarketRows(marketRows.map((r, j) => (j === i ? { ...r, change: e.target.value } : r)))}
              className={inputCls}
            />
            <button onClick={() => setMarketRows(marketRows.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-400 hover:text-red-500">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setMarketRows([...marketRows, { ...EMPTY_MARKET }])} className="text-xs text-zinc-500 hover:text-zinc-800">
          + 행 추가
        </button>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-zinc-500">서술형 하이라이트(원문 그대로)</p>
        <textarea
          value={narrativeText}
          onChange={(e) => setNarrativeText(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          placeholder="환경 / 등록 / 상승 여력 등 원문 그대로 붙여넣으세요"
        />
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-medium text-zinc-500">자료 출처(선택)</p>
        <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className={inputCls} placeholder="예: 전체 채널 월간 추이(26년8월업데이트).xlsx" />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
        {message && <span className="text-sm text-zinc-500">{message}</span>}
      </div>
    </div>
  );
}
