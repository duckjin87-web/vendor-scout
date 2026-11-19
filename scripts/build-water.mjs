// scripts/build-water.mjs — 전국폐수배출사업장표준데이터 색인(매주)
//
// 공공데이터포털 표준데이터(15139223) API를 전부 받아 리포트가 바로 대조할 수 있게 줄인 색인을 만든다.
//   data/water/latest.json — { builtAt, total, inst:[제공 시군구], tp:[업종구분], rows:[[상호, 도로명, 지번, 업종idx, 기관idx, 기준일]] }
// 표준데이터에는 배출량·종별이 없다(2026-11 확인: 상호·주소·위경도·업종구분·전화·대표자·기준일뿐).
// 지자체가 낸 곳만 들어 있어(2026-11: 32개 시군구 5,632곳) 제공 시군구 목록을 함께 저장한다 —
// 리포트가 '신고 없음'과 '그 지역 자료가 아예 없음'을 구분하는 데 쓴다. 키는 Secret에만 있다.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/water');
const KEY = process.env.DATA_GO_KR_API_KEY;
const BASE = 'https://api.data.go.kr/openapi/tn_pubr_public_wastewater_emission_site_api';
const notice = (t) => console.log(`::notice::${String(t).replace(/\r?\n/g, ' ').slice(0, 3000)}`);

async function page(no, rows) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${BASE}?serviceKey=${encodeURIComponent(KEY)}&type=json&pageNo=${no}&numOfRows=${rows}`, { signal: AbortSignal.timeout(40000) });
      const t = await r.text();
      const j = JSON.parse(t);
      const b = (j.response && j.response.body) || j.body;
      if (!b) throw new Error(`응답 형식 ${t.slice(0, 160)}`);
      let it = b.items; if (it && it.item) it = it.item;
      return { total: Number(b.totalCount) || 0, items: Array.isArray(it) ? it : it ? [it] : [] };
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 2000 * (i + 1))); }
  }
  throw last;
}

if (!KEY) { console.error('DATA_GO_KR_API_KEY 없음'); process.exit(1); }
const ROWS = 1000;
const first = await page(1, ROWS);
const all = [...first.items];
for (let no = 2; no <= Math.ceil(first.total / ROWS); no++) all.push(...(await page(no, ROWS)).items);
if (!all.length || all.length < first.total * 0.95) { console.error(`수집 부족 ${all.length}/${first.total} — 이전 색인 유지`); process.exit(1); }

const inst = [], tp = [];
const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { arr.push(v); i = arr.length - 1; } return i; };
const s = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const rows = all.map((o) => [s(o.bplcNm), s(o.lctnRoadNmAddr), s(o.lctnLotnoAddr), idx(tp, s(o.tpbizSeNm)), idx(inst, s(o.insttNm) || `${s(o.ctpvNm)} ${s(o.sggNm)}`), s(o.dataCrtrYmd)]);
const out = { builtAt: new Date().toISOString(), source: '공공데이터포털 전국폐수배출사업장표준데이터(15139223)', total: rows.length, inst, tp, rows };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(out));
const cos = rows.filter((r) => /화장품/.test(tp[r[3]])).length;
notice(`폐수배출사업장 색인 ${rows.length}곳 · 제공 시군구 ${inst.length}곳 · 업종 ${tp.length}종 · 화장품 제조시설 ${cos}곳 · ${(fs.statSync(path.join(OUT, 'latest.json')).size / 1024).toFixed(0)}KB`);
