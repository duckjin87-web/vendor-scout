// nearby.js — 근처 업체 탭
// 방문할 업체를 기점으로 주변 화장품 제조업체를 지도와 목록으로 보여준다.
// 한 번 가는 길에 들를 만한 곳을 같이 보고, 허가 여부까지 확인한 뒤 동선을 짜게 하려는 것이다.
//
// 화면 — 시안 A(지도 중심)와 B(리스트·동선)를 합친다
//   지도(A): 기점 ◆, 반경 링(선택 반경·절반), 허가 ● / 명단에 없음 ○ 핀, 선택 업체 카드
//   목록(B): 전체 · 제조업 허가 · 명단에 없음 탭, 지역 단계별 묶음, 펼치면 동선 담기·사전검증 리포트
//
// ── 위치를 믿는 방법 ──
// 처음 판에서는 주소를 좌표로 바꾼 결과를 그대로 썼다. 그런데 카카오 주소검색은 번지까지
// 못 맞추면 '파주시'처럼 시·군 중심점을 돌려준다. 그 점을 업체 위치로 찍어서, 파주시의 명단
// 업체 수십 곳이 모두 같은 2.9km에 몰렸고 동선도 엉뚱한 곳을 물었다.
// 이제는 두 단계로 좁힌다.
//   ① 글자 주소로 먼저 가른다 — 기점과 같은 읍·면·동 → 같은 시·군·구 → 같은 시·도 → 인접 시·도.
//      요청 없이 되고, 목록도 이 단계로 묶어 보여 준다.
//   ② 좌표는 '번지까지 맞은 결과(ROAD_ADDR·REGION_ADDR)'만 쓴다. 그리고 그 결과의 시·도·시·군이
//      글자 주소와 같아야 한다(교차검증). 못 맞으면 업체 이름으로 지도에서 한 번 더 찾는다.
//      그래도 안 되면 지도에 찍지 않고 '위치 미확인'으로 목록에만 둔다 — 틀린 점을 찍느니 안 찍는다.
//
// 데이터 — 요청 수를 먼저 생각했다
//   카카오 장소검색(주변 '화장품 제조/화장품 공장/코스메틱') · 식약처 제조업 명단 전체(세션 캐시)
//   · CGMP 명단 · 명단 업체 주소→좌표(가까운 단계부터 30곳씩, 결과는 브라우저에 저장)
//
// 이 파일은 app.js 뒤에 로드되며 app.js의 전역($, el, esc, proxyOnlyGet, proxyGet, pickByKey,
// stripCorp, visitAddress, lookup, mapLimit, BUILD)과 samples.js의 listOf·haversineKm를 쓴다.
// 모두 사용 시점(탭을 연 뒤)에만 부른다.

const NB = {
  RADII: [10, 30, 50],
  DEFAULT_RADIUS: 30,
  MAX_KM: 50,                                   // 한 번 받아 두고 반경 전환은 화면에서만 거른다
  QUERIES: ['화장품 제조', '화장품 공장', '코스메틱'],
  MAX_PAGES: 3,                                 // 카카오 장소검색 상한(15건 × 3쪽)
  GEO_BATCH: 30,                                // 명단 업체 좌표 변환 — 한 번에 이만큼
  NAME_RETRY: 10,                               // 번지가 안 맞은 가까운 업체를 이름으로 다시 찾는 수
  MFDS_PAGE: 500,
  MFDS_MAX_PAGES: 12,
};

// 인접 시·도 — 50km 반경은 도 경계를 쉽게 넘는다(세종 기점이면 청주·천안·대전)
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
// '청주시 흥덕구'처럼 시 아래 구가 붙으면 시까지를 같은 시·군으로 본다.
// 세종은 시·군·구가 없다 — sgg는 비고 바로 읍·면·동이 온다.
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
// '코스맥스 평택공장'과 '코스맥스(주)'가 같은 회사로 모이게 하려는 것이다.
const NB_SITE_TOKEN = /(제?\d*공장|본사|연구소|연구센터|사업장|지점|센터|사무소|캠퍼스|\d+동|R&D센터)$/i;
function nbNorm(s) {
  const toks = stripCorp(String(s || ''))
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  while (toks.length > 1 && NB_SITE_TOKEN.test(toks[toks.length - 1])) toks.pop();
  return toks.join('').replace(NB_SITE_TOKEN, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}
const nbNameHit = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))));

