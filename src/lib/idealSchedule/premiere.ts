// 같은 에피소드(부제)의 "본방" 블록 — 24시간 안에 최대 3회 편성되는 같은 에피소드의 첫 방송(사용자 지시
// 2026-09-30: "3방 중 첫방은 <본>으로 표시"). 프로그램·부제가 같은 블록을 시간순으로 훑어, 직전 묶음 시작 후
// 24시간이 지나면 새 묶음으로 보고 각 묶음의 첫 블록을 본방으로 본다. 부제 반영 모드가 아니면(부제 없음) 비어 있다.
export interface PremiereInput {
  program_key?: string | null;
  program_name: string;
  episode_subtitle: string | null;
  weekday: number;
  start_min: number | string;
}

export function premiereBlocks<T extends PremiereInput>(blocks: T[]): Set<T> {
  const groups = new Map<string, T[]>();
  for (const b of blocks) {
    if (!b.episode_subtitle) continue;
    const k = `${b.program_key ?? b.program_name}|${b.episode_subtitle}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const abs = (b: T) => b.weekday * 1440 + Number(b.start_min);
  const out = new Set<T>();
  for (const list of groups.values()) {
    let groupStart = -Infinity;
    for (const b of [...list].sort((x, y) => abs(x) - abs(y))) {
      if (abs(b) - groupStart >= 1440) {
        out.add(b);
        groupStart = abs(b);
      }
    }
  }
  return out;
}
