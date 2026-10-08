// scripts/build-makers.mjs — 화장품 제조업 명단 누적 관리(매주 + 조회 요청 때)
//
// 식약처 화장품 제조업 공개 API(CsmtcsMfcrtrInfoService01)의 명단을 받아, 지난번까지 쌓아 둔 누적 명단과 비교한다.
//   data/growth/makers-ledger.json — 누적 명단(업체별 처음 본 날·마지막으로 본 날·빠진 날) + 실행 기록
//   data/growth/makers.json        — 대시보드용 요약(신규·빠진 업체, 월별 신규 허가)
// 명단에는 폐업·상태 칸이 없다(2026-10 확인: INDUTY·ENTP_SEQ·ENTP_NAME·ENTP_PERMIT_DATE·FACTORY_ADDR·BIZRNO뿐).
// 빠진 업체는 지난번 명단과 비교해야만 알 수 있어 누적 명단을 저장소에 남긴다.
// 허가일은 4,318곳 모두에 있고 하루 전 허가분까지 반영돼 있었다(2026-10-08 진단).
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/growth');
const KEY = process.env.DATA_GO_KR_API_KEY;
const DAY = 864e5;
const NED_MAX = 40;                    // 한 번 실행에 번지 주소를 보강할 최대 업체 수(신규는 한 달 30곳 안팎)
const log = (...a) => console.log('[makers]', ...a);
const notice = (t) => console.log(`::notice::${String(t).replace(/%/g, '%25').replace(/\r?\n/g, ' ').slice(0, 4000)}`);
const nk = (s) => String(s || '').replace(/\(주\)|㈜|주식회사|유한회사|\(유\)|농업회사법인|\s/g, '').toLowerCase();
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const d8 = (s) => String(s || '').replace(/\D/g, '').slice(0, 8);
const iso8 = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return null; } };

async function fetchOk(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw last;
}

// 식약처 명단 전체(제조·책임판매·맞춤형) — 책임판매 기록은 '기존 책임판매업자가 제조에 진입' 표시에 쓴다
async function register() {
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
    // 한 쪽이라도 실패하면 그 쪽 업체가 전부 '빠짐'으로 잡힌다 — 실패를 삼키지 않고 실행을 멈춘다
    const got = await Promise.all([p, p + 1, p + 2, p + 3].filter((x) => x <= pages).map((x) => page(x)));
    got.forEach((g) => all.push(...g.items));
  }
  if (all.length < first.total * 0.98) throw new Error(`명단을 다 받지 못했습니다 (${all.length}/${first.total})`);
  return { all, total: first.total };
}

// 의약품안전나라 목록 화면 — 번지까지 있는 제조소 주소(공개 API는 시·군까지만)
// 식약처 CGMP(우수화장품 제조 및 품질관리기준) 적합업소 — 항목 이름이 확정되지 않아(BSSH_NM·ENTP_NAME 등)
// 레코드의 모든 값을 상호 키로 바꿔 모은다. 사전검증 리포트(matchByName)와 같은 방식이다.
async function gmpNames() {
  const BASE = 'https://apis.data.go.kr/1471000/CsmtcsGmpStbltCompInfo/getCsmtcsGmpStbltCompInfo';
  const page = async (n) => {
    const q = new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(n), numOfRows: '500' });
    const j = await (await fetchOk(`${BASE}?${q}`)).json();
    const b = j.body || (j.response && j.response.body) || {};
    let it = b.items; if (it && it.item) it = it.item;
    it = Array.isArray(it) ? it : (it ? [it] : []);
    return { total: Number(b.totalCount) || 0, items: it.map((x) => (x && x.item && typeof x.item === 'object' ? x.item : x)) };
  };
  const first = await page(1);
  const all = [...first.items];
  for (let p = 2; p <= Math.ceil(first.total / 500); p++) all.push(...(await page(p)).items);
  const names = new Set();
  all.forEach((x) => Object.values(x || {}).forEach((v) => { const k = nk(v); if (k.length >= 2 && !/^\d+$/.test(k)) names.add(k); }));
  return { names, n: all.length };
}

async function nedrugAddr(name) {
  const nm = String(name || '').replace(/\(주\)|㈜|주식회사/g, '').trim();
  const url = `https://nedrug.mfds.go.kr/pbp/CCBBA01/getList?searchYn=true&page=1&limit=50&cobCode=V&entpName=${encodeURIComponent(nm)}`;
  const html = await (await fetchOk(url, { headers: { 'User-Agent': 'Mozilla/5.0 vendor-scout' } }, 2)).text();
  const txt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    if (!/getItem/.test(m[1])) return null;
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => txt(x[1]));
    return { name: tds[1] || '', addr: tds[4] || '' };
  }).filter(Boolean);
  const hit = rows.find((r) => nk(r.name) === nk(name));
  if (!hit || !hit.addr) return null;
  // 한 줄에 제조소가 여럿 이어지면 첫 곳만(목록 표시용) — 전부는 사전검증 리포트에서 본다
  return hit.addr.split(/\s*,\s*(?=(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주))/)[0].slice(0, 120);
}

