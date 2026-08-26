"use client";

// PD 수동 회차 리포트 업로드 위젯 — 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는
// 내가 작성한 보고서 내용으로 덮어써서 반영하자." PD가 매주 직접 작성하는 "26년 오리지널
// 드라마시청률분석-XXX N회.xlsx"를 채널과 함께 올리면, 그 안의 분당 시청률·헤드라인 문구·
// 동시간대 경쟁 순위를 저장해 Page 1이 자동 계산 대신 우선 보여준다.
import { useEffect, useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type Channel = { id: string; code: string; name: string };
type SavedEpisode = { episodeNumber: number; broadcastDate: string };

export default function ManualDramaReportUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelCode, setChannelCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState<SavedEpisode[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
  }, []);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setErrorMessage("업로드할 파일을 먼저 선택해주세요.");
      return;
    }
    if (!channelCode) {
      setErrorMessage("채널을 먼저 선택해주세요.");
      return;
    }

    setUploading(true);
    setErrorMessage(null);
    setSaved(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("channelCode", channelCode);

    const res = await fetch("/api/admin/upload/manual-drama-report", { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));

    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "업로드에 실패했습니다.");
    } else {
      setSaved(body.saved);
    }
    setUploading(false);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">PD 수동 회차 리포트 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        &ldquo;26년 오리지널드라마시청률분석-OOO N회.xlsx&rdquo; 형식의 회차 리포트를 채널과 함께 올리면,
        1페이지 주요 컨텐츠 리뷰가 그 회차·날짜에 대해 자동 계산 대신 이 리포트의 분당 시청률·헤드라인
        문구·동시간대 경쟁 순위를 우선 보여줍니다(같은 채널·프로그램·날짜로 다시 올리면 최신 내용으로
        덮어씁니다).
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={channelCode}
          onChange={(e) => setChannelCode(e.target.value)}
          className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
        >
          <option value="">채널 선택</option>
          {channels.map((c) => (
            <option key={c.id} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <FileInputTrigger inputRef={fileInputRef} accept=".xlsx" />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {uploading ? "업로드 중..." : "업로드"}
        </button>
      </div>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {saved && (
        <p className="text-sm text-zinc-600">
          저장 완료: {saved.map((s) => `${s.broadcastDate} ${s.episodeNumber}회`).join(", ")}
        </p>
      )}
    </div>
  );
}
