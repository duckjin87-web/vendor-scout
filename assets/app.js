// app.js — vendor-scout 데모 프론트엔드
// src/report/schema.js의 스냅샷 리포트(JSON)를 화면에 렌더링. API 호출은 데모 모드에서 목데이터로 대체.

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const GRADE_LABEL = { A: '공식 API', B: '공공DB 간접', C: '추정/프록시', D: '데이터 공백' };

let currentReport = null;

// ── 식약처 실데이터(빌드타임): Actions가 GitHub Secret으로 구운 정적 JSON ──
let STATIC_INDEX = null;
async function loadStaticIndex() {
  try {
    const r = await fetch('data/mfds/index.json', { cache: 'no-store' });
    if (r.ok) STATIC_INDEX = await r.json();
  } catch { /* 아직 데이터 없음 → 데모 모드 */ }
}
function staticHit(key) {
  if (!STATIC_INDEX) return null;
  return STATIC_INDEX.find((e) => e.name === key || e.id === key)
    || STATIC_INDEX.find((e) => e.name.includes(key) || key.includes(e.name)) || null;
}

// ── 실데이터 연결 (프록시 경유) ──
// data.go.kr·네이버는 브라우저 직접 호출이 CORS로 막힌다. 프록시(Vercel /api/proxy 또는 Worker)
// 주소만 저장해 두고, 모든 조회를 프록시로 중계한다. API 키는 프록시 서버(환경변수)에만 있고 여기엔 없다.
const PROXY_KEY = 'vs_proxy';
const _ls = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const _sls = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
const getProxy = () => _ls(PROXY_KEY);
const isConnected = () => !!getProxy();
function setProxy(v) { _sls(PROXY_KEY, (v || '').trim()); }

// ── 데이터 소스 제외 설정 ──
// 조회 실패했거나 불필요한 소스를 사용자가 리포트에서 빼도록. 제외 목록은 브라우저에 저장.
const EXCLUDED_KEY = 'vs_excluded';
const getExcluded = () => { try { return new Set(JSON.parse(_ls(EXCLUDED_KEY) || '[]')); } catch { return new Set(); } };
function toggleExcluded(key) { const s = getExcluded(); s.has(key) ? s.delete(key) : s.add(key); _sls(EXCLUDED_KEY, JSON.stringify([...s])); }

// 필드/블록의 출처 문자열 → 소스 키 (제외 필터링용). 매핑 안 되는 항목(이동거리·PLT 등)은 항상 표시.
function srcKeyOf(sourceStr) {
  const s = String(sourceStr || '');
  if (/재무/.test(s)) return 'finance';
  if (/기능성|보고품목/.test(s)) return 'rpt';
  if (/국민연금/.test(s)) return 'nps';
  if (/제조업|화장품제조/.test(s)) return 'maker';
  if (/GMP/.test(s)) return 'gmp';
  if (/뉴스/.test(s)) return 'news';
  if (/공장|산업단지|산단/.test(s)) return 'factory';
  if (/국세청|사업자상태/.test(s)) return 'nts';
  return null; // 기업기본정보 등 핵심/비-API 항목은 제외 불가
}

// 프록시 주소 + 쿼리 → 최종 요청 URL. 루트 워커(경로 없음)엔 /를 붙이고, /api/proxy 같은 경로엔 그대로.
function buildProxyUrl(params) {
  const base = getProxy().replace(/\/+$/, '');
  const qs = new URLSearchParams(params).toString();
  // 경로가 있으면(/api/proxy) 그대로, 없으면(https://x.workers.dev) 루트 슬래시 추가
  const hasPath = /^https?:\/\//i.test(base) ? new URL(base).pathname.length > 1 : base.length > 0;
  return `${base}${hasPath ? '' : '/'}?${qs}`;
}

// 서비스별 파라미터 매핑(논리키 → 실제 data.go 파라미터명). 실제 엔드포인트 URL은
// 프록시(api/proxy.js·worker.js)에 단일 정의 — 화이트리스트로 오픈프록시 방지.
const PARAM_MAP = {
  corp:      { name: 'corpNm' },
  finance:   { crno: 'crno' },
  rpt:       { name: 'entp_name' },
  npsSearch: { name: 'wkplNm', bz: 'bzowrRgstNo' }, // 국민연금 V2 — camelCase
  npsDetail: { seq: 'seq', ym: 'dataCrtYm' },
  maker:     { name: 'bssh_nm' },
  gmp:       { rows: 'numOfRows' }, // 적합업체 현황(목록형) — 전체 받아 프론트에서 업체명 필터
  factory:   { name: 'cmpnyNm', rows: 'numOfRows' }, // 산단공 공장등록 — 회사명 검색
};

// data.go 공통 에러 메시지 → 사용자 조치 안내
function friendlyDataGoErr(msg) {
  msg = String(msg || '').trim();
  if (/NOT_REGISTERED|UNREGISTERED/i.test(msg)) return `${msg} → 이 API의 data.go 활용신청(승인) 필요`;
  if (/LIMITED_NUMBER|EXCEEDS/i.test(msg)) return `${msg} → 일일 호출한도 초과`;
  if (/DEADLINE|EXPIRED/i.test(msg)) return `${msg} → 활용기간 만료(연장 필요)`;
  return msg;
}