// 카카오 장소 중 '만드는 곳'만 남긴다. 화장품 가게·미용실·병원·물류창고가 섞여 나오기 때문이다.
const NB_EXCLUDE_CAT = /가정,생활|쇼핑|뷰티,미용|음식점|카페|숙박|교육|학원|병원|의원|약국|편의점|마트|백화점|면세|부동산|주차장|문화,예술|여행|스포츠|레저|물류|창고|택배|운송|도매|유통/;
const NB_RETAIL_NAME = /올리브영|아리따움|이니스프리|토니모리|더페이스샵|에뛰드|미샤|네이처리퍼블릭|롭스|랄라블라|세포라|시코르|아모레스토어|물류센터|\S+점$/;
const NB_MAKER_CAT = /제조|산업|공장|회사|화학|바이오|연구|기업/;
const NB_MAKER_NAME = /코스메틱|화장품|cosmetic|코스|바이오|랩|lab|뷰티|팜|케미|화학|메디|사이언스/i;
function nbLooksMaker(p) {
  const cat = String(p.category_name || ''), nm = String(p.place_name || '');
  if (NB_EXCLUDE_CAT.test(cat)) return 'category';
  if (NB_RETAIL_NAME.test(nm)) return 'retail';
  if (NB_MAKER_CAT.test(cat) || NB_MAKER_NAME.test(nm)) return null;
  return 'unrelated';
}

// ── 주소 → 좌표 (번지까지 맞은 결과만) ──
// 저장 키를 바꾼다(vs_geo → vs_geo2). 옛 캐시에는 시·군 중심점이 업체 위치처럼 들어가 있다.
const NB_GEO_KEY = 'vs_geo2';
try { localStorage.removeItem('vs_geo'); } catch { /* 무시 */ }
function nbGeoGet(addr) {
  try { const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}'); return m[addr] || null; } catch { return null; }
}
function nbGeoSet(addr, g) {
  try {
    const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}');
    m[addr] = g;
    const keys = Object.keys(m);
    if (keys.length > 1500) keys.slice(0, keys.length - 1500).forEach((k) => { delete m[k]; });
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
  return { lat: Number(d.y), lng: Number(d.x), exact: NB_EXACT.includes(d.address_type), type: d.address_type || '',
    sido: nbSido(reg.region_1depth_name || ''), sgg: String(reg.region_2depth_name || '').split(' ')[0] || '',
    emd: r3.split(' ')[0] || '' };
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
    res = bad ? { status: 'mismatch', got: nbRegionText(g) } : { status: 'exact', lat: g.lat, lng: g.lng, emd: g.emd, sgg: g.sgg, sido: g.sido };
  } else {
    // 동·시 단위까지만 맞음 — 좌표는 버리고 어디까지 맞았는지만 남긴다
    res = { status: 'region', got: loose ? nbRegionText(loose) : '' };
  }
  nbGeoSet(addr, res);
  return res;
}
// 번지가 안 맞은 업체는 이름으로 지도에서 찾는다. 이름과 시·군이 모두 맞는 장소만 쓴다.
async function nbFindByName(st, v) {
  const q = stripCorp(v.mfdsName || v.name).replace(/\([^)]*\)/g, ' ').trim();
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
    return { lat, lng, emd: p.emd, phone: d.phone || '', url: d.place_url || '' };
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
  const addr = pickByKey(r, /ADDR|SITE|LOCP|소재지|주소/i);
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
    // 명단을 끝까지 봤을 때만 '명단에 없음'이라고 말할 수 있다
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

// 카카오 장소 ↔ 식약처 명단. 이름이 맞고, 시·도와 시·군까지 같아야 같은 업체로 본다.
function nbMatchMfds(item, list) {
  let pre = null;
  for (const r of list) {
    const p = r.parts;
    if (item.parts.sido && p.sido && item.parts.sido !== p.sido) continue;
    if (item.parts.sgg && p.sgg && item.parts.sgg !== p.sgg) continue;
    if (r.key === item.key) return r;
    if (!pre && nbNameHit(r.key, item.key)) pre = r;
  }
  return pre;
}

// ── 데이터 수집 ──
// 기점도 같은 기준으로 잡는다. 번지까지 맞으면 그 좌표, 아니면 리포트의 방문 좌표를 쓰되 표시한다.
async function nbCenter(report) {
  const m = report.meta || {};
  const addr = m.visit_addr || visitAddress(report);
  if (!addr && !(m.visit_coord && isFinite(m.visit_coord.lat))) {
    throw new Error('방문지 주소가 없어 주변을 찾을 수 없습니다 — 공장·본점 주소가 확인된 업체에서 쓸 수 있습니다');
  }
  const text = nbAddrParts(addr);
  const g = addr ? await nbGeocode(addr, text).catch(() => null) : null;
  if (g && g.status === 'exact') {
    return { lat: g.lat, lng: g.lng, addr, exact: true, loc: { sido: g.sido || text.sido, sgg: g.sgg || text.sgg, emd: g.emd || text.emd } };
  }
  if (m.visit_coord && isFinite(m.visit_coord.lat) && isFinite(m.visit_coord.lng)) {
    return { lat: m.visit_coord.lat, lng: m.visit_coord.lng, addr, exact: false, loc: text };
  }
  throw new Error(`방문지 주소를 번지까지 좌표로 바꾸지 못했습니다 (${addr}) — 거리를 재면 틀리므로 근처 업체를 표시하지 않습니다`);
}

