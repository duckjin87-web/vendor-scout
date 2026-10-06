// scripts/build-growth.mjs — 급성장 신호(화장품 제조업) 월간 집계
//
// GitHub Actions(growth.yml)에서 돈다. 키(DATA_GO_KR_API_KEY)는 Secret에만 있고, 결과 JSON만 저장소에 남는다.
//
// 원천
//   ① 국민연금공단_국민연금 가입 사업장 내역(공공데이터포털 파일데이터 15083277, 월간, 전국 약 59만 사업장, CP949 CSV)
//      열: 자료생성년월 · 사업장명 · 사업자등록번호(앞 6자리) · 가입상태(1 등록) · 주소 · 법정동코드 · 업종코드 · 업종코드명
//          · 가입자수 · 당월고지금액 · 신규취득자수 · 상실가입자수
//      — 공개 범위: 가입자 3인 이상 법인 사업장. 포털에는 최신 한 달치만 남는다(이전 달 파일 없음, 2026-10 확인).
//   ② 식약처 화장품 제조업 공개 API(제조소 한 곳당 한 건, 상호·사업자번호) — 국민연금 업종이 '화장품 제조업'이
//      아닌 허가 업체(도매업 등으로 등록)도 함께 잡으려고 쓴다.
//
// 대상: 국민연금 업종 242403(화장품 제조업) 사업장 + 식약처 제조업 허가 업체와 사업자번호 앞 6자리·상호가 맞는 사업장
//
// 계산
//   1개월 순증 = 그 달 신규취득 − 상실. 직전 달 인원 ≈ 가입자수 − 1개월 순증.
//   2개월 순증 = 이번 달 순증 + 직전 달 스냅숏의 순증(같은 사업장). 직전 스냅숏이 없으면 비워 둔다.
//   포털이 이전 달 파일을 남기지 않으므로 이 스크립트가 달마다 스냅숏(data/growth/snap-YYYY-MM.json)을 쌓는다.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.DATA_GO_KR_API_KEY;
const OUT = path.resolve('data/growth');
const COSMETIC_CODE = '242403';
const log = (...a) => console.log('[growth]', ...a);

const nk = (s) => String(s || '')
  .replace(/\(주\)|㈜|주식회사|유한회사|\(유\)|농업회사법인|\s/g, '')
  .replace(/[-_]?(비정규|일용|파견|계약직|본사|본점|지점|공장|제\d공장|\d공장)$/, '')
  .toLowerCase();

async function fetchText(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0 (vendor-scout growth)', ...(init.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw last;
}