// data.go 응답 해석 — HTTP 200이어도 본문(XML 또는 JSON 헤더)에 에러가 실려 온다
async function parseDataGo(res) {
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* XML일 수 있음 */ }
  if (data) {
    const h = (data.response && data.response.header) || data.header || {};
    const code = h.resultCode != null ? String(h.resultCode).trim() : null;
    if (code && code !== '00' && code !== '0') throw new Error(friendlyDataGoErr(h.resultMsg || `API 오류(code ${code})`));
    return data;
  }
  // XML 응답 — 관세청 등 일부 API는 성공도 XML로 준다. 에러/성공을 구분해 파싱.
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error(friendlyDataGoErr(`응답 형식 오류(XML/HTML 아님): ${text.slice(0, 80)}`));
  }
  const tag = (n) => { const e = doc.getElementsByTagName(n)[0]; return e ? e.textContent.trim() : null; };
  const authMsg = tag('returnAuthMsg');
  if (authMsg) throw new Error(friendlyDataGoErr(authMsg)); // 미승인 키·한도초과 등
  const code = tag('resultCode') || tag('returnReasonCode');
  const msg = tag('resultMsg') || tag('errMsg') || tag('cmmMsgHeader');
  const ok = !code || code === '00' || code === '0' || /정상|NORMAL|SUCCESS/i.test(msg || '');
  if (!ok) throw new Error(friendlyDataGoErr(msg || `API 오류(code ${code})`));
  // 성공 XML → <item> 배열을 표준 구조로 반환(itemsOf/listOf 호환)
  const items = [...doc.getElementsByTagName('item')].map((it) => {
    const o = {};
    for (const c of it.children) o[c.tagName] = c.textContent.trim();
    return o;
  });
  return { response: { body: { items: { item: items } } } };
}

// 논리 파라미터 → 실제 파라미터로 매핑
function mapParams(logical, map) {
  const out = {};
  for (const [lk, v] of Object.entries(logical)) if (v != null && v !== '' && map[lk]) out[map[lk]] = v;
  return out;
}

// 프록시 비정상응답(res.ok=false) 본문에서 사람이 읽을 오류 메시지 추출
// (프록시가 { error, detail, upstreamStatus } 형태로 실어보냄. error가 객체여도 문자열화)
async function proxyErrMsg(res) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    const err = typeof j.error === 'object' ? JSON.stringify(j.error) : (j.error || '');
    const parts = [err, j.detail].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  } catch { /* JSON 아님 */ }
  return body ? body.slice(0, 200) : `프록시 HTTP ${res.status}`;
}

// 공공데이터 조회 — 프록시 경유. logical: { name?, crno?, bz6?, seq?, ym?, hs?, from?, to? }
async function proxyGet(service, logical) {
  const map = PARAM_MAP[service];
  if (!map) throw new Error(`알 수 없는 service: ${service}`);
  if (!getProxy()) throw new Error('프록시 미설정 — 우측 상단 실데이터 연결에 프록시 주소(/api/proxy)를 입력하세요');
  const url = buildProxyUrl({ service, ...mapParams(logical, map) });
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return parseDataGo(res);
}