async function nbKakao(st) {
  const out = new Map();
  const diag = { calls: 0, raw: 0, excl: { category: 0, retail: 0, unrelated: 0 }, errors: [] };
  await mapLimit(NB.QUERIES, 2, async (q) => {
    for (let page = 1; page <= NB.MAX_PAGES; page++) {
      let d;
      try {
        d = await proxyOnlyGet('kakaoKeyword', { query: q, x: String(st.center.lng), y: String(st.center.lat),
          sort: 'distance', page: String(page), size: '15' });
        diag.calls++;
      } catch (e) { diag.errors.push(`${q}: ${e.message}`); break; }
      const docs = (d && d.documents) || [];
      diag.raw += docs.length;
      let lastKm = 0;
      for (const p of docs) {
        const lat = Number(p.y), lng = Number(p.x);
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const km = haversineKm(st.center.lat, st.center.lng, lat, lng);
        lastKm = km;
        if (km > NB.MAX_KM) continue;
        const why = nbLooksMaker(p);
        if (why) { diag.excl[why]++; continue; }
        if (out.has(p.id)) continue;
        const key = nbNorm(p.place_name);
        if (st.vendorKey && nbNameHit(key, st.vendorKey) && km < 1) continue;     // 기점 자신
        const parts = nbAddrParts(p.address_name || p.road_address_name || '');
        out.set(p.id, { id: `k${p.id}`, name: p.place_name, key, addr: p.road_address_name || p.address_name || '', parts,
          tier: nbTier(st.loc, parts), lat, lng, km, geo: 'place',
          type: String(p.category_name || '').split('>').pop().trim() || '업종 미상',
          phone: p.phone || '', url: p.place_url || '', src: 'kakao', reg: undefined, cgmp: false });
      }
      if (!docs.length || (d.meta && d.meta.is_end) || lastKm > NB.MAX_KM) break;
    }
  });
  return { items: [...out.values()], diag };
}

function nbAnnotate(st) {
  const M = st.mfds, G = st.gmp;
  st.items.forEach((it) => {
    if (it.src === 'mfds') return;
    if (M) {
      const hit = nbMatchMfds(it, M.list);
      if (hit) { it.reg = true; it.lcns = hit.lcns; it.mfdsName = hit.nm; it.rep = hit.rep; st.matched.add(hit); }
      else it.reg = M.full ? false : null;
    } else if (st.mfdsErr) it.reg = null;
    if (G) it.cgmp = G.has(it.key) || (it.mfdsName ? G.has(nbNorm(it.mfdsName)) : false);
  });
}

// 명단 업체 중 기점과 같은 시·도·인접 시·도인 것을 모두 목록에 올린다(아직 좌표 없음).
// 글자 주소만으로 단계가 정해지므로 요청이 없다. 좌표는 가까운 단계부터 차례로 붙인다.
function nbSeedMfds(st) {
  if (!st.mfds) return;
  const near = new Set([st.loc.sido, ...(NB_ADJ[st.loc.sido] || [])].filter(Boolean));
  st.mfds.list.forEach((r, i) => {
    if (!r.addr || !r.parts.sido || !near.has(r.parts.sido) || st.matched.has(r)) return;
    if (st.vendorKey && nbNameHit(r.key, st.vendorKey) && nbTier(st.loc, r.parts) <= 1) return;   // 기점 자신
    st.items.push({ id: `m${i}`, name: r.nm, key: r.key, addr: r.addr, parts: { ...r.parts },
      tier: nbTier(st.loc, r.parts), lat: null, lng: null, km: null, geo: 'pending',
      type: '식약처 제조업 명단', phone: '', url: '', src: 'mfds', reg: true, lcns: r.lcns, rep: r.rep, mfdsName: r.nm,
      cgmp: st.gmp ? st.gmp.has(r.key) : false });
  });
}
function nbApplyGeo(st, v, g) {
  if (g && g.status === 'exact') {
    v.lat = g.lat; v.lng = g.lng; v.km = haversineKm(st.center.lat, st.center.lng, g.lat, g.lng); v.geo = 'exact';
    if (g.emd && !v.parts.emd) v.parts.emd = g.emd;
  } else {
    v.geo = g && g.status === 'mismatch' ? 'mismatch' : 'region';
    v.geoNote = g && g.got ? g.got : '';
  }
  v.tier = nbTier(st.loc, v.parts);
}
async function nbGeocodeBatch(st) {
  const pend = () => st.items.filter((v) => v.src === 'mfds' && v.geo === 'pending');
  // 저장해 둔 결과는 요청 없이 먼저 붙인다
  for (const v of pend()) { const c = nbGeoGet(v.addr); if (c) nbApplyGeo(st, v, c); }
  const batch = pend().sort((a, b) => a.tier - b.tier).slice(0, NB.GEO_BATCH);
  let done = 0;
  await mapLimit(batch, 3, async (v) => {
    const g = await nbGeocode(v.addr, v.parts).catch(() => null);
    nbApplyGeo(st, v, g);
    if (++done % 6 === 0) { st.phase = `인근 업체 위치 확인 ${done}/${batch.length}`; nbPaint(st); }
  });
  // 번지가 안 맞은 가까운(같은 시·군 이내) 업체는 이름으로 지도에서 한 번 더
  const retry = st.items.filter((v) => v.src === 'mfds' && (v.geo === 'region' || v.geo === 'mismatch') && v.tier <= 1 && !v.nameTried)
    .slice(0, NB.NAME_RETRY);
  await mapLimit(retry, 2, async (v) => {
    v.nameTried = true;
    const hit = await nbFindByName(st, v).catch(() => null);
    if (!hit) return;
    v.lat = hit.lat; v.lng = hit.lng; v.km = haversineKm(st.center.lat, st.center.lng, hit.lat, hit.lng);
    v.geo = 'name'; v.phone = v.phone || hit.phone; v.url = v.url || hit.url;
    if (hit.emd && !v.parts.emd) v.parts.emd = hit.emd;
    v.tier = nbTier(st.loc, v.parts);
  });
  st.geoRemain = pend().length;
}

