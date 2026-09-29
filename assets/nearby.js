// nearby.js — 근처 업체 탭
// 방문할 업체를 기점으로 주변 화장품 제조업체를 지도와 목록으로 보여준다.
// 한 번 가는 길에 들를 만한 곳을 같이 보고, 허가 여부까지 확인한 뒤 동선을 짜게 하려는 것이다.
//
// 화면 — 시안 A(지도 중심)와 B(리스트·동선)를 합친다
//   지도(A): 기점 ◆, 반경 링(선택 반경·절반), 허가 ● / 명단에 없음 ○ 핀, 선택 업체 카드
//   목록(B): 전체 · 제조업 허가 · 명단에 없음 탭, 거리순 행, 펼치면 동선 담기·사전검증 리포트
//
// 데이터 — 요청 수를 먼저 생각했다
//   ① 카카오 장소검색: 기점 좌표에서 가까운 순 '화장품 제조/화장품 공장/코스메틱'
//      (질의당 최대 3쪽, 좌표·거리가 함께 와서 추가 변환이 필요 없다)
//   ② 식약처 화장품제조업 명단 전체: 허가 대조용. 페이지를 넘겨 받고 세션 동안 한 번만 받는다
//   ③ 식약처 CGMP 적합업소: CGMP 대조용(한 번)
//   ④ 명단에는 있는데 지도에 안 올라온 업체: 같은 시·군·구 → 같은 시·도 → 인접 시·도 순으로
//      30곳씩 좌표를 바꿔 추가한다. 변환한 좌표는 브라우저에 저장해 다음부터는 요청하지 않는다
//
// 이 파일은 app.js 뒤에 로드되며 app.js의 전역($, el, esc, proxyOnlyGet, proxyGet, pickByKey,
// stripCorp, kakaoGeocodeFlex, visitAddress, lookup, mapLimit, BUILD)과 samples.js의
// listOf·haversineKm를 쓴다. 모두 사용 시점(탭을 연 뒤)에만 부른다.

