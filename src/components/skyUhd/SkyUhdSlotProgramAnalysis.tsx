// skyUHD 전용 "편성 시간대 × 프로그램" 분석 섹션 (2026-09-17, 사용자 지시).
//
// 사용자 지시 원문: "각 월의 편성시간과 편성 프로그램을 알 수 있으므로 (시청률이 안적힌 것은
// 시청률이 0이었던 거야) 편성 시간대와 프로그램은 함께 분석해서 뭘 늘리고, 뭘 시간대를 이동할지
// 등에 대한 분석을 해서 제언하는 것이 가장 중요해. (총 편성 횟수에 비해서 실제 시청률이 나온
// 구간 분석도 필요한거야)"
//
// 이 컴포넌트는 표시만 담당한다 — 모든 수치와 제언 후보는 서버(/api/scheduling/skyuhd-slot-analysis
// → src/lib/skyUhdSlotAnalysis.ts)가 DB의 실제 편성 행에서 계산한 값 그대로다. 여기서 시청률을
// 다시 계산하거나, PRD Fit Score 5태그(KEEP/MOVE/REPLACE/STRENGTHEN/TEST)를 붙이지 않는다
// (skyUHD는 타깃 자료가 없어 그 공식을 적용할 수 없다 — 검증된 판단인 것처럼 보이면 안 됨).
import { josaEunNeun } from "@/lib/josa";
import {
  SKYUHD_SLOT_HOURS,
  SKYUHD_SLOT_THRESHOLDS,
  type SkyUhdSlotAnalysis,
} from "@/lib/skyUhdSlotAnalysis";

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function hourLabel(h: number): string {
  return `${h}시`;
}

