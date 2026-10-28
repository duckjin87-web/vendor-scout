// ═══ 공장 부지 공간정보 (브이월드 · 프록시 service=vworld) ═══
// 공장 면적 탭을 보강한다 — 건물 윤곽 겹쳐 보기 · 주소 좌표 대조 · 용도지역 · 진입 도로 · 마당 회차 ·
// 증설 여력 · 부지 공시가 · 산업단지. 리포트를 그릴 때 한 번 받아 meta.geo에 담고(저장 리포트에도 남는다),
// 끝나면 리포트를 다시 그린다. 한국콜마 기준 부지는 30일 동안 브라우저에 보관한다.

const SG_REF_KEY = 'vs_sg_ref1';
const SG_TTL = 30 * 864e5;
const _sgBusy = new Set();

const sgVw = (p) => proxyOnlyGet('vworld', p);
const sgFeats = (j) => (j && j.response && j.response.result && j.response.result.featureCollection && j.response.result.featureCollection.features) || [];
// 좌표는 소수 6자리(약 10cm)까지만 — 저장 리포트 크기를 줄인다
const sgR6 = (v) => Math.round(v * 1e6) / 1e6;
const sgRing = (g) => {
  if (!g || !g.coordinates) return null;
  const c = g.type === 'MultiPolygon' ? g.coordinates[0] && g.coordinates[0][0] : g.type === 'Polygon' ? g.coordinates[0] : null;
  return c && c.length > 2 ? c.map(([x, y]) => [sgR6(x), sgR6(y)]) : null;
};
// 상세(층·호·괄호)를 떼고 '○○로 12' 또는 '○○리 123-4'까지만
const sgClean = (a) => String(a || '').replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();

async function sgGeocode(addr) {
  const a = sgClean(addr);
  if (!a || !/\d/.test(a)) return null;
  for (const type of ['road', 'parcel']) {
    try {
      const j = await sgVw({ op: 'address', request: 'getcoord', type, address: a, refine: 'true', simple: 'false' });
      const p = j && j.response && j.response.status === 'OK' && j.response.result && j.response.result.point;
      if (p && isFinite(+p.x) && isFinite(+p.y)) return { lng: +p.x, lat: +p.y, src: '브이월드' };
    } catch { /* 다음 방식 */ }
  }
  // 분구·신설 도로 등으로 브이월드가 못 찾으면 카카오(번지까지 맞은 것만)
  try { const k = await kakaoGeocode(a, { exact: true }); if (k) return { ...k, src: '카카오' }; } catch { /* 없음 */ }
  return null;
}

