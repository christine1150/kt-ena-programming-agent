"use client";

// 주요 뉴스 "출연자 이슈" 감시 명단 관리 — 사용자 지시(2026-11-15): 코드에 있던 명단을 관리자 화면에서 고친다.
// 한 줄 = 한 작품("구분 | 프로그램 | 이름, 이름"). 저장하면 명단 전체 교체, 다음 날 아침 자동 게시부터 반영된다.
import { useEffect, useState } from "react";
import HelpTip from "./HelpTip";

export default function CastRosterManager() {
  const [rawText, setRawText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<"db" | "code" | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/news/cast");
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (res.ok && body.ok) {
        setRawText(body.rawText);
        setSource(body.source);
      } else {
        setErrors([body.message ?? "명단을 불러오지 못했습니다."]);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(dryRun: boolean) {
    setSaving(true);
    setMessage(null);
    setErrors([]);
    const res = await fetch("/api/admin/news/cast", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawText, dryRun }) });
    const body = await res.json().catch(() => ({ ok: false }));
    setSaving(false);
    if (!res.ok || !body.ok) {
      setErrors(body.errors?.length ? body.errors : [body.message ?? "저장하지 못했습니다."]);
      return;
    }
    if (!dryRun) setSource("db");
    setMessage(dryRun ? `확인: 작품 ${body.programs}개, 감시 대상 ${body.count}건 — 아직 저장되지 않았습니다.` : `저장했습니다(작품 ${body.programs}개, ${body.count}건). 다음 자동 게시부터 반영됩니다.`);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">
        출연자 이슈 감시 명단
        <HelpTip>
          주요 뉴스의 &quot;출연자 이슈&quot;가 이 명단으로 기사를 찾습니다. 자사 작품 출연자의 논란·혐의·하차 같은 위험 기사와 자체 최고 시청률·시즌2 같은 흥행 기사를 고르고, 명단 밖 타사 출연자는 중대 사안·기록 기사만 싣습니다.
        </HelpTip>
      </h2>
      <p className="mb-3 text-xs text-zinc-600">
        한 줄에 한 작품: <code className="rounded bg-zinc-100 px-1">구분 | 프로그램 | 이름, 이름</code>. 구분은 <b>예정</b>(방영 중·예정), <b>지난</b>(지난 작품), <b>솔로</b>(일반인 프로그램 — 이름 없이 프로그램 단위). 한 글자 예명은 본명으로, 다른 낱말과 겹치는 짧은 예명은 빼 두는 편이 오탐이 적습니다.
      </p>
      {source === "code" && <p className="mb-2 text-xs font-medium text-amber-700">아직 저장된 명단이 없어 기본 명단을 보여 줍니다. 저장하면 이 명단이 쓰입니다.</p>}
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        disabled={!loaded}
        placeholder={"예정 | 크래시2 | 이민기, 곽선영\n지난 | 연애박사 | 추영우, 김소현\n솔로 | 나는 SOLO"}
        rows={12}
        className="w-full rounded-lg border border-zinc-200 p-3 font-mono text-xs"
        aria-label="출연자 이슈 감시 명단"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => send(true)} disabled={saving || !rawText.trim()} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-40">
          확인
        </button>
        <button onClick={() => send(false)} disabled={saving || !rawText.trim()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {saving ? "저장 중..." : "명단 저장"}
        </button>
        {message && <span className="text-sm text-emerald-600">{message}</span>}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-red-600" role="alert">
          {errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
