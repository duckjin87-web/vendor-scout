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
// 공장 면적 탭에 들어가는 섹션들. B: 건축물대장 합계(meta.bld), T: truckAccess 결과
function sgSectionsHtml(report, B) {
  const M = report.meta || {}, G = M.geo;
  if (!M.live) return '';
  if (!G) return getProxy() ? '<div class="at-sec sg-wait"><h4>부지 공간정보</h4><p class="tk-note">브이월드에서 부지 경계·용도지역·건물 윤곽을 불러오는 중…</p></div>' : '';
  if (G.err) return `<div class="at-sec sg-wait"><h4>부지 공간정보</h4><p class="tk-note">불러오지 못했습니다 — ${esc(G.err)}</p></div>`;
  const S = G.site || {}, Z = sgZone(S.uses || []), road = sgRoad(S.uses || []);
  const unit = B && B.unit;
  const py = (m2) => Math.round(m2 / 3.305785).toLocaleString();
  const chip = (lv, t) => `<span class="sg-chip ${lv}">${esc(t)}</span>`;
  // ① 부지 · 용도지역 요약
  const plat = B && B.plat;
  const facts = [];
  facts.push(`<div class="sg-f"><span>용도지역</span><b>${esc(Z.zone || '미확인')}</b>${chip(Z.level === 'unk' ? 'unk' : Z.level, { ok: '정상 제조소', warn: '확인 필요', bad: '제조소 의심', unk: '미확인' }[Z.level])}</div>`);
  if (Z.park) facts.push(`<div class="sg-f"><span>산업단지</span><b>${esc(Z.park.replace(/\(.*\)/, ''))}</b>${chip('ok', '입주')}</div>`);
  facts.push(`<div class="sg-f"><span>접한 도로</span><b>${road ? esc(road.name.replace(/\(폭.*$/, '')) : '도시계획도로 없음'}</b><small>${road ? `폭 ${road.lo ? `${road.lo}~` : ''}${road.hi}m` : '현장 확인'}</small></div>`);
  if (S.parcel && S.parcel.jiga && plat && !unit) {
    const v = S.parcel.jiga * plat;
    facts.push(`<div class="sg-f"><span>부지 공시가 (참고)</span><b>약 ${v >= 1e8 ? `${Math.round(v / 1e8).toLocaleString()}억` : `${Math.round(v / 1e4).toLocaleString()}만`} 원</b><small>${S.parcel.jiga.toLocaleString()}원/㎡ · ${esc(S.parcel.gosi || '')} 공시</small></div>`);
  }
  if (Z.bcr && plat && B.arch && !unit) {
    const cur = (B.arch / plat) * 100, room = Math.max(0, (Z.bcr / 100) * plat - B.arch);
    facts.push(`<div class="sg-f"><span>증설 여력 (건폐율)</span><b>${room > 0 ? `약 ${py(room)}평` : '여유 없음'}</b><small>현재 ${cur.toFixed(0)}% / 상한 ${Z.bcr}%</small></div>`);
  }
  const lim = Z.limits.length ? `<p class="sg-warn">⚠ ${esc(Z.limits.join(', '))} 저촉 — 증설·폐수 배출에 제약이 있을 수 있습니다</p>` : '';
  const zoneSec = `<div class="at-sec sg-zone"><h4>부지 · 용도지역 <small>브이월드 토지이용계획 · ${esc((S.parcel && S.parcel.addr) || '')}</small></h4>`
    + `<p class="sg-lead ${Z.level}">${esc(Z.text)}</p><div class="sg-facts">${facts.join('')}</div>${lim}`
    + (S.uses && S.uses.length ? `<details class="sg-uses"><summary>토지이용계획 전체 ${S.uses.length}건</summary><p>${S.uses.map((u) => `${esc(u.name)}<small>(${esc(u.rel)})</small>`).join(' · ')}</p></details>` : '')
    + '<p class="tk-note">건폐율 상한은 법정 기준입니다 — 지자체 조례·산업단지 관리계획으로 더 낮을 수 있습니다.</p></div>';

  // ② 주소 위치 대조
  const rows = G.addrs || [];
  const addrSec = rows.length ? `<div class="at-sec sg-addr"><h4>주소 위치 대조 <small>공장(제조소) 좌표 기준 거리 · 50m 이내 일치 / 1km 이상 분리 의심</small></h4><div class="sg-dist">`
    + `<div class="sg-drow base"><b>공장 (조회 기준)</b><span class="sg-dbar"><i style="width:2%"></i></span><span class="sg-dm">기준</span>${chip('ok', '기준')}</div>`
    + rows.map((r) => { const t = SG_TIER(r.m); const w = r.m == null ? 0 : Math.max(2, Math.min(100, (Math.log10(Math.max(r.m, 1)) / 5) * 100));
      return `<div class="sg-drow" title="${esc(r.addr)}"><span>${esc(r.label)}</span><span class="sg-dbar"><i class="${t.lv}" style="width:${w.toFixed(0)}%"></i></span><span class="sg-dm">${sgFmtM(r.m)}</span>${chip(t.lv, t.t)}</div>`; }).join('')
    + '</div><p class="tk-note">막대는 거리의 로그 눈금입니다. 좌표는 브이월드(못 찾으면 카카오)로 바꿨습니다.</p></div>' : '';

  return zoneSec + addrSec;
}

