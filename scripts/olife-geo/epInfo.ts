// 회차 번호 종류 구분 — 편성표·시청률의 'OLIFE 회차'는 프로그램마다 뜻이 다르다.
//  걸세: KBS 원방송 회차와 같다. 세테기: 1000 미만이면 OLIFE 자체 회차(EBS 번호와 다름), 1000 이상이면 EBS 번호와 같다.
// 수기 분류표(geoClassification.json)에 있는 회차는 원방송 회차·방송일을 그대로 쓰고, 없는 회차(자동 분류)는 번호 종류만 추정한다.
import cls from "../../src/lib/beta/geoClassification.json";

const C = cls as unknown as { p: string; oe: number | null; orig?: string; od?: string }[];
const BY = new Map(C.filter((r) => r.oe != null).map((r) => [`${r.p}|${r.oe}`, r]));

export function epInfo(p: string, oe: number | null): { orig: string; od: string; kind: string } {
  if (oe == null) return { orig: "", od: "", kind: "" };
  const r = BY.get(`${p}|${oe}`);
  if (r) {
    const same = String(r.orig) === String(oe);
    return { orig: r.orig ?? "", od: r.od ?? "", kind: p === "걸세" ? "KBS 회차" : same ? "EBS 번호와 동일" : "OLIFE 자체 회차" };
  }
  if (p === "걸세") return { orig: String(oe), od: "", kind: "KBS 회차(편성표)" };
  return oe >= 1000 ? { orig: String(oe), od: "", kind: "EBS 번호로 추정" } : { orig: "", od: "", kind: "OLIFE 자체 회차(EBS 번호 미확인)" };
}
