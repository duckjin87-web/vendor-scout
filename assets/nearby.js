// nearby.js — 근처 업체 탭
// 조회한 업체(기점)의 주소를 기준으로, 식약처 '화장품 제조업' 허가 업체 중 가까운 곳을
// 지도와 목록으로 보여준다. 방문 가는 길에 들를 만한 곳을 보고 동선을 짜려는 것이다.
//
// 화면 — 시안 A(지도 중심)와 B(리스트·동선)를 합친다
//   머리줄: 조회 업체명 (기준 주소) · [주소 수정] — 기준이 틀렸으면 고쳐서 다시 찾는다
//   지도(A): 기점 ◆, 반경 링, 제조업 허가 ● / CGMP 적합 ●, 선택 업체 카드(상세 주소·차량 이동시간)
//   목록(B): 전체 · CGMP 적합 · 위치 미확인 탭, 지역 단계별 묶음, 펼치면 동선 담기·사전검증 리포트
//
// ── 어떻게 찾나 ──
// 업체의 출처는 식약처 화장품제조업 명단 하나다. 카카오 장소검색으로 긁어 온 업체는 목록에
// 올리지 않는다(허가 없는 판매점·물류창고가 섞였다). 카카오는 '위치를 찾는 도구'로만 쓴다.
//   ① 주소로 먼저 좁힌다 — 기점과 같은 읍·면·동 → 같은 시·군·구 → 같은 시·도 → 인접 시·도.
//      글자 주소만으로 되므로 요청이 없다. 먼 시·군은 그 시·군의 중심 좌표로 거리를 가늠해
//      반경 밖이면 좌표 변환을 하지 않는다(중심점은 순서·거르기에만 쓰고 화면에 찍지 않는다).
//   ② 업체 좌표는 '번지까지 맞은 결과'만 쓴다. 결과의 시·도·시·군이 글자 주소와 달라도 버린다.
//      못 맞으면 업체 이름으로 카카오 지도에서 찾되 시·군까지 같아야 쓴다.
//      끝내 못 맞으면 지도에 찍지 않고 '위치 미확인'으로 목록에만 둔다.
//   ③ 이동시간은 목록에서는 직선거리로 추정하고, 업체를 고르면 카카오내비 실측으로 바꾼다.
//
// 이 파일은 app.js 뒤에 로드되며 app.js의 전역($, el, esc, proxyOnlyGet, proxyGet, pickByKey,
// stripCorp, visitAddress, lookup, mapLimit, BUILD)과 samples.js의 listOf·haversineKm를 쓴다.
// 모두 사용 시점(탭을 연 뒤)에만 부른다.

const NB = {
  RADII: [10, 30, 50],
  DEFAULT_RADIUS: 30,
  MAX_KM: 50,
  GEO_BATCH: 30,          // 먼 단계(같은 시·도 이상) 업체 좌표 변환 — 한 번에 이만큼
  NEAR_CAP: 150,          // 같은 시·군 이내는 자동으로 전부 확인하되 안전 상한
  NAME_RETRY: 12,         // 번지가 안 맞은 가까운 업체를 이름으로 다시 찾는 수
  SGG_CAP: 40,            // 한 번에 중심 좌표를 구할 시·군 수(결과는 저장돼 다음부터 요청 없음)
  MFDS_PAGE: 500,
  MFDS_MAX_PAGES: 12,
};
const NB_ORIGIN_KEY = 'vs_nb_origin';   // 업체별로 사용자가 고친 기준 주소

// 인접 시·도 — 50km 반경은 도 경계를 쉽게 넘는다
const NB_ADJ = {
  서울: ['경기', '인천'], 부산: ['경남', '울산'], 대구: ['경북', '경남'], 인천: ['서울', '경기'],
  광주: ['전남'], 대전: ['세종', '충남', '충북'], 울산: ['부산', '경남', '경북'],
  세종: ['대전', '충남', '충북'], 경기: ['서울', '인천', '강원', '충북', '충남'],
  강원: ['경기', '충북', '경북'], 충북: ['경기', '강원', '경북', '대전', '세종', '충남', '전북'],
  충남: ['경기', '충북', '대전', '세종', '전북'], 전북: ['충남', '충북', '경북', '경남', '전남', '광주'],
  전남: ['광주', '전북', '경남'], 경북: ['강원', '충북', '전북', '경남', '대구', '울산'],
  경남: ['부산', '울산', '대구', '경북', '전북', '전남'], 제주: [],
};
// 주소 첫 토큰 → 시·도. '충청북도'와 '충북', '전북특별자치도'를 같은 값으로 모은다.
const NB_SIDO = [['서울', '서울'], ['부산', '부산'], ['대구', '대구'], ['인천', '인천'], ['광주', '광주'],
  ['대전', '대전'], ['울산', '울산'], ['세종', '세종'], ['경기', '경기'], ['강원', '강원'],
  ['충북', '충북'], ['충청북', '충북'], ['충남', '충남'], ['충청남', '충남'], ['전북', '전북'], ['전라북', '전북'],
  ['전남', '전남'], ['전라남', '전남'], ['경북', '경북'], ['경상북', '경북'], ['경남', '경남'], ['경상남', '경남'],
  ['제주', '제주']];
function nbSido(addr) {
  const t = String(addr || '').trim().split(/\s+/)[0] || '';
  for (const [k, v] of NB_SIDO) if (t.startsWith(k)) return v;
  return null;
}
// 글자 주소 → { sido, sgg(시·군·구 첫 토큰), emd(읍·면·동) }.
// '청주시 흥덕구'처럼 시 아래 구가 붙으면 시까지를 같은 시·군으로 본다. 세종은 시·군·구가 없다.
function nbAddrParts(addr) {
  const toks = String(addr || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  const sido = nbSido(addr);
  if (!sido) return { sido: null, sgg: '', emd: '' };
  let i = 1, sgg = '';
  if (toks[i] && /(시|군|구)$/.test(toks[i]) && !/^\d/.test(toks[i])) {
    sgg = toks[i]; i++;
    if (toks[i] && /구$/.test(toks[i]) && /시$/.test(sgg)) i++;
  }
  let emd = '';
  for (let j = i; j < Math.min(toks.length, i + 2); j++) {
    if (/(읍|면|동|가)$/.test(toks[j]) && !/(로|길)$/.test(toks[j]) && !/^\d/.test(toks[j])) { emd = toks[j]; break; }
  }
  return { sido, sgg, emd };
}
const nbRegionText = (p) => (p && p.sido ? [p.sido, p.sgg, p.emd].filter(Boolean).join(' ') : '');

// 기점과 얼마나 같은 지역인가 — 0 같은 읍·면·동 · 1 같은 시·군 · 2 같은 시·도 · 3 인접 시·도 · 4 그 밖
function nbTier(loc, p) {
  if (!p || !p.sido || !loc || !loc.sido) return 4;
  if (p.sido !== loc.sido) return (NB_ADJ[loc.sido] || []).includes(p.sido) ? 3 : 4;
  if ((p.sgg || '') !== (loc.sgg || '')) return 2;
  if (p.emd && loc.emd && p.emd === loc.emd) return 0;
  return 1;
}
function nbTierLabel(st, t) {
  const L = st.loc || {};
  return t === 0 ? `같은 읍·면·동 · ${L.emd}`
    : t === 1 ? `같은 시·군 · ${L.sgg || L.sido}`
      : t === 2 ? `같은 시·도 · ${L.sido}`
        : t === 3 ? '인접 시·도' : '그 밖';
}

// 상호 정규화 — 법인격·괄호·공백을 떼고, 끝에 붙은 사업장 구분(공장·본사·연구소…)을 지운다.
const NB_SITE_TOKEN = /(제?\d*공장|본사|연구소|연구센터|사업장|지점|센터|사무소|캠퍼스|\d+동|R&D센터)$/i;
function nbNorm(s) {
  const toks = stripCorp(String(s || ''))
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  while (toks.length > 1 && NB_SITE_TOKEN.test(toks[toks.length - 1])) toks.pop();
  return toks.join('').replace(NB_SITE_TOKEN, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}
const nbNameHit = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))));

