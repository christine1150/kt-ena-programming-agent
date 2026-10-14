// 검수용 사본 — ?n=5 처럼 슬라이드 한 장만 보여 준다(스크린샷 확인용, 배포본과 무관).
import fs from "fs";
const D = "scripts/_ppt/";
const S = `<script>(function(){var n=+(new URLSearchParams(location.search).get('n')||1);
var ss=document.querySelectorAll('section');ss.forEach(function(s,i){if(i!==n-1)s.remove();});
document.querySelector('.deck').style.padding='0';})();<\/script>`;
for (const [src, out] of [["olife-deck.html", "_rev-deck.html"], ["olife-deep.html", "_rev-deep.html"]]) {
  fs.writeFileSync(D + out, fs.readFileSync(D + src, "utf8") + S);
}
console.log("review copies written");
