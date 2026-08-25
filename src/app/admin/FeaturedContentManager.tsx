"use client";

// 주요 콘텐츠(featured_content) 관리 위젯 — 목록 확인, 수동 등록, 수정, 삭제.
// `채널기본정보.xlsx` 업로드로 자동 반영된 항목도 여기서 함께 관리할 수 있다.
import { useEffect, useState } from "react";

type Channel = { id: string; code: string; name: string };
type ChannelRef = { code: string; name: string } | null;
type FeaturedItem = {
  id: string;
  category: string;
  broadcast_schedule_text: string | null;
  broadcast_day_of_week: string[] | null;
  broadcast_time: string | null;
  broadcast_start_date: string | null;
  broadcast_end_date: string | null;
  expected_episode_count: number | null;
  // 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램"을 여기로 통합 — 동시방송/직후재방 채널.
  simulcast_channel_id: string | null;
  rerun_channel_id: string | null;
  simulcast_channel: ChannelRef;
  rerun_channel: ChannelRef;
  programs: {
    id: string;
    canonical_name: string;
    channel_id: string;
    channels: { code: string; name: string } | null;
  } | null;
};

// 사용자 지시(2026-08-25): "브랜디드" 명칭을 "사업형"으로 변경(기존 DB 행도 반영 완료).
const KNOWN_CATEGORIES = ["오리지널", "오리지널 드라마", "오리지널 예능", "독점 예능", "사업형", "구매 예능", "구매 드라마"];
const DAY_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"];

const emptyForm = {
  channelId: "",
  title: "",
  category: "",
  episodeCount: "",
  scheduleText: "",
  dayOfWeek: [] as string[],
  time: "",
  startDate: "",
  endDate: "",
  expectedEpisodeCount: "",
  // 사용자 지시(2026-08-26): 통합에 따라 동시방송·직후재방 채널도 여기서 직접 관리.
  simulcastChannelId: "",
  rerunChannelId: "",
};

