"use client";

// 장르 분류 보완(이상적 1주일 편성용) — 사용자 결정(2026-09-30): "규칙으로 1차 분류한 뒤 관리자가 보완".
// 채널(자사 또는 경쟁채널)을 고르면 최근 12주 방영 프로그램을 편성 분이 많은 순으로 보여주고, 장르를 고르면
// 즉시 관리자 값(MANUAL)으로 저장된다. MATCH/COUNTER·장르 적합도 계산에 쓰인다.
import { useEffect, useState } from "react";

type Row = { canonicalName: string; programName: string; minutes: number; airings: number; genre: string; source: string; note: string | null };
const OWN = [
  { code: "ENA", name: "ENA" },
  { code: "ENA_DRAMA", name: "ENA Drama" },
  { code: "ENA_PLAY", name: "ENA Play" },
  { code: "ENA_STORY", name: "ENA Story" },
  { code: "OLIFE", name: "OLIFE" },
  { code: "ONCE", name: "ONCE" },
  { code: "SKYUHD", name: "skyUHD" },
];
const SOURCE_LABEL: Record<string, string> = { MANUAL: "관리자", FEATURED_CATEGORY: "주요 콘텐츠 분류", OWN_COMMON: "자사 공통", NAVER_SEARCH: "네이버 검색", RULE_KEYWORD: "제목 규칙", NONE: "미분류" };

export default function GenreMapManager() {
  const [owner, setOwner] = useState("ENA");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [onlyUnclassified, setOnlyUnclassified] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch("/api/scheduling/ideal-schedule/options?channel=ENA")
      .then((r) => r.json())
      .then((b) => b.ok && setCompetitors(b.competitors ?? []));
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/program-genre?owner=${encodeURIComponent(owner)}`)
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        setRows(b.ok ? b.rows : []);
        setGenres(b.genres ?? []);
      });
    return () => {
      alive = false;
    };
  }, [owner, reloadKey]);

  async function setGenre(row: Row, genre: string) {
    const r = await fetch("/api/admin/program-genre", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, canonicalName: row.canonicalName, genre }) });
    const j = await r.json();
    if (j.ok) {
      setSavedKey(row.canonicalName);
      setRows((prev) => (prev ? prev.map((x) => (x.canonicalName === row.canonicalName ? { ...x, genre, source: "MANUAL" } : x)) : prev));
    }
  }

  const visible = (rows ?? []).filter((r) => !onlyUnclassified || r.genre === "미분류");
  const totalMin = (rows ?? []).reduce((s, r) => s + r.minutes, 0);
  const classifiedMin = (rows ?? []).filter((r) => r.genre !== "미분류").reduce((s, r) => s + r.minutes, 0);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">장르 분류 보완(AI 스마트 편성용)</h3>
          <p className="text-sm text-zinc-500">제목 규칙으로 1차 분류한 장르를 확인·보완합니다. 편성 시간이 긴 프로그램부터 채우면 효과가 큽니다.</p>
        </div>
        {rows && (
          <p className="text-sm text-zinc-600">
            편성 분 기준 분류율 <span className="font-semibold">{totalMin > 0 ? Math.round((classifiedMin / totalMin) * 100) : 0}%</span>
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm">
          <optgroup label="당사 채널">
            {OWN.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
          {competitors.length > 0 && (
            <optgroup label="경쟁채널">
              {competitors.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600">
          <input type="checkbox" checked={onlyUnclassified} onChange={(e) => setOnlyUnclassified(e.target.checked)} />
          미분류만 보기
        </label>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-sm text-zinc-500 hover:underline">
          새로고침
        </button>
      </div>
      {rows === null ? (
        <p className="mt-3 text-sm text-zinc-400">불러오는 중…</p>
      ) : (
        <div className="mt-3 max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">프로그램</th>
                <th className="px-2 py-1.5 text-right font-medium">12주 편성 분</th>
                <th className="px-2 py-1.5 text-left font-medium">장르</th>
                <th className="px-2 py-1.5 text-left font-medium">출처</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 200).map((r) => (
                <tr key={r.canonicalName} className="border-t border-zinc-100">
                  <td className="px-2 py-1.5 text-zinc-800">{r.programName}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600">
                    {r.minutes.toLocaleString()}분 · {r.airings}회
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={r.genre} onChange={(e) => setGenre(r, e.target.value)} className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-sm">
                      {genres.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    {savedKey === r.canonicalName && <span className="ml-1 text-xs text-emerald-600">저장됨</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-zinc-500">{SOURCE_LABEL[r.source] ?? r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="py-4 text-center text-sm text-zinc-400">표시할 프로그램이 없습니다.</p>}
        </div>
      )}
    </div>
  );
}