async function nbLoad(st) {
  st.loading = true; st.error = null; nbPaint(st);
  try {
    st.center = await nbCenter(st.report);
    st.loc = st.center.loc;
  } catch (e) { st.loading = false; st.error = e.message; nbPaint(st); return; }
  // 어느 단계에서 예외가 나도 '찾는 중'에 멈춰 있지 않게 한다 — 받은 만큼은 보여 준다
  try {
    st.phase = '카카오 지도에서 주변 업체를 찾는 중';
    nbPaint(st);
    try {
      const k = await nbKakao(st);
      st.items = k.items; st.kdiag = k.diag;
    } catch (e) { st.kdiag = { errors: [e.message] }; }
    st.phase = '식약처 제조업 명단과 대조하는 중';
    nbPaint(st);
    const [m, g] = await Promise.allSettled([nbMfdsAll(), nbGmpAll()]);
    if (m.status === 'fulfilled') st.mfds = m.value; else st.mfdsErr = String(m.reason && m.reason.message || m.reason);
    if (g.status === 'fulfilled') st.gmp = g.value; else st.gmpErr = String(g.reason && g.reason.message || g.reason);
    nbAnnotate(st);
    nbSeedMfds(st);
    st.phase = '명단 업체 위치를 번지 단위로 확인하는 중';
    nbPaint(st);
    await nbGeocodeBatch(st).catch(() => {});
  } catch (e) {
    st.note = e && e.message ? e.message : String(e);
  } finally {
    st.loading = false; st.phase = null;
    if (!st.sel) { const first = nbVisible(st).find(nbPlaced); if (first) st.sel = first.id; }
    nbPaint(st);
  }
}

// ── 화면 ──
const nbStates = new Map();       // vendor_id → 상태(탭을 오가도, 리포트를 다시 그려도 유지)
const _nbActiveTab = new Map();   // vendor_id → 'report' | 'nearby'