// ── 이동시간 ──
// 목록은 요청 없이 추정한다: 직선 × 1.3(도로 우회) ÷ 거리대별 평균속도 + 진출입 3분.
// 가까운 길은 시내·국도라 느리고, 멀수록 고속도로 비중이 커진다.
function nbEstMin(km) {
  const road = km * 1.3;
  const kmh = road < 15 ? 35 : road < 40 ? 50 : 65;
  return Math.round((road / kmh) * 60) + 3;
}
const nbFmtMin = (m) => (m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`);
const nbFmtKm = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));

// ── 주소 → 좌표 (번지까지 맞은 결과만) ──
// 저장 키 vs_geo2. 옛 vs_geo에는 시·군 중심점이 업체 위치처럼 들어가 있어 지운다.
const NB_GEO_KEY = 'vs_geo2';
try { localStorage.removeItem('vs_geo'); } catch { /* 무시 */ }
function nbGeoGet(k) {
  try { const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}'); return m[k] || null; } catch { return null; }
}
function nbGeoSet(k, g) {
  try {
    const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}');
    m[k] = g;
    const keys = Object.keys(m);
    if (keys.length > 2500) keys.slice(0, keys.length - 2500).forEach((x) => { delete m[x]; });
    localStorage.setItem(NB_GEO_KEY, JSON.stringify(m));
  } catch { /* 저장 못 해도 이번 조회는 된다 */ }
}
// 식약처 주소는 괄호 속 동명·'외 1필지'·건물동·층이 섞여 있어 그대로는 번지가 안 맞는 일이 많다.
// 뒤를 조금씩 걷어 내며 시도한다 — 도로명은 '…로 12-3'까지, 지번은 '…리 123-4'까지만 남긴다.
function nbAddrVariants(a) {
  const out = [];
  const push = (x) => { x = String(x || '').replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim(); if (x && !out.includes(x)) out.push(x); };
  const base = String(a || '').replace(/\s+/g, ' ').trim();
  push(base);
  const noParen = base.replace(/\([^)]*\)/g, ' ').replace(/외\s*\d+\s*필지/g, ' ');
  const road = noParen.match(/^(.*?\S(?:로|길)\s*\d+(?:-\d+)?)(?=\D|$)/);
  if (road) push(road[1]);
  const lot = noParen.match(/^(.*?\S(?:동|리|가)\s*(?:산\s*)?\d+(?:-\d+)?)(?=\D|$)/);
  if (lot) push(lot[1]);
  push(noParen.split(',')[0]);
  return out.slice(0, 3);
}
const NB_EXACT = ['ROAD_ADDR', 'REGION_ADDR'];
function nbGeoFromDoc(d) {
  const reg = d.address || d.road_address || {};
  const r3 = String((d.address && d.address.region_3depth_name) || (d.road_address && d.road_address.region_3depth_name) || '');
  const ra = d.road_address, ja = d.address;
  const road = ra && ra.address_name ? `${ra.address_name}${ra.building_name ? ` (${ra.building_name})` : ''}` : '';
  return { lat: Number(d.y), lng: Number(d.x), exact: NB_EXACT.includes(d.address_type),
    sido: nbSido(reg.region_1depth_name || ''), sgg: String(reg.region_2depth_name || '').split(' ')[0] || '',
    emd: r3.split(' ')[0] || '', road, jibun: (ja && ja.address_name) || d.address_name || '' };
}
// expect = 글자 주소에서 뽑은 {sido, sgg}. 좌표 결과의 행정구역이 이것과 달라도 버린다(교차검증).
async function nbGeocode(addr, expect) {
  const cached = nbGeoGet(addr);
  if (cached) return cached;
  let loose = null, g = null;
  for (const q of nbAddrVariants(addr)) {
    let docs = [];
    try { docs = ((await proxyOnlyGet('kakaoGeocode', { query: q })) || {}).documents || []; } catch { docs = []; }
    const d = docs.find((x) => x.address_type === 'ROAD_ADDR') || docs.find((x) => x.address_type === 'REGION_ADDR');
    if (d) { g = nbGeoFromDoc(d); break; }
    if (!loose && docs[0]) loose = nbGeoFromDoc(docs[0]);
  }
  let res;
  if (g && isFinite(g.lat) && isFinite(g.lng)) {
    const bad = expect && ((expect.sido && g.sido && expect.sido !== g.sido) || (expect.sgg && g.sgg && expect.sgg !== g.sgg));
    res = bad ? { status: 'mismatch', got: nbRegionText(g) }
      : { status: 'exact', lat: g.lat, lng: g.lng, sido: g.sido, sgg: g.sgg, emd: g.emd, road: g.road, jibun: g.jibun };
  } else {
    res = { status: 'region', got: loose ? nbRegionText(loose) : '' };   // 동·시 단위까지만 맞음 — 좌표는 버린다
  }
  nbGeoSet(addr, res);
  return res;
}
// 시·군 중심 좌표 — 먼 시·군을 좌표 변환할지 말지 가르는 데만 쓴다(화면에 찍지 않는다)
async function nbSggCenter(sido, sgg) {
  const k = `sgg|${sido} ${sgg}`;
  const c = nbGeoGet(k);
  if (c) return c;
  let res = { none: true };
  try {
    const d = (((await proxyOnlyGet('kakaoGeocode', { query: `${sido} ${sgg}` })) || {}).documents || [])[0];
    if (d && isFinite(Number(d.y))) res = { lat: Number(d.y), lng: Number(d.x) };
  } catch { return null; }   // 네트워크 실패는 저장하지 않는다(다음에 다시)
  nbGeoSet(k, res);
  return res;
}
// 번지가 안 맞은 업체는 이름으로 지도에서 찾는다. 이름과 시·군이 모두 맞는 장소만 쓴다.
async function nbFindByName(st, v) {
  const q = stripCorp(v.name).replace(/\([^)]*\)/g, ' ').trim();
  if (q.length < 2) return null;
  let docs = [];
  try {
    docs = ((await proxyOnlyGet('kakaoKeyword', { query: q, x: String(st.center.lng), y: String(st.center.lat), sort: 'distance', size: '5' })) || {}).documents || [];
  } catch { return null; }
  for (const d of docs) {
    const p = nbAddrParts(d.address_name || d.road_address_name || '');
    if (!nbNameHit(nbNorm(d.place_name), v.key)) continue;
    if (v.parts.sido && p.sido !== v.parts.sido) continue;
    if (v.parts.sgg && p.sgg && p.sgg !== v.parts.sgg) continue;
    const lat = Number(d.y), lng = Number(d.x);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    return { lat, lng, emd: p.emd, road: d.road_address_name || '', jibun: d.address_name || '', phone: d.phone || '', url: d.place_url || '' };
  }
  return null;
}

// ── 식약처 명단 · CGMP (세션 캐시, 동시에 두 번 불러도 요청은 한 벌) ──
let _nbMfds = null, _nbMfdsP = null, _nbGmp = null, _nbGmpP = null;
const nbUnwrap = (r) => (r && r.item && typeof r.item === 'object' ? r.item : r);
function nbTotalCount(d) {
  for (const p of ['response.body.totalCount', 'body.totalCount', 'totalCount']) {
    let cur = d, ok = true;
    for (const seg of p.split('.')) { if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg]; else { ok = false; break; } }
    if (ok && isFinite(Number(cur))) return Number(cur);
  }
  return null;
}
function nbMkFields(r) {
  const nm = pickByKey(r, /BSSH_NM|CMPNY_NM|ENTRPS_?NM|ENTP_?NAME|업체|업소|회사|제조사/i) || pickByKey(r, /_NM$/i);
  const addr = joinAddrFields(r) || pickByKey(r, /ADDR|SITE|LOCP|소재지|주소/i);
  return { nm, key: nbNorm(nm), addr, parts: nbAddrParts(addr),
    rep: pickByKey(r, /PRSNL|PRSDNT|RPRSNTV|REPRE|대표/i), lcns: pickByKey(r, /LCNS_?NO|PERMIT|허가번호|PRMISN_?NO/i) };
}
function nbMfdsAll() {
  if (_nbMfds) return Promise.resolve(_nbMfds);
  if (_nbMfdsP) return _nbMfdsP;
  _nbMfdsP = (async () => {
    const take = (d) => listOf(d, ['body.items', 'response.body.items.item', 'items']).map(nbUnwrap);
    const first = await proxyOnlyGet('maker', { numOfRows: String(NB.MFDS_PAGE), pageNo: '1' });
    const raw = take(first);
    const total = nbTotalCount(first);
    const pages = total ? Math.min(NB.MFDS_MAX_PAGES, Math.ceil(total / NB.MFDS_PAGE)) : 1;
    const rest = []; for (let p = 2; p <= pages; p++) rest.push(p);
    let failed = 0;
    const got = await mapLimit(rest, 2, async (p) => {
      try { return take(await proxyOnlyGet('maker', { numOfRows: String(NB.MFDS_PAGE), pageNo: String(p) })); }
      catch { failed++; return []; }
    });
    got.forEach((g) => raw.push(...g));
    const full = !failed && (total != null ? raw.length >= total * 0.98 : raw.length < NB.MFDS_PAGE);
    // 같은 업체·같은 주소가 여러 번 실린 경우 한 건으로
    const seen = new Set(); const list = [];
    raw.map(nbMkFields).forEach((x) => {
      if (!x.nm || !x.key) return;
      const k = `${x.key}|${String(x.addr || '').replace(/\s/g, '')}`;
      if (seen.has(k)) return; seen.add(k); list.push(x);
    });
    _nbMfds = { list, total, full, failed };
    return _nbMfds;
  })().finally(() => { _nbMfdsP = null; });
  return _nbMfdsP;
}
function nbGmpAll() {
  if (_nbGmp) return Promise.resolve(_nbGmp);
  if (_nbGmpP) return _nbGmpP;
  _nbGmpP = (async () => {
    const d = await proxyGet('gmp', { rows: '500' });
    const keys = new Set();
    listOf(d, ['body.items', 'response.body.items.item']).map(nbUnwrap).forEach((r) => {
      Object.entries(r || {}).forEach(([k, v]) => {
        if (/ENTP|BSSH|CMPNY|COMP|업체|업소|NAME|_NM/i.test(k) && v) { const n = nbNorm(v); if (n.length >= 2) keys.add(n); }
      });
    });
    _nbGmp = keys;
    return keys;
  })().finally(() => { _nbGmpP = null; });
  return _nbGmpP;
}

// ── 기준 주소 ──
function nbOriginOverride(vid) {
  try { return (JSON.parse(localStorage.getItem(NB_ORIGIN_KEY) || '{}') || {})[vid] || null; } catch { return null; }
}
function nbSetOriginOverride(vid, addr) {
  try {
    const m = JSON.parse(localStorage.getItem(NB_ORIGIN_KEY) || '{}') || {};
    if (addr) m[vid] = addr; else delete m[vid];
    localStorage.setItem(NB_ORIGIN_KEY, JSON.stringify(m));
  } catch { /* 저장 못 해도 이번 조회는 된다 */ }
}
function nbReportAddr(report) {
  const m = report.meta || {};
  return m.visit_addr || visitAddress(report) || '';
}
// 기점 좌표 — 번지까지 맞아야 한다. 아니면 리포트의 방문 좌표로 가되 경고하고 수정을 권한다.
async function nbCenter(st) {
  const m = st.report.meta || {};
  const addr = st.originAddr;
  if (!addr && !(m.visit_coord && isFinite(m.visit_coord.lat))) {
    throw new Error('기준 주소가 없습니다 — 위의 [주소 수정]으로 방문할 주소를 넣어 주세요');
  }
  const text = nbAddrParts(addr);
  const g = addr ? await nbGeocode(addr, text).catch(() => null) : null;
  if (g && g.status === 'exact') {
    return { lat: g.lat, lng: g.lng, addr, road: g.road || g.jibun || addr, exact: true,
      loc: { sido: g.sido || text.sido, sgg: g.sgg || text.sgg, emd: g.emd || text.emd } };
  }
  if (!st.originEdited && m.visit_coord && isFinite(m.visit_coord.lat) && isFinite(m.visit_coord.lng)) {
    return { lat: m.visit_coord.lat, lng: m.visit_coord.lng, addr, road: addr, exact: false, loc: text };
  }
  throw new Error(`'${addr}'을(를) 번지까지 찾지 못했습니다 — 도로명(○○로 12)이나 지번(○○리 123)까지 넣어 주세요`);
}
// 사용자가 고친 주소 확인 — 주소로 안 되면 장소 이름으로도 찾아 본다(예: 회사 이름 + 지역)
async function nbResolveOrigin(text) {
  const g = await nbGeocode(text, null).catch(() => null);
  if (g && g.status === 'exact') return { addr: text, shown: g.road || g.jibun || text };
  let docs = [];
  try { docs = ((await proxyOnlyGet('kakaoKeyword', { query: text, size: '1' })) || {}).documents || []; } catch { docs = []; }
  const d = docs[0];
  if (d && (d.road_address_name || d.address_name)) {
    const a = d.road_address_name || d.address_name;
    const g2 = await nbGeocode(a, null).catch(() => null);
    if (g2 && g2.status === 'exact') return { addr: a, shown: `${d.place_name} · ${a}` };
  }
  return null;
}

// ── 데이터 수집 ──
// 명단 업체 중 기점과 같은 시·도·인접 시·도인 것을 목록 후보로 올린다(아직 좌표 없음).
function nbSeed(st) {
  const near = new Set([st.loc.sido, ...(NB_ADJ[st.loc.sido] || [])].filter(Boolean));
  st.items = [];
  st.mfds.list.forEach((r, i) => {
    if (!r.addr || !r.parts.sido || !near.has(r.parts.sido)) return;
    const tier = nbTier(st.loc, r.parts);
    // 조회 업체 자신은 뺀다. 기준 주소를 옮겨도 마찬가지다(다른 시로 옮기면 멀리서 자기 자신이 나왔다).
    // 같은 시·군 안에서는 '에이디인터내셔날 제2공장'처럼 접두까지 보고, 그 밖에서는 이름이 똑같을 때만 —
    // '코스맥스'로 조회했다고 먼 곳의 '코스맥스엔비티'까지 지우면 안 된다.
    if (st.vendorKey && (r.key === st.vendorKey || (tier <= 1 && nbNameHit(r.key, st.vendorKey)))) return;
    st.items.push({ id: `m${i}`, name: r.nm, key: r.key, addr: r.addr, parts: { ...r.parts }, tier,
      lat: null, lng: null, km: null, geo: 'pending', phone: '', url: '', lcns: r.lcns, rep: r.rep,
      cgmp: st.gmp ? st.gmp.has(r.key) : false });
  });
}
function nbApplyGeo(st, v, g) {
  if (g && g.status === 'exact') {
    v.lat = g.lat; v.lng = g.lng; v.km = haversineKm(st.center.lat, st.center.lng, g.lat, g.lng); v.geo = 'exact';
    v.mapAddr = g.road || g.jibun || '';
    if (g.emd && !v.parts.emd) v.parts.emd = g.emd;
  } else {
    v.geo = g && g.status === 'mismatch' ? 'mismatch' : 'region';
    v.geoNote = g && g.got ? g.got : '';
  }
  v.tier = nbTier(st.loc, v.parts);
}
// 먼 단계(같은 시·도 이상) 업체는 시·군 중심으로 거리를 가늠해 반경 밖이면 건너뛴다
async function nbRankFar(st) {
  const far = st.items.filter((v) => v.geo === 'pending' && v.tier >= 2 && v.sggKm == null);
  const keys = [...new Set(far.map((v) => `${v.parts.sido}|${v.parts.sgg}`))]
    .sort((a, b) => (a.startsWith(st.loc.sido + '|') ? 0 : 1) - (b.startsWith(st.loc.sido + '|') ? 0 : 1));
  let asked = 0;
  for (const k of keys) {
    const [sido, sgg] = k.split('|');
    const cached = nbGeoGet(`sgg|${sido} ${sgg}`);
    if (!cached && asked >= NB.SGG_CAP) continue;
    if (!cached) asked++;
    const c = cached || await nbSggCenter(sido, sgg);
    if (!c) continue;
    const km = c.none ? Infinity : haversineKm(st.center.lat, st.center.lng, c.lat, c.lng);
    far.filter((v) => `${v.parts.sido}|${v.parts.sgg}` === k).forEach((v) => {
      v.sggKm = km;
      if (km > NB.MAX_KM + 15) v.geo = 'far';     // 그 시·군 중심이 반경에서 한참 멀다 — 좌표 변환하지 않는다
    });
  }
}
async function nbGeocodeList(st, list) {
  let done = 0;
  await mapLimit(list, 3, async (v) => {
    const g = await nbGeocode(v.addr, v.parts).catch(() => null);
    nbApplyGeo(st, v, g);
    if (++done % 8 === 0) { st.phase = `업체 위치 확인 ${done}/${list.length}`; nbPaint(st); }
  });
}
async function nbNameRetry(st) {
  const retry = st.items.filter((v) => (v.geo === 'region' || v.geo === 'mismatch') && v.tier <= 1 && !v.nameTried)
    .slice(0, NB.NAME_RETRY);
  await mapLimit(retry, 2, async (v) => {
    v.nameTried = true;
    const hit = await nbFindByName(st, v).catch(() => null);
    if (!hit) return;
    v.lat = hit.lat; v.lng = hit.lng; v.km = haversineKm(st.center.lat, st.center.lng, hit.lat, hit.lng);
    v.geo = 'name'; v.phone = v.phone || hit.phone; v.url = v.url || hit.url; v.mapAddr = hit.road || hit.jibun || '';
    if (hit.emd && !v.parts.emd) v.parts.emd = hit.emd;
    v.tier = nbTier(st.loc, v.parts);
  });
}
// 한 차례: 저장된 좌표 먼저 → 같은 시·군 이내 전부 → 먼 단계 가까운 시·군부터 GEO_BATCH곳
async function nbGeocodeRound(st) {
  const pending = () => st.items.filter((v) => v.geo === 'pending');
  for (const v of pending()) { const c = nbGeoGet(v.addr); if (c) nbApplyGeo(st, v, c); }
  const near = pending().filter((v) => v.tier <= 1).slice(0, NB.NEAR_CAP);
  if (near.length) await nbGeocodeList(st, near);
  await nbNameRetry(st);
  st.phase = '먼 지역은 시·군 단위로 거리를 가늠하는 중'; nbPaint(st);
  await nbRankFar(st);
  const far = pending().filter((v) => v.tier >= 2 && v.sggKm != null && v.sggKm !== Infinity)
    .sort((a, b) => a.sggKm - b.sggKm).slice(0, NB.GEO_BATCH);
  if (far.length) await nbGeocodeList(st, far);
  st.geoRemain = pending().filter((v) => v.tier >= 2).length;
}

async function nbLoad(st) {
  st.loading = true; st.error = null; st.items = []; st.sel = null; st.open = null; st.route = [];
  st.drawnRadius = null;
  nbPaint(st);
  try {
    st.center = await nbCenter(st);
    st.loc = st.center.loc;
  } catch (e) { st.center = null; st.loading = false; st.error = e.message; nbPaint(st); return; }
  try {
    st.phase = '식약처 화장품 제조업 명단을 받는 중';
    nbPaint(st);
    const [m, g] = await Promise.allSettled([nbMfdsAll(), nbGmpAll()]);
    if (m.status === 'fulfilled') st.mfds = m.value;
    else { st.error = `식약처 제조업 명단을 받지 못했습니다 (${String(m.reason && m.reason.message || m.reason)})`; return; }
    if (g.status === 'fulfilled') st.gmp = g.value; else st.gmpErr = String(g.reason && g.reason.message || g.reason);
    nbSeed(st);
    st.phase = '가까운 지역부터 업체 위치를 번지 단위로 확인하는 중';
    nbPaint(st);
    await nbGeocodeRound(st);
  } catch (e) {
    st.note = e && e.message ? e.message : String(e);
  } finally {
    st.loading = false; st.phase = null;
    if (!st.error && !st.sel) { const first = nbVisible(st).find(nbPlaced); if (first) nbSelect(st, first.id, { quiet: true }); }
    nbPaint(st);
  }
}

// ── 화면 ──
const nbStates = new Map();       // vendor_id → 상태(탭을 오가도, 리포트를 다시 그려도 유지)
const _nbActiveTab = new Map();   // vendor_id → 'report' | 'nearby'

// 지도에 찍을 수 있는가 — 번지까지 맞았거나, 이름·시군으로 지도에서 찾은 것
const nbPlaced = (v) => v.geo === 'exact' || v.geo === 'name';
// 목록: 좌표가 있으면 반경 안, 좌표가 없으면 같은 시·군 이내(주소로 가까움이 확인된 것)
function nbVisible(st) {
  return st.items.filter((v) => (nbPlaced(v) ? v.km <= st.radius : (v.tier <= 1 && v.geo !== 'far')))
    .sort((a, b) => a.tier - b.tier || (a.km ?? 1e9) - (b.km ?? 1e9) || String(a.name).localeCompare(String(b.name)));
}
function nbFiltered(st) {
  const vis = nbVisible(st);
  return st.filter === 'gmp' ? vis.filter((v) => v.cgmp)
    : st.filter === 'unplaced' ? vis.filter((v) => !nbPlaced(v)) : vis;
}
const nbCls = (v) => (v.cgmp ? 'gmp' : 'reg');
function nbGeoText(v) {
  return v.geo === 'exact' ? '식약처 등록 주소를 번지까지 확인'
    : v.geo === 'name' ? '등록 주소가 번지까지 안 맞아 업체 이름·시군으로 지도에서 찾음'
      : v.geo === 'mismatch' ? `등록 주소를 좌표로 바꾸니 다른 지역(${v.geoNote || '?'})이 나와 지도에 표시하지 않음`
        : v.geo === 'region' ? `번지까지 안 맞음${v.geoNote ? ` (${v.geoNote}까지만 확인)` : ''} — 지도에 표시하지 않음`
          : '위치 확인 전';
}
// 이동 — 실측이 있으면 실측, 없으면 추정
const NB_SAME_KM = 0.15;   // 이보다 가까우면 기점과 같은 부지로 본다
function nbDriveText(v) {
  if (!nbPlaced(v)) return '';
  if (v.km < NB_SAME_KM) return '기점과 같은 위치';
  if (v.drive && v.drive.min != null) return `차량 ${nbFmtMin(v.drive.min)} · 도로 ${nbFmtKm(v.drive.km)}km`;
  return `차량 약 ${nbFmtMin(nbEstMin(v.km))}`;
}
function nbKakaoRoute(st, stops) {
  const pt = (n, lat, lng) => `${encodeURIComponent(String(n).replace(/[,/]/g, ' '))},${lat},${lng}`;
  return 'https://map.kakao.com/link/by/car/'
    + [pt(`${st.vendorName}(기점)`, st.center.lat, st.center.lng), ...stops.map((s) => pt(s.name, s.lat, s.lng))].join('/');
}
// 선택한 업체의 실제 차량 이동시간 — 카카오내비 길찾기(업체당 한 번, 결과는 기억)
function nbDrive(st, v) {
  if (!v || !nbPlaced(v) || v.drive || v.driveP || !st.center || v.km < NB_SAME_KM) return;
  v.driveP = proxyOnlyGet('kakaoDirections', { origin: `${st.center.lng},${st.center.lat}`, destination: `${v.lng},${v.lat}` })
    .then((d) => {
      const r = d && d.routes && d.routes[0];
      v.drive = r && (r.result_code == null || r.result_code === 0) && r.summary
        ? { min: Math.round(r.summary.duration / 60), km: r.summary.distance / 1000,
          toll: r.summary.fare && Number(r.summary.fare.toll) > 0 ? Number(r.summary.fare.toll) : null }
        : { err: (r && r.result_msg) || '경로를 찾지 못함' };
    })
    .catch((e) => { v.drive = { err: e.message }; })
    .finally(() => { v.driveP = null; nbPaint(st); });
}
// 동선 순서 — 기점에서 가장 가까운 곳부터 차례로(탐욕 근사). 좌표가 확인된 곳만.
function nbRouteOrder(st) {
  const left = st.items.filter((v) => st.route.includes(v.id) && nbPlaced(v));
  const out = []; let cur = st.center; let dist = 0, min = 0;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((v, i) => { const d = haversineKm(cur.lat, cur.lng, v.lat, v.lng); if (d < bd) { bd = d; bi = i; } });
    const v = left.splice(bi, 1)[0]; out.push(v); dist += bd; min += nbEstMin(bd); cur = v;
  }
  return { stops: out, km: dist, min };
}

function nbHeadHtml(st) {
  const addrShown = st.center ? (st.center.road || st.center.addr) : (st.originAddr || '주소 없음');
  const edited = !!nbOriginOverride(st.vid);
  if (st.editing) {
    return `<form class="nb-oform" data-form="origin">`
      + `<label for="nbOriginIn"><b>${esc(st.vendorName)}</b> 기준 주소 수정</label>`
      + `<div class="nb-orow"><input id="nbOriginIn" class="nb-oin" type="text" value="${esc(st.originAddr || '')}" placeholder="예: 경기도 파주시 탄현면 방촌로 100" autocomplete="off">`
      + `<button type="submit" class="nb-btn dark">이 주소로 다시 찾기</button>`
      + `<button type="button" class="nb-btn" data-act="cancel-origin">취소</button></div>`
      + (st.editErr ? `<div class="nb-oerr">${esc(st.editErr)}</div>` : '<div class="nb-ohint">도로명(○○로 12)이나 지번(○○리 123)까지 넣으면 정확합니다. 회사·건물 이름으로도 찾아 봅니다.</div>')
      + `</form>`;
  }
  return `<div class="nb-origin-line"><b class="nb-oname">${esc(st.vendorName)}</b>`
    + `<span class="nb-oaddr">(${esc(addrShown)})</span>`
    + (st.center && !st.center.exact ? '<span class="nb-owarn">번지 미확인</span>' : '')
    + (edited ? '<span class="nb-oedited">수정한 주소</span>' : '')
    + `<button type="button" class="nb-btn sm" data-act="edit-origin">주소 수정</button>`
    + (edited ? `<button type="button" class="nb-btn sm" data-act="reset-origin">원래 주소로</button>` : '')
    + `</div><small class="nb-osub">이 주소 기준 · 식약처 화장품 제조업 허가 업체</small>`;
}

function nbSheetHtml(st) {
  const vis = nbVisible(st);
  const placed = vis.filter(nbPlaced).length, gmpN = vis.filter((v) => v.cgmp).length;
  let h = `<div class="nb-sum">반경 ${st.radius}km · 제조업 허가 업체 <b>${vis.length}</b>곳 (CGMP ${gmpN})`
    + (vis.length - placed ? ` <span class="nb-sum-warn">· 위치 미확인 ${vis.length - placed}곳은 지도에 없음</span>` : '') + '</div>';
  const s = st.items.find((v) => v.id === st.sel);
  if (!s || !vis.includes(s)) return h + `<div class="nb-empty">${vis.length ? '지도나 목록에서 업체를 고르세요.' : '이 반경 안에서 찾은 업체가 없습니다. 반경을 넓혀 보세요.'}</div>`;
  const tel = s.phone ? `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : '—';
  const pl = nbPlaced(s);
  const mapUrl = s.url || (pl
    ? `https://map.kakao.com/link/map/${encodeURIComponent(s.name.replace(/[,/]/g, ' '))},${s.lat},${s.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(s.addr || s.name)}`);
  // 이동: 직선 · 추정 → 실측이 오면 바꿔 적는다
  let move = '—';
  if (pl && s.km < NB_SAME_KM) move = '기점과 같은 위치(같은 부지·건물로 보입니다)';
  else if (pl) {
    const est = `직선 ${nbFmtKm(s.km)}km · 차량 약 ${nbFmtMin(nbEstMin(s.km))}(추정)`;
    move = s.drive && s.drive.min != null
      ? `<b>차량 ${nbFmtMin(s.drive.min)}</b> · 도로 ${nbFmtKm(s.drive.km)}km${s.drive.toll ? ` · 통행료 ${s.drive.toll.toLocaleString()}원` : ''}<small>카카오내비 실측 · ${esc(est)}</small>`
      : s.driveP ? `${esc(est)}<small>카카오내비 실측 확인 중…</small>`
        : s.drive && s.drive.err ? `${esc(est)}<small>실측 불가(${esc(s.drive.err)}) — 추정치입니다</small>` : esc(est);
  }
  const mapAddrRow = s.mapAddr && s.mapAddr.replace(/\s/g, '') !== String(s.addr || '').replace(/\s/g, '')
    ? `<dt>지도 위치</dt><dd>${esc(s.mapAddr)}</dd>` : '';
  h += `<div class="nb-selhead"><div class="nb-selname"><b>${esc(s.name)}</b><span class="nb-badge reg">제조업 허가</span>${s.cgmp ? '<span class="nb-badge gmp">CGMP</span>' : ''}</div>`
    + `<div class="nb-seld">${pl ? `${nbFmtKm(s.km)}<small>km</small>` : '<small>거리 미확인</small>'}</div></div>`
    + `<div class="nb-seladdr">${esc(s.addr || '')}</div>`
    + `<dl class="nb-selbox">`
    + `<dt>이동</dt><dd class="nb-move">${move}</dd>`
    + `<dt>허가</dt><dd>${esc(s.lcns ? `식약처 화장품제조업 ${s.lcns}` : '식약처 화장품제조업 명단 등재')}</dd>`
    + (s.rep ? `<dt>대표자</dt><dd>${esc(s.rep)}</dd>` : '')
    + `<dt>CGMP</dt><dd>${s.cgmp ? '적합업소' : (st.gmp ? '명단에 없음' : '확인 불가')}</dd>`
    + `<dt>전화</dt><dd>${tel}</dd>`
    + `<dt>지역</dt><dd>${esc(nbTierLabel(st, s.tier))}</dd>`
    + mapAddrRow
    + `<dt>위치 근거</dt><dd class="${pl ? '' : 'unk'}">${esc(nbGeoText(s))}</dd>`
    + `</dl>`
    + `<div class="nb-selacts">`
    + (pl ? `<a class="nb-btn" href="${esc(nbKakaoRoute(st, [s]))}" target="_blank" rel="noopener">길찾기</a>`
      : `<button type="button" class="nb-btn" disabled title="위치가 번지까지 확인되지 않았습니다">길찾기</button>`)
    + `<a class="nb-btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">카카오맵</a>`
    + `<button type="button" class="nb-btn dark" data-act="report" data-id="${esc(s.id)}">사전검증 리포트</button>`
    + `</div>`;
  return h;
}

