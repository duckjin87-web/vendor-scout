// scripts/build-jobs.mjs — 채용공고 급등(화장품 제조업체, 최근 30일)
//
// growth.yml(조회 요청 때만 실행)의 두 번째 단계. 결과는 data/growth/jobs.json.
// 공식 API만 쓴다(2026-10 확인):
//   · 사람인 채용공고 API(oapi.saramin.co.kr/job-search) — access-key 필요(SARAMIN_KEY). 게시일 범위 지정 가능
//   · 고용24 채용정보 OpenAPI(work24.go.kr) — 인증키 필요(WORK24_KEY). 등록일 구간은 '최근 1개월'처럼 상대값만
//   잡코리아는 공개 API가 없고, 인크루트·링크드인은 robots.txt가 전체 수집을 막아(Disallow: /) 쓰지 않는다.
//
// 대상: 식약처 화장품 제조업 허가 업체(공개 API의 INDUTY '화장품제조')와 상호가 맞는 회사의 공고만 센다.
// 급등: 최근 30일 공고 3건 이상이면서 직전 30일의 2배 이상(직전 0건 포함).
//   직전 30일은 사람인 게시일 범위로 직접 센다. 고용24는 상대 구간뿐이라, 지난 실행에서 저장한 값과 비교한다.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/growth');
const KEY = process.env.DATA_GO_KR_API_KEY;
const SARAMIN = process.env.SARAMIN_KEY;
const WORK24 = process.env.WORK24_KEY;
const DAY = 864e5;
const log = (...a) => console.log('[jobs]', ...a);
const notice = (t) => console.log(`::notice::${String(t).replace(/%/g, '%25').replace(/\r?\n/g, ' ').slice(0, 4000)}`);
const nk = (s) => String(s || '')
  .replace(/\(주\)|㈜|주식회사|유한회사|\(유\)|농업회사법인|\s/g, '')
  .replace(/[-_]?(본사|본점|지점|공장|제\d공장|\d공장)$/, '')
  .toLowerCase();
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
// 화장품 제조 관련 공고를 넓게 받는 검색어 — 회사 쪽 대조(식약처 제조업 명단)로 좁힌다
const KEYWORDS = ['화장품 제조', '화장품 생산', '화장품 OEM', '화장품 ODM', '화장품 연구', '화장품 품질', '화장품 충전', '화장품 포장'];
const PROD_RE = /생산|제조|충전|포장|조색|칭량|오퍼레이터|기계|설비|품질|QC|QA|공정|라인/i;

async function getJson(url, init = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': 'vendor-scout jobs', Accept: 'application/json', ...(init.headers || {}) } });
      const t = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`);
      return t;
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 1500 * (i + 1))); }
  }
  throw last;
}

// 식약처 화장품 제조업 명단(상호 대조용)
async function makers() {
  if (!KEY) return [];
  const BASE = 'https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService01/getCsmtcsMfcrtrInfoList01';
  const page = async (n) => {
    const j = JSON.parse(await getJson(`${BASE}?${new URLSearchParams({ serviceKey: KEY, type: 'json', pageNo: String(n), numOfRows: '500' })}`));
    const b = j.body || (j.response && j.response.body) || {};
    let it = b.items; if (it && it.item) it = it.item;
    it = Array.isArray(it) ? it : (it ? [it] : []);
    return { total: Number(b.totalCount) || 0, items: it.map((x) => (x && x.item && typeof x.item === 'object' ? x.item : x)) };
  };
  const first = await page(1);
  const all = [...first.items];
  const pages = Math.ceil(first.total / 500);
  for (let p = 2; p <= pages; p += 4) {
    (await Promise.all([p, p + 1, p + 2, p + 3].filter((x) => x <= pages).map((x) => page(x).catch(() => ({ items: [] }))))).forEach((g) => all.push(...g.items));
  }
  const m = new Map();
  all.filter((x) => /제조/.test(String(x.INDUTY || '')) && !/판매/.test(String(x.INDUTY || ''))).forEach((x) => {
    const k = nk(x.ENTP_NAME); if (k.length >= 2 && !m.has(k)) m.set(k, x.ENTP_NAME);
  });
  return m;
}

// ── 사람인 ── 공고: company.detail.name · position.title · posting-timestamp(초) · url
export function saraminParse(text) {
  const j = JSON.parse(text);
  if (j.code && !j.jobs) throw new Error(`사람인 오류 ${j.code} ${j.message || ''}`);
  const jobs = (j.jobs && j.jobs.job) || [];
  return { total: Number(j.jobs && j.jobs.total) || 0, items: jobs.map((x) => ({
    company: x.company && x.company.detail ? x.company.detail.name : '',
    title: x.position ? x.position.title : '',
    at: Number(x['posting-timestamp']) * 1000 || Date.parse(x['posting-date']) || null,
    url: x.url || '', src: '사람인',
  })) };
}
async function saramin(fromMs, toMs) {
  const out = [];
  for (const kw of KEYWORDS) {
    for (let start = 0; start < 10; start++) {          // 검색어당 최대 10쪽 × 110건
      const q = new URLSearchParams({ 'access-key': SARAMIN, keywords: kw, published_min: String(Math.floor(fromMs / 1000)), published_max: String(Math.floor(toMs / 1000)),
        count: '110', start: String(start), sort: 'pd', fields: 'posting-date' });
      const r = saraminParse(await getJson(`https://oapi.saramin.co.kr/job-search?${q}`));
      out.push(...r.items);
      if (r.items.length < 110 || out.length >= r.total) break;
    }
  }
  return out;
}