// 지도에 찍을 수 있는가 — 장소 좌표이거나, 번지까지 맞았거나, 이름·시군으로 지도에서 찾은 것
const nbPlaced = (v) => v.geo === 'place' || v.geo === 'exact' || v.geo === 'name';
// 목록에 올릴 것: 좌표가 있으면 반경 안, 좌표가 없으면 같은 시·군 이내(단계로 가까움이 확인된 것)
function nbVisible(st) {
  return st.items.filter((v) => (nbPlaced(v) ? v.km <= st.radius : v.tier <= 1))
    .sort((a, b) => a.tier - b.tier || (a.km ?? 1e9) - (b.km ?? 1e9) || String(a.name).localeCompare(String(b.name)));
}
function nbFiltered(st) {
  const vis = nbVisible(st);
  return st.filter === 'reg' ? vis.filter((v) => v.reg === true)
    : st.filter === 'new' ? vis.filter((v) => v.reg !== true) : vis;
}
const nbCls = (v) => (v.reg === true ? 'reg' : v.reg === false ? 'new' : 'unk');
function nbStatusText(st, v) {
  if (v.reg === true) return `식약처 화장품제조업 허가${v.lcns ? ` ${v.lcns}` : ''}`;
  if (v.reg === false) return '식약처 제조업 명단에 없음';
  return st.mfdsErr ? '명단 조회 실패 — 확인 불가' : (st.mfds && !st.mfds.full ? '명단 일부만 받음 — 확인 불가' : '확인 중');
}
function nbGeoText(v) {
  return v.geo === 'place' ? '카카오 지도에 등록된 위치'
    : v.geo === 'exact' ? '식약처 주소를 번지까지 확인'
      : v.geo === 'name' ? '식약처 주소가 번지까지 안 맞아 업체 이름·시군으로 지도에서 찾음'
        : v.geo === 'mismatch' ? `주소를 좌표로 바꾸니 다른 지역(${v.geoNote || '?'})이 나와 표시하지 않음`
          : v.geo === 'region' ? `번지까지 안 맞음${v.geoNote ? ` (${v.geoNote}까지만 확인)` : ''} — 지도에 표시하지 않음`
            : '위치 확인 전';
}
const nbFmtKm = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));
function nbKakaoRoute(st, stops) {
  const pt = (n, lat, lng) => `${encodeURIComponent(String(n).replace(/[,/]/g, ' '))},${lat},${lng}`;
  return 'https://map.kakao.com/link/by/car/'
    + [pt(`${st.vendorName}(기점)`, st.center.lat, st.center.lng), ...stops.map((s) => pt(s.name, s.lat, s.lng))].join('/');
}
// 동선 순서 — 기점에서 가장 가까운 곳부터 차례로(탐욕 근사). 좌표가 확인된 곳만.
function nbRouteOrder(st) {
  const left = st.items.filter((v) => st.route.includes(v.id) && nbPlaced(v));
  const out = []; let cur = st.center; let dist = 0;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((v, i) => { const d = haversineKm(cur.lat, cur.lng, v.lat, v.lng); if (d < bd) { bd = d; bi = i; } });
    const v = left.splice(bi, 1)[0]; out.push(v); dist += bd; cur = v;
  }
  return { stops: out, km: dist };
}

function nbSheetHtml(st) {
  const vis = nbVisible(st);
  const placed = vis.filter(nbPlaced);
  const regN = vis.filter((v) => v.reg === true).length;
  const unplaced = vis.length - placed.length;
  let h = `<div class="nb-sum">반경 ${st.radius}km · 제조업 허가 <b>${regN}</b>곳 · 전체 <b>${vis.length}</b>곳`
    + (unplaced ? ` <span class="nb-sum-warn">(위치 미확인 ${unplaced}곳은 지도에 없음)</span>` : '') + '</div>';
  const s = st.items.find((v) => v.id === st.sel);
  if (!s || !vis.includes(s)) return h + `<div class="nb-empty">${vis.length ? '지도나 목록에서 업체를 고르세요.' : '이 반경 안에서 찾은 업체가 없습니다. 반경을 넓혀 보세요.'}</div>`;
  const badge = s.reg === true ? '<span class="nb-badge reg">제조업 허가</span>'
    : s.reg === false ? '<span class="nb-badge new">명단에 없음</span>' : '<span class="nb-badge unk">허가 확인 불가</span>';
  const tel = s.phone ? `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : '—';
  const placed1 = nbPlaced(s);
  const mapUrl = s.url || (placed1
    ? `https://map.kakao.com/link/map/${encodeURIComponent(s.name.replace(/[,/]/g, ' '))},${s.lat},${s.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(s.addr || s.name)}`);
  h += `<div class="nb-selhead"><div class="nb-selname"><b>${esc(s.name)}</b>${badge}${s.cgmp ? '<span class="nb-badge gmp">CGMP</span>' : ''}</div>`
    + `<div class="nb-seld">${placed1 ? `${nbFmtKm(s.km)}<small>km</small>` : '<small>거리 미확인</small>'}</div></div>`
    + `<div class="nb-selsub">${esc(nbTierLabel(st, s.tier))} · ${esc(nbRegionText(s.parts) || '')}</div>`
    + `<dl class="nb-selbox">`
    + `<dt>식약처 제조업</dt><dd class="${nbCls(s)}">${esc(nbStatusText(st, s))}${s.mfdsName && s.mfdsName !== s.name ? `<small>명단상 이름 ${esc(s.mfdsName)}</small>` : ''}</dd>`
    + `<dt>CGMP</dt><dd>${s.cgmp ? '적합업소' : (st.gmp ? '명단에 없음' : '확인 불가')}</dd>`
    + `<dt>전화</dt><dd>${tel}</dd>`
    + `<dt>주소</dt><dd>${esc(s.addr || '—')}</dd>`
    + `<dt>위치 근거</dt><dd class="${placed1 ? '' : 'unk'}">${esc(nbGeoText(s))}</dd>`
    + `</dl>`
    + `<div class="nb-selacts">`
    + (placed1 ? `<a class="nb-btn" href="${esc(nbKakaoRoute(st, [s]))}" target="_blank" rel="noopener">길찾기</a>`
      : `<button type="button" class="nb-btn" disabled title="위치가 번지까지 확인되지 않았습니다">길찾기</button>`)
    + `<a class="nb-btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">카카오맵</a>`
    + `<button type="button" class="nb-btn dark" data-act="report" data-id="${esc(s.id)}">사전검증 리포트</button>`
    + `</div>`;
  return h;
}