function nbRowHtml(st, v) {
  const open = st.open === v.id, inRoute = st.route.includes(v.id), pl = nbPlaced(v);
  const tel = v.phone ? ` · <a href="tel:${esc(v.phone.replace(/[^\d+]/g, ''))}">${esc(v.phone)}</a>` : '';
  const dist = pl ? `<b>${nbFmtKm(v.km)}</b><i>km</i>` : `<b class="nb-dq">—</b><i>${v.geo === 'pending' ? '확인 전' : '미확인'}</i>`;
  return `<div class="nb-row${open ? ' open' : ''}${st.sel === v.id ? ' sel' : ''}${pl ? '' : ' unplaced'}" data-row="${esc(v.id)}">`
    + `<button type="button" class="nb-rowbtn" data-act="pick" data-id="${esc(v.id)}" aria-expanded="${open}">`
    + `<span class="nb-d">${dist}</span>`
    + `<span class="nb-main"><span class="nb-nm"><span class="nb-mark ${nbCls(v)}"></span>${esc(v.name)}</span>`
    + `<span class="nb-sub">${esc(v.addr || nbRegionText(v.parts))}</span>`
    + (pl ? `<span class="nb-time">${esc(nbDriveText(v))}</span>` : '')
    + `</span>`
    + (v.cgmp ? '<span class="nb-chip">CGMP</span>' : '')
    + (inRoute ? '<span class="nb-inroute" title="동선에 담음">동선</span>' : '')
    + `</button>`
    + (open ? `<div class="nb-more"><div class="nb-facts">${esc(v.lcns ? `허가 ${v.lcns}` : '제조업 허가')}${v.rep ? ` · 대표 ${esc(v.rep)}` : ''}${v.cgmp ? ' · CGMP 적합' : ''}${tel}</div>`
      + (v.mapAddr && v.mapAddr.replace(/\s/g, '') !== String(v.addr || '').replace(/\s/g, '') ? `<div class="nb-addr">지도 위치: ${esc(v.mapAddr)}</div>` : '')
      + `<div class="nb-geo${pl ? '' : ' warn'}">위치 근거: ${esc(nbGeoText(v))}</div>`
      + `<div class="nb-acts">`
      + (pl
        ? `<button type="button" class="nb-btn${inRoute ? '' : ' blue'}" data-act="route" data-id="${esc(v.id)}">${inRoute ? '동선에서 빼기' : '동선에 추가'}</button>`
        : `<button type="button" class="nb-btn" disabled title="위치가 번지까지 확인되지 않아 동선에 넣지 않습니다">동선에 추가 불가</button>`)
      + `<button type="button" class="nb-btn" data-act="report" data-id="${esc(v.id)}">사전검증 리포트</button></div></div>` : '')
    + `</div>`;
}