const NB = {
  RADII: [10, 30, 50],
  DEFAULT_RADIUS: 30,
  MAX_KM: 50,                                   // 한 번 받아 두고 반경 전환은 화면에서만 거른다
  QUERIES: ['화장품 제조', '화장품 공장', '코스메틱'],
  MAX_PAGES: 3,                                 // 카카오 장소검색 상한(15건 × 3쪽)
  GEO_BATCH: 30,                                // 명단 기반 추가 — 한 번에 좌표 변환할 수
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
function nbSigungu(addr) {
  const t = String(addr || '').trim().split(/\s+/)[1] || '';
  return /(시|군|구)$/.test(t) ? t : '';
}
function nbRegion(addr) {
  const toks = String(addr || '').trim().split(/\s+/);
  const sido = nbSido(addr);
  if (!sido) return '';
  const rest = toks.slice(1, 3).filter((t) => /(시|군|구|읍|면|동)$/.test(t));
  return [sido, ...rest].join(' ');
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

// 카카오 장소 중 '만드는 곳'만 남긴다. 화장품 가게·미용실·병원이 섞여 나오기 때문이다.
const NB_EXCLUDE_CAT = /가정,생활|쇼핑|뷰티,미용|음식점|카페|숙박|교육|학원|병원|의원|약국|편의점|마트|백화점|면세|부동산|주차장|문화,예술|여행|스포츠|레저/;
const NB_RETAIL_NAME = /올리브영|아리따움|이니스프리|토니모리|더페이스샵|에뛰드|미샤|네이처리퍼블릭|롭스|랄라블라|세포라|시코르|아모레스토어|\S+점$/;
const NB_MAKER_CAT = /제조|산업|공장|회사|화학|바이오|연구|기업/;
const NB_MAKER_NAME = /코스메틱|화장품|cosmetic|코스|바이오|랩|lab|뷰티|팜|케미|화학|메디|사이언스/i;
function nbLooksMaker(p) {
  const cat = String(p.category_name || ''), nm = String(p.place_name || '');
  if (NB_EXCLUDE_CAT.test(cat)) return 'category';
  if (NB_RETAIL_NAME.test(nm)) return 'retail';
  if (NB_MAKER_CAT.test(cat) || NB_MAKER_NAME.test(nm)) return null;
  return 'unrelated';
}

// ── 좌표 캐시 — 같은 주소를 매번 변환하지 않는다 ──
const NB_GEO_KEY = 'vs_geo';
function nbGeoGet(addr) {
  try { const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}'); const v = m[addr]; return v ? { lat: v[0], lng: v[1] } : null; } catch { return null; }
}
function nbGeoSet(addr, c) {
  try {
    const m = JSON.parse(localStorage.getItem(NB_GEO_KEY) || '{}');
    m[addr] = [Number(c.lat.toFixed(6)), Number(c.lng.toFixed(6))];
    const keys = Object.keys(m);
    if (keys.length > 800) keys.slice(0, keys.length - 800).forEach((k) => { delete m[k]; });
    localStorage.setItem(NB_GEO_KEY, JSON.stringify(m));
  } catch { /* 저장 못 해도 이번 조회는 된다 */ }
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
  return { nm, key: nbNorm(nm), addr, sido: nbSido(addr), sgg: nbSigungu(addr),
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
    _nbMfds = { list: raw.map(nbMkFields).filter((x) => x.nm && x.key), total, full, failed };
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

// 카카오 장소 ↔ 식약처 명단. 이름이 같아야 하고, 둘 다 시·도가 있으면 시·도도 같아야 한다.
// 접두 일치는 3자 이상에서만 — '코스맥스평택'(공장 이름이 붙어 남은 것)을 '코스맥스'에 붙이려는 것.
function nbMatchMfds(item, list) {
  let pre = null;
  for (const r of list) {
    if (item.sido && r.sido && item.sido !== r.sido) continue;
    if (r.key === item.key) return r;
    if (!pre && Math.min(r.key.length, item.key.length) >= 3 && (item.key.startsWith(r.key) || r.key.startsWith(item.key))) pre = r;
  }
  return pre;
}

// ── 데이터 수집 ──
async function nbCenter(report) {
  const m = report.meta || {};
  const addr = m.visit_addr || visitAddress(report);
  if (m.visit_coord && isFinite(m.visit_coord.lat) && isFinite(m.visit_coord.lng)) return { lat: m.visit_coord.lat, lng: m.visit_coord.lng, addr };
  if (!addr) throw new Error('방문지 주소가 없어 주변을 찾을 수 없습니다 — 공장·본점 주소가 확인된 업체에서 쓸 수 있습니다');
  const c = nbGeoGet(addr) || await kakaoGeocodeFlex(addr);
  if (!c) throw new Error(`방문지 주소를 좌표로 바꾸지 못했습니다 (${addr})`);
  nbGeoSet(addr, c);
  return { ...c, addr };
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
        const km = isFinite(Number(p.distance)) && p.distance !== '' ? Number(p.distance) / 1000 : haversineKm(st.center.lat, st.center.lng, lat, lng);
        lastKm = km;
        if (km > NB.MAX_KM) continue;
        const why = nbLooksMaker(p);
        if (why) { diag.excl[why]++; continue; }
        if (out.has(p.id)) continue;
        const addr = p.road_address_name || p.address_name || '';
        const key = nbNorm(p.place_name);
        if (st.vendorKey && key === st.vendorKey) continue;           // 기점 자신
        if (km < 0.15 && st.vendorKey && key.includes(st.vendorKey)) continue;
        out.set(p.id, { id: `k${p.id}`, name: p.place_name, key, addr, sido: nbSido(p.address_name || addr),
          region: nbRegion(p.address_name || addr), lat, lng, km,
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
      if (hit) { it.reg = true; it.lcns = hit.lcns; it.mfdsName = hit.nm; it.rep = hit.rep; st.matchedKeys.add(hit.key); }
      else it.reg = M.full ? false : null;
    } else if (st.mfdsErr) it.reg = null;
    if (G) it.cgmp = G.has(it.key) || (it.mfdsName ? G.has(nbNorm(it.mfdsName)) : false);
  });
}

// 명단에만 있는 업체를 좌표로 바꿔 추가 — 가까울 법한 순서로 GEO_BATCH곳씩
async function nbGeocodeBatch(st) {
  if (!st.mfds) return;
  const near = new Set([st.sido, ...(NB_ADJ[st.sido] || [])].filter(Boolean));
  const pri = (r) => (r.sido === st.sido && st.sgg && r.sgg === st.sgg ? 0 : r.sido === st.sido ? 1 : 2);
  const cands = st.mfds.list
    .filter((r) => r.addr && r.sido && near.has(r.sido) && !st.matchedKeys.has(r.key) && r.key !== st.vendorKey && !st.geoTried.has(r.key + '|' + r.addr))
    .sort((a, b) => pri(a) - pri(b));
  const add = (r, c) => {
    const km = haversineKm(st.center.lat, st.center.lng, c.lat, c.lng);
    if (km > NB.MAX_KM || km < 0.15) return;
    if (st.items.some((x) => x.key === r.key && Math.abs(x.km - km) < 0.3)) return;
    st.items.push({ id: `m${st.items.length}_${r.key}`, name: r.nm, key: r.key, addr: r.addr, sido: r.sido,
      region: nbRegion(r.addr), lat: c.lat, lng: c.lng, km, type: '식약처 제조업 명단', phone: '', url: '',
      src: 'mfds', reg: true, lcns: r.lcns, rep: r.rep, mfdsName: r.nm, cgmp: st.gmp ? st.gmp.has(r.key) : false });
  };
  // 캐시에 있는 좌표는 요청 없이 먼저 채운다
  const need = [];
  for (const r of cands) {
    const c = nbGeoGet(r.addr);
    if (c) { st.geoTried.add(r.key + '|' + r.addr); add(r, c); } else need.push(r);
  }
  const batch = need.slice(0, NB.GEO_BATCH);
  batch.forEach((r) => st.geoTried.add(r.key + '|' + r.addr));
  let fail = 0;
  await mapLimit(batch, 3, async (r) => {
    const c = await kakaoGeocodeFlex(r.addr).catch(() => null);
    if (c) { nbGeoSet(r.addr, c); add(r, c); } else fail++;
  });
  st.geoRemain = need.length - batch.length;
  st.geoFail = (st.geoFail || 0) + fail;
}

async function nbLoad(st) {
  st.loading = true; st.error = null; nbPaint(st);
  try {
    st.center = await nbCenter(st.report);
  } catch (e) { st.loading = false; st.error = e.message; nbPaint(st); return; }
  st.sido = nbSido(st.center.addr); st.sgg = nbSigungu(st.center.addr);
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
    st.phase = '명단에만 있는 인근 업체 위치를 확인하는 중';
    nbPaint(st);
    await nbGeocodeBatch(st).catch(() => {});
  } catch (e) {
    st.note = e && e.message ? e.message : String(e);
  } finally {
    st.loading = false; st.phase = null;
    if (!st.sel) { const first = nbVisible(st)[0]; if (first) st.sel = first.id; }
    nbPaint(st);
  }
}

// ── 화면 ──
const nbStates = new Map();       // vendor_id → 상태(탭을 오가도, 리포트를 다시 그려도 유지)
const _nbActiveTab = new Map();   // vendor_id → 'report' | 'nearby'

function nbVisible(st) {
  return st.items.filter((v) => v.km <= st.radius).sort((a, b) => a.km - b.km);
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
const nbFmtKm = (km) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));
function nbKakaoRoute(st, stops) {
  const pt = (n, lat, lng) => `${encodeURIComponent(String(n).replace(/[,/]/g, ' '))},${lat},${lng}`;
  return 'https://map.kakao.com/link/by/car/'
    + [pt(`${st.vendorName}(기점)`, st.center.lat, st.center.lng), ...stops.map((s) => pt(s.name, s.lat, s.lng))].join('/');
}
// 동선 순서 — 기점에서 가장 가까운 곳부터 차례로(탐욕 근사)
function nbRouteOrder(st) {
  const left = st.items.filter((v) => st.route.includes(v.id));
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
  const regN = vis.filter((v) => v.reg === true).length, newN = vis.length - regN;
  const s = st.items.find((v) => v.id === st.sel && v.km <= st.radius);
  let h = `<div class="nb-sum">반경 ${st.radius}km 안에 제조업 허가 <b>${regN}</b>곳 · 그 밖 <b>${newN}</b>곳</div>`;
  if (!s) return h + `<div class="nb-empty">${vis.length ? '지도나 목록에서 업체를 고르세요.' : '이 반경 안에서 찾은 업체가 없습니다. 반경을 넓혀 보세요.'}</div>`;
  const badge = s.reg === true ? '<span class="nb-badge reg">제조업 허가</span>'
    : s.reg === false ? '<span class="nb-badge new">명단에 없음</span>' : '<span class="nb-badge unk">허가 확인 불가</span>';
  const tel = s.phone ? `<a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : '—';
  const mapUrl = s.url || `https://map.kakao.com/link/map/${encodeURIComponent(s.name.replace(/[,/]/g, ' '))},${s.lat},${s.lng}`;
  h += `<div class="nb-selhead"><div class="nb-selname"><b>${esc(s.name)}</b>${badge}${s.cgmp ? '<span class="nb-badge gmp">CGMP</span>' : ''}</div>`
    + `<div class="nb-seld">${nbFmtKm(s.km)}<small>km</small></div></div>`
    + `<div class="nb-selsub">${esc(s.region || s.addr || '')} · ${esc(s.type)}</div>`
    + `<dl class="nb-selbox">`
    + `<dt>식약처 제조업</dt><dd class="${nbCls(s)}">${esc(nbStatusText(st, s))}${s.mfdsName && s.mfdsName !== s.name ? `<small>명단상 이름 ${esc(s.mfdsName)}</small>` : ''}</dd>`
    + `<dt>CGMP</dt><dd>${s.cgmp ? '적합업소' : (st.gmp ? '명단에 없음' : '확인 불가')}</dd>`
    + `<dt>전화</dt><dd>${tel}</dd>`
    + `<dt>주소</dt><dd>${esc(s.addr || '—')}</dd>`
    + `<dt>찾은 곳</dt><dd>${s.src === 'kakao' ? '카카오 지도' : '식약처 제조업 명단(지도 미등록)'}</dd>`
    + `</dl>`
    + `<div class="nb-selacts">`
    + `<a class="nb-btn" href="${esc(nbKakaoRoute(st, [s]))}" target="_blank" rel="noopener">길찾기</a>`
    + `<a class="nb-btn" href="${esc(mapUrl)}" target="_blank" rel="noopener">카카오맵</a>`
    + `<button type="button" class="nb-btn dark" data-act="report" data-id="${esc(s.id)}">사전검증 리포트</button>`
    + `</div>`;
  return h;
}

function nbListHtml(st) {
  const vis = nbVisible(st);
  const n = { all: vis.length, reg: vis.filter((v) => v.reg === true).length };
  n.new = n.all - n.reg;
  const newLabel = st.mfds && st.mfds.full ? '명단에 없음' : '허가 미확인';
  const tabs = [['all', '전체', n.all], ['reg', '제조업 허가', n.reg], ['new', newLabel, n.new]]
    .map(([id, l, c]) => `<button type="button" class="nb-tab" data-act="filter" data-f="${id}" aria-pressed="${st.filter === id}">${l} <b>${c}</b></button>`).join('');
  const rows = nbFiltered(st);
  let body = rows.map((v) => {
    const open = st.open === v.id, inRoute = st.route.includes(v.id);
    const tel = v.phone ? ` · <a href="tel:${esc(v.phone.replace(/[^\d+]/g, ''))}">${esc(v.phone)}</a>` : '';
    return `<div class="nb-row${open ? ' open' : ''}${st.sel === v.id ? ' sel' : ''}" data-row="${esc(v.id)}">`
      + `<button type="button" class="nb-rowbtn" data-act="pick" data-id="${esc(v.id)}" aria-expanded="${open}">`
      + `<span class="nb-d"><b>${nbFmtKm(v.km)}</b><i>km</i></span>`
      + `<span class="nb-main"><span class="nb-nm"><span class="nb-mark ${nbCls(v)}"></span>${esc(v.name)}</span>`
      + `<span class="nb-sub">${esc(v.region || '')}${v.region ? ' · ' : ''}${esc(v.type)}</span></span>`
      + (v.cgmp ? '<span class="nb-chip">CGMP</span>' : '<span class="nb-chip off">—</span>')
      + (inRoute ? '<span class="nb-inroute" title="동선에 담음">동선</span>' : '')
      + `</button>`
      + (open ? `<div class="nb-more"><div class="nb-facts">${esc(nbStatusText(st, v))}${v.cgmp ? ' · CGMP 적합' : ''}${tel}</div>`
        + `<div class="nb-addr">${esc(v.addr || '')}</div>`
        + `<div class="nb-acts"><button type="button" class="nb-btn${inRoute ? '' : ' blue'}" data-act="route" data-id="${esc(v.id)}">${inRoute ? '동선에서 빼기' : '동선에 추가'}</button>`
        + `<button type="button" class="nb-btn" data-act="report" data-id="${esc(v.id)}">사전검증 리포트</button></div></div>` : '')
      + `</div>`;
  }).join('');
  if (!rows.length) body = `<div class="nb-empty">${st.loading ? '찾는 중…' : '해당하는 업체가 없습니다.'}</div>`;
  if (!st.loading && st.geoRemain > 0) {
    body += `<button type="button" class="nb-more-btn" data-act="more">식약처 명단에서 ${Math.min(NB.GEO_BATCH, st.geoRemain)}곳 더 찾기 <small>남은 후보 ${st.geoRemain}곳 · 좌표 변환 요청이 나갑니다</small></button>`;
  }
  const r = nbRouteOrder(st);
  const foot = `<div class="nb-route"><div><small>오늘 동선</small><b>기점 포함 ${r.stops.length + 1}곳</b>`
    + (r.stops.length ? `<small>직선 합계 약 ${Math.round(r.km)}km · ${esc(r.stops.map((s) => s.name).join(' → '))}</small>` : '<small>목록에서 업체를 펼쳐 동선에 추가하세요</small>')
    + `</div>`
    + (r.stops.length ? `<button type="button" class="nb-btn" data-act="clear">비우기</button>`
      + `<a class="nb-btn dark" href="${esc(nbKakaoRoute(st, r.stops.slice(0, 6)))}" target="_blank" rel="noopener">카카오맵 경로 보기</a>` : '')
    + `</div>`
    + (r.stops.length > 6 ? '<div class="nb-note">카카오맵 경로는 기점 포함 7곳까지만 넘깁니다 — 앞의 6곳까지 열립니다.</div>' : '');
  return `<div class="nb-tabs" role="group" aria-label="허가 여부로 거르기">${tabs}</div><div class="nb-rows">${body}</div>${foot}`;
}

function nbStatusLine(st) {
  const bits = [];
  if (st.kdiag) {
    if (st.kdiag.errors && st.kdiag.errors.length && !st.kdiag.calls) bits.push(`카카오 장소검색 실패(${esc(st.kdiag.errors[0])})`);
    else if (st.kdiag.calls) bits.push(`카카오 지도 ${st.items.filter((v) => v.src === 'kakao').length}곳`
      + (st.kdiag.excl ? ` <span title="판매점·미용실 등 제외">(제외 ${st.kdiag.excl.category + st.kdiag.excl.retail + st.kdiag.excl.unrelated})</span>` : ''));
  }
  if (st.mfds) bits.push(`식약처 명단 ${st.mfds.list.length.toLocaleString()}곳 대조${st.mfds.full ? '' : ' (일부만 받음 — 명단에 없다고 단정하지 않습니다)'}`);
  else if (st.mfdsErr) bits.push(`식약처 명단 조회 실패 — 허가 여부 확인 불가`);
  const mOnly = st.items.filter((v) => v.src === 'mfds').length;
  if (mOnly) bits.push(`명단에만 있는 업체 ${mOnly}곳 추가`);
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
    ? `기점 ${st.vendorName} · ${nbRegion(st.center.addr) || st.center.addr || ''}` : `기점 ${st.vendorName}`;
  pane.querySelectorAll('.nb-seg button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.r) === st.radius)));
  const status = pane.querySelector('.nb-status');
  if (st.error) {
    pane.querySelector('.nb-sheet').innerHTML = `<div class="nb-empty err">${esc(st.error)}</div>`;
    pane.querySelector('.nb-listcol').innerHTML = '';
    status.textContent = '';
    nbDrawMapSafe(st);
    return;
  }
  pane.querySelector('.nb-sheet').innerHTML = st.center ? nbSheetHtml(st) : '<div class="nb-empty">방문지 좌표를 확인하는 중…</div>';
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
  const vis = nbVisible(st);
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
  if (v && st.map && !opts.fromMap) st.map.panTo([v.lat, v.lng]);
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
    if (act === 'radius') { st.radius = Number(b.dataset.r); if (st.sel && !nbVisible(st).some((v) => v.id === st.sel)) st.sel = (nbVisible(st)[0] || {}).id || null; nbPaint(st); }
    else if (act === 'filter') { st.filter = b.dataset.f; nbPaint(st); }
    else if (act === 'pick') { st.open = st.open === id ? null : id; nbSelect(st, id); }
    else if (act === 'route') { st.route = st.route.includes(id) ? st.route.filter((x) => x !== id) : st.route.concat(id); nbPaint(st); }
    else if (act === 'clear') { st.route = []; nbPaint(st); }
    else if (act === 'more') { st.loading = true; st.phase = '명단에서 더 찾는 중'; nbPaint(st); nbGeocodeBatch(st).finally(() => { st.loading = false; st.phase = null; nbPaint(st); }); }
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
      filter: 'all', sel: null, open: null, route: [], items: [], matchedKeys: new Set(), geoTried: new Set(),
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