function nbRowHtml(st, v) {
  const open = st.open === v.id, inRoute = st.route.includes(v.id), placed = nbPlaced(v);
  const tel = v.phone ? ` · <a href="tel:${esc(v.phone.replace(/[^\d+]/g, ''))}">${esc(v.phone)}</a>` : '';
  const dist = placed ? `<b>${nbFmtKm(v.km)}</b><i>km</i>` : `<b class="nb-dq">—</b><i>${v.geo === 'pending' ? '확인 전' : '미확인'}</i>`;
  return `<div class="nb-row${open ? ' open' : ''}${st.sel === v.id ? ' sel' : ''}${placed ? '' : ' unplaced'}" data-row="${esc(v.id)}">`
    + `<button type="button" class="nb-rowbtn" data-act="pick" data-id="${esc(v.id)}" aria-expanded="${open}">`
    + `<span class="nb-d">${dist}</span>`
    + `<span class="nb-main"><span class="nb-nm"><span class="nb-mark ${nbCls(v)}"></span>${esc(v.name)}</span>`
    + `<span class="nb-sub">${esc(nbRegionText(v.parts) || '')}${v.parts && v.parts.sido ? ' · ' : ''}${esc(v.type)}</span></span>`
    + (v.cgmp ? '<span class="nb-chip">CGMP</span>' : '<span class="nb-chip off">—</span>')
    + (inRoute ? '<span class="nb-inroute" title="동선에 담음">동선</span>' : '')
    + `</button>`
    + (open ? `<div class="nb-more"><div class="nb-facts">${esc(nbStatusText(st, v))}${v.cgmp ? ' · CGMP 적합' : ''}${tel}</div>`
      + `<div class="nb-addr">${esc(v.addr || '')}</div>`
      + `<div class="nb-geo${placed ? '' : ' warn'}">위치 근거: ${esc(nbGeoText(v))}</div>`
      + `<div class="nb-acts">`
      + (placed
        ? `<button type="button" class="nb-btn${inRoute ? '' : ' blue'}" data-act="route" data-id="${esc(v.id)}">${inRoute ? '동선에서 빼기' : '동선에 추가'}</button>`
        : `<button type="button" class="nb-btn" disabled title="위치가 번지까지 확인되지 않아 동선에 넣지 않습니다">동선에 추가 불가</button>`)
      + `<button type="button" class="nb-btn" data-act="report" data-id="${esc(v.id)}">사전검증 리포트</button></div></div>` : '')
    + `</div>`;
}

function nbListHtml(st) {
  const vis = nbVisible(st);
  const n = { all: vis.length, reg: vis.filter((v) => v.reg === true).length };
  n.new = n.all - n.reg;
  const newLabel = st.mfds && st.mfds.full ? '명단에 없음' : '허가 미확인';
  const tabs = [['all', '전체', n.all], ['reg', '제조업 허가', n.reg], ['new', newLabel, n.new]]
    .map(([id, l, c]) => `<button type="button" class="nb-tab" data-act="filter" data-f="${id}" aria-pressed="${st.filter === id}">${l} <b>${c}</b></button>`).join('');
  const rows = nbFiltered(st);
  // 지역 단계별로 묶는다 — 같은 읍·면·동 → 같은 시·군 → 같은 시·도 → 인접 시·도
  let body = '';
  let lastTier = -1;
  rows.forEach((v) => {
    if (v.tier !== lastTier) {
      const cnt = rows.filter((x) => x.tier === v.tier).length;
      const unp = rows.filter((x) => x.tier === v.tier && !nbPlaced(x)).length;
      body += `<div class="nb-grp"><b>${esc(nbTierLabel(st, v.tier))}</b><span>${cnt}곳${unp ? ` · 위치 미확인 ${unp}` : ''}</span></div>`;
      lastTier = v.tier;
    }
    body += nbRowHtml(st, v);
  });
  if (!rows.length) body = `<div class="nb-empty">${st.loading ? '찾는 중…' : '해당하는 업체가 없습니다.'}</div>`;
  if (!st.loading && st.geoRemain > 0) {
    body += `<button type="button" class="nb-more-btn" data-act="more">명단 업체 ${Math.min(NB.GEO_BATCH, st.geoRemain)}곳 위치 더 확인 <small>남은 ${st.geoRemain}곳 · 가까운 지역부터 · 주소 변환 요청이 나갑니다</small></button>`;
  }
  const r = nbRouteOrder(st);
  const foot = `<div class="nb-route"><div><small>오늘 동선</small><b>기점 포함 ${r.stops.length + 1}곳</b>`
    + (r.stops.length ? `<small>직선 합계 약 ${Math.round(r.km)}km · ${esc(r.stops.map((s) => s.name).join(' → '))}</small>` : '<small>목록에서 업체를 펼쳐 동선에 추가하세요 (위치가 확인된 곳만)</small>')
    + `</div>`
    + (r.stops.length ? `<button type="button" class="nb-btn" data-act="clear">비우기</button>`
      + `<a class="nb-btn dark" href="${esc(nbKakaoRoute(st, r.stops.slice(0, 6)))}" target="_blank" rel="noopener">카카오맵 경로 보기</a>` : '')
    + `</div>`
    + (r.stops.length > 6 ? '<div class="nb-note">카카오맵 경로는 기점 포함 7곳까지만 넘깁니다 — 앞의 6곳까지 열립니다.</div>' : '');
  return `<div class="nb-tabs" role="group" aria-label="허가 여부로 거르기">${tabs}</div><div class="nb-rows">${body}</div>${foot}`;
}