function nbListHtml(st) {
  const vis = nbVisible(st);
  const n = { all: vis.length, gmp: vis.filter((v) => v.cgmp).length, unplaced: vis.filter((v) => !nbPlaced(v)).length };
  const tabs = [['all', '전체', n.all], ['gmp', 'CGMP 적합', n.gmp], ['unplaced', '위치 미확인', n.unplaced]]
    .map(([id, l, c]) => `<button type="button" class="nb-tab" data-act="filter" data-f="${id}" aria-pressed="${st.filter === id}">${l} <b>${c}</b></button>`).join('');
  const rows = nbFiltered(st);
  // 지역 단계별로 묶는다 — 같은 읍·면·동 → 같은 시·군 → 같은 시·도 → 인접 시·도
  let body = '';
  let lastTier = -1;
  rows.forEach((v) => {
    if (v.tier !== lastTier) {
      const grp = rows.filter((x) => x.tier === v.tier);
      const unp = grp.filter((x) => !nbPlaced(x)).length;
      body += `<div class="nb-grp"><b>${esc(nbTierLabel(st, v.tier))}</b><span>${grp.length}곳${unp ? ` · 위치 미확인 ${unp}` : ''}</span></div>`;
      lastTier = v.tier;
    }
    body += nbRowHtml(st, v);
  });
  if (!rows.length) body = `<div class="nb-empty">${st.loading ? '찾는 중…' : '해당하는 업체가 없습니다.'}</div>`;
  if (!st.loading && st.geoRemain > 0) {
    body += `<button type="button" class="nb-more-btn" data-act="more">다른 시·군 업체 ${Math.min(NB.GEO_BATCH, st.geoRemain)}곳 위치 더 확인 <small>남은 ${st.geoRemain}곳 · 가까운 시·군부터 · 주소 변환 요청이 나갑니다</small></button>`;
  }
  const r = nbRouteOrder(st);
  const foot = `<div class="nb-route"><div><small>오늘 동선</small><b>기점 포함 ${r.stops.length + 1}곳</b>`
    + (r.stops.length ? `<small>직선 합계 약 ${Math.round(r.km)}km · 차량 약 ${nbFmtMin(r.min)}(추정) · ${esc(r.stops.map((s) => s.name).join(' → '))}</small>` : '<small>목록에서 업체를 펼쳐 동선에 추가하세요 (위치가 확인된 곳만)</small>')
    + `</div>`
    + (r.stops.length ? `<button type="button" class="nb-btn" data-act="clear">비우기</button>`
      + `<a class="nb-btn dark" href="${esc(nbKakaoRoute(st, r.stops.slice(0, 6)))}" target="_blank" rel="noopener">카카오맵 경로 보기</a>` : '')
    + `</div>`
    + (r.stops.length > 6 ? '<div class="nb-note">카카오맵 경로는 기점 포함 7곳까지만 넘깁니다 — 앞의 6곳까지 열립니다.</div>' : '');
  return `<div class="nb-tabs" role="group" aria-label="거르기">${tabs}</div><div class="nb-rows">${body}</div>${foot}`;
}

