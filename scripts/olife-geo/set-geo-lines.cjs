// geo.txt의 회차 줄을 번호로 찾아 통째로 바꾼다: node scripts/olife-geo/set-geo-lines.cjs < "번호|국가|장소|태그|근거" 여러 줄
const fs = require("fs");
const f = "scripts/olife-geo/geo.txt";
const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
const upd = fs.readFileSync(0, "utf8").split(/\r?\n/).filter((l) => /^\d+\|/.test(l));
for (const u of upd) {
  const id = u.split("|")[0];
  const i = lines.findIndex((l) => l.split("|")[0] === id);
  if (i < 0) throw new Error("번호 없음 " + id);
  lines[i] = u;
}
fs.writeFileSync(f, lines.join("\n"));
console.log("바꾼 줄", upd.length);
