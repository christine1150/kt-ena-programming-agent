// 시청률 지도 — 닐슨 방송 행(하루치, 시작 분 오름차순)을 편성표 '칸'(같은 날·같은 프로그램)과 순서대로 짝짓는다.
// 닐슨 시작 시각은 편성표와 수 분~십수 분 어긋나므로, 시각 차이가 작은 순서쌍을 DP로 고르고(순서 유지),
// 25분을 넘는 쌍과 짝이 없는 행·칸은 건너뛴다. 반환: 행마다 짝지어진 칸([시작분, 시작 회차, 끝 회차, 칸 길이]) 또는 null.
export type SchedBlock = [number, number, number, number];
const MAX_GAP = 25;
export function alignDay(rowMins: number[], blocks: SchedBlock[]): (SchedBlock | null)[] {
  const n = rowMins.length, m = blocks.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0)); // 최대 짝 수, 같으면 시각 차 합 최소
  const gapSum = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const take: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(m + 1).fill(false));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    let b = best[i - 1][j], g = gapSum[i - 1][j], t = false;
    if (best[i][j - 1] > b || (best[i][j - 1] === b && gapSum[i][j - 1] < g)) { b = best[i][j - 1]; g = gapSum[i][j - 1]; }
    const d = Math.abs(rowMins[i - 1] - blocks[j - 1][0]);
    if (d <= MAX_GAP) {
      const nb = best[i - 1][j - 1] + 1, ng = gapSum[i - 1][j - 1] + d;
      if (nb > b || (nb === b && ng < g)) { b = nb; g = ng; t = true; }
    }
    best[i][j] = b; gapSum[i][j] = g; take[i][j] = t;
  }
  const res: (SchedBlock | null)[] = new Array(n).fill(null);
  for (let i = n, j = m; i > 0 && j > 0;) {
    if (take[i][j]) { res[i - 1] = blocks[j - 1]; i--; j--; }
    else if (best[i][j] === best[i - 1][j] && gapSum[i][j] === gapSum[i - 1][j]) i--;
    else j--;
  }
  return res;
}