function nbStatusLine(st) {
  const bits = [];
  if (st.center && !st.center.exact) bits.push('<b class="nb-warn">기준 주소가 번지까지 확인되지 않아 거리가 부정확할 수 있습니다 — 주소 수정을 권합니다</b>');
  if (st.mfds) bits.push(`식약처 화장품 제조업 명단 ${st.mfds.list.length.toLocaleString()}곳 중 기점 주변 시·도 ${st.items.length.toLocaleString()}곳 대조`
    + (st.mfds.full ? '' : ' (명단 일부만 받음)'));
  const c = (g) => st.items.filter((v) => v.geo === g).length;
  if (st.items.length) bits.push(`위치: 번지 확인 ${c('exact')} · 이름으로 찾음 ${c('name')} · 번지 불일치 ${c('region') + c('mismatch')} · 반경 밖 시·군 ${c('far')} · 확인 전 ${c('pending')}`);
  if (st.gmpErr) bits.push('CGMP 명단 조회 실패');
  return bits.join(' · ');
}

function nbPaint(st) {
  const pane = st.pane;
  if (!pane || !pane.isConnected) return;
  if (!pane.querySelector('.nb')) {
    pane.innerHTML = `<div class="nb">`
      + `<div class="nb-head"><div class="nb-title"></div>`
      + `<div class="nb-legend"><span><i class="nb-mark reg"></i>제조업 허가</span><span><i class="nb-mark gmp"></i>CGMP 적합</span></div>`
      + `<div class="nb-seg" role="group" aria-label="반경">${NB.RADII.map((r) => `<button type="button" data-act="radius" data-r="${r}">${r}km</button>`).join('')}</div></div>`
      + `<div class="nb-body"><div class="nb-mapcol"><div class="nb-map" role="region" aria-label="근처 업체 지도"></div><div class="nb-sheet"></div></div>`
      + `<div class="nb-listcol"></div></div>`
      + `<div class="nb-status"></div></div>`;
  }
  const title = pane.querySelector('.nb-title');
  // 주소를 고치는 중에는 머리줄을 다시 그리지 않는다(입력하던 글자가 날아간다)
  if (!(st.editing && title.querySelector('form'))) title.innerHTML = nbHeadHtml(st);
  pane.querySelectorAll('.nb-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === st.radius)));
  const status = pane.querySelector('.nb-status');
  if (st.error) {
    pane.querySelector('.nb-sheet').innerHTML = `<div class="nb-empty err">${esc(st.error)}</div>`;
    pane.querySelector('.nb-listcol').innerHTML = '';
    status.textContent = '';
    nbDrawMapSafe(st);
    return;
  }
  pane.querySelector('.nb-sheet').innerHTML = st.center ? nbSheetHtml(st) : '<div class="nb-empty">기준 주소의 위치를 확인하는 중…</div>';
  pane.querySelector('.nb-listcol').innerHTML = nbListHtml(st);
  status.innerHTML = (st.phase ? `<span class="nb-spin" aria-hidden="true"></span>${esc(st.phase)} · ` : '') + nbStatusLine(st)
    + ' · 거리는 직선, 이동시간은 추정(업체를 고르면 카카오내비 실측)입니다';
  nbDrawMapSafe(st);
}
// 지도가 어떤 이유로 못 그려져도 목록·데이터 수집은 계속 가야 한다. 여기서 막는다.
function nbDrawMapSafe(st) {
  try { nbDrawMap(st); }
  catch (e) {
    const box = st.pane && st.pane.querySelector('.nb-map');
    if (box && !box.querySelector('.nb-maperr')) box.insertAdjacentHTML('beforeend', `<div class="nb-empty err nb-maperr">지도를 그리지 못했습니다 — 목록은 그대로 쓸 수 있습니다 (${esc(e.message)})</div>`);
  }
}

// ── 지도(Leaflet · OpenStreetMap 타일) ──
// 카카오 지도 JS는 도메인 등록된 공개 키를 화면에 넣어야 해서 쓰지 않는다.
// Leaflet은 저장소에 넣어 두었고(assets/vendor), 타일은 키가 필요 없는 OSM을 쓴다.
let _nbLeafletP = null;
function nbLoadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_nbLeafletP) return _nbLeafletP;
  _nbLeafletP = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `assets/vendor/leaflet/leaflet.css?v=${BUILD}`;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = `assets/vendor/leaflet/leaflet.js?v=${BUILD}`;
    s.onload = () => resolve(window.L);
    s.onerror = () => { _nbLeafletP = null; reject(new Error('지도 라이브러리를 불러오지 못했습니다')); };
    document.head.appendChild(s);
  });
  return _nbLeafletP;
}
const nbCssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb);