// ── ① 국민연금 파일 ──
async function npsFile() {
  const page = await (await fetchText('https://www.data.go.kr/data/15083277/fileData.do')).text();
  const uddi = (page.match(/uddi:[0-9a-f-]{20,}/i) || [])[0];
  const next = (page.replace(/<[^>]+>/g, ' ').match(/차기\s*등록\s*예정일\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  if (!uddi) throw new Error('국민연금 파일 식별자(uddi)를 찾지 못했습니다');
  const meta = await (await fetchText(`https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=15083277&publicDataDetailPk=${uddi}&fileDetailSn=1`,
    { headers: { Referer: 'https://www.data.go.kr/data/15083277/fileData.do' } })).text();
  const atch = (meta.match(/"atchFileId"\s*:\s*"(FILE_[0-9]+)"/) || [])[1];
  if (!atch) throw new Error('국민연금 파일 첨부 번호를 찾지 못했습니다');
  const r = await fetchText(`https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${atch}&fileDetailSn=1&insertDataPrcus=N`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const txt = new TextDecoder('euc-kr').decode(buf);
  log(`국민연금 파일 ${atch} ${(buf.length / 1e6).toFixed(1)}MB`);
  return { txt, next, atch };
}
function parseCsvLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── ② 식약처 제조업 명단 ──
async function mfdsRegister() {
  if (!KEY) { log('키 없음 — 식약처 명단 생략'); return []; }
  const BASE = 'https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService01/getCsmtcsMfcrtrInfoList01';
  const page = async (n) => {
    const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(n), numOfRows: '500' });
    const j = await (await fetchText(`${BASE}?${q}`)).json();
    const b = j.body || (j.response && j.response.body) || {};
    let it = b.items; if (it && it.item) it = it.item;
    it = Array.isArray(it) ? it : (it ? [it] : []);
    return { total: Number(b.totalCount) || 0, items: it.map((x) => (x && x.item && typeof x.item === 'object' ? x.item : x)) };
  };
  const first = await page(1);
  const pages = Math.ceil(first.total / 500);
  const all = [...first.items];
  for (let p = 2; p <= pages; p += 4) {
    const got = await Promise.all([p, p + 1, p + 2, p + 3].filter((x) => x <= pages).map((x) => page(x).catch(() => ({ items: [] }))));
    got.forEach((g) => all.push(...g.items));
  }
  log(`식약처 제조업 명단 ${all.length}/${first.total}건`);
  const seen = new Map();
  all.forEach((x) => {
    const bz = String(x.BIZRNO || '').replace(/\D/g, '');
    const key = `${bz.slice(0, 6)}|${nk(x.ENTP_NAME)}`;
    if (!seen.has(key)) seen.set(key, { name: x.ENTP_NAME, bz6: bz.slice(0, 6), key: nk(x.ENTP_NAME), permit: x.ENTP_PERMIT_DATE || '' });
  });
  return [...seen.values()];
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const [{ txt, next, atch }, mfds] = await Promise.all([npsFile(), mfdsRegister().catch((e) => { log('식약처 명단 실패', e.message); return []; })]);
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]);
  const col = (re) => head.findIndex((h) => re.test(h));
  const C = {
    ym: col(/생성년월/), nm: col(/사업장명/), bz: col(/사업자등록번호/), st: col(/가입상태/), jibun: col(/지번상세주소/), road: col(/도로명상세주소/),
    ldong: col(/고객법정동주소코드/), code: head.findIndex((h) => /업종코드/.test(h) && !/명/.test(h)), codeNm: col(/업종코드명/),
    cnt: col(/^가입자수/), amt: col(/고지금액/), nw: col(/신규취득/), ls: col(/상실/), kind: col(/사업장형태/),
  };
  if (Object.values(C).some((i) => i < 0)) throw new Error(`국민연금 파일 열이 예상과 다릅니다: ${head.join('|')}`);
  const byBz6 = new Map();
  mfds.forEach((m) => { if (!byBz6.has(m.bz6)) byBz6.set(m.bz6, []); byBz6.get(m.bz6).push(m); });
  let ym = '';
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    if (c[C.st] !== '1') continue;
    const code = c[C.code];
    const key = nk(c[C.nm]);
    // 식약처 허가 업체와 사업자번호 앞 6자리가 같고 상호가 서로 포함되면 같은 회사로 본다
    const mf = (byBz6.get(c[C.bz]) || []).find((m) => m.key.length >= 2 && key.length >= 2 && (key.includes(m.key) || m.key.includes(key)));
    if (code !== COSMETIC_CODE && !mf) continue;
    ym = ym || c[C.ym];
    rows.push({
      id: `${c[C.bz]}|${key}|${c[C.ldong]}`,
      nm: c[C.nm], bz6: c[C.bz], addr: (c[C.road] || c[C.jibun] || '').trim(), code, codeNm: c[C.codeNm],
      cnt: +c[C.cnt] || 0, amt: +c[C.amt] || 0, nw: +c[C.nw] || 0, ls: +c[C.ls] || 0,
      mfds: !!mf, mfdsName: mf ? mf.name : null,
      temp: /비정규|일용|파견|계약직/.test(c[C.nm]),
    });
  }
  log(`기준월 ${ym} · 대상 사업장 ${rows.length}곳 (화장품 제조업 업종 ${rows.filter((r) => r.code === COSMETIC_CODE).length} · 식약처 허가 일치 ${rows.filter((r) => r.mfds).length})`);

  // 스냅숏 저장 — 다음 달 2개월 계산의 재료
  const snapFile = path.join(OUT, `snap-${ym}.json`);
  fs.writeFileSync(snapFile, JSON.stringify({ ym, atch, rows: rows.map((r) => [r.id, r.cnt, r.amt, r.nw, r.ls]) }));
  // 직전 달 스냅숏(있으면)
  const snaps = fs.readdirSync(OUT).filter((f) => /^snap-\d{4}-\d{2}\.json$/.test(f)).sort();
  const prevName = snaps.filter((f) => f < `snap-${ym}.json`).pop() || null;
  const prev = prevName ? JSON.parse(fs.readFileSync(path.join(OUT, prevName), 'utf8')) : null;
  const prevMap = new Map(prev ? prev.rows.map((x) => [x[0], { cnt: x[1], amt: x[2], nw: x[3], ls: x[4] }]) : []);
  // 오래된 스냅숏은 6개만 남긴다
  snaps.slice(0, Math.max(0, snaps.length - 6)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));

  const out = rows.map((r) => {
    const d1 = r.nw - r.ls;
    const p = prevMap.get(r.id);
    const d2 = p ? d1 + (p.nw - p.ls) : null;
    return {
      nm: r.nm, bz6: r.bz6, addr: r.addr, codeNm: r.codeNm, cnt: r.cnt, amt: r.amt, nw: r.nw, ls: r.ls,
      d1, b1: r.cnt - d1,
      d2, b2: d2 == null ? null : r.cnt - d2,
      amtPrev: p ? p.amt : null,
      mfds: r.mfds, mfdsName: r.mfdsName, cos: r.code === COSMETIC_CODE, temp: r.temp,
    };
  });
  const prevYm = prev ? prev.ym : null;
  const doc = {
    ym, prevYm, nextUpdate: next, builtAt: new Date().toISOString(),
    source: '국민연금공단_국민연금 가입 사업장 내역(공공데이터포털 15083277) · 식약처 화장품 제조업 공개 API',
    scope: '가입자 3인 이상 법인 사업장 · 업종 화장품 제조업(242403) 또는 식약처 제조업 허가 업체(사업자번호 앞 6자리·상호 일치)',
    counts: { rows: out.length, cosmetics: out.filter((r) => r.cos).length, mfds: out.filter((r) => r.mfds).length, mfdsRegister: mfds.length },
    rows: out,
  };
  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(doc));
  log(`latest.json 저장 · 직전 스냅숏 ${prevYm || '없음'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
