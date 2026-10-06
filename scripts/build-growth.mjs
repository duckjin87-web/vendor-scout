// scripts/build-growth.mjs — 급성장 신호(화장품 제조업) 월간 집계
//
// GitHub Actions(growth.yml)에서 돈다. 키(DATA_GO_KR_API_KEY)는 Secret에만 있고, 결과 JSON만 저장소에 남는다.
//
// 원천
//   ① 국민연금공단_국민연금 가입 사업장 내역(공공데이터포털 파일데이터 15083277, 월간, 전국 약 59만 사업장, CP949 CSV)
//      열: 자료생성년월 · 사업장명 · 사업자등록번호(앞 6자리) · 가입상태(1 등록) · 주소 · 법정동코드 · 업종코드 · 업종코드명
//          · 가입자수 · 당월고지금액 · 신규취득자수 · 상실가입자수
//      — 공개 범위: 가입자 3인 이상 법인 사업장.
//      — 데이터셋 화면의 '과거 데이터'에 달마다 파일이 남아 있다(2023-08분부터, 2026-10 확인). 버전마다 uddi가
//        따로 있고 내려받는 방법은 최신 파일과 같다.
//   ② 식약처 화장품 제조업 공개 API(제조소 한 곳당 한 건, 상호·사업자번호) — 국민연금 업종이 '화장품 제조업'이
//      아닌 허가 업체(도매업 등으로 등록)도 함께 잡으려고 쓴다. 이 API에는 제조업 말고 다른 업종(INDUTY)도
//      섞여 와서(코스트코·샤넬 등 책임판매업) INDUTY가 '제조'인 건만 쓴다.
//
// 대상: 국민연금 업종 242403(화장품 제조업) 사업장 + 식약처 제조업 허가 업체와 사업자번호 앞 6자리·상호가 맞는 사업장
//
// 최근 13개월(기준월 M−12 ~ M)의 가입자수·고지금액을 사업장별로 모은다. 달마다 화장품 대상 사업장만 추린
// 스냅숏(data/growth/snap-YYYY-MM.json)을 남겨, 다음 달부터는 새 달 파일 하나만 내려받는다.
// 대시보드는 1·2·3개월 전과 작년 같은 달 대비 가입자수 증감을 이 시계열에서 바로 계산한다.
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.DATA_GO_KR_API_KEY;
const OUT = path.resolve('data/growth');
const COSMETIC_CODE = '242403';
const MONTHS = 13;                 // M−12 ~ M (작년 같은 달까지)
const DS = '15083277';
const log = (...a) => console.log('[growth]', ...a);
const notice = (t) => console.log(`::notice::${String(t).replace(/%/g, '%25').replace(/\r?\n/g, ' ').slice(0, 4000)}`);

const nk = (s) => String(s || '')
  .replace(/\(주\)|㈜|주식회사|유한회사|\(유\)|농업회사법인|\s/g, '')
  .replace(/[-_]?(비정규|일용|파견|계약직|본사|본점|지점|공장|제\d공장|\d공장)$/, '')
  .toLowerCase();
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

async function fetchOk(url, init = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0 (vendor-scout growth)', ...(init.headers || {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 2000 * (i + 1))); }
  }
  throw last;
}