function nbDrawMap(st) {
  const box = st.pane && st.pane.querySelector('.nb-map');
  if (!box || st.pane.hidden) return;
  if (!st.center) { if (st.layer) st.layer.clearLayers(); return; }
  if (!window.L) {
    box.classList.add('loading');
    nbLoadLeaflet().then(() => nbDrawMap(st)).catch((e) => { box.innerHTML = `<div class="nb-empty err">${esc(e.message)}</div>`; });
    return;
  }
  box.classList.remove('loading');
  const L = window.L;
  const c = [st.center.lat, st.center.lng];
  if (!st.map || st.map.getContainer() !== box) {
    if (st.map) { try { st.map.remove(); } catch {} }
    // 정수 줌만 쓰면 반경 링이 지도의 절반만 채우고 가운데에 핀이 몰린다 — 1/4 단계로 맞춘다
    st.map = L.map(box, { zoomControl: true, scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(st.map);
    // 페이지를 스크롤하다 지도가 확대되는 일을 막는다 — 지도를 한 번 누른 뒤에만 휠 확대
    st.map.on('click', () => st.map.scrollWheelZoom.enable());
    st.map.on('mouseout', () => st.map.scrollWheelZoom.disable());
    // 레이어보다 시점이 먼저다 — 시점 없는 지도에 원을 올리면 투영을 못 해 예외가 난다
    st.map.setView(c, 11);
    st.layer = L.layerGroup().addTo(st.map);
    st.drawnRadius = null;
  }
  const map = st.map;
  map.invalidateSize();
  const reg = nbCssVar('--pin-reg', '#1D4ED8');
  st.layer.clearLayers();
  L.circle(c, { radius: st.radius * 1000, color: reg, weight: 1.5, opacity: 0.55, dashArray: '5 5', fillColor: reg, fillOpacity: 0.05, interactive: false }).addTo(st.layer);
  L.circle(c, { radius: st.radius * 500, color: reg, weight: 1, opacity: 0.35, dashArray: '3 5', fill: false, interactive: false }).addTo(st.layer);
  const up = (km) => [st.center.lat + km / 111.32, st.center.lng];
  L.marker(up(st.radius), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-rlabel', html: `<span>${st.radius}km</span>`, iconSize: [48, 18], iconAnchor: [24, 9] }) }).addTo(st.layer);
  L.marker(up(st.radius / 2), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-rlabel half', html: `<span>${st.radius / 2}km</span>`, iconSize: [48, 18], iconAnchor: [24, 9] }) }).addTo(st.layer);
  // 원을 새로 그렸으면(주소를 고쳤으면) 기점도 새 위치로 옮긴다
  if (st.drawnCenter !== `${c[0]},${c[1]}`) { st.drawnRadius = null; st.drawnCenter = `${c[0]},${c[1]}`; }
  L.marker(c, { keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'nb-origin-pin', html: `<span class="nb-dia"></span><span class="nb-plabel strong">${esc(st.vendorName)} · 기점</span>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(st.layer);
  // 시점을 먼저 맞춘다 — 이름표 겹침은 화면 좌표로 따지므로 줌이 정해진 뒤여야 한다
  // (원의 getBounds()는 그리기 직후 불안정해서 좌표에서 바로 계산한다)
  if (st.drawnRadius !== st.radius) { map.fitBounds(L.latLng(c).toBounds(st.radius * 2000), { padding: [8, 8], animate: false }); st.drawnRadius = st.radius; }
  // 지도에는 위치가 확인된 업체만 찍는다 — 시·군 중심점 같은 추정 위치는 찍지 않는다
  const vis = nbVisible(st).filter(nbPlaced);
  // 이름표 겹침 피하기 — 이미 붙인 이름표(기점 포함)와 상자가 겹치면 그 핀은 이름을 붙이지 않는다.
  // 고른 업체는 반드시 붙이되, 오른쪽이 막히면 왼쪽에 붙인다.
  const boxes = [];
  // 상자 위치는 CSS와 같아야 한다: 핀 상자(32px, 가운데 기준)에서 오른쪽 이름표는 left:26px → 핀+10,
  // 왼쪽 이름표는 right:26px → 핀−10에서 끝난다. 기점은 18px 상자에 left:24px → 기점+15.
  // 글자 폭은 넉넉히(12px/자) 잡고 사이를 4px 띄운다.
  const boxOf = (pt, text, left, origin) => {
    const w = Math.min(180, String(text).length * 12 + 4);
    const x0 = origin ? pt.x + 15 : left ? pt.x - 10 - w : pt.x + 10;
    return { x0: x0 - 2, x1: x0 + w + 2, y0: pt.y - 10, y1: pt.y + 10 };
  };
  const hit = (b) => boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const cp = map.latLngToContainerPoint(c);
  boxes.push(boxOf(cp, `${st.vendorName} · 기점`, false, true));
  boxes.push({ x0: cp.x - 10, x1: cp.x + 10, y0: cp.y - 10, y1: cp.y + 10 });   // 기점 마름모 자체
  vis.forEach((v) => { const q = map.latLngToContainerPoint([v.lat, v.lng]); boxes.push({ x0: q.x - 7, x1: q.x + 7, y0: q.y - 7, y1: q.y + 7, pin: true }); });
  const order = vis.slice().sort((a, b) => (b.id === st.sel) - (a.id === st.sel) || a.km - b.km);   // 고른 것 먼저
  const labelSide = new Map();
  order.forEach((v) => {
    const pt = map.latLngToContainerPoint([v.lat, v.lng]);
    for (const left of [false, true]) {
      const bx = boxOf(pt, v.name, left);
      if (!hit(bx)) { boxes.push(bx); labelSide.set(v.id, left ? 'left' : 'right'); return; }
    }
    if (v.id === st.sel) labelSide.set(v.id, 'left');   // 둘 다 막혀도 고른 것은 붙인다
  });
  vis.forEach((v) => {
    const on = v.id === st.sel;
    const side = labelSide.get(v.id);
    const label = side ? `<span class="nb-plabel${on ? ' strong' : ''}${side === 'left' ? ' left' : ''}">${esc(v.name)}</span>` : '';
    const m = L.marker([v.lat, v.lng], {
      title: v.name, alt: v.name, riseOnHover: true, zIndexOffset: on ? 900 : 0,
      icon: L.divIcon({ className: 'nb-pinwrap', html: `<span class="nb-pin ${nbCls(v)}${on ? ' on' : ''}"></span>${label}`, iconSize: [32, 32], iconAnchor: [16, 16] }),
    }).addTo(st.layer);
    m.on('click', () => nbSelect(st, v.id, { fromMap: true }));
  });
}

function nbSelect(st, id, opts = {}) {
  st.sel = id;
  if (opts.fromMap) st.open = id;
  const v = st.items.find((x) => x.id === id);
  nbDrive(st, v);                                        // 고른 업체만 실측 이동시간을 묻는다
  if (opts.quiet) return;
  nbPaint(st);
  if (v && st.map && !opts.fromMap && nbPlaced(v)) st.map.panTo([v.lat, v.lng]);
  if (opts.fromMap) {
    const row = st.pane.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ── 기준 주소 수정 ──
function nbForceHead(st) {
  const title = st.pane && st.pane.querySelector('.nb-title');
  if (!title) return;
  const prev = title.querySelector('.nb-oin');
  const keep = prev ? prev.value : null;
  title.innerHTML = nbHeadHtml(st);
  const i = title.querySelector('.nb-oin');
  if (i) { if (keep != null) i.value = keep; i.focus(); }
}
async function nbSubmitOrigin(st, text) {
  const t = String(text || '').trim();
  if (!t) { st.editErr = '주소를 입력해 주세요'; nbForceHead(st); return; }
  st.editErr = null;
  const btn = st.pane.querySelector('.nb-oform [type=submit]');
  if (btn) { btn.disabled = true; btn.textContent = '주소 확인 중…'; }
  const r = await nbResolveOrigin(t).catch(() => null);
  if (!r) {
    st.editErr = `'${t}'을(를) 번지까지 찾지 못했습니다. 도로명이나 지번까지 넣어 주세요.`;
    nbForceHead(st);
    return;
  }
  nbSetOriginOverride(st.vid, r.addr);
  st.originAddr = r.addr; st.originEdited = true; st.editing = false; st.editErr = null;
  nbLoad(st);
}

function nbBind(st) {
  st.pane.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form="origin"]');
    if (!f) return;
    e.preventDefault();
    nbSubmitOrigin(st, (f.querySelector('.nb-oin') || {}).value);
  });
  st.pane.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.editing && e.target.closest('.nb-oform')) { st.editing = false; st.editErr = null; nbForceHead(st); }
  });
  st.pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !st.pane.contains(b)) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'radius') { st.radius = Number(b.dataset.r); if (st.sel && !nbVisible(st).some((v) => v.id === st.sel)) st.sel = (nbVisible(st).find(nbPlaced) || {}).id || null; nbPaint(st); }
    else if (act === 'filter') { st.filter = b.dataset.f; nbPaint(st); }
    else if (act === 'pick') { st.open = st.open === id ? null : id; nbSelect(st, id); }
    else if (act === 'route') { st.route = st.route.includes(id) ? st.route.filter((x) => x !== id) : st.route.concat(id); nbPaint(st); }
    else if (act === 'clear') { st.route = []; nbPaint(st); }
    else if (act === 'more') {
      st.loading = true; st.phase = '다른 시·군 업체 위치를 더 확인하는 중'; nbPaint(st);
      nbGeocodeRound(st).finally(() => { st.loading = false; st.phase = null; nbPaint(st); });
    }
    else if (act === 'edit-origin') { st.editing = true; st.editErr = null; nbForceHead(st); }
    else if (act === 'cancel-origin') { st.editing = false; st.editErr = null; nbForceHead(st); }
    else if (act === 'reset-origin') {
      nbSetOriginOverride(st.vid, null);
      st.originAddr = nbReportAddr(st.report); st.originEdited = false; st.editing = false;
      nbLoad(st);
    }
    else if (act === 'report') {
      const v = st.items.find((x) => x.id === id);
      if (!v) return;
      const q = document.getElementById('q'); if (q) q.value = v.name;
      const bz = document.getElementById('bno'); if (bz) bz.value = '';
      lookup(v.name, '');
    }
  });
}

function nbOpen(pane, report) {
  const vid = (report.meta && report.meta.vendor_id) || 'x';
  let st = nbStates.get(vid);
  if (!st) {
    const name = String((report.meta && report.meta.vendor_name) || '');
    const over = nbOriginOverride(vid);
    st = { vid, report, vendorName: stripCorp(name) || name, vendorKey: nbNorm(name), radius: NB.DEFAULT_RADIUS,
      filter: 'all', sel: null, open: null, route: [], items: [],
      originAddr: over || nbReportAddr(report), originEdited: !!over,
      loading: false, started: false };
    nbStates.set(vid, st);
  }
  st.report = report;
  if (st.pane !== pane) { st.pane = pane; st.map = null; pane.innerHTML = ''; nbBind(st); }
  if (!getProxy()) {
    pane.innerHTML = '<div class="nb"><div class="nb-empty">근처 업체는 실데이터 연결(프록시) 상태에서만 볼 수 있습니다 — 우측 상단 실데이터 연결을 먼저 해 주세요.</div></div>';
    return;
  }
  if (!st.started) { st.started = true; nbLoad(st); } else nbPaint(st);
}

// ── 리포트 화면에 탭을 붙인다 ── render()가 다 그린 뒤 부른다.
// 툴바 아래의 모든 내용을 '사전검증 리포트' 탭으로 옮기고, 옆에 '근처 업체' 탭을 둔다.
// 닫힌 탭은 hidden이라 인쇄에도 나오지 않는다(조회 화면 그대로 인쇄).
function mountReportTabs(root, report, actions) {
  if (!root || !actions || actions.parentNode !== root) return;
  const vid = (report.meta && report.meta.vendor_id) || 'x';
  const bar = el('div', 'rtabs');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', '리포트 보기');
  bar.innerHTML = '<button type="button" role="tab" class="rtab" data-tab="report" id="rtab-report" aria-controls="rpane-report">사전검증 리포트</button>'
    + '<button type="button" role="tab" class="rtab" data-tab="nearby" id="rtab-nearby" aria-controls="rpane-nearby">근처 업체</button>';
  const paneR = el('div', 'tabpane'); paneR.id = 'rpane-report'; paneR.setAttribute('role', 'tabpanel'); paneR.setAttribute('aria-labelledby', 'rtab-report');
  const paneN = el('div', 'tabpane nbpane'); paneN.id = 'rpane-nearby'; paneN.setAttribute('role', 'tabpanel'); paneN.setAttribute('aria-labelledby', 'rtab-nearby');
  let n = actions.nextSibling;
  while (n) { const nx = n.nextSibling; paneR.appendChild(n); n = nx; }
  root.appendChild(bar); root.appendChild(paneR); root.appendChild(paneN);
  const show = (tab) => {
    _nbActiveTab.set(vid, tab);
    bar.querySelectorAll('.rtab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    });
    paneR.hidden = tab !== 'report';
    paneN.hidden = tab !== 'nearby';
    if (tab === 'nearby') nbOpen(paneN, report);
  };
  bar.addEventListener('click', (e) => { const b = e.target.closest('.rtab'); if (b) show(b.dataset.tab); });
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = _nbActiveTab.get(vid) || 'report';
    const next = cur === 'report' ? 'nearby' : 'report';
    show(next); bar.querySelector(`[data-tab="${next}"]`).focus();
  });
  show(_nbActiveTab.get(vid) || 'report');
}
window.mountReportTabs = mountReportTabs;
