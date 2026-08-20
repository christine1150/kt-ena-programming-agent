"use client";

// 관리자 화면에서 PD 공유 링크를 조회/재발급하는 위젯.
import { useEffect, useState } from "react";

export default function ShareLinkManager() {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reissuing, setReissuing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 최초 진입 시 한 번만 현재 활성 링크를 불러온다.
  // (effect 안에서 바로 setState하면 안 된다는 린트 규칙 때문에, 언마운트 후 응답이 와도
  //  상태를 건드리지 않도록 cancelled 플래그로 감싼다)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch("/api/admin/share-link");
      const body = await res.json().catch(() => ({ ok: false }));
      if (cancelled) return;
      if (!res.ok || !body.ok) {
        setErrorMessage(body.message ?? "공유 링크를 불러오지 못했습니다.");
      } else {
        setUrl(body.url);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReissue() {
    const confirmed = window.confirm(
      "재발급하면 기존 링크는 즉시 사용할 수 없게 됩니다. 계속하시겠습니까?"
    );
    if (!confirmed) return;

    setReissuing(true);
    setErrorMessage(null);
    const res = await fetch("/api/admin/share-link", { method: "POST" });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "재발급에 실패했습니다.");
    } else {
      setUrl(body.url);
      setCopied(false);
    }
    setReissuing(false);
  }

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">PD 공유 링크</h2>
      <p className="mb-4 text-sm text-zinc-500">
        이 링크를 PD에게 전달하면, 로그인 없이 Morning Briefing 열람과 자연어 질문이 가능합니다.
      </p>

      {loading ? (
        <p className="text-sm text-zinc-400">불러오는 중...</p>
      ) : (
        <>
          {url && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
              <code className="flex-1 truncate text-sm text-zinc-700">{url}</code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700"
              >
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
          )}
          {errorMessage && <p className="mb-3 text-sm text-red-600">{errorMessage}</p>}
          <button
            onClick={handleReissue}
            disabled={reissuing}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {reissuing ? "재발급 중..." : "링크 재발급"}
          </button>
        </>
      )}
    </div>
  );
}