function nbStatusLine(st) {
  const bits = [];
  if (st.center && !st.center.exact) bits.push('<b class="nb-warn">기점 위치가 번지까지 확인되지 않아 거리가 부정확할 수 있습니다</b>');
  if (st.kdiag) {
    if (st.kdiag.errors && st.kdiag.errors.length && !st.kdiag.calls) bits.push(`카카오 장소검색 실패(${esc(st.kdiag.errors[0])})`);
    else if (st.kdiag.calls) bits.push(`카카오 지도 ${st.items.filter((v) => v.src === 'kakao').length}곳`
      + (st.kdiag.excl ? ` <span title="판매점·미용실·물류창고 등 제외">(제외 ${st.kdiag.excl.category + st.kdiag.excl.retail + st.kdiag.excl.unrelated})</span>` : ''));
  }
  if (st.mfds) bits.push(`식약처 명단 ${st.mfds.list.length.toLocaleString()}곳 대조${st.mfds.full ? '' : ' (일부만 받음 — 명단에 없다고 단정하지 않습니다)'}`);
  else if (st.mfdsErr) bits.push('식약처 명단 조회 실패 — 허가 여부 확인 불가');
  const m = st.items.filter((v) => v.src === 'mfds');
  if (m.length) {
    const c = (g) => m.filter((v) => v.geo === g).length;
    bits.push(`명단 업체 위치: 번지 확인 ${c('exact')} · 이름으로 찾음 ${c('name')} · 번지 불일치 ${c('region') + c('mismatch')} · 확인 전 ${c('pending')}`);
  }
  if (st.gmpErr) bits.push('CGMP 명단 조회 실패');
  return bits.join(' · ');
}

