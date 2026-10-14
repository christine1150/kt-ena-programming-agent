import { execSync } from "child_process";
import fs from "fs";

const src = "scripts/_ppt/_userreport.docx";
const outDir = "scripts/_ppt/_unzipped";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execSync(`unzip -q -o "${src}" -d "${outDir}"`);

const xml = fs.readFileSync(outDir + "/word/document.xml", "utf8");
const paras = xml.split(/<w:p[ >]/).slice(1);
const lines = [];
for (const p of paras) {
  const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
  lines.push(texts.join(""));
}
fs.writeFileSync("scripts/_ppt/_userreport.txt", lines.join("\n"));
console.log("paragraphs:", lines.length, "chars:", lines.join("\n").length);
