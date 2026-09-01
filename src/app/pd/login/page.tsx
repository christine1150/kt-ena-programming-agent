"use client";

// PD 개별 로그인 화면 — 이름/비밀번호를 입력받아 /api/pd/login 을 호출한다.
// admin/login과 동일한 구조, 라벨만 이메일→이름으로 바꿨다.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PdLoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    const res = await fetch("/api/pd/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const body = await res.json().catch(() => ({ ok: false }));

    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "로그인에 실패했습니다.");
      setSubmitting(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-100"
      >
        <h1 className="mb-1 text-xl font-semibold text-zinc-900">PD 로그인</h1>
        <p className="mb-6 text-sm text-zinc-500">이름과 비밀번호로 로그인하세요.</p>

        <label className="mb-1 block text-sm font-medium text-zinc-700">이름</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          placeholder="홍길동"
        />

        <label className="mb-1 block text-sm font-medium text-zinc-700">비밀번호</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
          placeholder="비밀번호"
        />

        {errorMessage && <p className="mb-4 text-sm text-red-600">{errorMessage}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {submitting ? "로그인 중..." : "로그인"}
        </button>

        {/* 사용자 지시(2026-09-02): 로그인 안 한 방문자는 이제 /access-denied가 아니라 이 화면으로
            바로 오므로, 그 페이지가 하던 "관리자이신가요?" 안내를 여기로 옮겨 관리자 접근 경로가
            없어지지 않게 한다. */}
        <p className="mt-4 text-center text-xs text-zinc-400">
          관리자이신가요?{" "}
          <Link href="/admin/login" className="font-medium text-zinc-600 hover:underline">
            관리자 로그인
          </Link>
        </p>
      </form>
    </div>
  );
}