// 점이 다각형 안에 있는가(경도·위도 그대로)
function sgInside(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
// 닫힌 고리(처음 = 끝)는 끝점을 한 번 빼고, 꼭짓점 평균이 아니라 테두리 상자 가운데를 쓴다(그림 가운데 맞춤용)
const sgCentroid = (ring) => {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
// 경도·위도 → 기준점에서 동·북 방향 미터
const sgM = (o) => { const kx = Math.cos(o[1] * Math.PI / 180) * 111320, ky = 110540; return ([x, y]) => [(x - o[0]) * kx, (y - o[1]) * ky]; };
const sgArea = (pts) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const sgKm = (a, b) => { const R = 6371, d = (x) => x * Math.PI / 180; const h = Math.sin(d(b.lat - a.lat) / 2) ** 2 + Math.cos(d(a.lat)) * Math.cos(d(b.lat)) * Math.sin(d(b.lng - a.lng) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// 한 지점의 필지·용도·건물 — pt {lng,lat}
async function sgSiteAt(pt) {
  const P = `POINT(${pt.lng} ${pt.lat})`;
  const pj = await sgVw({ op: 'data', data: 'LP_PA_CBND_BUBUN', geomFilter: P, size: '1', geometry: 'true', attribute: 'true', crs: 'EPSG:4326' });
  const pf = sgFeats(pj)[0];
  const parcel = pf ? { pnu: pf.properties.pnu, addr: String(pf.properties.addr || '').replace(/\s+/g, ' ').trim(), jiga: Number(pf.properties.jiga) || null,
    gosi: `${pf.properties.gosi_year || ''}${pf.properties.gosi_month ? `-${pf.properties.gosi_month}` : ''}`, ring: sgRing(pf.geometry) } : null;
  let uses = [];
  if (parcel && parcel.pnu) {
    try {
      const l = await sgVw({ op: 'landuse', pnu: parcel.pnu, numOfRows: '60' });
      const seen = new Set();
      uses = ((l && l.landUses && l.landUses.field) || []).map((x) => ({ name: x.prposAreaDstrcCodeNm || '', rel: x.cnflcAtNm || '' }))
        .filter((x) => x.name && !seen.has(x.name + x.rel) && seen.add(x.name + x.rel));
    } catch { /* 용도 없이 */ }
  }
  // 건물 — 필지 테두리 상자로 부르고 중심이 필지 안에 있는 것만(옆 필지 건물 제외)
  let bldgs = [];
  try {
    const ring = parcel && parcel.ring;
    const box = ring ? `BOX(${Math.min(...ring.map((p) => p[0]))},${Math.min(...ring.map((p) => p[1]))},${Math.max(...ring.map((p) => p[0]))},${Math.max(...ring.map((p) => p[1]))})` : P;
    const bj = await sgVw({ op: 'data', data: 'LT_C_SPBD', geomFilter: box, size: '100', geometry: 'true', attribute: 'true', crs: 'EPSG:4326' });
    bldgs = sgFeats(bj).map((f) => ({ name: (f.properties.buld_nm || '').trim(), floors: Number(f.properties.gro_flo_co) || null, ring: sgRing(f.geometry) }))
      .filter((b) => b.ring && (!ring || sgInside(sgCentroid(b.ring), ring)));
  } catch { /* 건물 없이 */ }
  return { pt: { lng: sgR6(pt.lng), lat: sgR6(pt.lat) }, parcel, uses, bldgs };
}

// ── 판정 ──
const SG_ZONES = /(제[12]종전용주거지역|제[123]종일반주거지역|준주거지역|중심상업지역|일반상업지역|근린상업지역|유통상업지역|전용공업지역|일반공업지역|준공업지역|보전녹지지역|생산녹지지역|자연녹지지역|보전관리지역|생산관리지역|계획관리지역|농림지역|자연환경보전지역)/;
// 법정 건폐율 상한(%) — 지자체 조례·산업단지 관리계획으로 더 낮을 수 있다
const SG_BCR = { 전용공업지역: 70, 일반공업지역: 70, 준공업지역: 70, 계획관리지역: 40, 생산관리지역: 20, 보전관리지역: 20, 자연녹지지역: 20, 생산녹지지역: 20,
  보전녹지지역: 20, 농림지역: 20, 자연환경보전지역: 20, 중심상업지역: 90, 일반상업지역: 80, 근린상업지역: 70, 유통상업지역: 80,
  제1종전용주거지역: 50, 제2종전용주거지역: 50, 제1종일반주거지역: 60, 제2종일반주거지역: 60, 제3종일반주거지역: 50, 준주거지역: 70 };
function sgZone(uses) {
  const names = uses.filter((u) => u.rel !== '접함').map((u) => u.name);
  const zone = names.map((n) => (n.match(SG_ZONES) || [])[1]).find(Boolean) || null;
  const park = names.find((n) => /산업단지|농공단지/.test(n)) || null;
  const limits = names.filter((n) => /개발제한구역|상수원보호구역|수변구역|특별대책지역/.test(n));
  let level = 'unk', text = '용도지역을 찾지 못했습니다 — 토지이음(eum.go.kr)에서 확인하세요';
  if (zone || park) {
    if (/공업지역|계획관리지역/.test(zone || '') || park) { level = 'ok'; text = `${zone || '산업단지'} — 공장이 들어설 수 있는 땅입니다`; }
    else if (/생산관리|보전관리|녹지지역|농림|자연환경보전/.test(zone)) { level = 'warn'; text = `${zone} — 소규모 공장만 허용되는 지역입니다. 증설 제약과 실제 시설 규모를 확인하세요`; }
    else if (/주거지역|상업지역/.test(zone)) { level = 'bad'; text = `${zone} — 공장이 들어서기 어려운 지역입니다. 사무실만 두고 제조업으로 등록했거나 위탁 생산일 수 있어 실제 생산지를 확인하세요`; }
  }
  return { zone, park, limits, level, text, bcr: zone ? SG_BCR[zone] || null : null };
}
// 접한 도시계획도로 중 가장 넓은 것 — '중로2류(폭 15m~20m)(접함)'
function sgRoad(uses) {
  const roads = uses.filter((u) => u.rel === '접함' && /[대중소]로\d류/.test(u.name)).map((u) => {
    const m = u.name.match(/폭\s*([\d.]+)\s*m?\s*~\s*([\d.]+)?/) || u.name.match(/폭\s*([\d.]+)\s*m?\s*미만/);
    const lo = m ? Number(m[1]) : null, hi = m && m[2] ? Number(m[2]) : lo;
    return { name: u.name.replace(/\(접함\)/, '').trim(), lo: /미만/.test(u.name) ? 0 : lo, hi };
  }).filter((r) => r.hi != null);
  return roads.sort((a, b) => b.hi - a.hi)[0] || null;
}
// 도로 폭으로 들어갈 수 있는 가장 큰 차 — 경험치(양방향 진입·회전 기준)
function sgRoadMax(road) {
  if (!road) return null;
  const w = road.lo || road.hi;
  return w >= 15 ? { idx: 6, text: '40ft 컨테이너까지 진입 무난' } : w >= 12 ? { idx: 5, text: '18톤 장축까지 진입 무난 · 컨테이너는 회전 확인' }
    : w >= 8 ? { idx: 4, text: '11톤까지 무난 · 18톤은 회전 반경 확인 · 컨테이너는 곤란' } : { idx: 3, strict: true, text: '도로가 좁습니다(8m 미만) — 5톤 이하 위주, 11톤 이상 곤란' };
}

// 마당 회차 — 필지 안 빈 땅(건물 제외)에 들어가는 가장 큰 원. 격자로 빈 칸을 만들고 거리 변환으로 찾는다
function sgTurnCircle(site) {
  const ring = site && site.parcel && site.parcel.ring;
  if (!ring) return null;
  const o = sgCentroid(ring), toM = sgM(o);
  const P = ring.map(toM), Bs = (site.bldgs || []).map((b) => b.ring.map(toM));
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), W = Math.max(...xs) - x0, H = Math.max(...ys) - y0;
  const cell = Math.max(0.5, Math.max(W, H) / 220);
  const nx = Math.ceil(W / cell) + 2, ny = Math.ceil(H / cell) + 2;
  const inPoly = (pt, poly) => sgInside(pt, poly);
  const d = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const pt = [x0 + (i - 0.5) * cell, y0 + (j - 0.5) * cell];
    d[j * nx + i] = inPoly(pt, P) && !Bs.some((b) => inPoly(pt, b)) ? 1e9 : 0;
  }
  // 두 번 훑는 챔퍼 거리(3-4) — 셀 단위
  const at = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : d[j * nx + i]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4);
  }
  let best = 0, bi = 0, bj = 0;
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4);
    if (d[k] > best) { best = d[k]; bi = i; bj = j; }
  }
  const r = (best / 3) * cell;
  return { r: Math.round(r * 10) / 10, c: [x0 + (bi - 0.5) * cell, y0 + (bj - 0.5) * cell], o };
}
// 차종별 회차에 필요한 원 반경(m) — 최소 회전반경에 차체 여유를 더한 경험치. TRUCKS 순서와 같다
const SG_TURN_R = [5.5, 7, 7.5, 8.5, 10.5, 12, 13.5];

