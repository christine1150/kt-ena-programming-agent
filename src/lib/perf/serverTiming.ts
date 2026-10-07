// 단계 15 — 요청 단계별 소요 시간 측정. 응답 헤더 Server-Timing으로 내보내 브라우저 개발자 도구·측정 스크립트가 읽는다.
// 값은 그 단계에 걸린 밀리초일 뿐 숫자 계산에는 쓰이지 않는다(순수 계측). 단계 이름에는 사용자 데이터를 넣지 않는다.
export interface StageTimer {
  /** 직전 mark 이후 지난 시간을 name 단계로 기록한다 */
  mark(name: string): void;
  /** promise가 끝나기까지 걸린 시간을 name 단계로 기록하고 결과를 그대로 돌려준다(병렬 단계용: 구간이 겹칠 수 있다) */
  measure<T>(name: string, work: Promise<T> | (() => Promise<T>)): Promise<T>;
  /** Server-Timing 헤더 값. 전체 시간은 total로 붙는다 */
  header(): string;
  entries(): { name: string; ms: number }[];
}

const safe = (n: string) => n.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "stage";

export function createStageTimer(now: () => number = () => performance.now()): StageTimer {
  const start = now();
  let last = start;
  const list: { name: string; ms: number }[] = [];
  const add = (name: string, ms: number) => {
    let key = safe(name);
    let k = 2;
    while (list.some((e) => e.name === key)) key = `${safe(name)}_${k++}`;
    list.push({ name: key, ms: Math.round(ms * 10) / 10 });
  };
  return {
    mark(name) {
      const t = now();
      add(name, t - last);
      last = t;
    },
    async measure<T>(name: string, work: Promise<T> | (() => Promise<T>)): Promise<T> {
      const t0 = now();
      try {
        return await (typeof work === "function" ? work() : work);
      } finally {
        add(name, now() - t0);
      }
    },
    header() {
      const parts = list.map((e) => `${e.name};dur=${e.ms}`);
      parts.push(`total;dur=${Math.round((now() - start) * 10) / 10}`);
      return parts.join(", ");
    },
    entries() {
      return list.slice();
    },
  };
}