// 화물차 예상에 붙일 보강 — 진입 도로 · 마당 회차 원
function sgTruckExtra(report) {
  const G = report.meta && report.meta.geo;
  if (!G || !G.site) return null;
  const road = sgRoad(G.site.uses || []), rm = sgRoadMax(road);
  const turn = G.site.parcel && G.site.parcel.ring ? sgTurnCircle(G.site) : null;
  return { road, rm, turn };
}

// 건물 윤곽 겹쳐 보기 — 한국콜마 부지·건물(회색) 위에 조회 업체 건물(파랑)을 같은 축척으로
function sgOverlayHtml(report, B) {
  const G = report.meta && report.meta.geo;
  if (!G || !G.site || !G.ref || !G.ref.parcel || !G.ref.parcel.ring) return '';
  const R = G.ref, S = G.site, unit = B && B.unit;
  const ro = sgCentroid(R.parcel.ring), rM = sgM(ro);
  const refP = R.parcel.ring.map(rM), refB = (R.bldgs || []).map((b) => ({ ...b, pts: b.ring.map(rM) }));
  let mine = [];
  if (unit) {
    const a = unit.area && unit.area.excl;
    if (a) { const s = Math.sqrt(a) / 2; mine = [{ pts: [[-s, -s], [s, -s], [s, s], [-s, s]], dash: true, name: `호실 전용 ${Math.round(a)}㎡` }]; }
  } else if (S.bldgs && S.bldgs.length) {
    const all = S.bldgs.flatMap((b) => b.ring), so = sgCentroid(all), sM = sgM(so);
    mine = S.bldgs.map((b) => ({ pts: b.ring.map(sM), name: b.name, floors: b.floors }));
  }
  if (!mine.length) return '';
  const xs = refP.map((p) => p[0]), ys = refP.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 60) * 1.15;
  const vb = `${(-span / 2).toFixed(1)} ${(-span / 2).toFixed(1)} ${span.toFixed(1)} ${span.toFixed(1)}`;
  const pts = (arr) => arr.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join(' ');      // 북쪽이 위
  const refArea = refB.reduce((a, b) => a + sgArea(b.pts), 0), myArea = mine.reduce((a, b) => a + sgArea(b.pts), 0);
  const big = refB.slice().sort((a, b) => sgArea(b.pts) - sgArea(a.pts))[0];
  const bar = [10, 20, 50, 100, 200].find((v) => v >= span / 6) || 200;
  const sw = span / 400;
  return `<div class="at-sec sg-ov"><h4>건물 모양 겹쳐 보기 <small>브이월드 건물 윤곽 · 같은 축척(미터) · 북쪽이 위</small></h4>`
    + `<div class="sg-ovgrid"><div class="sg-ovbox"><svg class="sg-svg" viewBox="${vb}" data-span="${span.toFixed(1)}" role="img" aria-label="한국콜마 세종 부지와 건물 위에 ${esc(report.meta.vendor_name || '')} 건물 윤곽을 같은 축척으로 겹친 그림">`
    + `<polygon class="sg-refp" points="${pts(refP)}" style="stroke-width:${(sw * 1.5).toFixed(2)}"/>`
    + refB.map((b) => `<polygon class="sg-refb" points="${pts(b.pts)}" style="stroke-width:${sw.toFixed(2)}"/>`).join('')
    + `<g class="sg-mine" data-x="0" data-y="0" data-r="0">${mine.map((b) => `<polygon class="sg-myb${b.dash ? ' dash' : ''}" points="${pts(b.pts)}" style="stroke-width:${(sw * 2).toFixed(2)}"/>`).join('')}</g>`
    + `<g class="sg-scale" transform="translate(${(-span / 2 + span * 0.04).toFixed(1)},${(span / 2 - span * 0.05).toFixed(1)})"><rect width="${bar}" height="${(sw * 4).toFixed(2)}"/><text y="${(-sw * 5).toFixed(2)}" style="font-size:${(sw * 13).toFixed(2)}px">${bar}m</text></g>`
    + `</svg></div><div class="sg-ovside">`
    + `<div class="sg-legend"><span><i class="sg-sw mine"></i>${esc(stripCorp(report.meta.vendor_name || '') || '조회 업체')} ${unit ? '호실' : `건물 ${mine.length}동`}</span><span><i class="sg-sw ref"></i>한국콜마 세종 건물 ${refB.length}동</span><span><i class="sg-sw refp"></i>한국콜마 부지 경계</span></div>`
    + `<div class="sg-ovstat"><div><span>조회 업체 바닥 면적</span><b>약 ${Math.round(myArea / 3.305785).toLocaleString()}평</b></div><div><span>한국콜마 대비</span><b>${refArea ? `${Math.max(1, Math.round((myArea / refArea) * 100))}%` : '—'}</b></div></div>`
    + `<label class="tk-note" for="sgRot">돌리기 <span class="sg-rotv">0°</span></label><input id="sgRot" class="sg-rot" type="range" min="-180" max="180" value="0">`
    + `<div class="sg-btns"><button type="button" class="nb-btn sm" data-sg="snap">콜마 가장 큰 동에 맞추기</button><button type="button" class="nb-btn sm" data-sg="reset">처음 위치</button></div>`
    + `<p class="tk-note">파란 도형은 끌어서 옮길 수 있습니다.${unit ? ' 오피스형 건물 입주사라 건물 전체 대신 호실 전용면적만큼의 점선 정사각형으로 그렸습니다.' : ''} 바닥 면적은 지도 윤곽 기준이라 대장 건축면적과 조금 다를 수 있습니다.</p>`
    + `</div></div><span class="sg-snap" hidden data-x="${big ? sgCentroid(big.pts)[0].toFixed(1) : 0}" data-y="${big ? (-sgCentroid(big.pts)[1]).toFixed(1) : 0}"></span></div>`;
}
// 겹쳐 보기 끌기·돌리기 — 공장 면적 탭이 그려진 뒤 붙인다
function sgBindOverlay(root) {
  const svg = root.querySelector('.sg-svg'); if (!svg) return;
  const g = svg.querySelector('.sg-mine'), rot = root.querySelector('.sg-rot'), rv = root.querySelector('.sg-rotv');
  const st = { x: 0, y: 0, r: 0 };
  const apply = () => { g.setAttribute('transform', `translate(${st.x} ${st.y}) rotate(${st.r})`); if (rv) rv.textContent = `${st.r}°`; };
  const toSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  let drag = null;
  g.addEventListener('pointerdown', (e) => { const p = toSvg(e); drag = { dx: p.x - st.x, dy: p.y - st.y }; g.setPointerCapture(e.pointerId); g.classList.add('drag'); });
  g.addEventListener('pointermove', (e) => { if (!drag) return; const p = toSvg(e); st.x = p.x - drag.dx; st.y = p.y - drag.dy; apply(); });
  const end = () => { drag = null; g.classList.remove('drag'); };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  if (rot) rot.addEventListener('input', () => { st.r = Number(rot.value); apply(); });
  root.querySelectorAll('[data-sg]').forEach((b) => b.addEventListener('click', () => {
    const s = root.querySelector('.sg-snap');
    if (b.dataset.sg === 'snap' && s) { st.x = Number(s.dataset.x); st.y = Number(s.dataset.y); }
    else { st.x = 0; st.y = 0; st.r = 0; if (rot) rot.value = 0; }
    apply();
  }));
}