// ── 고용24 ── 공고(XML): <wanted><company>, <title>, <regDt>YY-MM-DD, <wantedInfoUrl>
export function work24Parse(xml) {
  const err = (xml.match(/<error>([\s\S]*?)<\/error>/) || [])[1];
  if (err) throw new Error(`고용24 오류 ${err.trim()}`);
  const tag = (s, t) => ((s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  const total = Number(tag(xml, 'total')) || 0;
  const items = [...xml.matchAll(/<wanted>([\s\S]*?)<\/wanted>/g)].map((m) => {
    const d = tag(m[1], 'regDt');
    const iso = /^\d{2}-\d{2}-\d{2}$/.test(d) ? `20${d}` : d;
    return { company: tag(m[1], 'company'), title: tag(m[1], 'title'), at: Date.parse(iso) || null, url: tag(m[1], 'wantedInfoUrl'), src: '고용24' };
  });
  return { total, items };
}
async function work24() {
  const out = [];
  for (const kw of KEYWORDS.slice(0, 4)) {
    for (let page = 1; page <= 10; page++) {
      const q = new URLSearchParams({ authKey: WORK24, callTp: 'L', returnType: 'XML', startPage: String(page), display: '100', keyword: kw, regDate: 'M-1' });
      const r = work24Parse(await getJson(`https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do?${q}`, { headers: { Accept: 'application/xml' } }));
      out.push(...r.items);
      if (r.items.length < 100) break;
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const now = Date.now(), from = now - 30 * DAY, prevFrom = now - 60 * DAY;
  const doc = { builtAt: new Date(now).toISOString(), window: { from: ymd(from), to: ymd(now) }, prevWindow: { from: ymd(prevFrom), to: ymd(from) },
    sources: {}, rows: [], note: '잡코리아는 공개 API가 없고, 인크루트·링크드인은 robots.txt가 수집을 막아 제외했습니다.' };
  if (!SARAMIN && !WORK24) {
    doc.sources = { saramin: { ok: false, err: 'SARAMIN_KEY 미등록' }, work24: { ok: false, err: 'WORK24_KEY 미등록' } };
    fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(doc));
    notice('채용 급등: 사람인·고용24 API 키가 없어 건너뜀(jobs.json에 사유 기록)');
    return;
  }
  const mk = await makers();
  log(`식약처 제조업 ${mk.size}곳`);
  const cur = [], prev = [];
  if (SARAMIN) {
    try {
      const a = await saramin(from, now), b = await saramin(prevFrom, from);
      cur.push(...a); prev.push(...b);
      doc.sources.saramin = { ok: true, cur: a.length, prev: b.length };
    } catch (e) { doc.sources.saramin = { ok: false, err: e.message }; }
  } else doc.sources.saramin = { ok: false, err: 'SARAMIN_KEY 미등록' };
  if (WORK24) {
    try { const a = await work24(); cur.push(...a); doc.sources.work24 = { ok: true, cur: a.length }; } catch (e) { doc.sources.work24 = { ok: false, err: e.message }; }
  } else doc.sources.work24 = { ok: false, err: 'WORK24_KEY 미등록' };

  // 같은 공고가 검색어마다 겹친다 — 주소(또는 회사+제목)로 한 번만 센다
  const uniq = (arr) => { const s = new Set(); return arr.filter((x) => { const k = x.url || `${nk(x.company)}|${x.title}`; if (s.has(k)) return false; s.add(k); return true; }); };
  const count = (arr) => {
    const m = new Map();
    uniq(arr).forEach((x) => {
      const k = nk(x.company); if (!mk.has(k)) return;              // 식약처 화장품 제조업체만
      const e = m.get(k) || { n: 0, prod: 0, src: {}, posts: [] };
      e.n++; if (PROD_RE.test(x.title)) e.prod++;
      e.src[x.src] = (e.src[x.src] || 0) + 1;
      e.posts.push({ t: x.title, u: x.url, d: x.at ? ymd(x.at) : null, s: x.src });
      m.set(k, e);
    });
    return m;
  };
  const C = count(cur), P = count(prev);
  // 고용24 직전 값 — 지난 실행의 jobs.json에서(상대 구간이라 직접 못 센다)
  let last = null; try { last = JSON.parse(fs.readFileSync(path.join(OUT, 'jobs.json'), 'utf8')); } catch { /* 처음 */ }
  const lastW24 = new Map(((last && last.rows) || []).map((r) => [nk(r.nm), (r.src && r.src['고용24']) || 0]));
  doc.rows = [...C.entries()].map(([k, e]) => {
    // 직전 30일 = 사람인 직전 구간 공고 수 + (고용24에서 잡혔으면) 지난 실행 때의 고용24 공고 수
    const prevN = (P.get(k) || { n: 0 }).n + (e.src['고용24'] ? (lastW24.get(k) || 0) : 0);
    return { nm: mk.get(k), cur: e.n, prev: prevN, prod: e.prod, src: e.src,
      posts: e.posts.sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, 5) };
  }).sort((a, b) => b.cur - a.cur);
  fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(doc));
  notice(`채용 급등: 최근 30일 공고가 잡힌 화장품 제조업체 ${doc.rows.length}곳 · 소스 ${JSON.stringify(doc.sources)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); notice(`채용 급등 집계 실패: ${e.message}`); process.exit(1); });