/** 02~25시 전 구간을 축에 고정하고, 총 편성 횟수(연한 막대) 위에 시청률이 나온 횟수(진한 막대)를 겹쳐 그린다. */
function SlotHitBars({
  analysis,
  accentColor,
}: {
  analysis: SkyUhdSlotAnalysis;
  accentColor: string;
}) {
  const byHour = new Map(analysis.slots.map((s) => [s.hour, s]));
  const maxAir = Math.max(1, ...analysis.slots.map((s) => s.airCount));
  return (
    <div>
      <div className="flex h-28 items-stretch gap-[3px]">
        {SKYUHD_SLOT_HOURS.map((hour) => {
          const s = byHour.get(hour);
          const air = s?.airCount ?? 0;
          const hit = s?.hitCount ?? 0;
          const airPct = (air / maxAir) * 100;
          const hitPct = (hit / maxAir) * 100;
          return (
            <div key={hour} className="flex flex-1 flex-col justify-end">
              <div
                className="relative w-full rounded-t bg-zinc-200"
                style={{ height: `${Math.max(air > 0 ? 3 : 0.8, airPct)}%` }}
                title={
                  s
                    ? `${hour}시 · 편성 ${air}회 중 시청률 발생 ${hit}회(적중률 ${pct(s.hitRate)})`
                    : `${hour}시 · 편성 없음`
                }
              >
                <div
                  className="absolute bottom-0 left-0 w-full rounded-t"
                  style={{
                    height: air > 0 ? `${(hitPct / Math.max(airPct, 0.0001)) * 100}%` : "0%",
                    backgroundColor: accentColor,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {SKYUHD_SLOT_HOURS.map((hour) => (
          <span key={hour} className="flex-1 text-center text-[9px] text-zinc-400">
            {hour}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-zinc-400">
        <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-zinc-200 align-middle" />총 편성 횟수
        <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: accentColor }} />
        그중 시청률이 나온 횟수 — 02시부터 25시까지 전 구간을 고정 축으로 표시하며, 편성이 없던 시간대는 빈
        칸으로 둡니다.
      </p>
    </div>
  );
}

export function SkyUhdSlotProgramAnalysis({
  analysis,
  accentColor,
  fmtR,
  loading,
}: {
  analysis: SkyUhdSlotAnalysis | null;
  accentColor: string;
  fmtR: (v: number | null) => string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
        <h2 className="font-heading mb-1 text-xl font-bold tracking-tight text-zinc-800">
          편성 시간대 × 프로그램 분석
        </h2>
        <p className="text-sm text-zinc-400">불러오는 중...</p>
      </div>
    );
  }
  if (!analysis || analysis.totals.airCount === 0) return null;

  const { totals, slots, programs, expandCandidates, moveCandidates, deadSlots } = analysis;
  const mainPrograms = programs.filter((p) => p.airCount >= SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_PROGRAM);
  const lowSamplePrograms = programs.filter((p) => p.airCount < SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_PROGRAM);
  const bestSlot = slots.length > 0 ? slots.reduce((a, s) => (s.avgRating > a.avgRating ? s : a)) : null;
  const busiestSlot = slots.length > 0 ? slots.reduce((a, s) => (s.airCount > a.airCount ? s : a)) : null;

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="font-heading mb-1 text-xl font-bold tracking-tight text-zinc-800">
        편성 시간대 × 프로그램 분석
        <span className="ml-2 align-middle text-sm font-normal text-zinc-400">(SLOT × PROGRAM)</span>
      </h2>
      <p className="mb-4 text-sm text-zinc-400">
        {analysis.window.from} ~ {analysis.window.to} 동안 실제로 편성된 {totals.airCount}회를 시간대와 프로그램
        두 축으로 함께 봅니다. 원본 파일에서 시청률이 비어 있는 방영분은 <b>자료 없음이 아니라 실제 0</b>이므로
        분모에서 빼지 않고 0으로 계산했습니다 — 그래서 &ldquo;몇 번 편성해서 몇 번 시청률이 나왔는가(적중률)&rdquo;를
        그대로 읽을 수 있습니다.
      </p>

      {/* ① 요약 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "총 편성 횟수", value: `${totals.airCount}회`, sub: `${totals.daysWithSchedule}일 · ${totals.programCount}개 프로그램` },
          { label: "시청률이 나온 횟수", value: `${totals.hitCount}회`, sub: `전체의 ${pct(totals.hitRate)}` },
          { label: "편성 평균 시청률", value: fmtR(totals.avgRating), sub: "0인 방영분 포함" },
          {
            label: "최고 성과 시간대",
            value: bestSlot ? hourLabel(bestSlot.hour) : "—",
            sub: bestSlot ? `평균 ${fmtR(bestSlot.avgRating)} · ${bestSlot.airCount}회 편성` : "",
          },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl bg-zinc-50 p-4">
            <p className="text-sm text-zinc-500">{card.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{card.value}</p>
            {card.sub && <p className="mt-0.5 text-[12px] text-zinc-400">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* ② 시간대별 편성 대비 적중 */}
      <div className="mt-6 border-t border-zinc-100 pt-5">
        <h3 className="mb-1 text-sm font-semibold text-zinc-600">시간대별 — 총 편성 횟수 대비 시청률이 나온 구간</h3>
        <p className="mb-3 text-sm text-zinc-400">
          막대 전체 높이가 그 시간대의 총 편성 횟수, 진한 부분이 그중 시청률이 실제로 나온 횟수입니다.
        </p>
        <SlotHitBars analysis={analysis} accentColor={accentColor} />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th className="pb-1.5 pr-2 font-medium">시간대</th>
                <th className="pb-1.5 pr-2 font-medium">편성</th>
                <th className="pb-1.5 pr-2 font-medium">시청률 발생</th>
                <th className="pb-1.5 pr-2 font-medium">적중률</th>
                <th className="pb-1.5 pr-2 font-medium">평균(0 포함)</th>
                <th className="pb-1.5 pr-2 font-medium">발생분만 평균</th>
                <th className="pb-1.5 font-medium">대표 프로그램</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.hour} className="border-t border-zinc-100">
                  <td className="py-1.5 pr-2 font-medium text-zinc-800">{hourLabel(s.hour)}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-600">{s.airCount}회</td>
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-600">{s.hitCount}회</td>
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-zinc-100 align-middle">
                        <span
                          className="block h-1.5 rounded-full"
                          style={{ width: `${Math.max(2, s.hitRate * 100)}%`, backgroundColor: accentColor }}
                        />
                      </span>
                      <span className="tabular-nums text-zinc-600">{pct(s.hitRate)}</span>
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums font-semibold text-zinc-900">{fmtR(s.avgRating)}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-500">{fmtR(s.avgRatingWhenHit)}</td>
                  <td className="max-w-[220px] truncate py-1.5 text-zinc-600" title={s.topProgramName ?? ""}>
                    {s.topProgramName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ③ 프로그램별 */}
      <div className="mt-6 border-t border-zinc-100 pt-5">
        <h3 className="mb-1 text-sm font-semibold text-zinc-600">프로그램별 — 편성 횟수 · 적중률 · 주력/최고 성과 시간대</h3>
        <p className="mb-3 text-sm text-zinc-400">
          &ldquo;주 편성 시간대&rdquo;는 그 프로그램이 가장 많이 걸린 시간대, &ldquo;최고 성과 시간대&rdquo;는 같은
          프로그램이 {SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_PER_SLOT_CELL}회 이상 편성된 시간대 중 평균이 가장
          높았던 곳입니다. 둘이 다르면 아래 제언에서 시간대 이동 후보로 짚습니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th className="pb-1.5 pr-2 font-medium">프로그램</th>
                <th className="pb-1.5 pr-2 font-medium">편성</th>
                <th className="pb-1.5 pr-2 font-medium">적중률</th>
                <th className="pb-1.5 pr-2 font-medium">평균(0 포함)</th>
                <th className="pb-1.5 pr-2 font-medium">주 편성 시간대</th>
                <th className="pb-1.5 font-medium">최고 성과 시간대</th>
              </tr>
            </thead>
            <tbody>
              {mainPrograms.map((p) => (
                <tr key={p.programName} className="border-t border-zinc-100">
                  <td className="max-w-[220px] truncate py-1.5 pr-2 font-bold text-zinc-800" title={p.programName}>
                    {p.programName}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-600">{p.airCount}회</td>
                  <td className="py-1.5 pr-2 tabular-nums text-zinc-600">
                    {pct(p.hitRate)} <span className="text-zinc-400">({p.hitCount}회)</span>
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums font-semibold text-zinc-900">{fmtR(p.avgRating)}</td>
                  <td className="py-1.5 pr-2 text-zinc-600">
                    {p.mainHour !== null ? `${hourLabel(p.mainHour)} (${p.mainHourAirCount}회)` : "—"}
                  </td>
                  <td className="py-1.5 text-zinc-600">
                    {p.bestHour !== null ? (
                      <>
                        {hourLabel(p.bestHour)}{" "}
                        <span className="text-zinc-400">(평균 {fmtR(p.bestHourAvgRating)})</span>
                      </>
                    ) : (
                      <span className="text-zinc-300">표본 부족</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lowSamplePrograms.length > 0 && (
          <details className="mt-3 border-t border-dashed border-zinc-200 pt-3">
            <summary className="cursor-pointer text-sm text-zinc-400">
              표본 부족(편성 {SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_PROGRAM}회 미만) {lowSamplePrograms.length}개 보기
            </summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-zinc-500">
              {lowSamplePrograms.map((p) => (
                <span key={p.programName}>
                  <span className="font-medium text-zinc-700">{p.programName}</span> {p.airCount}회 · 평균{" "}
                  {fmtR(p.avgRating)}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* ④ 제언 */}
      <div className="mt-6 border-t border-zinc-100 pt-5">
        <h3 className="mb-1 text-sm font-semibold text-zinc-600">이 기간 편성에 대한 제언</h3>
        <p className="mb-3 text-sm text-zinc-400">
          아래 제언은 전부 위 표의 실제 편성 횟수·적중률·시간대 평균에서 나온 것입니다. skyUHD는 타깃 자료가 없어
          다른 채널의 적합도 점수(Fit Score)를 계산할 수 없으므로, 점수나 태그 대신 근거 수치를 그대로 적었습니다.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl bg-emerald-50/60 p-4">
            <p className="mb-2 text-sm font-semibold text-emerald-700">늘려볼 만한 프로그램</p>
            {expandCandidates.length === 0 ? (
              <p className="text-sm text-zinc-500">
                이 기간에는 채널 편성 평균의 {SKYUHD_SLOT_THRESHOLDS.EXPAND_RATING_RATIO}배를 넘으면서 적중률도 평균
                이상인 프로그램이 확인되지 않았습니다.
              </p>
            ) : (
              <ul className="space-y-2 text-sm text-zinc-700">
                {expandCandidates.map((c) => (
                  <li key={c.programName}>
                    <span className="font-semibold text-zinc-900">{c.programName}</span>
                    {josaEunNeun(c.programName)} {c.airCount}회 편성에서 평균 {fmtR(c.avgRating)}(채널 편성 평균{" "}
                    {fmtR(c.channelAvgRating)})·적중률 {pct(c.hitRate)}로, 편성 횟수를 늘리거나
                    {c.mainHour !== null ? ` 현재 주력인 ${hourLabel(c.mainHour)} 인접 시간대로 확대하는 것을` : " 편성 확대를"}{" "}
                    검토해볼 만합니다.
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-amber-50/60 p-4">
            <p className="mb-2 text-sm font-semibold text-amber-700">시간대를 옮겨볼 만한 프로그램</p>
            {moveCandidates.length === 0 ? (
              <p className="text-sm text-zinc-500">
                같은 프로그램 안에서 다른 시간대가 주력 시간대보다 {SKYUHD_SLOT_THRESHOLDS.MOVE_RATING_RATIO}배 이상
                잘 나온 사례는 이 기간에 확인되지 않았습니다.
              </p>
            ) : (
              <ul className="space-y-2 text-sm text-zinc-700">
                {moveCandidates.map((c) => (
                  <li key={c.programName}>
                    <span className="font-semibold text-zinc-900">{c.programName}</span>
                    {josaEunNeun(c.programName)} 주력인 {hourLabel(c.mainHour)}에서 {c.mainHourAirCount}회 평균{" "}
                    {fmtR(c.mainHourAvgRating)}인데, {hourLabel(c.bestHour)}에서는 {c.bestHourAirCount}회 평균{" "}
                    {fmtR(c.bestHourAvgRating)}
                    {Number.isFinite(c.ratio) ? `(${c.ratio.toFixed(1)}배)` : ""}였습니다 — 편성 시각을{" "}
                    {hourLabel(c.bestHour)} 쪽으로 옮겨보는 것을 검토해볼 만합니다.
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-zinc-50 p-4">
            <p className="mb-2 text-sm font-semibold text-zinc-600">성과가 거의 없는 시간대</p>
            {deadSlots.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_SLOT}회 이상 편성하고도 적중률이{" "}
                {pct(SKYUHD_SLOT_THRESHOLDS.DEAD_SLOT_HIT_RATE)} 이하인 시간대는 없습니다.
              </p>
            ) : (
              <ul className="space-y-2 text-sm text-zinc-700">
                {deadSlots.map((s) => (
                  <li key={s.hour}>
                    <span className="font-semibold text-zinc-900">{hourLabel(s.hour)}</span>
                    {josaEunNeun(hourLabel(s.hour))} {s.airCount}회 편성 중 시청률이 나온 방영분이 {s.hitCount}회뿐입니다
                    {s.programNames.length > 0 ? `(주로 ${s.programNames.join(" / ")})` : ""} — 이 시간대는 편성 물량을
                    줄이거나, 지금과 다른 성격의 콘텐츠로 바꿔 시험해보는 것을 검토하세요.
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {busiestSlot && bestSlot && busiestSlot.hour !== bestSlot.hour && (
          <p className="mt-4 text-base leading-relaxed text-zinc-700">
            편성 물량이 가장 많이 몰린 시간대는 {hourLabel(busiestSlot.hour)}({busiestSlot.airCount}회, 평균{" "}
            {fmtR(busiestSlot.avgRating)})인데 성과가 가장 좋았던 시간대는 {hourLabel(bestSlot.hour)}(
            {bestSlot.airCount}회, 평균 {fmtR(bestSlot.avgRating)})입니다 — 물량과 성과가 서로 다른 시간대에 놓여 있어,
            {hourLabel(bestSlot.hour)} 쪽 편성 비중을 늘릴 여지가 있는지 확인해보세요.
          </p>
        )}
        {busiestSlot && bestSlot && busiestSlot.hour === bestSlot.hour && (
          <p className="mt-4 text-base leading-relaxed text-zinc-700">
            편성 물량이 가장 많은 시간대와 성과가 가장 좋은 시간대가 {hourLabel(bestSlot.hour)}로 일치합니다(
            {bestSlot.airCount}회, 평균 {fmtR(bestSlot.avgRating)}) — 현재 물량 배분이 성과가 나는 쪽에 맞춰져 있는
            상태이므로, 그다음 순위 시간대의 적중률을 함께 확인하세요.
          </p>
        )}
      </div>
    </div>
  );
}