// 건물 연식·규모 한 줄 — 건축물대장(이미 받은 값)으로
function sgScaleHtml(B) {
  if (!B || !B.arch || B.unit) return '';
  const bl = B.bldgs || [];
  const aprs = bl.map((b) => String(b.apr || '')).filter((a) => /^\d{8}$/.test(a)).sort();
  const y0 = aprs.length ? Number(aprs[0].slice(0, 4)) : null, y1 = aprs.length ? Number(aprs[aprs.length - 1].slice(0, 4)) : null;
  const age = y0 ? new Date().getFullYear() - y0 : null;
  const tot = B.factoryTot || B.tot || 0;
  const tier = tot >= 20000 ? '대형' : tot >= 5000 ? '중형' : tot >= 1000 ? '중소형' : tot ? '소형' : '—';
  const floors = Math.max(0, ...bl.map((b) => b.floors || 0)) || null;
  const strct = [...new Set(bl.map((b) => b.strct).filter(Boolean))].slice(0, 2).join('·');
  const asks = [];
  if (age != null && age >= 15) asks.push(`${y0}년 준공 ${age}년차 — 공조·정제수·배관 설비 교체 이력`);
  if (y1 && y0 && y1 - y0 >= 3) asks.push(`${y1}년 증축(최초 ${y0}년) — 당시 늘린 물량·고객사`);
  if (floors && floors >= 3) asks.push(`지상 ${floors}층 — 층별 공정 배치와 화물 엘리베이터 용량`);
  if (tot) asks.push(`대장 연면적 ${Math.round(tot).toLocaleString()}㎡ — 실제 생산 라인 수와 일 생산량`);
  const py = (m2) => Math.round(m2 / 3.305785).toLocaleString();
  return `<div class="at-sec sg-scale-sec"><h4>시설 규모 · 연식 <small>국토부 건축물대장 · 방문 크로스체크</small></h4><div class="sg-facts">`
    + `<div class="sg-f"><span>${B.factoryTot ? '공장 연면적' : '연면적'}</span><b>약 ${py(tot)}평</b><small>${Math.round(tot).toLocaleString()}㎡ · ${B.factoryCount || B.bldgCount || 0}개 동</small></div>`
    + `<div class="sg-f"><span>시설 연식</span><b>${age != null ? `${age}년` : '—'}</b><small>${y0 ? `${y0} 사용승인${y1 && y1 !== y0 ? ` · 최근 ${y1}` : ''}` : '사용승인일 없음'}</small></div>`
    + `<div class="sg-f"><span>층 구성</span><b>${floors ? `지상 ${floors}층` : '—'}</b><small>${esc(strct || '구조 미상')}</small></div>`
    + `<div class="sg-f"><span>규모 구간</span><b>${tier}</b><small>연면적 기준</small></div></div>`
    + (asks.length ? `<ul class="sg-asks">${asks.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '') + '</div>';
}