export async function main() {
  if (!KEY) { notice('제조업 명단: DATA_GO_KR_API_KEY가 없어 건너뜀'); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const now = Date.now(), today = ymd(now);
  const { all, total } = await register();
  const isMaker = (x) => /제조/.test(String(x.INDUTY || '')) && !/판매/.test(String(x.INDUTY || ''));
  const makers = all.filter(isMaker);
  // 사업자번호별 다른 기록 — 기존 책임판매업자·기존 제조사의 새 공장 표시용
  const byBz = new Map();
  all.forEach((x) => {
    const bz = String(x.BIZRNO || '').replace(/\D/g, '');
    if (bz.length !== 10) return;
    if (!byBz.has(bz)) byBz.set(bz, []);
    byBz.get(bz).push({ seq: String(x.ENTP_SEQ || ''), sale: /판매/.test(String(x.INDUTY || '')), p: d8(x.ENTP_PERMIT_DATE) });
  });
  log(`명단 ${all.length}/${total} · 제조 ${makers.length}`);

  const prev = readJson('makers-ledger.json');
  const base = !prev || !prev.firms;                     // 첫 실행 — 비교 대상이 없어 '이번 조회 추가'를 세지 않는다
  const firms = base ? {} : prev.firms;
  const idOf = (x) => String(x.ENTP_SEQ || '') || `${String(x.BIZRNO || '').replace(/\D/g, '')}|${nk(x.ENTP_NAME)}`;
  const cur = new Set();
  const added = [], renamed = [];
  makers.forEach((x) => {
    const id = idOf(x); cur.add(id);
    const bz = String(x.BIZRNO || '').replace(/\D/g, '');
    const rec = { n: String(x.ENTP_NAME || '').trim(), bz, a: String(x.FACTORY_ADDR || '').trim(), p: d8(x.ENTP_PERMIT_DATE) };
    const old = firms[id];
    if (!old) { firms[id] = { ...rec, f: today, l: today }; if (!base) added.push(id); return; }
    if (old.g) { delete old.g; old.back = today; if (!base) added.push(id); }       // 빠졌다가 다시 들어옴
    if (nk(old.n) !== nk(rec.n)) { old.on = old.n; old.rn = today; renamed.push(id); }
    Object.assign(old, rec, { l: today });
  });
  const removed = Object.keys(firms).filter((id) => !cur.has(id) && !firms[id].g);
  removed.forEach((id) => { firms[id].g = today; });
  // 같은 사업자번호가 빠지고 새로 들어왔으면 '빠짐+추가'가 아니라 상호·기록 변경이다
  const addedBz = new Map(added.map((id) => [firms[id].bz, id]));
  const pairs = [];
  removed.forEach((id) => { const bz = firms[id].bz; if (bz && addedBz.has(bz)) pairs.push([id, addedBz.get(bz)]); });
  pairs.forEach(([o, n]) => { firms[n].on = firms[o].n; firms[n].rn = today; firms[o].to = firms[n].n; });
  const pairOld = new Set(pairs.map((p) => p[0])), pairNew = new Set(pairs.map((p) => p[1]));
  const addedReal = added.filter((id) => !pairNew.has(id));
  const removedReal = removed.filter((id) => !pairOld.has(id));

  // ── 대시보드에 올릴 업체: 이번 조회 추가 + 허가일 90일 이내 ──
  const since = (n) => ymd(now - n * DAY).replace(/-/g, '');
  const live = Object.entries(firms).filter(([, r]) => !r.g);
  const showIds = new Set([...addedReal, ...live.filter(([, r]) => r.p >= since(90)).map(([id]) => id)]);

  // 번지 주소 보강(의약품안전나라) — 아직 없는 것만, 최근 허가 순으로 최대 NED_MAX곳
  const need = [...showIds].filter((id) => firms[id] && !firms[id].ad && !firms[id].adTry).sort((a, b) => firms[b].p.localeCompare(firms[a].p)).slice(0, NED_MAX);
  let nedOk = 0, nedErr = '';
  for (const id of need) {
    try { const ad = await nedrugAddr(firms[id].n); firms[id].adTry = today; if (ad) { firms[id].ad = ad; nedOk++; } } catch (e) { nedErr = e.message; break; }
  }

  // 국민연금(가장 최근 월간 스냅숏) · 채용공고(jobs.json)
  const snaps = fs.readdirSync(OUT).filter((f) => /^snap-\d{4}-\d{2}\.json$/.test(f)).sort();
  const snap = snaps.length ? readJson(snaps[snaps.length - 1]) : null;
  const npsBy = new Map();
  ((snap && snap.rows) || []).forEach((r) => {
    [nk(r.nm), nk(r.mfds)].filter(Boolean).forEach((k) => {
      const key = `${r.bz6}|${k}`; const o = npsBy.get(key);
      npsBy.set(key, { cnt: (o ? o.cnt : 0) + (Number(r.cnt) || 0) });
    });
  });
  // CGMP 적합업소 — 실패해도 명단 갱신은 계속(배지만 '확인 못 함')
  let gmp = null;
  try { gmp = await gmpNames(); log(`CGMP 적합업소 ${gmp.n}건`); } catch (e) { log(`CGMP 목록 실패: ${e.message}`); }
  const jobs = readJson('jobs.json');
  const jobBy = new Map(((jobs && jobs.rows) || []).map((r) => [nk(r.nm), r.cur]));

  const view = (id) => {
    const r = firms[id];
    const other = (byBz.get(r.bz) || []).filter((o) => o.seq !== id);
    const nps = npsBy.get(`${r.bz.slice(0, 6)}|${nk(r.n)}`);
    return {
      id, n: r.n, a: r.a, ad: r.ad || null, p: iso8(r.p), f: r.f,
      add: addedReal.includes(id) || undefined,
      on: r.rn === today ? r.on : undefined,
      // 같은 사업자번호의 더 이른 책임판매업 기록 → 브랜드사가 제조로 진입 / 더 이른 제조 기록 → 기존 제조사의 새 제조소
      sale: other.some((o) => o.sale && o.p && o.p < r.p) || undefined,
      more: other.some((o) => !o.sale && o.p && o.p < r.p) || undefined,
      nps: nps ? nps.cnt : null,
      job: jobBy.has(nk(r.n)) ? jobBy.get(nk(r.n)) : undefined,
      gmp: gmp ? gmp.names.has(nk(r.n)) : null,          // true 적합 · false 목록에 없음 · null 목록 조회 실패
    };
  };
  const recent = [...showIds].map(view).sort((a, b) => String(b.p).localeCompare(String(a.p)) || a.n.localeCompare(b.n));
  const gone = removedReal.map((id) => { const v = view(id); return { ...v, last: prev && prev.at ? prev.at : null }; });
  const renames = pairs.map(([o, n]) => ({ from: firms[o].n, to: firms[n].n, a: firms[n].a }))
    .concat(renamed.map((id) => ({ from: firms[id].on, to: firms[id].n, a: firms[id].a })));

  // 월별 신규 허가(최근 13개월) — 지금 명단에 있는 업체의 허가일 기준
  const months = [];
  for (let i = 12; i >= 0; i--) { const t = new Date(now); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - i); months.push(t.toISOString().slice(0, 7)); }
  const monthly = months.map((ym) => ({ ym, n: live.filter(([, r]) => r.p.startsWith(ym.replace('-', ''))).length }));
  const cnt = (n) => live.filter(([, r]) => r.p >= since(n)).length;

  const runs = [...((prev && prev.runs) || []), { at: today, total: live.length, added: addedReal.length, removed: removedReal.length, renamed: renames.length, base }].slice(-104);
  const doc = {
    builtAt: new Date(now).toISOString(), at: today, prevAt: base ? null : prev.at, base,
    source: '식약처 화장품 제조업 허가 명단(공개 API) · 번지 주소 의약품안전나라 · 인원 국민연금 월간 파일',
    npsYm: snap ? snap.ym : null, gmpOk: !!gmp, gmpN: gmp ? gmp.n : null, jobsAt: jobs ? jobs.builtAt : null,
    total: live.length, counts: { d30: cnt(30), d90: cnt(90), d365: cnt(365), added: addedReal.length, removed: removedReal.length, renamed: renames.length },
    monthly, recent, removed: gone, renames, runs: runs.slice(-12),
  };
  fs.writeFileSync(path.join(OUT, 'makers-ledger.json'), JSON.stringify({ v: 1, at: today, runs, firms }));
  fs.writeFileSync(path.join(OUT, 'makers.json'), JSON.stringify(doc));
  notice(`제조업 명단 ${live.length}곳${base ? ' (첫 실행 — 기준 명단 저장)' : ` · 지난 조회(${prev.at}) 대비 추가 ${addedReal.length} · 빠짐 ${removedReal.length} · 상호변경 ${renames.length}`}`
    + ` · CGMP 목록 ${gmp ? `${gmp.n}건(전체 명단 중 적합 ${live.filter(([, r]) => gmp.names.has(nk(r.n))).length}곳 · 신규 중 ${recent.filter((r) => r.gmp).length}곳)` : '조회 실패'}`
    + ` · 최근 30일 허가 ${doc.counts.d30} · 번지 보강 ${nedOk}/${need.length}${nedErr ? ` (중단: ${nedErr})` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); notice(`제조업 명단 갱신 실패: ${e.message}`); process.exit(1); });