// ── 불러오기 ──
async function sgRefSite(ref) {
  try { const c = JSON.parse(localStorage.getItem(SG_REF_KEY) || 'null'); if (c && Date.now() - c.at < SG_TTL && c.site) return c.site; } catch { /* 없음 */ }
  const pt = ref && ref.lat ? { lng: ref.lng, lat: ref.lat } : await sgGeocode((ref && ref.addr) || KOLMAR_ADDR);
  if (!pt) return null;
  const site = await sgSiteAt(pt);
  try { localStorage.setItem(SG_REF_KEY, JSON.stringify({ at: Date.now(), site })); } catch { /* 저장 못 해도 동작 */ }
  return site;
}
// 주소 후보들을 좌표로 바꿔 제조소와의 거리를 잰다
async function sgAddrCheck(M, basePt, baseAddr) {
  const cands = ((M.site && M.site.cands) || []).filter((c) => c.full && c.addr && c.state !== 'pick');
  // 기준 주소와 글자가 같은 후보는 부르지 않고 0m로 — 그래야 '모두 같은 곳'도 판정에 남는다
  const base0 = sgClean(baseAddr), seen = new Set();
  const list = cands.filter((c) => { const k = sgClean(c.addr); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
  const rows = await mapLimit(list, 2, async (c) => {
    if (sgClean(c.addr) === base0) return { label: c.label, addr: c.addr, m: 0, src: '같은 주소' };
    const p = await sgGeocode(c.addr).catch(() => null);
    return { label: c.label, addr: c.addr, m: p ? Math.round(sgKm(basePt, p) * 1000) : null, src: p ? p.src : null };
  });
  return rows;
}
const SG_TIER = (m) => (m == null ? { lv: 'unk', t: '좌표 없음' } : m <= 50 ? { lv: 'ok', t: '일치' } : m < 1000 ? { lv: 'info', t: '같은 단지' }
  : m < 10000 ? { lv: 'warn', t: '분리 의심' } : { lv: 'bad', t: '본사·공장 분리' });
const sgFmtM = (m) => (m == null ? '—' : m < 1000 ? `${m}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`);

// 리포트를 그릴 때 부른다 — 이미 있으면 그대로, 없으면 받아서 meta.geo에 담고 다시 그린다
function sgEnsure(report) {
  const M = report && report.meta;
  if (!M || !M.live || M.geo || !getProxy()) return;
  const key = M.vendor_id || M.vendor_name;
  if (_sgBusy.has(key)) return;
  _sgBusy.add(key);
  (async () => {
    const addr = (M.bld && M.bld.queried) || M.visit_addr || '';
    let pt = await sgGeocode(addr).catch(() => null);
    if (!pt && M.visit_coord) pt = { lng: M.visit_coord.lng, lat: M.visit_coord.lat, src: '카카오' };
    if (!pt) { M.geo = { err: '공장 주소를 좌표로 바꾸지 못했습니다', at: Date.now() }; return; }
    const [site, ref, addrs] = await Promise.all([
      sgSiteAt(pt), sgRefSite(M.ref_point).catch(() => null), sgAddrCheck(M, pt, addr).catch(() => []),
    ]);
    M.geo = { at: Date.now(), addr, src: pt.src, site, ref, addrs };
  })().catch((e) => {
    // 키 미설정·차단은 조용히 넘어간다(탭은 예전처럼 동작)
    M.geo = { err: e && e.message ? e.message.slice(0, 120) : '공간정보 조회 실패', at: Date.now() };
  }).finally(() => {
    _sgBusy.delete(key);
    sgPatchCross(report);
    try { saveLastReport(report); } catch { /* 저장 못 해도 동작 */ }
    if (typeof currentReport !== 'undefined' && currentReport === report) render(report, { noScroll: true });
  });
}

// 교차 진단의 '주소 정합성'을 좌표 거리로 다시 판정한다(글자만 다른 같은 건물의 오경보를 걷어 낸다)
function sgPatchCross(report) {
  const G = report.meta && report.meta.geo;
  if (!G || G.err || !report.cross_diag) return;
  const items = report.cross_diag.items || (report.cross_diag.items = []);
  // 용도지역 — 주거·상업지역 제조소는 위험 신호로 올린다
  const Z = G.site ? sgZone(G.site.uses || []) : null;
  if (Z && Z.level !== 'unk') {
    const zi = { label: '용도지역', status: Z.level === 'ok' ? 'match' : 'warn', severe: Z.level === 'bad', detail: `${Z.text}${Z.park ? ` · ${Z.park}` : ''}`, geo: true };
    const k = items.findIndex((x) => x.label === '용도지역');
    if (k >= 0) items[k] = zi; else items.push(zi);
    if (Z.level === 'bad' && Array.isArray(report.risk_flags) && !report.risk_flags.some((f) => f.type === '용도지역')) {
      report.risk_flags.push({ type: '용도지역', detail: Z.text });
    }
  }
  if (!G.addrs || !G.addrs.length) { report.cross_diag.warnCount = items.filter((x) => x.status === 'warn').length; return; }
  const i = items.findIndex((x) => x.label === '주소 정합성');
  const rows = G.addrs.filter((r) => r.m != null);
  if (!rows.length) return;
  const worst = rows.reduce((a, r) => (r.m > a.m ? r : a));
  const tier = SG_TIER(worst.m);
  const detail = `공장(제조소) 기준 좌표 거리 — ${rows.map((r) => `${r.label} ${sgFmtM(r.m)}(${SG_TIER(r.m).t})`).join(' · ')}`
    + (tier.lv === 'ok' ? ' — 같은 건물(주소 표기만 다름)' : tier.lv === 'info' ? ' — 같은 단지 안' : tier.lv === 'warn' ? ' — 근무지·생산지가 떨어져 있을 수 있음, 방문 때 확인' : ' — 본사와 공장이 분리됐거나 이전한 것으로 보임');
  const item = { label: '주소 정합성', status: tier.lv === 'ok' || tier.lv === 'info' ? 'match' : 'warn', severe: tier.lv === 'bad', detail, geo: true };
  if (i >= 0) items[i] = item; else items.push(item);
  // 글자 비교로 붙었던 '주소 상이' 위험 신호는 좌표로 같은 곳이면 걷는다
  if (item.status === 'match' && Array.isArray(report.risk_flags)) report.risk_flags = report.risk_flags.filter((f) => f.type !== '주소 상이');
  report.cross_diag.warnCount = items.filter((x) => x.status === 'warn').length;
}

// ── 화면 ──
// 공장 면적 탭은 카테고리 카드로 묶는다. 아래 함수들은 카드 본문(html)과, 「!」 버튼 안에 숨길 출처·설명(src)을 따로 돌려준다.
const sgChip = (lv, t) => `<span class="sg-chip ${lv}">${esc(t)}</span>`;
const sgPy = (m2) => Math.round(m2 / 3.305785).toLocaleString();

// 입지 · 부지 — 용도지역 판정 · 산업단지 · 접한 도로 · 공시가 · 증설 여력 · 주소 위치 대조
function sgPlace(report, B) {
  const M = report.meta || {}, G = M.geo;
  if (!M.live) return null;
  if (!G) return getProxy() ? { html: '<p class="at-wait">브이월드에서 용도지역·부지 경계·건물 윤곽을 불러오는 중…</p>', src: [], badge: '' } : null;
  if (G.err) return { html: `<p class="at-wait">공간정보를 불러오지 못했습니다 — ${esc(G.err)}</p>`, src: [], badge: '' };
  const S = G.site || {}, Z = sgZone(S.uses || []), road = sgRoad(S.uses || []);
  const unit = B && B.unit, plat = B && B.plat;
  const facts = [];
  facts.push(`<div class="sg-f"><span>용도지역</span><b>${esc(Z.zone || '미확인')}</b>${sgChip(Z.level, { ok: '정상 제조소', warn: '확인 필요', bad: '제조소 의심', unk: '미확인' }[Z.level])}</div>`);
  if (Z.park) facts.push(`<div class="sg-f"><span>산업단지</span><b>${esc(Z.park.replace(/\(.*\)/, ''))}</b>${sgChip('ok', '입주')}</div>`);
  facts.push(`<div class="sg-f"><span>접한 도로</span><b>${road ? esc(road.name.replace(/\(폭.*$/, '')) : '도시계획도로 없음'}</b><small>${road ? `폭 ${road.lo ? `${road.lo}~` : ''}${road.hi}m` : '현장 확인'}</small></div>`);
  if (S.parcel && S.parcel.jiga && plat && !unit) {
    const v = S.parcel.jiga * plat;
    facts.push(`<div class="sg-f"><span>부지 공시가 (참고)</span><b>약 ${v >= 1e8 ? `${Math.round(v / 1e8).toLocaleString()}억` : `${Math.round(v / 1e4).toLocaleString()}만`} 원</b><small>${S.parcel.jiga.toLocaleString()}원/㎡</small></div>`);
  }
  if (Z.bcr && plat && B.arch && !unit) {
    const cur = (B.arch / plat) * 100, room = Math.max(0, (Z.bcr / 100) * plat - B.arch);
    facts.push(`<div class="sg-f"><span>증설 여력 (건폐율)</span><b>${room > 0 ? `약 ${sgPy(room)}평` : '여유 없음'}</b><small>현재 ${cur.toFixed(0)}% / 상한 ${Z.bcr}%</small></div>`);
  }
  const lim = Z.limits.length ? `<p class="sg-warn">⚠ ${esc(Z.limits.join(', '))} 저촉 — 증설·폐수 배출에 제약이 있을 수 있습니다</p>` : '';
  const rows = G.addrs || [];
  const addr = rows.length ? `<h4 class="at-sub">주소 위치 대조 <small>공장 좌표 기준 거리</small></h4><div class="sg-dist">`
    + rows.map((r) => { const t = SG_TIER(r.m); const w = r.m == null ? 0 : Math.max(2, Math.min(100, (Math.log10(Math.max(r.m, 1)) / 5) * 100));
      return `<div class="sg-drow" title="${esc(r.addr)}"><span>${esc(r.label)}</span><span class="sg-dbar"><i class="${t.lv}" style="width:${w.toFixed(0)}%"></i></span><span class="sg-dm">${sgFmtM(r.m)}</span>${sgChip(t.lv, t.t)}</div>`; }).join('')
    + '</div>' : '';
  const uses = S.uses && S.uses.length ? `<details class="sg-uses"><summary>토지이용계획 전체 ${S.uses.length}건</summary><p>${S.uses.map((u) => `${esc(u.name)}<small>(${esc(u.rel)})</small>`).join(' · ')}</p></details>` : '';
  const src = [
    `용도지역·도로·산업단지: 브이월드 토지이용계획 (필지 ${esc((S.parcel && S.parcel.addr) || '미확인')})`,
    S.parcel && S.parcel.jiga ? `공시지가: 브이월드 연속지적도 ${esc(S.parcel.gosi || '')} 공시 × 건축물대장 대지면적 — 시세가 아닌 참고값` : '',
    Z.bcr ? `건폐율 상한 ${Z.bcr}%는 법정 기준입니다 — 지자체 조례·산업단지 관리계획으로 더 낮을 수 있습니다` : '',
    rows.length ? '주소 위치 대조: 후보 주소를 브이월드 지오코딩(못 찾으면 카카오)으로 좌표로 바꿔 거리를 쟀습니다 · 50m 이내 일치 / 1km 미만 같은 단지 / 10km 미만 분리 의심 / 그 이상 본사·공장 분리 · 막대는 로그 눈금' : '',
    `좌표 출처: ${esc(G.src || '브이월드')}`,
  ].filter(Boolean);
  return { html: `<p class="sg-lead ${Z.level}">${esc(Z.text)}</p><div class="sg-facts">${facts.join('')}</div>${lim}${addr}${uses}`, src,
    badge: sgChip(Z.level, Z.zone || '용도 미확인') };
}

// 시설 규모 · 연식 — 건축물대장(이미 받은 값)으로. 칸(면적 칸과 같은 모양)과 방문 확인 질문을 따로 준다
function sgScaleInfo(B) {
  if (!B || !B.arch || B.unit) return null;
  const bl = B.bldgs || [];
  const aprs = bl.map((b) => String(b.apr || '')).filter((a) => /^\d{8}$/.test(a)).sort();
  const y0 = aprs.length ? Number(aprs[0].slice(0, 4)) : null, y1 = aprs.length ? Number(aprs[aprs.length - 1].slice(0, 4)) : null;
  const age = y0 ? new Date().getFullYear() - y0 : null;
  const tot = B.factoryTot || B.tot || 0;
  const tier = tot >= 20000 ? '대형' : tot >= 5000 ? '중형' : tot >= 1000 ? '중소형' : tot ? '소형' : '—';
  const floors = Math.max(0, ...bl.map((b) => b.floors || 0)) || null;
  const strct = [...new Set(bl.map((b) => b.strct).filter(Boolean))].slice(0, 2).join('·');
  return { y0, y1, age, tot, tier, floors, strct };
}
function sgScaleStats(B) {
  const I = sgScaleInfo(B);
  if (!I) return [];
  return [
    ['시설 연식', I.age != null ? `${I.age}년` : '—', I.y0 ? `${I.y0} 사용승인${I.y1 && I.y1 !== I.y0 ? ` · 최근 ${I.y1}` : ''}` : '사용승인일 없음'],
    ['층 구성', I.floors ? `지상 ${I.floors}층` : '—', I.strct || '구조 미상'],
    ['규모 구간', I.tier, `${B.factoryTot ? '공장 ' : ''}연면적 기준`],
  ];
}
function sgScaleAsks(B) {
  const I = sgScaleInfo(B);
  if (!I) return '';
  const asks = [];
  if (I.age != null && I.age >= 15) asks.push(`${I.y0}년 준공 ${I.age}년차 — 공조·정제수·배관 설비 교체 이력`);
  if (I.y1 && I.y0 && I.y1 - I.y0 >= 3) asks.push(`${I.y1}년 증축(최초 ${I.y0}년) — 당시 늘린 물량·고객사`);
  if (I.floors && I.floors >= 3) asks.push(`지상 ${I.floors}층 — 층별 공정 배치와 화물 엘리베이터 용량`);
  if (I.tot) asks.push(`대장 연면적 ${Math.round(I.tot).toLocaleString()}㎡ — 실제 생산 라인 수와 일 생산량`);
  return asks.length ? `<div class="sg-askbox"><b>방문 때 확인</b><ul class="sg-asks">${asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : '';
}

// 화물차 예상에 붙일 보강 — 진입 도로 · 마당 회차 원
function sgTruckExtra(report) {
  const G = report.meta && report.meta.geo;
  if (!G || !G.site) return null;
  const road = sgRoad(G.site.uses || []), rm = sgRoadMax(road);
  const turn = G.site.parcel && G.site.parcel.ring ? sgTurnCircle(G.site) : null;
  return { road, rm, turn };
}

// ── 3D 규모 비교 ── 브이월드 건물 윤곽을 지상 층수만큼 세워 한국콜마 세종 건물과 같은 축척으로 나란히(또는 겹쳐) 본다.
// 라이브러리 없이 캔버스에 직교 투영으로 그린다. 끌면 돌아가고, 위아래로 끌면 내려다보는 각도가 바뀐다.
const SG_FLOOR_M = 4.5;          // 공장 한 층 높이 가정
function sg3dData(report, B) {
  const G = report.meta && report.meta.geo;
  if (!G || !G.site || !G.ref || !(G.ref.bldgs || []).length) return null;
  const R = G.ref, S = G.site, unit = B && B.unit;
  const open = (ring) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring);
  const ro = sgCentroid(R.parcel && R.parcel.ring ? R.parcel.ring : R.bldgs.flatMap((b) => b.ring)), rM = sgM(ro);
  const ref = { parcel: R.parcel && R.parcel.ring ? open(R.parcel.ring).map(rM) : null,
    bldgs: R.bldgs.map((b) => ({ pts: open(b.ring).map(rM), floors: b.floors || 1 })) };
  let mine;
  if (unit) {
    const a = unit.area && unit.area.excl;
    if (!a) return null;
    const s = Math.sqrt(a) / 2;
    mine = { parcel: null, unit: true, bldgs: [{ pts: [[-s, -s], [s, -s], [s, s], [-s, s]], floors: 1 }] };
  } else {
    if (!(S.bldgs || []).length) return null;
    const so = sgCentroid(S.parcel && S.parcel.ring ? S.parcel.ring : S.bldgs.flatMap((b) => b.ring)), sM = sgM(so);
    // 브이월드 층수가 비면(전부 1층 이하) 건축물대장의 평균 층수(연면적 ÷ 건축면적)로 채운다
    const avgF = B && B.arch && B.tot ? Math.max(1, Math.min(15, Math.round(B.tot / B.arch))) : 1;
    const noF = S.bldgs.every((b) => !b.floors || b.floors <= 1) && avgF > 1;
    mine = { parcel: S.parcel && S.parcel.ring ? open(S.parcel.ring).map(sM) : null, estF: noF ? avgF : null,
      bldgs: S.bldgs.map((b) => ({ pts: open(b.ring).map(sM), floors: noF ? avgF : (b.floors || 1) })) };
  }
  const sum = (g) => g.bldgs.reduce((a, b) => a + sgArea(b.pts), 0);
  const gfa = (g) => g.bldgs.reduce((a, b) => a + sgArea(b.pts) * (b.floors || 1), 0);
  const top = (g) => Math.max(...g.bldgs.map((b) => b.floors || 1));
  return { ref, mine, stat: { refFoot: sum(ref), myFoot: sum(mine), refGfa: gfa(ref), myGfa: gfa(mine), refTop: top(ref), myTop: top(mine) } };
}
function sg3dHtml(report, B) {
  const D = sg3dData(report, B);
  if (!D) return null;
  const nm = stripCorp(report.meta.vendor_name || '') || '조회 업체', st = D.stat, unit = B && B.unit;
  const pct = (a, b) => (b ? `${Math.max(1, Math.round((a / b) * 100))}%` : '—');
  const bar = (lab, a, b, unitTxt) => {
    const mx = Math.max(a, b) || 1;
    return `<div class="s3-row"><span class="s3-l">${lab}</span><div class="s3-bars"><div class="s3-b m"><i style="width:${Math.max(1.5, (a / mx) * 100).toFixed(1)}%"></i><em>${unitTxt(a)}</em></div>`
      + `<div class="s3-b k"><i style="width:${Math.max(1.5, (b / mx) * 100).toFixed(1)}%"></i><em>${unitTxt(b)}</em></div></div></div>`;
  };
  const html = `<div class="s3"><div class="s3-stage"><canvas class="s3-cv" role="img" aria-label="${esc(nm)} 건물과 한국콜마 세종 건물을 같은 축척 3D로 나란히 세운 그림"></canvas>`
    + `<div class="s3-ctl"><button type="button" class="nb-btn sm" data-s3="side" aria-pressed="true">위아래로</button><button type="button" class="nb-btn sm" data-s3="over" aria-pressed="false">겹쳐 보기</button><button type="button" class="nb-btn sm" data-s3="reset">처음 시점</button></div>`
    + `<span class="s3-hint">끌어서 돌리기 · 위아래로 끌면 각도</span></div>`
    + `<div class="s3-side"><p class="s3-head"><b>${esc(nm)}</b>의 바닥 면적은 한국콜마 세종의 <em>${pct(st.myFoot, st.refFoot)}</em>${unit ? ' (호실 전용)' : ''}</p>`
    + `<div class="s3-legend"><span><i class="s3-sw m"></i>${esc(nm)}${unit ? ' 호실' : ` ${D.mine.bldgs.length}동`}</span><span><i class="s3-sw k"></i>한국콜마 세종 ${D.ref.bldgs.length}동</span></div>`
    + bar('바닥 면적', st.myFoot, st.refFoot, (v) => `${sgPy(v)}평`)
    + bar('추정 연면적', st.myGfa, st.refGfa, (v) => `${sgPy(v)}평`)
    + bar('최고 층수', st.myTop, st.refTop, (v) => `${v}층`)
    + '</div></div>';
  const src = ['건물 모양·지상 층수: 브이월드 건물 윤곽(도로명주소 건물) — 지도 윤곽이라 대장 건축면적과 조금 다를 수 있습니다',
    '한국콜마 기준: 세종 산단길 22-17 필지 안 건물만(세종 공장 전체가 아님)', `높이는 층수 × ${SG_FLOOR_M}m로 가정했습니다 · 추정 연면적 = 바닥 면적 × 층수`,
    unit ? '오피스형 건물 입주사라 건물 전체 대신 호실 전용면적만큼의 한 층짜리 상자로 그렸습니다' : '',
    D.mine.estF ? `브이월드에 층수가 없어 건축물대장 평균 층수(연면적 ÷ 건축면적 ≈ ${D.mine.estF}층)로 세웠습니다` : ''].filter(Boolean);
  return { html, src, D, badge: sgChip('info', `콜마 대비 ${pct(st.myFoot, st.refFoot)}`) };
}
// 캔버스 그리기 — st: { yaw, pitch, mode }
function sg3dDraw(cv, D, st) {
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const css = getComputedStyle(cv), col = (v, d) => (css.getPropertyValue(v).trim() || d);
  const rgb = (h) => { const m = String(h).match(/^#([0-9a-f]{6})$/i); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [128, 128, 128]; };
  const kRGB = rgb(col('--muted', '#6b7280')), mRGB = rgb(col('--accent', '#2f6df6')), line = col('--faint', '#9aa1ab'), txt = col('--text', '#1a1d21');
  // 배치 — 나란히: 업체를 콜마 오른쪽에 / 겹쳐: 콜마 가운데에
  const bb = (g) => { const xs = g.bldgs.flatMap((b) => b.pts.map((p) => p[0])).concat((g.parcel || []).map((p) => p[0])); const ys = g.bldgs.flatMap((b) => b.pts.map((p) => p[1])).concat((g.parcel || []).map((p) => p[1])); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const rb = bb(D.ref), mb = bb(D.mine);
  // 위아래: 콜마를 위(북쪽), 업체를 아래(남쪽)에 가운데 맞춰 둔다 — 돌리지 않아도 바로 견줘진다
  const off = st.mode === 'over' ? [0, 0] : [(rb[0] + rb[1]) / 2 - (mb[0] + mb[1]) / 2, rb[2] - mb[3] - Math.max(14, (rb[3] - rb[2]) * 0.12)];
  const groups = [{ g: D.ref, o: [0, 0], rgbc: kRGB, a: 1, key: 'k' }, { g: D.mine, o: off, rgbc: mRGB, a: st.mode === 'over' ? 0.55 : 0.92, key: 'm' }];
  // 가운데 맞춤 — 두 무리 전체의 가운데를 원점으로
  const allX = [rb[0], rb[1], mb[0] + off[0], mb[1] + off[0]], allY = [rb[2], rb[3], mb[2] + off[1], mb[3] + off[1]];
  const cx0 = (Math.min(...allX) + Math.max(...allX)) / 2, cy0 = (Math.min(...allY) + Math.max(...allY)) / 2;
  const Rxy = Math.max(...allX.map((x) => Math.abs(x - cx0)), ...allY.map((y) => Math.abs(y - cy0))) * 1.08 || 50;
  const maxZ = Math.max(...[D.ref, D.mine].flatMap((g) => g.bldgs.map((b) => (b.floors || 1) * SG_FLOOR_M)));
  const ct = Math.cos(st.yaw), sn = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
  const scale = Math.min(W / (2 * Rxy), H / (2 * Rxy * sp + maxZ * cp)) * 0.96;
  const P = ([x, y, z]) => { const X = x - cx0, Y = y - cy0; const xr = X * ct - Y * sn, yr = X * sn + Y * ct;
    return { x: W / 2 + xr * scale, y: H / 2 - (yr * sp + z * cp - maxZ * cp / 2) * scale, d: yr * cp - z * sp }; };
  const poly = (pts, fill, stroke, dash) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.setLineDash(dash || []); c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); c.setLineDash([]); } };
  const shade = (rgbc, k, a) => `rgba(${rgbc.map((v) => Math.round(Math.min(255, v * k))).join(',')},${a})`;
  // 땅 — 부지 경계
  groups.forEach(({ g, o, rgbc }) => { if (g.parcel) poly(g.parcel.map(([x, y]) => P([x + o[0], y + o[1], 0])), shade(rgbc, 1.6, 0.08), line, [4, 3]); });
  // 건물 — 먼 것부터
  const L = [Math.cos(-0.8), Math.sin(-0.8)];
  const bl = groups.flatMap(({ g, o, rgbc, a, key }) => g.bldgs.map((b) => {
    const pts = b.pts.map(([x, y]) => [x + o[0], y + o[1]]), h = (b.floors || 1) * SG_FLOOR_M;
    const cen = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
    return { pts, h, rgbc, a, key, d: P([cen[0], cen[1], 0]).d, dash: key === 'm' && D.mine.unit };
  })).sort((p, q) => q.d - p.d);
  bl.forEach((b) => {
    const walls = b.pts.map((p, i) => { const q = b.pts[(i + 1) % b.pts.length];
      const quad = [P([p[0], p[1], 0]), P([q[0], q[1], 0]), P([q[0], q[1], b.h]), P([p[0], p[1], b.h])];
      const nx = q[1] - p[1], ny = -(q[0] - p[0]), nl = Math.hypot(nx, ny) || 1;
      return { quad, d: quad.reduce((s, v) => s + v.d, 0) / 4, k: 0.62 + 0.3 * Math.abs((nx * L[0] + ny * L[1]) / nl) };
    }).sort((p, q) => q.d - p.d);
    walls.forEach((w) => poly(w.quad, shade(b.rgbc, w.k, b.a), shade(b.rgbc, 0.5, Math.min(1, b.a + 0.1)), b.dash ? [4, 3] : null));
    poly(b.pts.map(([x, y]) => P([x, y, b.h])), shade(b.rgbc, 1.18, b.a), shade(b.rgbc, 0.5, Math.min(1, b.a + 0.1)), b.dash ? [4, 3] : null);
  });
  // 이름표 — 무리마다 가장 높은 건물 위
  c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center'; c.fillStyle = txt;
  [['k', '한국콜마 세종'], ['m', st.label || '조회 업체']].forEach(([key, t]) => {
    const g = bl.filter((b) => b.key === key); if (!g.length) return;
    const hi = g.reduce((a, b) => (b.h > a.h ? b : a));
    const cen = hi.pts.reduce((s, p) => [s[0] + p[0] / hi.pts.length, s[1] + p[1] / hi.pts.length], [0, 0]);
    const pt = P([cen[0], cen[1], hi.h]);
    // 겹쳐 보기에서는 두 이름표가 부딪치지 않게 업체 이름을 한 줄 위로
    c.fillText(t, pt.x, Math.max(14, pt.y - 8 - (st.mode === 'over' && key === 'm' ? 16 : 0)));
  });
  // 축척 막대
  const bar = [10, 20, 50, 100, 200].find((v) => v * scale >= 50) || 200;
  c.fillStyle = txt; c.fillRect(12, H - 14, bar * scale, 3); c.font = '11px system-ui, sans-serif'; c.textAlign = 'left'; c.fillText(`${bar}m`, 12, H - 19);
}
function sgBind3d(root, D, label) {
  const cv = root.querySelector('.s3-cv'); if (!cv || !D) return;
  const st = { yaw: -0.18, pitch: 0.95, mode: 'side', label };
  const draw = () => sg3dDraw(cv, D, st);
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; st.yaw = drag.yaw + (e.clientX - drag.x) * 0.01; st.pitch = Math.max(0.2, Math.min(1.5, drag.pitch - (e.clientY - drag.y) * 0.008)); draw(); });
  const end = () => { drag = null; cv.classList.remove('drag'); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  root.querySelectorAll('[data-s3]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.s3;
    if (k === 'reset') { st.yaw = -0.18; st.pitch = 0.95; } else { st.mode = k; root.querySelectorAll('[data-s3="side"],[data-s3="over"]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.s3 === k))); }
    draw();
  }));
  if (window.ResizeObserver) new ResizeObserver(draw).observe(cv);
  // 숨은 탭에서 그리면 크기가 0이다 — 보이게 되면 다시 그린다
  if (window.IntersectionObserver) new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) draw(); }).observe(cv);
  draw();
}
