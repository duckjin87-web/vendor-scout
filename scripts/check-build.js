// 배포 전 검사: index.html의 세 자산 ?v=와 app.js의 BUILD 상수가 모두 같은 값이어야 한다.
// 하나라도 어긋나면 브라우저가 옛 파일을 캐시에서 계속 쓴다 — 실제로 styles.css가 v89에
// 멈춘 채 JS만 올라가 CSS 변경이 몇 번이나 사용자에게 닿지 않았다.
import fs from 'node:fs';
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('assets/app.js', 'utf8');

const assets = [...html.matchAll(/(styles\.css|samples\.js|app\.js)\?v=(\d+)/g)].map((m) => [m[1], Number(m[2])]);
const build = Number((app.match(/^const BUILD = (\d+);/m) || [])[1]);
const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };

if (assets.length !== 3) fail(`index.html에서 자산 3개를 찾지 못했습니다 (${assets.length}개)`);
const vs = new Set(assets.map((a) => a[1]));
if (vs.size !== 1) fail(`자산 버전이 어긋납니다 — ${assets.map((a) => `${a[0]} v${a[1]}`).join(' / ')}`);
if (!isFinite(build)) fail('assets/app.js에서 BUILD 상수를 찾지 못했습니다');
if (build !== [...vs][0]) fail(`BUILD 상수 v${build} ≠ 자산 ?v=${[...vs][0]}`);

console.log(`✓ 빌드 v${build} — 자산 3개와 BUILD 상수가 일치합니다`);