// ── ① 국민연금 파일: 최신 + 과거 버전 목록 ──
async function npsVersions() {
  const page = await (await fetchOk(`https://www.data.go.kr/data/${DS}/fileData.do`)).text();
  const cur = (page.match(/uddi:[0-9a-f-]{20,}/i) || [])[0];
  const next = (page.replace(/<[^>]+>/g, ' ').match(/차기\s*등록\s*예정일\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const curDate = ((page.match(/<title>[^<]*_(\d{8})/) || [])[1]) || null;
  if (!cur) throw new Error('국민연금 파일 식별자(uddi)를 찾지 못했습니다');
  const body = new URLSearchParams({ publicDataPk: DS, publicDataDetailPk: cur });
  const hist = await (await fetchOk('https://www.data.go.kr/tcs/dss/selectHistAndCsvData.do', {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `https://www.data.go.kr/data/${DS}/fileData.do` } })).text();
  const past = [...hist.matchAll(/data-public-pk=["'](uddi:[0-9a-f-]+)["'][^>]*>\s*[^<]*?_(\d{8})\s*</g)].map((m) => ({ uddi: m[1], date: m[2] }));
  const all = [{ uddi: cur, date: curDate }, ...past.filter((p) => p.uddi !== cur)];
  // 파일 날짜(등록일)의 전달이 기준월이다(예: _20260923 → 2026-08). 실제 기준월은 내려받은 뒤 자료생성년월로 확인한다.
  all.forEach((v) => { if (v.date) v.ym = ymAdd(`${v.date.slice(0, 4)}-${v.date.slice(4, 6)}`, -1); });
  log(`국민연금 파일 버전 ${all.length}개 (최신 ${curDate}, 과거 ${past.length})`);
  return { versions: all, next };
}
async function npsDownload(uddi) {
  const meta = await (await fetchOk(`https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?publicDataPk=${DS}&publicDataDetailPk=${uddi}&fileDetailSn=1`,
    { headers: { Referer: `https://www.data.go.kr/data/${DS}/fileData.do` } })).text();
  const atch = (meta.match(/"atchFileId"\s*:\s*"(FILE_[0-9]+)"/) || [])[1];
  if (!atch) throw new Error(`첨부 번호 없음(${uddi})`);
  // 파일 하나가 약 115MB다. 포털이 느려도 한 파일에 10분 넘게 붙잡히지 않게 끊고 다시 시도한다.
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
    try {
      const r = await fetchOk(`https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${atch}&fileDetailSn=1&insertDataPrcus=N`, { signal: ctrl.signal }, 2);
      const buf = new Uint8Array(await r.arrayBuffer());
      clearTimeout(tm);
      log(`  ${atch} ${(buf.length / 1e6).toFixed(0)}MB · ${Math.round((Date.now() - t0) / 1000)}초`);
      return new TextDecoder('euc-kr').decode(buf);
    } catch (e) { clearTimeout(tm); if (i) throw e; log(`  ${atch} 다시 시도 (${e.message})`); }
  }
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
    const j = await (await fetchOk(`${BASE}?${q}`)).json();
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
  const ind = {}; all.forEach((x) => { ind[x.INDUTY] = (ind[x.INDUTY] || 0) + 1; });
  log(`식약처 명단 ${all.length}/${first.total}건 · 업종별 ${JSON.stringify(ind)}`);
  const seen = new Map();
  all.filter((x) => /제조/.test(String(x.INDUTY || '')) && !/판매/.test(String(x.INDUTY || ''))).forEach((x) => {
    const bz = String(x.BIZRNO || '').replace(/\D/g, '');
    const key = `${bz.slice(0, 6)}|${nk(x.ENTP_NAME)}`;
    if (!seen.has(key)) seen.set(key, { name: x.ENTP_NAME, bz6: bz.slice(0, 6), key: nk(x.ENTP_NAME) });
  });
  return [...seen.values()];
}

// 한 달 파일 → 화장품 대상 사업장만 추린 스냅숏
function extract(txt, byBz6) {
  const lines = txt.split(/\r?\n/);
  const head = parseCsvLine(lines[0]);
  const col = (re) => head.findIndex((h) => re.test(h));
  const C = {
    ym: col(/생성년월/), nm: col(/사업장명/), bz: col(/사업자등록번호/), st: col(/가입상태/), jibun: col(/지번상세주소/), road: col(/도로명상세주소/),
    ldong: col(/고객법정동주소코드/), code: head.findIndex((h) => /업종코드/.test(h) && !/명/.test(h)), codeNm: col(/업종코드명/),
    cnt: col(/^가입자수/), amt: col(/고지금액/), nw: col(/신규취득/), ls: col(/상실/),
  };
  if (Object.values(C).some((i) => i < 0)) throw new Error(`국민연금 파일 열이 예상과 다릅니다: ${head.join('|')}`);
  let ym = '';
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = parseCsvLine(lines[i]);
    if (c[C.st] !== '1') continue;
    const key = nk(c[C.nm]);
    const mf = (byBz6.get(c[C.bz]) || []).find((m) => m.key.length >= 2 && key.length >= 2 && (key.includes(m.key) || m.key.includes(key)));
    if (c[C.code] !== COSMETIC_CODE && !mf) continue;
    ym = ym || c[C.ym];
    rows.push({
      id: `${c[C.bz]}|${key}|${c[C.ldong]}`, alt: `${c[C.bz]}|${c[C.ldong]}`,
      nm: c[C.nm], bz6: c[C.bz], addr: (c[C.road] || c[C.jibun] || '').trim(), codeNm: c[C.codeNm],
      cos: c[C.code] === COSMETIC_CODE, mfds: mf ? mf.name : null, temp: /비정규|일용|파견|계약직/.test(c[C.nm]),
      cnt: +c[C.cnt] || 0, amt: +c[C.amt] || 0, nw: +c[C.nw] || 0, ls: +c[C.ls] || 0,
    });
  }
  return { ym, rows };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // 조회 요청이 들어와도 포털의 최신 파일이 지난번과 같으면 아무것도 내려받지 않고 끝낸다
  // (4천여 제조업체 대조·115MB 내려받기는 새 달 자료가 나왔을 때만). FORCE=1이면 다시 만든다.
  const { versions, next } = await npsVersions();
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'latest.json'), 'utf8'));
    if (process.env.FORCE !== '1' && prev.fileDate && prev.fileDate === versions[0].date) {
      notice(`최신 국민연금 파일(${versions[0].date})이 지난 집계와 같습니다 — 내려받기·대조 없이 끝냅니다. 다음 공개 예정 ${next || '미정'}`);
      return;
    }
  } catch { /* 이전 집계 없음 */ }
  const mfds = await mfdsRegister().catch((e) => { log('식약처 명단 실패', e.message); return []; });
  const byBz6 = new Map();
  mfds.forEach((m) => { if (!byBz6.has(m.bz6)) byBz6.set(m.bz6, []); byBz6.get(m.bz6).push(m); });
  const snapPath = (ym) => path.join(OUT, `snap-${ym}.json`);
  // 최신 파일은 매번 받는다(같은 달이라도 정정될 수 있다). 과거 달은 스냅숏이 없을 때만.
  const latestTxt = await npsDownload(versions[0].uddi);
  const latest = extract(latestTxt, byBz6);
  const M = latest.ym;
  fs.writeFileSync(snapPath(M), JSON.stringify(latest));
  log(`최신 기준월 ${M} · 대상 ${latest.rows.length}곳`);
  const want = Array.from({ length: MONTHS }, (_, i) => ymAdd(M, -(MONTHS - 1) + i));   // 오래된 달 → 최신
  const got = { [M]: latest };
  let downloaded = 1;
  // 스냅숏이 없는 달만 내려받는다 — 처음 한 번은 12개 파일, 그 뒤로는 달마다 새 파일 하나. 세 개씩 동시에.
  const missing = [];
  for (const ym of want.slice(0, -1)) {
    if (fs.existsSync(snapPath(ym))) { got[ym] = JSON.parse(fs.readFileSync(snapPath(ym), 'utf8')); continue; }
    const v = versions.find((x) => x.ym === ym);
    if (!v) { log(`${ym} 파일 없음`); continue; }
    missing.push({ ym, v });
  }
  const failed = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < missing.length) {
      const { ym, v } = missing[cursor++];
      try {
        const snap = extract(await npsDownload(v.uddi), byBz6);
        downloaded++;
        if (snap.ym !== ym) log(`주의: ${v.date} 파일의 기준월이 ${snap.ym}(예상 ${ym})`);
        got[snap.ym] = snap;
        fs.writeFileSync(snapPath(snap.ym), JSON.stringify(snap));   // 받는 대로 저장 — 중간에 끊겨도 다음 실행이 이어 받는다
        log(`${snap.ym} 스냅숏 ${snap.rows.length}곳`);
      } catch (e) { failed.push(ym); log(`${ym} 내려받기 실패 ${e.message}`); }
    }
  }));
  if (failed.length) notice(`내려받지 못한 달: ${failed.join(', ')} — 다음 실행에서 다시 시도합니다`);
  // 오래된 스냅숏 정리 — 13개월만 남긴다
  fs.readdirSync(OUT).filter((f) => /^snap-\d{4}-\d{2}\.json$/.test(f) && f < `snap-${want[0]}.json`).forEach((f) => fs.unlinkSync(path.join(OUT, f)));

  // 사업장별 13개월 시계열 — 같은 사업장은 (사업자번호 앞 6자리·상호·법정동)으로, 상호가 바뀌었으면 (사업자번호·법정동)이 하나뿐일 때만 잇는다
  const idx = want.map((ym) => {
    const s = got[ym]; if (!s) return null;
    const byId = new Map(s.rows.map((r) => [r.id, r]));
    const altCount = new Map(); s.rows.forEach((r) => altCount.set(r.alt, (altCount.get(r.alt) || 0) + 1));
    const byAlt = new Map(s.rows.filter((r) => altCount.get(r.alt) === 1).map((r) => [r.alt, r]));
    return { byId, byAlt };
  });
  const pick = (k, r) => (idx[k] ? (idx[k].byId.get(r.id) || idx[k].byAlt.get(r.alt) || null) : null);
  const rows = latest.rows.map((r) => {
    const seq = want.map((_, k) => pick(k, r));
    return {
      nm: r.nm, bz6: r.bz6, addr: r.addr, codeNm: r.codeNm, cos: r.cos, mfds: !!r.mfds, mfdsName: r.mfds, temp: r.temp,
      s: seq.map((x) => (x ? x.cnt : null)),          // 가입자수 시계열(오래된 달 → 기준월)
      a: seq.map((x) => (x ? x.amt : null)),          // 당월 고지금액 시계열
      nw: r.nw, ls: r.ls,
    };
  });
  // 업종 전체 추이 — 13개월 모두 잡힌 사업장만 더해야 '사업장이 새로 잡혀서' 늘어난 것과 섞이지 않는다
  const full = rows.filter((r) => r.s.every((v) => v != null) && !r.temp);
  const industry = { months: want, total: want.map((_, k) => full.reduce((a, r) => a + r.s[k], 0)), firms: full.length };
  const have = want.filter((ym) => got[ym]);
  const doc = {
    ym: M, months: want, have, nextUpdate: next, builtAt: new Date().toISOString(), fileDate: versions[0].date,
    source: '국민연금공단_국민연금 가입 사업장 내역(공공데이터포털 15083277, 월별 파일) · 식약처 화장품 제조업 공개 API',
    scope: '가입자 3인 이상 법인 사업장 · 업종 화장품 제조업(242403) 또는 식약처 제조업 허가 업체(사업자번호 앞 6자리·상호 일치)',
    counts: { rows: rows.length, cosmetics: rows.filter((r) => r.cos).length, mfds: rows.filter((r) => r.mfds).length, mfdsRegister: mfds.length },
    industry, rows,
  };
  fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(doc));
  notice(`기준월 ${M} · 대상 ${rows.length}곳 · 시계열 달 ${have.length}/${MONTHS} (${have[0]}~${have[have.length - 1]}) · 이번에 내려받은 파일 ${downloaded}개 · 13개월 모두 잡힌 사업장 ${full.length}곳`);
}

main().catch((e) => { console.error(e); process.exit(1); });
