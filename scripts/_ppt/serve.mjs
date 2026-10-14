// 덱 미리보기용 초경량 정적 서버 (scripts/_ppt 폴더만 서빙)
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = path.resolve("scripts/_ppt");
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".ttf": "font/ttf", ".js": "text/javascript" };

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "olife-deck.html";
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(4321, () => console.log("deck preview on http://localhost:4321"));