// 네이버 뉴스/웹 / 카카오 / 페이지 대조 — 프록시 전용 (CORS 차단, 응답이 data.go 형식 아님)
async function proxyOnlyGet(service, params) {
  const proxy = getProxy();
  if (!proxy) throw new Error('프록시 미설정 — 이 소스는 프록시 경유 전용');
  let res;
  try { res = await fetch(buildProxyUrl({ service, ...params }), { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return res.json();
}

// ── 홈페이지 추적 ──
// 네이버 웹문서 검색으로 후보 사이트 추출 → 각 페이지에서 상호·대표자·사업자번호·주소 대조.
// 2개 이상 매칭되면 '확정 제안'. 포털·블로그·쇼핑·구인 도메인은 후보에서 제외.
const HP_SKIP = /(^|\.)(naver|daum|kakao|tistory|blog|cafe|youtube|instagram|facebook|linkedin|jobkorea|saramin|wanted|incruit|catch|nicebizinfo|wikipedia|namu\.wiki|google|11st|coupang|gmarket|auction|ssg|smartstore|blogspot|medium|threads|x)\./i;
function hpAddrCores(addr) {
  return String(addr || '').replace(/\s/g, '').match(/[가-힣]{2,}(읍|면|동|리|가|로|길)/g) || [];
}
async function findHomepage(nm, corp) {
  if (!getProxy()) return null;
  let web;
  try { web = await proxyOnlyGet('naverWeb', { query: `${nm} 화장품`, display: '20' }); }
  catch (e) { return { proposed: null, candidates: [], err: e.message }; }
  const items = (web && web.items) || [];
  const seen = new Set(); const cands = [];
  for (const it of items) {
    let host;
    try { host = new URL(it.link).hostname.replace(/^www\./, ''); } catch { continue; }
    if (HP_SKIP.test(host) || seen.has(host)) continue;
    seen.add(host);
    cands.push({ url: `https://${host}`, host, title: String(it.title || '').replace(/<\/?b>/g, '') });
    if (cands.length >= 4) break;
  }
  if (!cands.length) return { proposed: null, candidates: [] };

  const nameCore = stripCorp(nm).replace(/\s/g, '');
  const rep = corp && corp.rep ? String(corp.rep).replace(/\s/g, '') : '';
  const bz = corp && corp.bzno ? String(corp.bzno).replace(/\D/g, '') : '';
  const bzFmt = bz.length === 10 ? `${bz.slice(0, 3)}-${bz.slice(3, 5)}-${bz.slice(5)}` : '';
  const addrCores = hpAddrCores(corp && corp.addr);

  const scored = await Promise.all(cands.map(async (c) => {
    let page;
    try { page = await proxyOnlyGet('fetchPage', { url: c.url }); } catch { return { ...c, matches: [], score: 0 }; }
    const text = String((page && page.text) || '').replace(/\s/g, '');
    const m = [];
    if (nameCore && text.includes(nameCore)) m.push('상호');
    if (rep && text.includes(rep)) m.push('대표자');
    if (bz && (text.includes(bz) || (bzFmt && text.includes(bzFmt)))) m.push('사업자번호');
    if (addrCores.length && addrCores.some((a) => text.includes(a))) m.push('주소');
    return { ...c, matches: m, score: m.length };
  }));
  scored.sort((a, b) => b.score - a.score);
  const proposed = scored[0] && scored[0].score >= 2 ? scored[0] : null; // 2개 이상 매칭 → 확정 제안
  return { proposed, candidates: scored };
}

// 카카오 이동거리 — 한국콜마(기준점)→방문지.
//  1순위: 카카오모빌리티 길찾기(실측). 이용신청 안 돼 있으면 실패 → 2순위.
//  2순위: 카카오맵 Local API로 양 지점 정확 좌표 → 하버사인×도로계수로 추정(모빌리티 불필요).
// 좌표 변환(주소검색)까지 실패하면 throw → 상태 패널에 사유 표시(키·재배포 확인).
const KOLMAR_ADDR = '세종특별자치시 전의면 산단길 22-17'; // 한국콜마 기준점
let _kolmarCoord = null; // 세션 내 캐시(기준점 좌표는 고정)
async function kakaoGeocode(addr) {
  const data = await proxyOnlyGet('kakaoGeocode', { query: addr }); // 실패 시 proxyErrMsg 전파(401 등)
  const doc = data && data.documents && data.documents[0];
  if (!doc) return null;
  const lng = Number(doc.x), lat = Number(doc.y);
  return (isFinite(lng) && isFinite(lat)) ? { lng, lat } : null;
}
async function kakaoTravel(destAddr) {
  if (!getProxy()) throw new Error('프록시 미설정');
  if (!destAddr) throw new Error('방문 주소 없음');
  if (!_kolmarCoord) _kolmarCoord = await kakaoGeocode(KOLMAR_ADDR); // 실패(401 등) 시 여기서 throw
  if (!_kolmarCoord) throw new Error('기준점(한국콜마) 좌표 변환 실패');
  const dest = await kakaoGeocode(destAddr);
  if (!dest) throw new Error(`방문지 좌표 변환 실패: ${destAddr}`);

  // 1순위: 모빌리티 실측
  try {
    const dir = await proxyOnlyGet('kakaoDirections', {
      origin: `${_kolmarCoord.lng},${_kolmarCoord.lat}`,
      destination: `${dest.lng},${dest.lat}`,
    });
    const route = dir && dir.routes && dir.routes[0];
    if (route && (route.result_code == null || route.result_code === 0) && route.summary) {
      return { km: Math.round(route.summary.distance / 1000), min: Math.round(route.summary.duration / 60), method: 'navi' };
    }
  } catch { /* 모빌리티 미이용 → 좌표 기반 추정으로 폴백 */ }

  // 2순위: 정확 좌표 하버사인 × 도로우회계수(1.3), 평균 62km/h
  const straight = haversineKm(_kolmarCoord.lat, _kolmarCoord.lng, dest.lat, dest.lng);
  if (straight < 1.5) return { km: 0, min: 0, same: true, method: 'coord' };
  const km = Math.round(straight * 1.3);
  return { km, min: Math.round((km / 62) * 60), method: 'coord' };
}

// 응답에서 아이템 배열 추출 (공통 중첩 경로들 시도)
function itemsOf(data) {
  const paths = [
    (d) => d && d.response && d.response.body && d.response.body.items && d.response.body.items.item,
    (d) => d && d.body && d.body.items,
    (d) => d && d.items,
  ];
  for (const p of paths) {
    const v = p(data);
    if (v != null) return Array.isArray(v) ? v : [v].filter(Boolean);
  }
  return [];
}

// 1단계: 기준정보(동명업체 후보) 조회 → {candidates} 또는 {report}
async function liveLookup(name) {
  let cands = [];
  try {
    const corpData = await proxyGet('corp', { name });
    cands = window.mapCorpCandidates(corpData);
  } catch (e) { /* 기업기본정보 실패 → 식약처만으로 폴백 */ }

  if (!cands.length) {
    const rptData = await proxyGet('rpt', { name });
    return { report: window.mapMfdsReport(name, rptData) };
  }
  if (cands.length === 1) return { report: await finishLive(name, cands[0]) };
  return { candidates: cands, name };
}

// 법인 접두/접미어 제거 — 식약처/국민연금은 순수 상호로 조회해야 매칭됨
function stripCorp(s) {
  return String(s || '').replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사/g, '').trim();
}

// NPS(B552015) 응답 파서 — resultType=json이면 서버가 500 크래시 → XML로 받아 파싱.
// (혹시 JSON이면 그대로 파싱) 반환: item 객체 배열.
// 국민연금 2단계(V2·JSON): 사업장 검색 → 첫 건 seq로 상세조회(가입자수 jnngpCnt는 상세에만 있음)
// 사업자등록번호(bzowrRgstNo) 우선, 0건이면 상호명(wkplNm)으로 폴백.
async function npsLookup(nm, bzno) {
  const digits = bzno ? String(bzno).replace(/\D/g, '') : '';
  let items = [];
  if (digits.length >= 10) {
    try { items = itemsOf(await proxyGet('npsSearch', { bz: digits })); } catch { /* 상호명으로 폴백 */ }
  }
  if (!items.length) items = itemsOf(await proxyGet('npsSearch', { name: nm }));

  const hit = items[0];
  let detail = null;
  if (hit && hit.seq != null && hit.seq !== '') {
    try { detail = itemsOf(await proxyGet('npsDetail', { seq: hit.seq, ym: hit.dataCrtYm }))[0] || null; }
    catch { /* 상세 실패해도 검색 결과는 사용 */ }
  }
  return { search: hit || null, detail, count: items.length };
}

// 2단계: 선택된 업체의 재무·식약처·국민연금·제조업 병렬 조회 → 진단 포함 조립
async function finishLive(name, corp) {
  const nm = stripCorp(corp.corpNm || name);
  const calls = {
    finance: corp.crno ? proxyGet('finance', { crno: corp.crno }) : Promise.reject(new Error('법인등록번호 없음')),
    rpt: proxyGet('rpt', { name: nm }),
    nps: npsLookup(nm, corp.bzno),
    maker: proxyGet('maker', { name: nm }),
    gmp: proxyGet('gmp', { rows: '500' }),
    factory: proxyGet('factory', { name: nm, rows: '30' }),
    nts: corp.bzno ? proxyOnlyGet('ntsStatus', { b_no: String(corp.bzno).replace(/\D/g, '') }) : Promise.reject(new Error('사업자번호 없음')),
    naverNews: proxyOnlyGet('naverNews', { query: `${nm} 화장품`, display: '5' }),
  };
  const keys = Object.keys(calls);
  const settled = await Promise.allSettled(keys.map((k) => calls[k]));
  const res = {};
  keys.forEach((k, i) => {
    res[k] = settled[i].status === 'fulfilled'
      ? { ok: true, data: settled[i].value }
      : { ok: false, err: String(settled[i].reason && settled[i].reason.message || settled[i].reason) };
  });

  // 카카오 실측 이동거리 — 공장(산단공) 주소 우선, 없으면 본점. 가장 정확한 방문지로 길찾기.
  const fList = res.factory && res.factory.ok ? listOf(res.factory.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const fAddr = fList[0] ? (fList[0].lotNoAddr ?? fList[0].roadNmAddr ?? fList[0].adres ?? fList[0].ADRES ?? fList[0].fctryAddr ?? null) : null;
  const visitAddr = fAddr || corp.addr || null;
  let travel = null, kakaoErr = null;
  try { travel = await kakaoTravel(visitAddr); }
  catch (e) { kakaoErr = e && e.message ? e.message : String(e); }
  res.kakao = travel
    ? { ok: true, data: travel }
    : { ok: false, err: `${kakaoErr || '실패'} — 추정치 대체` };

  return window.assembleLiveReport(corp.corpNm || name, corp, res);
}

// 동명업체 선택 UI
function renderCandidates(name, cands) {
  const root = $('#report');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const box = el('div', 'candbox');
  box.appendChild(el('div', 'candhead', `「${esc(name)}」 동명·유사 업체 <b>${cands.length}건</b> — 조회할 업체를 선택하세요`));
  cands.forEach((c) => {
    const card = el('button', 'cand');
    const meta = [c.rep ? '대표 ' + esc(c.rep) : '', c.bzno ? '사업자 ' + esc(c.bzno) : '', c.addr ? esc(c.addr) : ''].filter(Boolean).join(' · ');
    card.innerHTML = `<div class="cn">${esc(c.corpNm || '(상호미상)')}</div><div class="cm">${meta || '추가정보 없음'}</div>`;
    card.addEventListener('click', async () => {
      root.innerHTML = `<div class="empty">「${esc(c.corpNm || name)}」 나머지 카테고리 조회 중…</div>`;
      try { render(await finishLive(name, c)); }
      catch (e) { root.innerHTML = `<div class="empty">조회 실패: ${esc(e.message)}</div>`; }
    });
    box.appendChild(card);
  });
  root.appendChild(box);
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setProxyUI() {
  const btn = $('#proxyBtn');
  if (!btn) return;
  const on = isConnected();
  btn.textContent = on ? '🟢 프록시 연결됨' : '🔌 실데이터 연결';
  btn.classList.toggle('on', on);
}

function downloadJSON() {
  if (!currentReport) return;
  const m = currentReport.meta;
  const safe = (m.vendor_id || m.vendor_name).replace(/[^\w가-힣-]/g, '_');
  const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}_v${m.version}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// CGMP 적합업소 여부 → 해당 행 음영 (품질인증 체크리스트에 CGMP 보유 시)
function isCgmpField(fld) {
  if (Array.isArray(fld.checklist)) return fld.checklist.some((c) => /cgmp/i.test(c.label) && c.ok);
  const v = String(fld.value || '');
  return /cgmp/i.test(v) && /(적합|유효|인증)/.test(v);
}

// 체크리스트 값 렌더 (품질인증 / PLT 거래여부) — ☑/☐ 칩
function checklistHtml(list) {
  return '<span class="cklist">' + list.map((c) =>
    `<span class="ck ${c.ok ? 'on' : 'off'}">${c.ok ? '☑' : '☐'} ${esc(c.label)}</span>`).join('') + '</span>';
}

// 3열 압축 행: [등급+항목] | [값] | [출처(우측 소형)]
function fieldRow(fld) {
  const isGap = fld.data_gap || fld.value == null;
  const row = el('div', 'field' + (isCgmpField(fld) ? ' cgmp' : ''));
  if (fld.note) row.title = fld.note;

  const k = el('div', 'k');
  k.appendChild(el('span', 'gdot g' + fld.grade, esc(fld.grade)));
  k.appendChild(el('span', 'ktxt', esc(fld.key)));
  row.appendChild(k);

  const stale = fld.fresh === false ? ' <span class="stale">⚠기간초과</span>' : '';
  const info = fld.note ? ` <span class="ninfo" title="${esc(fld.note)}">ⓘ</span>` : '';
  const valHtml = Array.isArray(fld.checklist)
    ? checklistHtml(fld.checklist) + info
    : (isGap ? '데이터 없음' : esc(fld.value)) + stale + info;
  row.appendChild(el('div', 'v' + (isGap && !fld.checklist ? ' gap' : ''), valHtml));

  const src = el('div', 'src');
  src.innerHTML = esc(fld.source || '—') + (fld.as_of ? `<br><span class="asof">${esc(fld.as_of)}</span>` : '');
  row.appendChild(src);
  return row;
}

function block(title, icon, fields) {
  const b = el('div', 'block');
  const gapCount = fields.filter((f) => f.data_gap).length;
  const h = el('h3', null, `<span class="ic">${icon}</span>${esc(title)}<span class="cnt">${fields.length}개 필드${gapCount ? ' · 공백 ' + gapCount : ''}</span>`);
  b.appendChild(h);
  fields.forEach((f) => b.appendChild(fieldRow(f)));
  return b;
}

// 재무 지표 정의 (금액 4종 + 비율 2종), 색상 구분
const FIN_SERIES = [
  { name: '매출액', unit: '억', grp: 'amt', color: '#3b82f6', g: (d) => d.revenue },
  { name: '영업이익', unit: '억', grp: 'amt', color: '#ef4444', g: (d) => d.operatingProfit },
  { name: '총자산', unit: '억', grp: 'amt', color: '#10b981', g: (d) => d.assets },
  { name: '총부채', unit: '억', grp: 'amt', color: '#f59e0b', invert: true, g: (d) => d.debt },
  { name: '영업이익률', unit: '%', grp: 'rat', color: '#a855f7', g: (d) => (d.revenue ? +(d.operatingProfit / d.revenue * 100).toFixed(1) : null) },
  { name: '부채비율', unit: '%', grp: 'rat', color: '#94a3b8', invert: true, g: (d) => { const eq = (d.assets || 0) - (d.debt || 0); return eq > 0 ? +(d.debt / eq * 100).toFixed(0) : null; } },
];

// 지표별 스파크 카드 — 각자 자기 스케일이라 수치 크기가 달라도 추이가 전부 보인다
function sparkCard(se, years) {
  const vals = se.vals;
  const idxs = vals.map((v, i) => (v != null ? i : null)).filter((i) => i != null);
  if (!idxs.length) {
    return `<div class="spark" style="border-top-color:${se.color}"><div class="sphead">${esc(se.name)} <span class="u">(${se.unit})</span></div><div class="spmiss">데이터 없음</div></div>`;
  }
  const first = vals[idxs[0]], last = vals[idxs[idxs.length - 1]];
  // 증감 배지: 금액은 %(첫해 대비), 비율(%)은 %p 차이
  let chg = '—', dir = 0;
  if (se.unit === '%') { const d = +(last - first).toFixed(1); chg = `${d > 0 ? '+' : ''}${d}%p`; dir = Math.sign(d); }
  else if (first) { const p = Math.round(((last - first) / Math.abs(first)) * 100); chg = `${p > 0 ? '+' : ''}${p}%`; dir = Math.sign(p); }
  const bad = se.invert ? dir > 0 : dir < 0;   // 부채류는 증가가 경고
  const good = se.invert ? dir < 0 : dir > 0;

  // 표시 포맷: %는 그대로, 억은 1만억 이상이면 '조' 단위로
  const fmt = (n) => se.unit === '%' ? `${n}%`
    : Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}조`
    : `${n}억`;
  const lbl = (n) => se.unit === '%' ? `${n}` : (Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}조` : `${n}`);

  const W = 250, H = 100, px = 12, pt = 18, pb = 18;
  const nums = vals.filter((v) => v != null);
  const maxV = Math.max(...nums, 0), minV = Math.min(...nums, 0), span = (maxV - minV) || 1;
  const x = (i) => px + (W - 2 * px) * (vals.length > 1 ? i / (vals.length - 1) : 0.5);
  const y = (v) => pt + (H - pt - pb) * (1 - (v - minV) / span);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="spsvg">`;
  if (minV < 0 && maxV > 0) svg += `<line x1="${px}" y1="${y(0).toFixed(1)}" x2="${W - px}" y2="${y(0).toFixed(1)}" class="mini-base"/>`;
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="2"/>`;
  vals.forEach((v, i) => {
    const xi = x(i).toFixed(1);
    if (v != null) {
      const yi = y(v);
      svg += `<circle cx="${xi}" cy="${yi.toFixed(1)}" r="2.8" fill="${se.color}"/>`;
      svg += `<text x="${xi}" y="${(yi - 5).toFixed(1)}" class="spptv" text-anchor="middle" fill="${se.color}">${lbl(v)}</text>`;
    }
    svg += `<text x="${xi}" y="${H - 5}" class="spptx" text-anchor="middle">${String(years[i]).slice(2)}</text>`;
  });
  svg += `</svg>`;

  return `<div class="spark" style="border-top-color:${se.color}">
    <div class="sphead">${esc(se.name)} <span class="u">(${se.unit})</span></div>
    <div class="spval">${fmt(last)}<span class="spchg ${bad ? 'bad' : good ? 'good' : ''}">${chg}</span></div>
    ${svg}
  </div>`;
}

// 재무 블록(전폭) = 지표별 스파크 카드 6개(각자 스케일) + 자본금 행
function financeBlock(report) {
  const fields = report.finance;
  const hist = report.finance_history || [];
  const b = el('div', 'block full');
  const chartN = hist.length ? '그래프 6지표 · 표 자본금' : `${fields.length}개 필드`;
  b.appendChild(el('h3', null, `<span class="ic">💰</span>재무 (금융위)<span class="cnt">${chartN}</span>`));

  if (hist.length) {
    const years = hist.map((d) => d.year);
    const w = el('div', 'finwrap');
    w.appendChild(el('div', 'finhead', `<span>재무 지표 ${years.length}개년 추이 (${years[0]}~${years[years.length - 1]}, 최신연도 기준)</span><span class="finnote">지표별 자기 스케일 — 추이 비교용</span>`));
    const grid = el('div', 'sparkgrid');
    FIN_SERIES.forEach((s) => {
      grid.insertAdjacentHTML('beforeend', sparkCard({ name: s.name, unit: s.unit, color: s.color, invert: s.invert, vals: hist.map(s.g) }, years));
    });
    w.appendChild(grid);
    b.appendChild(w);
  } else {
    b.appendChild(el('div', 'finmiss', '공식 재무 미제출 법인 — 추이 그래프 생략'));
  }
  const rows = el('div', 'finrows');
  const capRow = fields.find((f) => f.key === '자본금');
  if (capRow) rows.appendChild(fieldRow(capRow));
  else fields.forEach((f) => rows.appendChild(fieldRow(f)));
  b.appendChild(rows);
  return b;
}

function renderRiskFlags(flags) {
  if (!flags || !flags.length) return null;
  const box = el('div', 'riskbox');
  box.appendChild(el('h3', null, `⚠ 리스크 플래그 ${flags.length}건 — 방문 전 반드시 확인`));
  const ul = el('ul');
  flags.forEach((fl) => {
    const li = el('li');
    li.appendChild(el('span', 't', esc(fl.type)));
    li.appendChild(el('span', null, esc(fl.detail || '')));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  return box;
}


function renderNews(news) {
  if (!news || !news.length) return null;
  const b = el('div', 'newsbox');
  b.innerHTML = `<h4>📰 최신 관련기사 <span>(최근 1년 · ${news.length}건)</span></h4>`;
  const list = el('ul', 'newslist');
  news.forEach((n) => {
    const li = el('li');
    const title = String(n.title || '').replace(/<\/?b>/g, '');
    const desc = String(n.description || '').replace(/<\/?b>/g, '');
    const date = n.pubDate ? new Date(n.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const src = n.source || '';
    li.innerHTML =
      `<a href="${esc(n.link || '#')}" target="_blank" rel="noopener" class="ntitle">${esc(title)}</a>` +
      `<div class="ndesc">${esc(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}</div>` +
      `<div class="nmeta">${date}${src ? ' · ' + esc(src) : ''}</div>`;
    list.appendChild(li);
  });
  b.appendChild(list);
  return b;
}

// 홈페이지 추적 결과를 박스에 렌더 (검색중 → 결과 교체)
function renderHomepageInto(box, hp) {
  const chip = (m) => `<span class="hp-m">✓ ${esc(m)}</span>`;
  if (!hp) { box.innerHTML = '<h4>🔎 홈페이지 추적</h4><div class="hp-none">검색 실패 또는 프록시 미설정</div>'; return; }
  if (hp.err) { box.innerHTML = `<h4>🔎 홈페이지 추적</h4><div class="hp-none">검색 실패: ${esc(hp.err)}</div>`; return; }
  const p = hp.proposed;
  let html = `<h4>🔎 홈페이지 추적 <span>업체명+화장품 웹검색 → 페이지 대조</span></h4>`;
  if (p) {
    html += `<div class="hp-top">` +
      `<span class="hp-badge">확정 제안</span>` +
      `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="hp-url">${esc(p.host)}</a>` +
      `<div class="hp-ms">${p.matches.map(chip).join('')} <em>(${p.matches.length}개 일치)</em></div>` +
      `</div>`;
  } else {
    html += `<div class="hp-none">2개 이상 일치하는 확정 사이트 없음 — 아래 후보 수동 확인</div>`;
  }
  const others = (hp.candidates || []).filter((c) => !p || c.host !== p.host);
  if (others.length) {
    html += `<div class="hp-cands"><i>후보</i>` + others.map((c) =>
      `<a href="${esc(c.url)}" target="_blank" rel="noopener" class="hp-cand">${esc(c.host)}${c.matches.length ? ` <b>${c.matches.join('·')}</b>` : ''}</a>`).join('') + `</div>`;
  }
  box.innerHTML = html;
}

// 방문지 주소 선택 — 제조소(식약처) > 본점(금융위) > 사업장(연금) 순
function visitAddress(report) {
  const fields = [...(report.basic || []), ...(report.capacity || [])];
  const val = (k) => { const f = fields.find((x) => x.key === k); return f && f.value ? f.value : null; };
  return val('제조소 소재지') || val('본점주소') || val('사업장 주소 (연금기준)') || null;
}

function render(report) {
  currentReport = report;
  const root = $('#report');
  root.innerHTML = '';
  root.classList.remove('hidden');

  const m = report.meta;

  // 제외된 소스는 필드/블록/집계에서 모두 숨김
  const excl = getExcluded();
  const included = (f) => { const k = srcKeyOf(f.source); return !k || !excl.has(k); };
  const visible = (fields) => fields.filter(included);

  // 방문 리포트 저장/인쇄 툴바
  const actions = el('div', 'actions');
  const dlBtn = el('button', 'act', '⬇ JSON 다운로드');
  dlBtn.addEventListener('click', downloadJSON);
  const printBtn = el('button', 'act primary', '🖨 인쇄 / PDF로 저장');
  printBtn.addEventListener('click', () => window.print());
  actions.appendChild(el('span', 'act-hint', '방문 전 리포트로 저장 →'));
  // 🗺 카카오맵에서 공장 위치 보기 (제조소 주소 우선) — 별도 키 불필요, 새 탭에서 로드맵 표시
  const visitAddr = visitAddress(report);
  if (visitAddr) {
    const mapBtn = el('button', 'act', '🗺 카카오맵에서 공장 위치');
    mapBtn.title = `카카오맵에서 「${visitAddr}」 위치를 로드맵으로 표시`;
    mapBtn.addEventListener('click', () => window.open(`https://map.kakao.com/?q=${encodeURIComponent(visitAddr)}`, '_blank', 'noopener'));
    actions.appendChild(mapBtn);
  }
  actions.appendChild(dlBtn);
  actions.appendChild(printBtn);
  root.appendChild(actions);
  const allFields = [...report.basic, ...report.capacity, ...report.finance].filter(included);
  const gapTotal = allFields.filter((f) => f.data_gap).length;

  // Summary
  const sm = el('div', 'summary');
  sm.appendChild(el('div', 'grade-badge badge-' + m.overall_grade, esc(m.overall_grade)));
  const vinfo = el('div', 'vinfo');
  const qDate = new Date(m.query_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  vinfo.innerHTML =
    `<h2>${esc(m.vendor_name)}</h2>` +
    `<div class="meta-line">조회시점 <b>${esc(qDate)}</b> · 스냅샷 <b>v${m.version}</b> · ` +
    `최신성 기준 <b>${m.max_age_years}년</b> · 사용 출처 <b>${m.sources_used.length}종</b></div>`;
  sm.appendChild(vinfo);
  const stats = el('div', 'stats');
  stats.innerHTML =
    `<div class="s"><div class="n">${allFields.length}</div><div class="k">수집 필드</div></div>` +
    `<div class="s"><div class="n ${gapTotal ? 'warn' : ''}">${gapTotal}</div><div class="k">데이터 공백</div></div>` +
    `<div class="s"><div class="n ${report.risk_flags.length ? 'warn' : ''}">${report.risk_flags.length}</div><div class="k">리스크</div></div>`;
  sm.appendChild(stats);
  root.appendChild(sm);

  // 데이터 출처 배너
  if (m.live) {
    root.appendChild(el('div', 'livenote',
      '🟢 <b>실데이터</b> — data.go.kr 공공 API 조회 결과입니다. ' +
      '값이 없는 항목은 <code>data_gap</code>으로 명시합니다.'));
    // 📡 소스별 조회 상태 — 무엇이 왜 비었는지 + 체크 해제 시 리포트에서 제외
    if (Array.isArray(m.src_status) && m.src_status.length) {
      const excluded = getExcluded();
      const sp = el('div', 'srcstat');
      sp.appendChild(el('div', 'srchead', '📡 데이터 소스 상태 <span>체크 해제 → 리포트에서 제외</span>'));
      m.src_status.forEach((s) => {
        const canToggle = !!s.key;
        const ex = canToggle && excluded.has(s.key);
        const row = el('label', 'ss ' + (ex ? 'excl' : (s.ok ? 'ok' : 'no')));
        const mark = ex ? '⊘' : (s.ok ? '✓' : '✗');
        const detail = ex ? '제외됨 — 사용자 설정' : (s.detail || '');
        row.innerHTML =
          `<input type="checkbox" ${ex ? '' : 'checked'} ${canToggle ? '' : 'disabled'}>` +
          `<em>${mark}</em><span class="ssn">${esc(s.name)}</span><i>${esc(detail)}</i>`;
        if (canToggle) {
          row.querySelector('input').addEventListener('change', () => {
            toggleExcluded(s.key);
            render(currentReport); // 즉시 반영 (재조회 없이 표시만 갱신)
          });
        }
        sp.appendChild(row);
      });
      root.appendChild(sp);
    }
  } else if (m.generated) {
    root.appendChild(el('div', 'gennote',
      '⚙️ <b>자동 생성 데모 데이터</b> — 예시 업체(리니어코스메틱·샘플뷰티랩) 외 입력은 UI 검증용으로 이름 기반 합성됩니다. ' +
      '실데이터는 우측 상단 <b>🔌 실데이터 연결</b>에 <b>프록시 주소</b>(/api/proxy)를 넣으면 됩니다.'));
  }

  const rf = renderRiskFlags(report.risk_flags);
  if (rf) root.appendChild(rf);

  const blocks = el('div', 'blocks');
  blocks.appendChild(block('기업 기본정보', '🏢', visible(report.basic)));
  blocks.appendChild(block('생산역량 · 인원', '🏭', visible(report.capacity)));
  if (!excl.has('finance')) blocks.appendChild(financeBlock(report));
  if (!excl.has('news')) { const newsB = renderNews(report.news); if (newsB) blocks.appendChild(newsB); }

  // 🔎 홈페이지 추적 — 실데이터일 때만, 지연 로드(첫 렌더 이후 비동기). 결과는 report에 캐시.
  if (m.live) {
    const hpBox = el('div', 'hpbox');
    blocks.appendChild(hpBox);
    if (report._homepage !== undefined) {
      renderHomepageInto(hpBox, report._homepage);
    } else {
      hpBox.innerHTML = '<h4>🔎 홈페이지 추적 <span>검색 중…</span></h4>';
      const getV = (k) => { const f = report.basic.find((x) => x.key === k); return f && f.value; };
      findHomepage(report.meta.vendor_name, { rep: getV('대표자'), addr: getV('본점주소'), bzno: getV('사업자등록번호') })
        .then((hp) => { report._homepage = hp || null; renderHomepageInto(hpBox, report._homepage); })
        .catch(() => { report._homepage = null; renderHomepageInto(hpBox, null); });
    }
  }

  const diffBlock = renderDiff(report.diff_from_prev);
  if (diffBlock) blocks.appendChild(diffBlock);
  root.appendChild(blocks);

  // Legend
  const lg = el('div', 'legend');
  lg.innerHTML =
    '<span class="item"><b>신뢰도</b></span>' +
    ['A', 'B', 'C', 'D'].map((g) => `<span class="item"><span class="dot badge-${g}"></span>${g} · ${GRADE_LABEL[g]}</span>`).join('');
  root.appendChild(lg);

  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDiff(diff) {
  if (!diff || !diff.length) return null;
  const b = el('div', 'block');
  b.appendChild(el('h3', null, `<span class="ic">📈</span>직전 버전 대비 변경<span class="cnt">${diff.length}건</span>`));
  diff.forEach((d) => {
    const row = el('div', 'field');
    row.appendChild(el('div', 'k', esc(d.key)));
    const cell = el('div');
    cell.style.flex = '1';
    cell.appendChild(el('div', 'v', `${esc(d.before)} <span style="color:var(--faint)">→</span> <b>${esc(d.after)}</b>`));
    row.appendChild(cell);
    b.appendChild(row);
  });
  return b;
}

function lookup(name) {
  const key = (name || '').trim();
  if (!key) return;
  const db = window.VENDOR_SAMPLES || {};
  let report = db[key];
  if (!report) {
    // 부분 일치 시도
    const hit = Object.keys(db).find((k) => k.includes(key) || key.includes(k));
    report = hit ? db[hit] : null;
  }
  // 식약처 실데이터(빌드타임): Actions가 시크릿으로 구운 정적 JSON에 있으면 실데이터 렌더
  if (!report) {
    const hit = staticHit(key);
    if (hit) {
      const root = $('#report');
      root.classList.remove('hidden');
      root.innerHTML = `<div class="empty">식약처 실데이터 불러오는 중… 「${esc(hit.name)}」</div>`;
      fetch(`data/mfds/${hit.id}.json`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((rep) => render(rep))
        .catch((e) => { root.innerHTML = `<div class="empty">불러오기 실패: ${esc(e.message)}</div>`; });
      return;
    }
  }

  // (선택) 실시간 모드: 기준정보 → (동명업체 선택) → 나머지 카테고리 (키 직접 또는 프록시)
  if (isConnected() && !report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">금융위·식약처 실시간 조회 중… 「${esc(key)}」</div>`;
    liveLookup(key)
      .then((res) => { if (res.candidates) renderCandidates(res.name, res.candidates); else render(res.report); })
      .catch((e) => {
        root.innerHTML =
          `<div class="empty">실데이터 조회 실패: ${esc(e.message)}<br>` +
          `<span style="font-size:12.5px">프록시 주소·키·API 승인을 확인하세요. 데모 데이터로 대체하려면 아래를 누르세요.</span><br><br>` +
          `<button class="act" id="fallbackBtn">데모 리포트 보기</button></div>`;
        const fb = $('#fallbackBtn');
        if (fb) fb.addEventListener('click', () => render(window.generateReport(key)));
      });
    return;
  }
  // 범용성: 미등록 업체명은 이름 기반으로 데모 리포트 자동 생성
  if (!report && window.generateReport) report = window.generateReport(key);
  if (!report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">업체명을 입력하세요.</div>`;
    return;
  }
  render(report);
}

document.addEventListener('DOMContentLoaded', () => {
  loadStaticIndex(); // 식약처 실데이터 인덱스 미리 로드 (있으면)

  // ?proxy= 로 들어오면 저장 (프록시 자동 연결)
  const pParam = new URLSearchParams(location.search).get('proxy');
  if (pParam !== null) { setProxy(pParam.trim()); }

  const proxyBtn = $('#proxyBtn');
  if (proxyBtn) {
    proxyBtn.addEventListener('click', () => {
      const cur = getProxy();
      const next = window.prompt(
        '실데이터 연결 — 프록시 주소 입력:\n' +
        '같은 도메인이면  /api/proxy\n' +
        '다른 도메인이면  https://…/api/proxy\n\n' +
        '※ API 키는 프록시 서버(환경변수)에만 두세요. 여기엔 넣지 않습니다.\n' +
        '비우고 확인하면 데모 모드로 돌아갑니다.',
        cur
      );
      if (next === null) return; // 취소
      setProxy(next.trim());
      setProxyUI();
      const q = $('#q').value.trim();
      if (q) lookup(q);
    });
    setProxyUI();
  }

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup($('#q').value);
  });
  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      $('#q').value = c.dataset.name;
      lookup(c.dataset.name);
    })
  );
});
