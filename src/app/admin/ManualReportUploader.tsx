"use client";

// PD 수동 회차 리포트 업로드 위젯 — 사용자 지시(2026-08-26): "1페이지 <주요 컨텐츠 리뷰>는
// 내가 작성한 보고서 내용으로 덮어써서 반영하자." PD가 직접 작성한 회차 리포트를 채널과 함께
// 올리면, 그 안의 분당 시청률·헤드라인 문구·동시간대 경쟁 정보를 저장해 Page 1이 자동 계산
// 대신 우선 보여준다.
//
// 통합(사용자 지시 2026-09-01, 관리자 화면 중복 점검): 원래 "PD 수동 회차 리포트 업로드"
// (오리지널 드라마 양식)와 "PD 수동 오리지널예능 리포트 업로드"(나는 SOLO 등 다른 양식)가
// 별도 카드 두 개로 나뉘어 있었다 — 둘은 화면·채널 선택·결과 표시가 사실상 같은 코드였고,
// 저장 대상도 같은 테이블(program_manual_reports, 같은 conflict 키)이며, Page 1의 같은
// 섹션을 채운다. 양식이 다를 뿐인데 PD가 "이 파일은 어느 카드에 올리는 거였지"를 매번
// 판단해야 했고, 잘못 고르면 파싱 실패로 반려됐다. 이제 카드 하나에서 **양식을 자동 판별**
// 한다(드라마 양식으로 먼저 시도 → 그 양식이 아니면 예능 양식으로 재시도). 서버 라우트·파서는
// 둘 다 그대로 두고(각 양식의 검증 로직은 이미 검증된 자산이라 건드리지 않는다) 호출 순서만
// 이 화면이 감춘다.
//
// 부수 효과(개선): 광고 브레이크(중CM) 입력이 드라마 카드에만 있었는데, 저장 API(PATCH)는
// 양식과 무관하게 program_manual_reports.cm_breaks만 갱신하므로 이제 두 양식 모두에서 쓸 수
// 있다 — 나는 SOLO 같은 예능 회차에도 중CM 시각을 넣을 수 있게 됐다.
import { useEffect, useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

type Channel = { id: string; code: string; name: string };
type SavedEpisode = { episodeNumber: number; broadcastDate: string; canonicalNameNormalized: string };
type ReportFormat = "drama" | "original";

const FORMAT_LABEL: Record<ReportFormat, string> = {
  drama: "오리지널 드라마 양식",
  original: "오리지널 예능 양식",
};

export default function ManualReportUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelCode, setChannelCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState<SavedEpisode[] | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<ReportFormat | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 사용자 지시(2026-08-26): "중CM1/중CM2" 등 광고 브레이크 시각 — PD 엑셀의 네이티브 차트
  // 텍스트 상자로만 있어 자동 파싱이 불가능하다(supabase/migrations/20260826190000 참고).
  // 업로드 직후 관리자가 그 차트를 육안으로 보고 한 줄씩 입력하면 별도 PATCH로 저장한다.
  const [cmBreaksText, setCmBreaksText] = useState<Record<string, string>>({});
  const [cmBreaksSaving, setCmBreaksSaving] = useState<string | null>(null);
  const [cmBreaksMessage, setCmBreaksMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/channels")
      .then((r) => r.json())
      .then((body) => setChannels(Array.isArray(body) ? body : (body.channels ?? [])))
      .catch(() => setChannels([]));
  }, []);

  async function postTo(endpoint: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("channelCode", channelCode);
    const res = await fetch(endpoint, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({ ok: false, message: "업로드 응답을 읽지 못했습니다." }));
    return { ok: res.ok && body.ok === true, body } as { ok: boolean; body: { saved?: SavedEpisode[]; message?: string } };
  }

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
    setDetectedFormat(null);

    // 드라마 양식 먼저 시도 → 실패하면 예능 양식으로. 두 파서 모두 "이 양식이 아니다"를
    // 명확한 메시지로 거부하므로(회차 시트/제목 셀 형식 검사) 잘못된 양식이 조용히 저장되는
    // 일은 없다. 둘 다 실패하면 두 메시지를 함께 보여줘 어느 쪽 형식이 어긋났는지 알 수 있게 한다.
    const drama = await postTo("/api/admin/upload/manual-drama-report", file);
    if (drama.ok) {
      setSaved(drama.body.saved ?? []);
      setDetectedFormat("drama");
    } else {
      const original = await postTo("/api/admin/upload/manual-original-report", file);
      if (original.ok) {
        setSaved(original.body.saved ?? []);
        setDetectedFormat("original");
      } else {
        setErrorMessage(
          `어느 양식으로도 읽지 못했습니다.\n· ${FORMAT_LABEL.drama}: ${drama.body.message ?? "실패"}\n· ${FORMAT_LABEL.original}: ${original.body.message ?? "실패"}`
        );
      }
    }
    setUploading(false);
  }

  // "HH:MM 라벨" 한 줄씩(예: "22:38 중CM1") → [{time,label}]. 형식이 안 맞는 줄은 조용히
  // 건너뛴다(억지로 추정하지 않음 — 관리자가 다시 고쳐 쓰면 됨).
  function parseCmBreaksText(text: string): { time: string; label: string }[] {
    return text
      .split("\n")
      .map((line) => {
        const m = line.trim().match(/^(\d{1,2}:\d{2})\s+(.+)$/);
        if (!m) return null;
        const [h, mm] = m[1].split(":");
        return { time: `${h.padStart(2, "0")}:${mm}`, label: m[2].trim() };
      })
      .filter((v): v is { time: string; label: string } => v !== null);
  }

  async function saveCmBreaks(episode: SavedEpisode) {
    const key = `${episode.broadcastDate}-${episode.episodeNumber}`;
    setCmBreaksSaving(key);
    setCmBreaksMessage((prev) => ({ ...prev, [key]: "" }));
    const cmBreaks = parseCmBreaksText(cmBreaksText[key] ?? "");
    // PATCH는 program_manual_reports.cm_breaks만 갱신하고 양식을 따지지 않으므로, 어느 양식으로
    // 저장된 회차든 이 엔드포인트 하나로 처리된다.
    const res = await fetch("/api/admin/upload/manual-drama-report", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelCode, canonicalNameNormalized: episode.canonicalNameNormalized, broadcastDate: episode.broadcastDate, cmBreaks }),
    });
    const body = await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
    setCmBreaksMessage((prev) => ({ ...prev, [key]: !res.ok || !body.ok ? (body.message ?? "저장 실패") : `저장 완료(${cmBreaks.length}건)` }));
    setCmBreaksSaving(null);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">PD 수동 회차 리포트 업로드</h2>
      <p className="mb-4 text-sm text-zinc-500">
        PD가 직접 작성한 회차 리포트를 채널과 함께 올리면, 1페이지 주요 컨텐츠 리뷰가 그 회차·날짜에 대해 자동 계산 대신 이
        리포트의 분당 시청률·헤드라인 문구·동시간대 경쟁 정보를 우선 보여줍니다(같은 채널·프로그램·날짜로 다시 올리면 최신
        내용으로 덮어씁니다). <b>양식은 자동으로 판별</b>합니다 — &ldquo;26년 오리지널드라마시청률분석-OOO N회.xlsx&rdquo;(드라마)와
        &ldquo;ENA ORIGINAL_OOO_본방 시청률_N회(YYYYMMDD).xlsx&rdquo;(나는 SOLO 등 예능) 둘 다 이 카드 하나로 올리면 됩니다.
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

      {errorMessage && <p className="whitespace-pre-line text-sm text-red-600">{errorMessage}</p>}

      {saved && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            {detectedFormat && <span className="mr-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{FORMAT_LABEL[detectedFormat]}</span>}
            저장 완료: {saved.map((s) => `${s.broadcastDate} ${s.episodeNumber}회`).join(", ")}
          </p>
          {/* 사용자 지시(2026-08-26): "중CM1/중CM2" 등은 PD 엑셀의 네이티브 차트를 관리자가
              직접 눈으로 보고 입력해야 한다(자동 파싱 불가) — 업로드 직후 바로 입력할 수 있게. */}
          {saved.map((s) => {
            const key = `${s.broadcastDate}-${s.episodeNumber}`;
            return (
              <div key={key} className="rounded-xl bg-zinc-50 p-3">
                <p className="mb-1 text-xs font-medium text-zinc-500">
                  {s.broadcastDate} {s.episodeNumber}회 — 광고 브레이크 등 주요 이벤트 시각(선택, 엑셀 안 차트를 직접 보고 입력)
                </p>
                <textarea
                  value={cmBreaksText[key] ?? ""}
                  onChange={(e) => setCmBreaksText((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={"한 줄에 하나씩, \"HH:MM 라벨\" 형식 — 예:\n22:38 중CM1\n22:54 중CM2"}
                  rows={3}
                  className="mb-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveCmBreaks(s)}
                    disabled={cmBreaksSaving === key}
                    className="rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {cmBreaksSaving === key ? "저장 중..." : "저장"}
                  </button>
                  {cmBreaksMessage[key] && <span className="text-xs text-zinc-500">{cmBreaksMessage[key]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