function nbPaint(st) {
  const pane = st.pane;
  if (!pane || !pane.isConnected) return;
  if (!pane.querySelector('.nb')) {
    pane.innerHTML = `<div class="nb">`
      + `<div class="nb-head"><div class="nb-title"><b>근처 제조업체</b><small class="nb-origin"></small></div>`
      + `<div class="nb-legend"><span><i class="nb-mark reg"></i>제조업 허가</span><span><i class="nb-mark new"></i>명단에 없음</span><span><i class="nb-mark unk"></i>확인 불가</span></div>`
      + `<div class="nb-seg" role="group" aria-label="반경">${NB.RADII.map((r) => `<button type="button" data-act="radius" data-r="${r}">${r}km</button>`).join('')}</div></div>`
      + `<div class="nb-body"><div class="nb-mapcol"><div class="nb-map" role="region" aria-label="근처 업체 지도"></div><div class="nb-sheet"></div></div>`
      + `<div class="nb-listcol"></div></div>`
      + `<div class="nb-status"></div></div>`;
  }
  pane.querySelector('.nb-origin').textContent = st.center
    ? `기점 ${st.vendorName} · ${nbRegionText(st.loc) || st.center.addr || ''}` : `기점 ${st.vendorName}`;
  pane.querySelectorAll('.nb-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === st.radius)));
  const status = pane.querySelector('.nb-status');
  if (st.error) {
    pane.querySelector('.nb-sheet').innerHTML = `<div class="nb-empty err">${esc(st.error)}</div>`;
    pane.querySelector('.nb-listcol').innerHTML = '';
    status.textContent = '';
    nbDrawMapSafe(st);
    return;
  }
  pane.querySelector('.nb-sheet').innerHTML = st.center ? nbSheetHtml(st) : '<div class="nb-empty">방문지 위치를 확인하는 중…</div>';
  pane.querySelector('.nb-listcol').innerHTML = nbListHtml(st);
  status.innerHTML = (st.phase ? `<span class="nb-spin" aria-hidden="true"></span>${esc(st.phase)} · ` : '') + nbStatusLine(st)
    + ' · 거리는 직선거리입니다';
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
  if (!box || !st.center || st.pane.hidden) return;
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
  // 반경 라벨 — 링의 위쪽 끝에
  const up = (km) => [st.center.lat + km / 111.32, st.center.lng];
  L.marker(up(st.radius), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-rlabel', html: `<span>${st.radius}km</span>`, iconSize: [48, 18], iconAnchor: [24, 9] }) }).addTo(st.layer);
  L.marker(up(st.radius / 2), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'nb-rlabel half', html: `<span>${st.radius / 2}km</span>`, iconSize: [48, 18], iconAnchor: [24, 9] }) }).addTo(st.layer);
  // 기점
  L.marker(c, { keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'nb-origin-pin', html: `<span class="nb-dia"></span><span class="nb-plabel strong">${esc(st.vendorName)} · 기점</span>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(st.layer);
  // 업체 핀 — 반경 안의 것만. 많으면 이름은 고른 것만 붙인다(겹쳐서 읽을 수 없다)
  // 지도에는 위치가 확인된 업체만 찍는다 — 시·군 중심점 같은 추정 위치는 찍지 않는다
  const vis = nbVisible(st).filter(nbPlaced);
  const showAll = vis.length <= 12;
  vis.forEach((v) => {
    const on = v.id === st.sel;
    // 기점 바로 옆 핀의 이름은 기점 이름과 겹친다 — 고른 것만 붙이고, 가까이 보려면 10km로
    const crowd = !on && v.km < st.radius * 0.12;
    const label = ((showAll || on) && !crowd) ? `<span class="nb-plabel${on ? ' strong' : ''}">${esc(v.name)}</span>` : '';
    const m = L.marker([v.lat, v.lng], {
      title: v.name, alt: v.name, riseOnHover: true, zIndexOffset: on ? 900 : 0,
      icon: L.divIcon({ className: 'nb-pinwrap', html: `<span class="nb-pin ${nbCls(v)}${on ? ' on' : ''}"></span>${label}`, iconSize: [32, 32], iconAnchor: [16, 16] }),
    }).addTo(st.layer);
    m.on('click', () => nbSelect(st, v.id, { fromMap: true }));
  });
  // 원의 getBounds()는 지도 투영에 기대서 그리기 직후엔 불안정하다. 좌표에서 바로 계산한다.
  if (st.drawnRadius !== st.radius) { map.fitBounds(L.latLng(c).toBounds(st.radius * 2000), { padding: [8, 8] }); st.drawnRadius = st.radius; }
}

function nbSelect(st, id, opts = {}) {
  st.sel = id;
  if (opts.fromMap) st.open = id;
  nbPaint(st);
  const v = st.items.find((x) => x.id === id);
  if (v && st.map && !opts.fromMap && nbPlaced(v)) st.map.panTo([v.lat, v.lng]);
  if (opts.fromMap) {
    const row = st.pane.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function nbBind(st) {
  st.pane.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !st.pane.contains(b)) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'radius') { st.radius = Number(b.dataset.r); if (st.sel && !nbVisible(st).some((v) => v.id === st.sel)) st.sel = (nbVisible(st).find(nbPlaced) || {}).id || null; nbPaint(st); }
    else if (act === 'filter') { st.filter = b.dataset.f; nbPaint(st); }
    else if (act === 'pick') { st.open = st.open === id ? null : id; nbSelect(st, id); }
    else if (act === 'route') { st.route = st.route.includes(id) ? st.route.filter((x) => x !== id) : st.route.concat(id); nbPaint(st); }
    else if (act === 'clear') { st.route = []; nbPaint(st); }
    else if (act === 'more') { st.loading = true; st.phase = '명단 업체 위치를 더 확인하는 중'; nbPaint(st); nbGeocodeBatch(st).finally(() => { st.loading = false; st.phase = null; nbPaint(st); }); }
    else if (act === 'report') {
      const v = st.items.find((x) => x.id === id);
      if (!v) return;
      const q = document.getElementById('q'); if (q) q.value = v.mfdsName || v.name;
      const bz = document.getElementById('bno'); if (bz) bz.value = '';
      lookup(v.mfdsName || v.name, '');
    }
  });
}

function nbOpen(pane, report) {
  const vid = (report.meta && report.meta.vendor_id) || 'x';
  let st = nbStates.get(vid);
  if (!st) {
    const name = String((report.meta && report.meta.vendor_name) || '');
    st = { vid, report, vendorName: stripCorp(name) || name, vendorKey: nbNorm(name), radius: NB.DEFAULT_RADIUS,
      filter: 'all', sel: null, open: null, route: [], items: [], matched: new Set(),
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