export default function FeaturedContentManager() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [items, setItems] = useState<FeaturedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    const [channelsRes, itemsRes] = await Promise.all([
      fetch("/api/admin/channels").then((r) => r.json()),
      fetch("/api/admin/featured-content").then((r) => r.json()),
    ]);
    if (channelsRes.ok) setChannels(channelsRes.channels);
    if (itemsRes.ok) setItems(itemsRes.items);
    setLoading(false);
  }

  // 최초 진입 시 한 번만 불러온다. effect 안에서 바로 setState하면 안 된다는 린트 규칙 때문에,
  // 언마운트 후 응답이 와도 상태를 건드리지 않도록 cancelled 플래그로 감싼다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [channelsRes, itemsRes] = await Promise.all([
        fetch("/api/admin/channels").then((r) => r.json()),
        fetch("/api/admin/featured-content").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (channelsRes.ok) setChannels(channelsRes.channels);
      if (itemsRes.ok) setItems(itemsRes.items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function startEdit(item: FeaturedItem) {
    setEditingId(item.id);
    setShowForm(true);
    setForm({
      channelId: item.programs?.channel_id ?? "",
      title: item.programs?.canonical_name ?? "",
      category: item.category,
      episodeCount: "",
      scheduleText: item.broadcast_schedule_text ?? "",
      dayOfWeek: item.broadcast_day_of_week ?? [],
      time: item.broadcast_time ?? "",
      startDate: item.broadcast_start_date ?? "",
      endDate: item.broadcast_end_date ?? "",
      expectedEpisodeCount: item.expected_episode_count != null ? String(item.expected_episode_count) : "",
      simulcastChannelId: item.simulcast_channel_id ?? "",
      rerunChannelId: item.rerun_channel_id ?? "",
    });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setErrorMessage(null);
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage(null);

    const payload = {
      channelId: form.channelId,
      title: form.title,
      category: form.category,
      episodeCount: form.episodeCount ? Number(form.episodeCount) : null,
      scheduleText: form.scheduleText,
      dayOfWeek: form.dayOfWeek,
      time: form.time || null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      expectedEpisodeCount: form.expectedEpisodeCount ? Number(form.expectedEpisodeCount) : null,
      simulcastChannelId: form.simulcastChannelId || null,
      rerunChannelId: form.rerunChannelId || null,
    };

    const res = editingId
      ? await fetch(`/api/admin/featured-content/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/admin/featured-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) {
      setErrorMessage(body.message ?? "저장에 실패했습니다.");
      setSaving(false);
      return;
    }

    setSaving(false);
    resetForm();
    loadAll();
  }

  async function handleDelete(id: string) {
    if (!window.confirm("이 주요 콘텐츠 항목을 삭제할까요?")) return;
    await fetch(`/api/admin/featured-content/${id}`, { method: "DELETE" });
    loadAll();
  }

  function toggleDay(day: string) {
    setForm((f) => ({
      ...f,
      dayOfWeek: f.dayOfWeek.includes(day) ? f.dayOfWeek.filter((d) => d !== day) : [...f.dayOfWeek, day],
    }));
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">주요 콘텐츠 관리 (요일별 리뷰 프로그램)</h2>
          <p className="text-sm text-zinc-500">
            채널기본정보.xlsx &quot;요일 별 리뷰 프로그램&quot; 시트 업로드로 자동 반영된 항목 + 직접 추가한 항목을 함께
            관리합니다. 여기에 등록된 프로그램이 매일 요일에 맞춰 1페이지 &quot;주요 콘텐츠 리뷰&quot;에 표시됩니다.
          </p>
        </div>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          {showForm ? "닫기" : "+ 직접 추가"}
        </button>
      </div>

      {showForm && (
        <div className="mb-5 space-y-3 rounded-lg border border-zinc-200 p-4">
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.channelId}
              onChange={(e) => setForm({ ...form, channelId: e.target.value })}
              disabled={!!editingId}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-100"
            >
              <option value="">채널 선택</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={!!editingId}
              placeholder="타이틀명"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              list="category-options"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="분류 (예: 오리지널 드라마)"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
            <datalist id="category-options">
              {KNOWN_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              value={form.episodeCount}
              onChange={(e) => setForm({ ...form, episodeCount: e.target.value })}
              placeholder="편수"
              type="number"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>

          {/* 편성 정보는 "첫 방송일자"와 "매주 반복 편성(요일·시간)"을 서로 다른 개념으로
              분리해서 관리한다 — 둘 다 있어야 "이 프로그램이 오늘 방영 예정인가"를 정확히
              판단할 수 있다(첫 방송일자만 있으면 그 후 매주 언제 하는지 모르고, 요일·시간만
              있으면 언제부터 시작했는지 모른다). scheduleText는 원본 Excel 문구를 참고용으로
              그대로 보존하는 자리이고, 실제 화면 로직은 구조화된 필드(day/time/date)를 쓴다. */}
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">① 첫 방송일자 (프로그램이 처음 편성된 날)</p>
            <div className="grid grid-cols-3 gap-3">
              <input
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                type="date"
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <div>
                <input
                  value={form.expectedEpisodeCount}
                  onChange={(e) => setForm({ ...form, expectedEpisodeCount: e.target.value })}
                  type="number"
                  placeholder="예상 총 회차"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">첫 방송일자·②요일과 함께 있으면 종영일 자동계산</p>
              </div>
              <div>
                <input
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  type="date"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <p className="mt-0.5 text-[11px] text-zinc-400">종영일(직접 입력 — 자동계산 있으면 자동계산 우선)</p>
              </div>
            </div>
          </div>

          {/* 사용자 지시(2026-08-26): "요일 별 리뷰 프로그램" 시트의 동시방송·직후 재방 채널을
              여기(주요 콘텐츠 관리)에서 함께 관리한다 — Page 1 주요 콘텐츠 리뷰의 "직후재방"
              칸이 이 값으로 계산된다(직후 재방이 비어 있으면 동시방송 채널을 대신 본다). */}
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">동시방송 / 직후 재방 채널 (선택)</p>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={form.simulcastChannelId}
                onChange={(e) => setForm({ ...form, simulcastChannelId: e.target.value })}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="">동시방송 채널 없음</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={form.rerunChannelId}
                onChange={(e) => setForm({ ...form, rerunChannelId: e.target.value })}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="">직후 재방 채널 없음</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">② 매주 반복 편성 (무슨 요일 몇 시)</p>
            <div className="flex flex-wrap items-center gap-2">
              {DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`h-8 w-8 rounded-full text-sm font-medium ${
                    form.dayOfWeek.includes(day) ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {day}
                </button>
              ))}
              <input
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                type="time"
                className="ml-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">편성 메모 (원본 문구, 참고용 — 위 ①②가 실제 화면 계산에 쓰인다)</p>
            <input
              value={form.scheduleText}
              onChange={(e) => setForm({ ...form, scheduleText: e.target.value })}
              placeholder="예: 2026.07.13. ~ 2026.08.18 매주월화 밤 10:00"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>

          {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

          <button
            onClick={handleSave}
            disabled={saving || !form.channelId || !form.title || !form.category}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "저장 중..." : editingId ? "수정 저장" : "등록"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">불러오는 중...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400">등록된 주요 콘텐츠가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              {/* 사용자 지시(2026-08-26): 채널기본정보.xlsx "요일 별 리뷰 프로그램" 시트와 같은
                  열 구성(분류/타이틀/본방채널/동시방송/직후재방/첫방송일자/매주반복편성/예상회차/
                  종영일)으로 통합 — 별도 위젯이던 화이트리스트 조회 화면을 여기로 흡수했다. */}
              <tr className="text-zinc-400">
                <th className="pb-1 font-medium">분류</th>
                <th className="pb-1 font-medium">타이틀</th>
                <th className="pb-1 font-medium">본방 채널</th>
                <th className="pb-1 font-medium">동시방송</th>
                <th className="pb-1 font-medium">직후 재방</th>
                <th className="pb-1 font-medium">첫 방송일자</th>
                <th className="pb-1 font-medium">매주 반복 편성</th>
                <th className="pb-1 font-medium">예상 회차 / 종영일</th>
                <th className="pb-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-1.5 text-zinc-600">{item.category}</td>
                  <td className="py-1.5 font-medium text-zinc-900">{item.programs?.canonical_name ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-zinc-800">{item.programs?.channels?.name ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-zinc-600">{item.simulcast_channel?.name ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-zinc-600">{item.rerun_channel?.name ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 text-zinc-600">{item.broadcast_start_date || "—"}</td>
                  <td className="py-1.5 text-zinc-600">
                    {item.broadcast_day_of_week && item.broadcast_day_of_week.length > 0
                      ? `매주 ${item.broadcast_day_of_week.join("·")} ${item.broadcast_time ? item.broadcast_time.slice(0, 5) : ""}`
                      : item.broadcast_schedule_text || "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-zinc-600">
                    {item.expected_episode_count ? `${item.expected_episode_count}회` : "—"}
                    {" / "}
                    {item.broadcast_end_date || "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    <button onClick={() => startEdit(item)} className="mr-2 text-zinc-500 hover:text-zinc-900">
                      수정
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-700">
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
