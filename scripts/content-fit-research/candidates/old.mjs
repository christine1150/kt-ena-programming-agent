// 기존 점수(마트에 저장되어 있던 값)를 평가 하네스에 태우는 어댑터. stored=true: 저장값이라 방영 건을 일부만 써서 다시 계산할 수 없다.
import { oldScores } from "../harness.mjs";

const mk = (name, pick) => ({
  name,
  stored: true,
  score(snap) {
    const m = oldScores(snap.code, snap.T);
    const out = new Map();
    if (!m) return out;
    for (const [pid, v] of m) out.set(pid, { score: pick(v) });
    return out;
  },
});

export const oldTable = mk("기존 화면 종합(3개 평균)", (v) => v.table);
export const oldFit = mk("기존 fit_score(6항 가중)", (v) => v.fit);
export const oldPerfOnly = mk("기존 target_performance만", (v) => v.perf);
export const oldAffOnly = mk("기존 target_affinity만", (v) => v.aff);
export const oldEngOnly = mk("기존 engagement만", (v) => v.eng);
