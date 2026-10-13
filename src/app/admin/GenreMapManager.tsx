"use client";

// 장르 분류 보완(이상적 1주일 편성용) — 사용자 결정(2026-09-30): "규칙으로 1차 분류한 뒤 관리자가 보완".
// 채널(자사 또는 경쟁채널)을 고르면 최근 12주 방영 프로그램을 편성 분이 많은 순으로 보여주고, 장르를 고르면
// 즉시 관리자 값(MANUAL)으로 저장된다. MATCH/COUNTER·장르 적합도 계산에 쓰인다.
import { useEffect, useState } from "react";
import { formatCoverage } from "@/lib/admin/genreCoverage";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

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
const SOURCE_LABEL: Record<string, string> = { MANUAL: "관리자", FEATURED_CATEGORY: "주요 콘텐츠 분류", OWN_COMMON: "자사 공통", NAVER_SEARCH: "네이버·다음 검색", RULE_KEYWORD: "제목 규칙", NONE: "미분류" };

export default function GenreMapManager() {
  const [owner, setOwner] = useState("ENA");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [onlyUnclassified, setOnlyUnclassified] = useState(true);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savedExtra, setSavedExtra] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchMissOnly, setSearchMissOnly] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkGenre, setBulkGenre] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

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
      setSavedExtra(Number(j.propagated) || 0);
      setRows((prev) => (prev ? prev.map((x) => (x.canonicalName === row.canonicalName ? { ...x, genre, source: "MANUAL" } : x)) : prev));
    }
  }

  // 사용자 지시(2026-10-14): "네이버가 찾지 못함" 필터 — 네이버(·다음) 검색을 거쳤지만 일치하는 방송 정보가 없어 미분류로 남은 것.
  const isSearchMiss = (r: Row) => r.genre === "미분류" && !!r.note?.includes("일치하는 방송 정보 없음");
  const visible = (rows ?? []).filter((r) => (!onlyUnclassified || r.genre === "미분류") && (!searchMissOnly || isSearchMiss(r)));
  // 일괄 지정: 입력한 글자가 제목에 들어 있는 미분류 프로그램(공백·부호 무시). 현재 필터와 무관하게 이 채널의 미분류 전체가 대상이다.
  const bulkKey = normalizeProgramCanonicalName(bulkText);
  const bulkMatches = bulkKey.length >= 2 ? (rows ?? []).filter((r) => r.genre === "미분류" && r.canonicalName.includes(bulkKey)) : [];

  async function applyBulk() {
    if (!bulkGenre || bulkMatches.length === 0) return;
    if (!window.confirm(`제목에 "${bulkText.trim()}"이(가) 들어간 미분류 ${bulkMatches.length}개를 모두 "${bulkGenre}"로 지정합니다. 같은 이름의 다른 채널에도 반영됩니다. 진행할까요?`)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const r = await fetch("/api/admin/program-genre/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, genre: bulkGenre, canonicalNames: bulkMatches.map((m) => m.canonicalName) }) });
      const j = await r.json();
      if (j.ok) {
        setBulkMsg(`${j.saved}개 저장${j.propagated ? ` · 다른 채널 ${j.propagated}곳에도 반영` : ""}${j.skipped ? ` · ${j.skipped}개는 이미 장르가 있어 제외` : ""}`);
        setBulkText("");
        setReloadKey((k) => k + 1);
      } else {
        setBulkMsg(j.message ?? "저장하지 못했습니다.");
      }
    } catch {
      setBulkMsg("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBulkBusy(false);
    }
  }
  const totalMin = (rows ?? []).reduce((s, r) => s + r.minutes, 0);
  const classifiedMin = (rows ?? []).filter((r) => r.genre !== "미분류").reduce((s, r) => s + r.minutes, 0);
  // 단계 05: 반올림으로 100%처럼 보이지 않게 내림하고 미분류 건수·분을 함께 표시한다.
  const coverage = formatCoverage({ classifiedMinutes: classifiedMin, totalMinutes: totalMin, unclassifiedCount: (rows ?? []).filter((r) => r.genre === "미분류").length });

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-zinc-900">장르 분류 보완(AI 스마트 편성용)</h3>
          <p className="text-sm text-zinc-500">제목 규칙·네이버·다음 검색으로 1차 분류한 장르를 확인·보완합니다. 한 채널에서 고치면 같은 이름의 다른 채널에도 반영됩니다(자사 오리지널은 자사 채널끼리만). 네이버 검색은 매주 월요일 아침 7시에 자동으로 다시 돕니다.</p>
        </div>
        {rows && (
          <p className="text-sm text-zinc-600">
            편성 분 기준 분류율 <span className="font-semibold">{coverage.text}</span>
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
        <label className="flex items-center gap-1.5 text-sm text-zinc-600" title="네이버(·다음) 검색을 했지만 일치하는 방송 정보가 없어 미분류로 남은 프로그램">
          <input type="checkbox" checked={searchMissOnly} onChange={(e) => setSearchMissOnly(e.target.checked)} />
          네이버가 찾지 못함{rows ? ` (${rows.filter(isSearchMiss).length})` : ""}
        </label>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-sm text-zinc-500 hover:underline">
          새로고침
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-700">일괄 지정</span>
        <span className="text-zinc-500">제목에</span>
        <input
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder="예: 트롯"
          aria-label="일괄 지정할 제목 글자"
          className="w-36 rounded-md border border-zinc-300 bg-white px-2 py-1"
        />
        <span className="text-zinc-500">가 들어간 미분류를</span>
        <select value={bulkGenre} onChange={(e) => setBulkGenre(e.target.value)} aria-label="일괄 지정할 장르" className="rounded-md border border-zinc-300 bg-white px-1.5 py-1">
          <option value="">장르 선택</option>
          {genres.filter((g) => g !== "미분류").map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={applyBulk}
          disabled={bulkBusy || !bulkGenre || bulkMatches.length === 0}
          title={!bulkGenre ? "장르를 먼저 선택하세요" : bulkMatches.length === 0 ? "제목에 두 글자 이상 입력하면 해당하는 미분류 프로그램이 집계됩니다" : undefined}
          className="rounded-md bg-zinc-900 px-3 py-1 text-white disabled:opacity-40"
        >
          {bulkBusy ? "저장 중…" : `${bulkMatches.length}개 지정`}
        </button>
        {bulkKey.length >= 2 && bulkMatches.length > 0 && (
          <span className="text-xs text-zinc-500">
            예: {bulkMatches.slice(0, 3).map((m) => m.programName).join(", ")}
            {bulkMatches.length > 3 ? ` 외 ${bulkMatches.length - 3}개` : ""}
          </span>
        )}
        {bulkKey.length >= 2 && bulkMatches.length === 0 && <span className="text-xs text-zinc-500">해당하는 미분류 프로그램이 없습니다.</span>}
        {bulkMsg && <span className="text-xs text-emerald-700" role="status">{bulkMsg}</span>}
      </div>
      {rows === null ? (
        <p className="mt-3 text-sm text-zinc-400" role="status">불러오는 중…</p>
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
                    {savedKey === r.canonicalName && <span className="ml-1 text-xs text-emerald-600">저장됨{savedExtra > 0 ? ` · 같은 프로그램 ${savedExtra}곳에도 반영` : ""}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-zinc-500">{r.source === "MANUAL" && r.note?.startsWith("같은 프로그램 공통") ? "같은 프로그램 공통" : (SOURCE_LABEL[r.source] ?? r.source)}</td>
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
