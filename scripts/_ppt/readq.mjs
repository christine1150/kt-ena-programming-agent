import fs from "fs";
export function readQ(name) {
  const s = fs.readFileSync(`scripts/_ppt/_out/${name}.json`, "utf8");
  const j = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  if (j._tag === "Error") throw new Error(name + ": " + j.error.message);
  const m = {};
  for (const r of j.rows) m[r.k] = r.v;
  return m;
}
