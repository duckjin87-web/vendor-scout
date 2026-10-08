// app.js — vendor-scout 데모 프론트엔드
// src/report/schema.js의 스냅샷 리포트(JSON)를 화면에 렌더링. API 호출은 데모 모드에서 목데이터로 대체.

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
// 이 파일에 박아 둔 빌드 번호. index.html의 ?v=와 반드시 같은 값으로 함께 올린다.
// (배포 스크립트가 세 자산의 ?v=와 이 상수가 어긋나면 배포를 막는다)
const BUILD = 173;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 오류값을 사람이 읽을 수 있는 문자열로 — 오류는 문자열일 수도, Error일 수도,
// Vercel 플랫폼 오류처럼 {code, message} 객체일 수도 있다. 어느 쪽이든 화면에
// "[object Object]"가 찍히면 원인을 통째로 잃는다. 여기서 한 번에 막는다.
function errText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);
  // Vercel 플랫폼 오류는 {error:{code,message}} 형태로 한 겹 감싸서 온다 — 안으로 들어간다
  if (v.error && typeof v.error === 'object' && !Array.isArray(v.error)) return errText(v.error);
  const parts = [v.message, typeof v.error === 'string' ? v.error : null, typeof v.detail === 'string' ? v.detail : null]
    .filter((x) => typeof x === 'string' && x);
  if (v.code && !parts.length) parts.push(String(v.code));
  else if (v.code) parts.unshift(`[${v.code}]`);
  if (parts.length) return parts.join(' · ');
  try { return JSON.stringify(v).slice(0, 300); } catch { return String(v); }
}

const GRADE_LABEL = { A: '공식 API', B: '공공DB 간접', C: '추정/프록시', D: '데이터 공백' };

let currentReport = null;
let _srcOpen = false;   // 데이터 소스 상태 패널 펼침 여부(재렌더 시 유지)
let _editingCheck = null;  // 수정 중인 직접추가 항목 id — 재렌더로 편집 폼을 그린다

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
// ── 화면 테마 ──
// 'auto'는 저장하지 않고 속성을 지운다 — 그래야 기기 설정이 바뀔 때 따라 움직인다.
// (첫 그림 전 적용은 index.html 인라인 스크립트가 맡는다. 여기는 전환·버튼 상태만.)
const THEME_KEY = 'vs_theme';
const getTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'dark' || t === 'light' ? t : 'auto'; } catch { return 'auto'; } };
function setTheme(mode) {
  const root = document.documentElement;
  if (mode === 'dark' || mode === 'light') {
    root.setAttribute('data-theme', mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* 저장 못 해도 이번 세션은 적용된다 */ }
  } else {
    root.removeAttribute('data-theme');
    try { localStorage.removeItem(THEME_KEY); } catch {}
  }
  syncThemeUI();
}
function syncThemeUI() {
  const cur = getTheme();
  document.querySelectorAll('[data-set-theme]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-set-theme') === cur));
  });
}

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

// ── 사용자 추가 체크 항목 / 체크 상태 ──
// 자동 도출 항목만으로는 부족하다. 자료를 훑다가 "이건 물어봐야겠다" 싶은 게 생기면
// 그 자리에서 적어 방문 체크리스트에 넣을 수 있어야 한다. 업체별로 브라우저에 저장한다.
// 체크 상태도 함께 저장한다 — 홈페이지 분석이 끝나면 목록이 다시 그려지는데,
// 그때 이미 체크해둔 항목이 전부 풀려버리는 문제가 있었다.
const CUSTOM_KEY = 'vs_custom_checks';   // { [vendorId]: [{id,text,cat,pri,at}] }
const CHECKED_KEY = 'vs_checked';        // { [vendorId]: [itemKey, ...] }
const _readMap = (k) => { try { return JSON.parse(_ls(k) || '{}') || {}; } catch { return {}; } };
const _writeMap = (k, m) => _sls(k, JSON.stringify(m));

const getCustomChecks = (vid) => (vid ? (_readMap(CUSTOM_KEY)[vid] || []) : []);
function addCustomCheck(vid, item) {
  if (!vid) return null;
  const m = _readMap(CUSTOM_KEY);
  const row = { id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString().slice(0, 10), ...item };
  m[vid] = [...(m[vid] || []), row];
  _writeMap(CUSTOM_KEY, m);
  return row;
}
function updateCustomCheck(vid, id, patch) {
  const m = _readMap(CUSTOM_KEY);
  if (!m[vid]) return;
  m[vid] = m[vid].map((x) => (x.id === id ? { ...x, ...patch } : x));
  _writeMap(CUSTOM_KEY, m);
}
function removeCustomCheck(vid, id) {
  const m = _readMap(CUSTOM_KEY);
  if (!m[vid]) return;
  m[vid] = m[vid].filter((x) => x.id !== id);
  _writeMap(CUSTOM_KEY, m);
}
// 항목 식별키 — 자동 항목은 문구가 바뀌지 않는 한 같은 키를 유지해야 체크가 살아남는다
function checkKeyOf(it) {
  if (it.uid) return it.uid;
  let h = 5381;
  const s = `${it.cat}|${it.text}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `a${h.toString(36)}`;
}
// 항목별 메모 — 방문 전에 물어볼 말을 적어 두거나, 방문해서 들은 답을 적는 칸.
// 체크 표시와 같은 키를 쓰므로 문구가 그대로면 다시 조회해도 남아 있다.
const MEMO_KEY = 'vs_memos';             // { [vendorId]: { [itemKey]: '메모' } }
const getMemos = (vid) => (vid ? (_readMap(MEMO_KEY)[vid] || {}) : {});
function setMemo(vid, key, text) {
  if (!vid) return;
  const m = _readMap(MEMO_KEY);
  const o = { ...(m[vid] || {}) };
  if (text && text.trim()) o[key] = text.trim(); else delete o[key];
  m[vid] = o;
  _writeMap(MEMO_KEY, m);
}
const getCheckedSet = (vid) => new Set(vid ? (_readMap(CHECKED_KEY)[vid] || []) : []);
function toggleChecked(vid, key, on) {
  if (!vid) return;
  const m = _readMap(CHECKED_KEY);
  const set = new Set(m[vid] || []);
  on ? set.add(key) : set.delete(key);
  m[vid] = [...set];
  _writeMap(CHECKED_KEY, m);
}

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
  corp:      { name: 'corpNm', bzno: 'bzno' }, // 상호 또는 사업자등록번호로 조회
  finance:   { crno: 'crno', rows: 'numOfRows', page: 'pageNo', year: 'bizYear' },
  financeBs: { crno: 'crno', rows: 'numOfRows', page: 'pageNo', year: 'bizYear' },
  financeIs: { crno: 'crno', rows: 'numOfRows', page: 'pageNo', year: 'bizYear' },
  rpt:       { name: 'entp_name', rows: 'numOfRows' },
  npsSearch: { name: 'wkplNm', bz: 'bzowrRgstNo' }, // 국민연금 V2 — camelCase
  npsDetail: { seq: 'seq', ym: 'dataCrtYm' },
  maker:     { name: 'bssh_nm', rows: 'numOfRows' },
  gmp:       { rows: 'numOfRows' }, // 적합업체 현황(목록형) — 전체 받아 프론트에서 업체명 필터
  factory:   { name: 'cmpnyNm', rows: 'numOfRows' }, // 산단공 공장등록 — 회사명 검색
  // 건축물대장 — 법정동코드(시군구 5 + 법정동 5)와 지번(본번·부번 4자리)으로 찾는다
  bldTitle: { sigunguCd: 'sigunguCd', bjdongCd: 'bjdongCd', platGbCd: 'platGbCd', bun: 'bun', ji: 'ji', rows: 'numOfRows' },
  bldRecap: { sigunguCd: 'sigunguCd', bjdongCd: 'bjdongCd', platGbCd: 'platGbCd', bun: 'bun', ji: 'ji', rows: 'numOfRows' },
  factoryBass:  { name: 'cmpnyNm', manageNo: 'fctryManageNo', rows: 'numOfRows' },
  factoryLand:  { name: 'cmpnyNm', manageNo: 'fctryManageNo', rows: 'numOfRows' },
  factoryFclty: { name: 'cmpnyNm', manageNo: 'fctryManageNo', rows: 'numOfRows' },
  recall:    { rows: 'numOfRows', page: 'pageNo' }, // 화장품 회수·판매중지 — 목록형, 프론트에서 업체명 필터
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
    // hint는 '다음에 뭘 하면 되는지'라 오류만큼 중요 — 함께 노출
    // 값이 객체여도 errText가 읽을 수 있게 풀어준다(그냥 이으면 [object Object]가 된다)
    const parts = [j.error, j.detail, j.hint].map(errText).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  } catch { /* JSON 아님 */ }
  return body ? body.slice(0, 200) : `프록시 HTTP ${res.status}`;
}

// 브라우저 fetch 재시도 — 순간 네트워크 실패("Failed to fetch")·연결끊김을 짧게 재시도.
// (프록시 도달 전 클라이언트단 실패라 서버 재시도로는 못 잡음)
async function fetchRetry(url, opts, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { lastErr = e; if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

// 동시성 제한 병렬 실행 — 브라우저 동시연결 포화("Failed to fetch") 방지
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── 조회 속도 ──
// 업체와 상관없이 늘 같은 목록(CGMP 적합업소 · 회수·판매중지)은 매번 실시간으로 받는다.
// 받은 목록은 저장해 두되, 실시간 조회가 실패하거나 LIST_WAIT_MS 안에 안 오면 7일 이내 저장본을 대신 쓴다
// (실시간 조회는 뒤에서 계속 돌아 저장본을 새로 고친다). 저장본을 쓴 경우 __savedAt에 저장 시각을 남긴다.
const LIST_WAIT_MS = 4000;
const LIST_KEEP_MS = 7 * 24 * 3600e3;
function liveFirstList(key, fn) {
  let saved = null;
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.data && Date.now() - c.at < LIST_KEEP_MS) saved = c;
  } catch { /* 저장소 차단 — 실시간만 */ }
  const useSaved = () => ({ ...saved.data, __savedAt: saved.at });
  const fresh = fn().then((data) => {
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* 용량 초과 등 */ }
    return data;
  });
  if (!saved) return fresh;
  const slow = new Promise((r) => setTimeout(() => r(null), LIST_WAIT_MS));
  return Promise.race([fresh.then((d) => ({ d }), () => ({ failed: true })), slow])
    .then((r) => (r && r.d ? r.d : useSaved()));
}
// 짧은 메모 — 같은 조회 안에서 후보 추천과 리포트 조립이 같은 요청을 두 번 하지 않게(실패는 기억하지 않는다)
const _memo = new Map();
function memoAsync(key, ttlMs, fn) {
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p;
  const p = fn();
  _memo.set(key, { at: Date.now(), p });
  p.catch(() => _memo.delete(key));
  return p;
}

// 공공데이터 조회 — 프록시 경유. logical: { name?, crno?, bz6?, seq?, ym?, hs?, from?, to? }
async function proxyGet(service, logical) {
  const map = PARAM_MAP[service];
  if (!map) throw new Error(`알 수 없는 service: ${service}`);
  if (!getProxy()) throw new Error('프록시 미설정 — 우측 상단 실데이터 연결에 프록시 주소(/api/proxy)를 입력하세요');
  const url = buildProxyUrl({ service, ...mapParams(logical, map) });
  let res;
  try { res = await fetchRetry(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return parseDataGo(res);
}

// 네이버 뉴스/웹 / 카카오 / 페이지 대조 — 프록시 전용 (CORS 차단, 응답이 data.go 형식 아님)
async function proxyOnlyGet(service, params) {
  const proxy = getProxy();
  if (!proxy) throw new Error('프록시 미설정 — 이 소스는 프록시 경유 전용');
  let res;
  try { res = await fetchRetry(buildProxyUrl({ service, ...params }), { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return res.json();
}

// ── 홈페이지 추적 ──
// 네이버 웹문서 검색으로 후보 사이트 추출 → 각 페이지에서 상호·대표자·사업자번호·주소 대조.
// 근거 가중합 4점 이상이면 '확정 제안'. 포털·블로그·쇼핑·구인 도메인은 후보에서 제외.
// 홈페이지 후보에서 제외할 도메인.
// 뷰티맥스 조회에서 후보 3건이 전부 노이즈였다(홈페이지 제작 대행사·알바몬·사업자정보 집계).
// 기존 목록은 이름 뒤에 점이 붙는 형태만 막아서 albamon·moneypin·bizno가 그대로 통과했다.
// 유형별로 나눠 관리한다 — 어느 유형이 새로 생겼는지 알아야 계속 손볼 수 있다.
const HP_SKIP_GROUPS = {
  포털·SNS: /(^|\.)(naver|daum|kakao|tistory|blog|cafe|youtube|instagram|facebook|linkedin|google|wikipedia|namu\.wiki|blogspot|medium|threads|twitter|pinterest|band\.us)(\.|$)/i,
  채용: /(^|\.)(jobkorea|saramin|wanted|incruit|catch|albamon|alba\.co\.kr|jobplanet|work24|worknet|jobaba|kosmes|superpass|rocketpunch|jumpit|programmers)(\.|$)/i,
  사업자정보집계: /(^|\.)(moneypin|bizno|nicebizinfo|cretop|sbiz24|findbiz|jaoms|ktdb|wgbiz|innobiz|kisline|saramin|ppomppu)(\.|$)/i,
  쇼핑·오픈마켓: /(^|\.)(11st|coupang|gmarket|auction|ssg|smartstore|interpark|tmon|wemakeprice|lotteon|oliveyoung|naverpay)(\.|$)/i,
  // 홈페이지 제작·디자인 대행사 포트폴리오 — 고객사 상호가 그대로 실려 상위에 올라온다(ipdesign.kr 사례)
  // ※ 아임웹·카페24·모두 같은 '빌더'는 여기서 뺐다. 아래 HP_BUILDERS 참고.
  제작대행: /(^|\.)(ipdesign|sitepro|homepage|webmaker|webdesign)(\.|$)/i,
  공공·기관: /(^|\.)(go\.kr|or\.kr\.gov|molit|data\.go)(\.|$)/i,
  언론: /(^|\.)(news|press|newsis|yna|mk\.co\.kr|hankyung|edaily|etnews|mt\.co\.kr|sedaily)(\.|$)/i,
};
// 홈페이지 빌더 플랫폼. 영세 제조업체는 자기 도메인을 사지 않고 여기에 그냥 얹는 경우가 많다
// (cellab.imweb.me 처럼). 여태 이것들을 '제작대행'으로 싸잡아 걸러서, 정작 찾아야 할
// 업체 홈페이지를 후보에서 지우고 있었다. 플랫폼 대문(imweb.me)만 걸러내고
// 서브도메인(cellab.imweb.me)은 그 업체의 홈페이지로 본다.
const HP_BUILDERS = [
  'imweb.me', 'cafe24.com', 'modoo.at', 'creatorlink.net', 'wixsite.com', 'weebly.com',
  'makeshop.co.kr', 'godomall.com', 'sixshop.com', 'shopby.kr', 'mycafe24.com', 'site123.me',
  'creatorlink.com', 'squarespace.com', 'wordpress.com', 'webnode.kr',
];
function hpSkipReason(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  const builder = HP_BUILDERS.find((d) => h === d || h.endsWith('.' + d));
  if (builder) return h === builder ? '제작대행' : null;   // 서브도메인 = 그 업체 사이트
  for (const [why, re] of Object.entries(HP_SKIP_GROUPS)) if (re.test(h)) return why;
  return null;
}
function hpAddrCores(addr) {
  return String(addr || '').replace(/\s/g, '').match(/[가-힣]{2,}(읍|면|동|리|가|로|길)/g) || [];
}
// ── 홈페이지 정보 추출 (생산 CAPA · 인증) ──
// HTML → 가독 텍스트 (script/style·태그 제거, 엔티티·공백 정리)
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/li|\/p|\/div|\/h[1-6]|\/tr|\/td|\/th|\/section)\b[^>]*>/gi, '\n') // 블록 경계 → 줄바꿈(문장 분리 보존)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#\d+;/g, ' ')
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n').trim();
}
// 인증 키워드 사전 — 홈페이지에 게재된 인증 문구 탐지(과대광고 아닌 표기 여부만)
// grp: 제조품질 / 국가규제 / 친환경·윤리 / 시험·평가 / 기업인증
// ── 인증 '보유' 판정 ──
// 키워드가 본문에 나왔다는 것만으로 인증을 가졌다고 볼 수 없다. 유스케어팜 사례가 정확히
// 그랬다 — 보도자료의 "원료가 미국화장품협회에 등록, cGMP(미국 FDA 의약품 품질 관리 기준)"
// 라는 설명 문장에서 CGMP를 뽑아, 식약처 GMP API가 '미등재'라고 답한 업체에 CGMP를 달았다.
// 그래서 문장 단위로 보고 (1) 소유를 뜻하는 표현이 있는지 (2) 남의 것을 가리키는 문맥은
// 아닌지를 함께 본다. 근거가 약하면 버리지 않고 '언급'으로 낮춰 표시한다.
const OWN_CUES = /(인증|취득|획득|보유|적합\s*판정|적합업소|인정|등재|지정|받았|받아|완료|유지|승인|허가|등록(?!된\s*원료)|certified|accredited)/;
// 남의 인증·설명·계획을 가리키는 문맥 — 이게 걸리면 '보유'로 보지 않는다
const THIRD_PARTY = /(원료|성분|협회|기준(?:이|입니다|을)|이란|란\s|의미|추진|예정|계획|준비\s*중|목표|협력사|고객사|파트너사|공급사|타사|해당\s*없|미보유|미인증|미등재)/;
function certOwnership(sentence) {
  const t = String(sentence || '');
  if (!t) return { level: 'weak', why: '근거 문장 없음' };
  if (THIRD_PARTY.test(t)) return { level: 'weak', why: '타사·원료·설명 문맥으로 보임' };
  if (OWN_CUES.test(t)) return { level: 'own', why: null };
  return { level: 'mention', why: '보유를 뜻하는 표현 없이 언급만 확인' };
}

const CERT_PATTERNS = [
  // ── 제조·품질 시스템 ──
  { label: 'CGMP (우수화장품제조)', grp: '제조품질', re: /\bCGMP\b|우수화장품\s*제조|우수화장품\s*및\s*품질관리/i },
  { label: 'ISO 22716 (화장품GMP)', grp: '제조품질', re: /ISO\s*22716/i },
  { label: 'ISO 9001 (품질경영)', grp: '제조품질', re: /ISO\s*9001/i },
  { label: 'ISO 14001 (환경경영)', grp: '제조품질', re: /ISO\s*14001/i },
  { label: 'ISO 45001 (안전보건)', grp: '제조품질', re: /ISO\s*45001/i },
  { label: 'ISO 13485 (의료기기)', grp: '제조품질', re: /ISO\s*13485/i },
  { label: 'ISO 22000/HACCP (식품안전)', grp: '제조품질', re: /ISO\s*22000|HACCP|해썹/i },
  { label: 'ISO 27001 (정보보안)', grp: '제조품질', re: /ISO\s*27001/i },
  { label: '의약외품 제조업 허가', grp: '제조품질', re: /의약외품\s*(제조업)?\s*(허가|신고|등록)/i },
  // ── 국가·지역 규제 ──
  { label: 'MoCRA (미국 화장품규제현대화법)', grp: '국가규제', re: /\bMoCRA\b|모크라|화장품\s*규제\s*현대화|Modernization\s*of\s*Cosmetics\s*Regulation/i },
  { label: '미국 FDA 등록', grp: '국가규제', re: /\bFDA\b\s*(등록|registration|승인|인증)?|FDA\s*시설\s*등록/i },
  { label: '중국 NMPA(위생허가)', grp: '국가규제', re: /\bNMPA\b|\bCFDA\b|위생허가|중국\s*수출\s*허가/i },
  { label: 'EU CPNP 등록', grp: '국가규제', re: /\bCPNP\b|유럽\s*화장품\s*등록|EU\s*화장품\s*규정|1223\/2009/i },
  { label: '일본 후생노동성 허가', grp: '국가규제', re: /후생노동성|厚生労働省|일본\s*제조판매업/i },
  { label: 'ASEAN/기타 수출 인증', grp: '국가규제', re: /ASEAN\s*화장품|아세안\s*인증|BPOM|FDA\s*필리핀/i },
  // ── 친환경·윤리·원료 ──
  { label: '할랄(HALAL)', grp: '친환경·윤리', re: /할랄|HALAL|JAKIM|\bMUI\b|KMF\s*할랄/i },
  { label: '비건(VEGAN)', grp: '친환경·윤리', re: /비건|VEGAN|EVE\s*VEGAN|비건표준인증원/i },
  { label: '코셔(KOSHER)', grp: '친환경·윤리', re: /코셔|KOSHER/i },
  { label: 'ECOCERT/COSMOS(유기농)', grp: '친환경·윤리', re: /ECOCERT|COSMOS|유기농\s*인증|NATRUE/i },
  { label: '크루얼티프리(무동물실험)', grp: '친환경·윤리', re: /cruelty[\s-]*free|크루얼티\s*프리|leaping\s*bunny|무동물실험/i },
  { label: 'RSPO(지속가능 팜오일)', grp: '친환경·윤리', re: /\bRSPO\b|지속가능\s*팜/i },
  { label: 'EWG 그린등급', grp: '친환경·윤리', re: /\bEWG\b/i },
  { label: '친환경·저탄소 인증', grp: '친환경·윤리', re: /친환경\s*인증|탄소\s*(중립|발자국)\s*인증|녹색기업|환경표지/i },
  // ── 시험·평가 ──
  { label: '더마테스트', grp: '시험·평가', re: /dermatest|더마테스트/i },
  { label: '피부 저자극 테스트', grp: '시험·평가', re: /피부\s*저?\s*자극\s*(테스트|시험)|첩포\s*시험|patch\s*test/i },
  { label: '인체적용시험(임상)', grp: '시험·평가', re: /인체\s*적용\s*시험|임상\s*시험|효능\s*평가/i },
  { label: '기능성화장품 심사·보고', grp: '시험·평가', re: /기능성화장품\s*(심사|보고|인정)/i },
  // ── 기업 인증 ──
  { label: '특허 보유', grp: '기업인증', re: /특허\s*(제?\s*[\d\-]+\s*호|출원|등록|보유)/i },
  { label: '벤처기업·이노비즈·메인비즈', grp: '기업인증', re: /벤처기업\s*인증|이노비즈|INNO-?BIZ|메인비즈|MAIN-?BIZ/i },
  { label: '기업부설연구소 인정', grp: '기업인증', re: /기업부설연구소\s*(인정|설립|등록)/i },
  { label: '수출유망중소기업·글로벌강소', grp: '기업인증', re: /수출유망중소기업|글로벌\s*강소기업|월드클래스/i },
];
// 동일 도메인 링크 추출 (서브페이지 탐색용)
// <a> 외에 프레임셋(<frame>/<iframe>)과 JS 내비게이션(location.href='...')까지 본다.
// 구형 국내 사이트는 본문이 프레임 안에 있어 <a>만 보면 링크가 0개로 나온다.
function extractLinks(html, baseUrl) {
  let origin = ''; try { origin = new URL(baseUrl).origin; } catch { return []; }
  const out = []; const seen = new Set();
  const add = (href, anchor) => {
    if (!href || out.length >= 80) return;
    let abs; try { abs = new URL(href, baseUrl).href; } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    try { if (new URL(abs).origin !== origin) return; } catch { return; }
    const key = abs.replace(/#.*$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ href: abs, anchor: anchor || '' });
  };
  let m;
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(html))) add(m[1], htmlToText(m[2]));
  // 프레임/아이프레임 — 실제 본문이 여기 있는 경우가 많아 앵커 텍스트가 없어도 반드시 포함
  const fRe = /<(?:frame|iframe)\b[^>]*\bsrc\s*=\s*["']([^"'#\s]+)["']/gi;
  while ((m = fRe.exec(html))) add(m[1], '프레임 본문');
  // JS 이동 경로 — 메뉴가 스크립트로 구현된 사이트 대응
  const jRe = /(?:location\.href|location\.replace|window\.open)\s*\(?\s*=?\s*["']([^"'#\s]+\.(?:html?|php|asp|jsp))["']/gi;
  while ((m = jRe.exec(html))) add(m[1], '');
  return out;
}
// 생산능력 관련 문장 발췌 (키워드 + 숫자가 함께 있는 짧은 구절)
function extractCapaSnippets(text) {
  const parts = String(text).split(/\n+|[.。!?]\s|\s{3,}/).map((s) => s.trim()).filter(Boolean);
  // '평'을 맨글자로 두면 '구매평'이 면적 단위로 잡힌다. 씨앤티드림 조회에서 생산능력 6줄이
  // 전부 네이버 페이 구매평이었다("씌우기 너무 어려웠지만 바꿔서 좋아요"). 면적의 '평'은
  // 반드시 숫자 뒤에 온다 — 3,000평. 숫자를 앞에 붙여 단위일 때만 인정한다.
  const KEY = /(생산\s*능력|생산량|월\s*생산|연간?\s*생산|일\s*생산|생산\s*라인|자동화\s*라인|충전\s*라인|생산\s*설비|생산\s*시설|공장\s*면적|연면적|부지|대지\s*면적|생산\s*규모|생산\s*capa|capacity|[\d,]\s*(?:㎡|평)\b)/i;
  // 쇼핑몰 홈페이지는 구매평·배송안내가 본문의 대부분이다. 숫자가 있다고 생산능력이 아니다.
  const NOISE = /(구매평|구매\s*후기|사용\s*후기|상품\s*평|리뷰|평점|별점|배송|반품|교환|환불|적립금|쿠폰|장바구니|주문|결제|회원|로그인|문의|댓글|공지사항|이벤트)/;
  const NUM = /\d/;
  const out = [];
  for (const p of parts) {
    if (p.length < 5 || p.length > 140) continue;
    if (NOISE.test(p)) continue;
    if (/\d{4}[-.]\d{2}[-.]\d{2}\s+\d{2}:\d{2}/.test(p)) continue;   // 작성일시가 박힌 줄 = 게시물
    if (KEY.test(p) && NUM.test(p)) { const s = p.replace(/\s{2,}/g, ' ').trim(); if (!out.includes(s)) out.push(s); }
    if (out.length >= 6) break;
  }
  return out;
}
// 확정 홈페이지에서 인증·생산능력 추출 (메인 + 관련 서브페이지 최대 2개)
async function extractSiteInfo(baseUrl, mainHtml) {
  let html = mainHtml;
  if (!html) { const g = await fetchPageSmart(baseUrl); html = g.html; if (g.url) baseUrl = g.url; }
  if (!html) return null;
  const texts = [htmlToText(html)]; const pages = [baseUrl];
  const REL = /(인증|certif|품질|quality|생산|시설|facilit|공장|factory|설비|장비|회사\s*소개|about|company|연구|R&?D|사업|business)/i;
  const seen = new Set([baseUrl.replace(/\/+$/, '')]); const targets = [];
  for (const l of extractLinks(html, baseUrl)) {
    const key = l.href.replace(/\/+$/, ''); if (seen.has(key)) continue;
    if (REL.test(l.anchor) || REL.test(l.href)) { targets.push(l.href); seen.add(key); }
    if (targets.length >= 2) break;
  }
  const subs = await Promise.all(targets.map((u) =>
    proxyOnlyGet('fetchPage', { url: u }).then((p) => ({ u, t: htmlToText((p && p.text) || '') })).catch(() => null)));
  subs.forEach((s) => { if (s && s.t) { texts.push(s.t); pages.push(s.u); } });
  const all = texts.join('\n').slice(0, 400000);
  const certs = CERT_PATTERNS.filter((c) => c.re.test(all)).map((c) => c.label);
  const capa = extractCapaSnippets(all);
  const oem = ['OEM', 'ODM', 'OGM', 'OBM'].filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(all));
  return (certs.length || capa.length || oem.length) ? { certs, capa, oemOdm: oem, pages } : null;
}

// ── 페이지 가져오기(스킴·www 변형 폴백) ──
// 국내 중소 제조사 홈페이지는 http 전용이거나 www 전용인 경우가 흔하다.
// 한 형태만 시도하면(예: https + www제거) 멀쩡한 사이트도 전부 실패하므로 변형을 순차 시도한다.
function urlVariants(u) {
  const out = []; const seen = new Set();
  const push = (s) => { if (s && !seen.has(s)) { seen.add(s); out.push(s); } };
  let p;
  try { p = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`); } catch { return [String(u)]; }
  const bare = p.hostname.replace(/^www\./, '');
  const rest = (p.pathname || '/') + (p.search || '');
  push(p.href);                                   // 사용자가 준 원본 우선
  push(`https://www.${bare}${rest}`);
  push(`http://www.${bare}${rest}`);
  push(`http://${bare}${rest}`);
  return out.slice(0, 4);
}
// 변형을 시도해 '내용이 있는' 첫 응답을 채택. 실제 도달 주소도 함께 반환.
async function fetchPageSmart(url) {
  let lastErr = null, thin = null;
  for (const u of urlVariants(url)) {
    let p;
    try { p = await proxyOnlyGet('fetchPage', { url: u }); }
    catch (e) { lastErr = e && e.message ? e.message : String(e); continue; }
    const html = String((p && p.text) || '');
    if (html.replace(/\s/g, '').length > 200) return { html, url: (p && p.url) || u };
    if (html && !thin) thin = { html, url: (p && p.url) || u }; // 빈약해도 최후 후보로 보관
  }
  if (thin) return thin;
  return { html: '', url, err: lastErr || '응답 없음' };
}

// ── 홈페이지 심층분석: 키워드 휴리스틱(무료·API키 불필요) ──
// 홈페이지 유형(정적 HTML / 자바스크립트 SPA / 이미지 위주)에 상관없이 최대한 텍스트를 확보한다.
//  ① 본문 텍스트  ② meta(description·keywords·og)  ③ 임베드 JSON(__NEXT_DATA__·JSON-LD 등 SPA 대응)
//  ④ 이미지 alt·파일명·title/aria-label(그림으로 된 사이트 대응)  ⑤ noscript  ⑥ 링크 앵커(메뉴)
function metaTexts(html) {
  const out = []; const re = /<meta\b[^>]*>/gi; let m;
  while ((m = re.exec(html)) && out.length < 40) {
    const tag = m[0];
    const name = ((tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
    const content = ((tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim();
    if (!content || content.length > 400) continue;
    if (/description|keywords|og:|twitter:|subject|author|classification/i.test(name)) out.push(content);
  }
  const t = (html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1];
  if (t) out.unshift(htmlToText(t));
  return out;
}
// SPA(리액트/뷰/넥스트 등)는 본문이 JS 안에 있어 HTML 텍스트가 비어 보인다 → 임베드 JSON에서 문자열 회수
function embeddedJsonTexts(html) {
  const blobs = [];
  const ld = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = ld.exec(html)) && blobs.length < 6) blobs.push(m[1]);
  const nextD = html.match(/<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextD) blobs.push(nextD[1]);
  const stateRe = /window\.__(?:NUXT|INITIAL_STATE|PRELOADED_STATE|APOLLO_STATE|INITIAL_DATA)__\s*=\s*([\s\S]{0,200000}?)(?:;\s*(?:<\/script>|window\.)|<\/script>)/gi;
  while ((m = stateRe.exec(html)) && blobs.length < 10) blobs.push(m[1]);
  const out = [];
  for (const b of blobs) {
    // JSON 파싱 대신 문자열 리터럴만 회수(형식이 깨져 있어도 안전)
    const sre = /"((?:[^"\\]|\\.){2,300})"/g; let s;
    while ((s = sre.exec(b)) && out.length < 600) {
      let v = s[1];
      if (/^(https?:|\/|#|[a-f0-9]{16,}$)/i.test(v)) continue;      // URL·해시 제외
      if (!/[가-힣]|[A-Za-z]{3,}/.test(v)) continue;                 // 의미 없는 토큰 제외
      // 짧은 영문은 대개 JSON 키 이름이라 제외하되, 대문자 약어(CGMP·ISO·OEM 등)는 인증/사업유형 단서라 보존
      if (/^[a-z0-9_\-.]+$/.test(v) && v.length < 6) continue;
      v = v.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
           .replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\//g, '/').trim();
      if (v.length >= 2) out.push(v);
    }
  }
  return out;
}
// 이미지로 내용을 채운 사이트 — alt·파일명·title/aria-label에서 단서 회수
function imageAndAttrTexts(html) {
  const out = [];
  const imgRe = /<img\b[^>]*>/gi; let m;
  while ((m = imgRe.exec(html)) && out.length < 300) {
    const tag = m[0];
    const alt = ((tag.match(/\balt\s*=\s*["']([^"']+)["']/i) || [])[1] || '').trim();
    if (alt && alt.length <= 120) out.push(alt);
    const src = ((tag.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
    if (src) {
      let base = src.split(/[?#]/)[0].split('/').pop() || '';
      try { base = decodeURIComponent(base); } catch { /* 인코딩 아님 */ }
      const nm = base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-+%]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      // 파일명이 의미를 담은 경우만(한글 또는 3자 이상 영단어), 해시/일련번호 제외
      if (nm && nm.length <= 60 && /[가-힣]|[A-Za-z]{3,}/.test(nm) && !/^[0-9a-f]{8,}$/i.test(nm)) out.push(nm);
    }
  }
  const attrRe = /\b(?:title|aria-label|data-title)\s*=\s*["']([^"']{2,120})["']/gi;
  while ((m = attrRe.exec(html)) && out.length < 450) { const v = m[1].trim(); if (/[가-힣]|[A-Za-z]{3,}/.test(v)) out.push(v); }
  const nsRe = /<noscript[^>]*>([\s\S]*?)<\/noscript>/gi;
  while ((m = nsRe.exec(html))) { const v = htmlToText(m[1]); if (v) out.push(v); }
  return out;
}
// 한 페이지에서 모든 전략으로 텍스트 확보 → {text, richness}
function harvestFromHtml(html, baseUrl) {
  const body = htmlToText(html);
  const parts = [body];
  parts.push(metaTexts(html).join('\n'));
  parts.push(embeddedJsonTexts(html).join('\n'));
  parts.push(imageAndAttrTexts(html).join('\n'));
  if (baseUrl) parts.push(extractLinks(html, baseUrl).map((l) => l.anchor).filter(Boolean).join(' '));
  const text = parts.filter(Boolean).join('\n');
  return { text, bodyLen: body.length, totalLen: text.length };
}
async function gatherSiteText(baseUrl, companyName, seedUrls) {
  const got = await fetchPageSmart(baseUrl);
  const html = got.html;
  if (!html) return null;
  baseUrl = got.url || baseUrl;                 // 실제로 열린 주소 기준으로 링크 해석
  const first = harvestFromHtml(html, baseUrl);
  const texts = [first.text]; const pages = [baseUrl];
  // 관련 페이지 우선순위 — 설비·인증·시설 페이지가 뒤로 밀려 수집에서 빠지는 일이 있었다.
  // (유스케어팜: 회사소개 계열 6개만 받고 제품·기술 페이지를 놓쳤다)
  const REL_TIERS = [
    [3, /(설비|장비|equip|시설|facilit|공장|factory|생산|production|제조|manufactur|라인|클린룸)/i],
    [3, /(인증|certif|품질|quality|GMP|ISO|허가|특허|patent)/i],
    [2, /(제품|product|브랜드|brand|품목|라인업|item)/i],
    [2, /(회사\s*소개|about|company|기업|연혁|history|overview|비전)/i],
    [1, /(연구|R&?D|기술|tech|사업|business|수출|export|글로벌|global)/i],
    [1, /(오시는|contact|location|찾아|고객)/i],
  ];
  const relRank = (str) => { for (const [w, re] of REL_TIERS) if (re.test(str)) return w; return 0; };
  const seen = new Set([baseUrl.replace(/\/+$/, '')]); let targets = [];
  const scored = [];
  for (const l of extractLinks(html, baseUrl)) {
    const key = l.href.replace(/\/+$/, ''); if (seen.has(key)) continue;
    // 프레임 본문은 주제어와 무관해도 반드시 포함(구형 프레임셋 사이트의 실제 내용)
    if (l.anchor === '프레임 본문') { targets.push(l.href); seen.add(key); continue; }
    const w = Math.max(relRank(l.anchor || ''), relRank(l.href || ''));
    // 게시판 글 하나하나는 보도자료라 사실 추출에 해로우면서 수집 칸만 잡아먹는다 — 목록만 허용
    if (w && !/wr_id=|\bidx=|articleView|view\.php\?/i.test(l.href)) scored.push({ href: l.href, key, w });
  }
  scored.sort((a, b) => b.w - a.w);
  for (const c of scored) { if (seen.has(c.key)) continue; seen.add(c.key); targets.push(c.href); if (targets.length >= 14) break; }
  // ★ 검색결과가 알려준 실제 내용 페이지를 최우선으로 넣는다.
  //   (예: 루트는 프레임셋인데 검색결과는 /about/intro.html 을 가리키는 경우 — 추측 경로보다 확실)
  for (const sd of (seedUrls || [])) {
    try {
      const u = new URL(sd, baseUrl).href;
      const key = u.replace(/\/+$/, '');
      if (!seen.has(key)) { targets.unshift(u); seen.add(key); }
    } catch { /* 무시 */ }
  }
  // 그래도 본문이 빈약하면 흔한 회사소개 경로를 추측해 추가 시도
  if (first.bodyLen < 400 && targets.length < 4) {
    for (const p of ['/about', '/company', '/sub/company', '/company.html', '/about.html', '/introduce', '/kr/company']) {
      try { const u = new URL(p, baseUrl).href; if (!seen.has(u.replace(/\/+$/, ''))) { targets.push(u); seen.add(u.replace(/\/+$/, '')); } } catch { /* 무시 */ }
      if (targets.length >= 6) break;
    }
  }
  targets = targets.slice(0, 14);   // 회사소개 계열만 받고 설비·제품 페이지를 놓치던 문제
  const rawHtmls = [html];
  const subs = await Promise.all(targets.map((u) =>
    proxyOnlyGet('fetchPage', { url: u }).then((p) => ({ u, h: (p && p.text) || '' })).catch(() => null)));
  subs.forEach((s) => {
    if (s && s.h) { const r = harvestFromHtml(s.h, s.u); if (r.text) { texts.push(r.text); pages.push(s.u); rawHtmls.push(s.h); } }
  });

  const homeText = texts.join('\n');
  // ★ 홈페이지 본문과 웹 검색 텍스트는 절대 합치지 않는다.
  //   합치면 집계사이트·채용공고·'다른 회사' 스니펫이 인증·주소·사업장 같은 사실 항목을 오염시킨다.
  //   검색 보완분은 keywords 용도로만, 그것도 상호가 실제 포함된 스니펫만 사용한다.
  let webText = '';
  if (homeText.replace(/\s/g, '').length < 300 && companyName) {
    try {
      const w = await proxyOnlyGet('naverWeb', { query: `${companyName} 화장품 제조`, display: '25' });
      const key = stripCorp(companyName).replace(/\s/g, '');
      webText = ((w && w.items) || [])
        .map((it) => `${String(it.title || '')} ${String(it.description || '')}`.replace(/<\/?b>/g, ''))
        .filter((s) => key.length < 2 || s.replace(/\s/g, '').includes(key)) // 타사 스니펫 배제
        .join('\n');
    } catch { /* 검색 실패 무시 */ }
  }
  return {
    text: homeText.slice(0, 500000),          // 사실 추출용 = 홈페이지 본문만
    webText: webText.slice(0, 100000),        // 참고용(키워드 전용)
    pages, webFallback: !!webText, thin: first.bodyLen < 400,
    html: rawHtmls.join('\n').slice(0, 600000), // 설비 추정용 원본(이미지 태그 분석)
    resolvedUrl: baseUrl,
  };
}

// ── 키워드 추출 — 사이트 유형과 무관하게 확보된 텍스트에서 빈도 기반 핵심어 도출 ──
const KW_STOP = new Set((
  '그리고 그러나 하지만 또한 위해 통해 대한 대하여 있는 있습니다 합니다 입니다 등의 등을 이나 에서 으로 하는 하여 되는 된다 같은 경우 ' +
  '우리 저희 고객 회사 기업 홈페이지 사이트 페이지 메뉴 바로가기 더보기 전체 목록 검색 로그인 회원가입 이용약관 개인정보 처리방침 ' +
  '저작권 무단 전재 재배포 금지 서울 경기 문의 상담 안내 소개 정보 관련 다양한 최고 최상 다음 이전 확인 신청 접수 오시는길 찾아오시는 ' +
  '사업자등록번호 대표이사 개인정보처리방침 이메일무단수집거부 거치고 이곳 여기 각종 통한 위한 모든 하나 함께 이상 이하 ' +
  // 채용공고·집계사이트 스니펫에서 흔한 잡음(회사 자체 정보가 아님)
  '기업정보 직원수 채용 년차 근무환경 복리후생 연봉 급여 신입 경력 채용정보 구인 지원자격 우대사항 마감일 모집 ' +
  '자동등록방지 보안절차 자바스크립트 브라우저 로딩 팝업 닫기 이메일 팩스 전화번호 대표번호 상호명 업태 종목 ' +
  '공장찾기 위세브 기업분석 재무정보 신용등급 매출액순위 공고 채용공고 ' +
  // 집계사이트 요약표의 '항목명'들 — 회사 고유 정보가 아니라 표 라벨이라 키워드로서 무의미
  '사원수 기업구분 자본금 억원 백만원 천원 주요사업 매출액 영업이익 당기순이익 총자산 총부채 설립일 대표자명 ' +
  // 자바스크립트 차단·로봇검증 안내문에 흔한 영단어(사이트 내용이 아님)
  'please prove human enable javascript browser verify checking security connection redirect ' +
  'All Rights Reserved Copyright the and for with our your this that from are was has have not you all can more ' +
  'about home page site menu login search contact info news event list view detail'
).split(/\s+/));
function extractKeywords(text, limit = 24) {
  const counts = new Map();
  const bump = (w, n = 1) => counts.set(w, (counts.get(w) || 0) + n);
  // 한국어는 조사가 붙어 같은 말이 다르게 세어지므로(예: 유화탱크/유화탱크를) 흔한 조사를 떼고 집계
  const JOSA = /(으로써|으로서|에서는|에게서|이라고|라고는|으로|에서|에게|부터|까지|보다|처럼|만큼|과의|와의|의|를|을|은|는|이|가|도|와|과|에|로|년|월|일)$/;
  const ko = String(text).match(/[가-힣]{2,12}/g) || [];
  for (const raw of ko) {
    let w = raw;
    const cut = w.replace(JOSA, '');
    if (cut.length >= 2) w = cut;                 // 떼고도 2자 이상일 때만 적용
    if (w.length < 2 || KW_STOP.has(w)) continue;
    bump(w);
  }
  const en = String(text).match(/[A-Za-z][A-Za-z0-9+#&.-]{2,20}/g) || [];
  for (const raw of en) {
    const w = raw.replace(/[.\-]+$/, '');
    if (w.length < 3 || KW_STOP.has(w) || KW_STOP.has(w.toLowerCase())) continue;
    bump(/^[A-Z0-9+#&-]+$/.test(w) ? w : w.toLowerCase());
  }
  // 도메인 관련어 가중치 — 화장품 제조 문맥에서 의미 있는 단어를 위로
  const BOOST = /(화장품|제조|생산|공장|설비|라인|충전|유화|품질|인증|연구|개발|처방|원료|용기|포장|수출|납품|브랜드|기능성|스킨|크림|세럼|앰플|마스크|선크림|클렌징|샴푸|바디|헤어|OEM|ODM|GMP|ISO|비건|할랄|특허|클린룸|무균|안정성|시험)/i;
  const arr = [...counts.entries()]
    .map(([w, c]) => [w, c * (BOOST.test(w) ? 3 : 1)])
    .filter(([w, c]) => c >= 2 || BOOST.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w, c]) => ({ word: w, score: c }));
  return arr;
}
// 문장 단위로 키워드 포함 짧은 구절 발췌
function pickSentences(text, re, { min = 4, max = 130, cap = 5 } = {}) {
  const parts = String(text).split(/\n+|[.。!?]\s|\s{3,}/).map((s) => s.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length < min || p.length > max) continue;
    if (re.test(p) && !out.includes(p)) out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}
const PROD_CATS = [
  ['기초/스킨케어', /기초화장품|스킨케어|skin\s*care|토너|에센스|세럼|앰플|크림|로션|essence|serum/i],
  ['색조/메이크업', /색조|메이크업|make\s*up|파운데이션|쿠션|립스틱|틴트|아이섀도|마스카라/i],
  ['마스크팩', /마스크팩|시트마스크|마스크\s*시트|sheet\s*mask|팩\b/i],
  ['선케어', /선케어|선크림|자외선\s*차단|sun\s*(care|screen|block)|SPF/i],
  ['클렌징', /클렌징|cleansing|폼클렌|클렌저|세안/i],
  ['헤어', /헤어|샴푸|hair|린스|트리트먼트|두피/i],
  ['바디', /바디\s*(케어|로션|워시)|body\s*(care|wash|lotion)/i],
  ['기능성화장품', /기능성화장품|미백|주름개선|안티에이징|anti[-\s]*aging/i],
  ['더모/코스메슈티컬', /더모코스메틱|코스메슈티컬|cosmeceutical|dermo/i],
  ['향수/방향', /향수|퍼퓸|fragrance|perfume|디퓨저/i],
];
const EXPORT_MKTS = ['미국', '중국', '일본', '베트남', '태국', '인도네시아', '말레이시아', '필리핀', '싱가포르', '대만', '홍콩', '러시아', '유럽', '독일', '프랑스', '영국', '캐나다', '호주', '인도', '중동', 'UAE', '사우디', '브라질', '멕시코'];
const EQUIP_RE = /(충전\s*(기|라인)|튜브\s*충전|파우치\s*충전|제조\s*(기|탱크)|유화\s*(기|탱크)|호모\s*믹서|homogen|디스퍼|반응기|믹싱\s*탱크|포장\s*라인|카톤|라벨러|클린\s*룸|clean\s*room|자동화\s*라인|생산\s*라인\s*\d)/i;
// ═══ 생산설비 추정 (OCR 대체) ═══
// 이미지 안의 글자는 읽을 수 없으므로, 설비 사진의 파일명·alt·주변 문구를 설비 지식베이스와
// 대조해 '어떤 설비로 보이는지'를 추정한다. 반드시 [추정]으로 표기하고 근거를 함께 남긴다.
// 가마(제조·유화 탱크) 제조사 — 사용자가 지정한 업체를 우선 수록. 필요 시 이 배열만 늘리면 된다.
const EQUIP_VENDORS = [
  { name: '선진', re: /선진(?:기계|테크|엔지니어링|이엔지|테크놀로지)?/ },
  { name: '우원', re: /우원(?:기계|테크|산업|이엔지)?/ },
];
// 설비 유형 — 본문 문구(text)와 이미지 단서(asset: 파일명/alt)를 각각 매칭
const EQUIP_TYPES = [
  { label: '제조·유화 가마(탱크)', text: /(가마|제조\s*탱크|유화\s*(기|탱크|가마)|진공\s*유화|emulsif|호모\s*믹서|homo\s*mixer)/i,
    asset: /(가마|gama|kama|유화|emul|탱크|tank|호모|homo|믹서|mixer|반응기|reactor)/i },
  { label: '충전기(필링)', text: /(충전\s*(기|라인)|튜브\s*충전|파우치\s*충전|로터리\s*충전|filling|filler)/i,
    asset: /(충전|filling|filler|튜브|tube|파우치|pouch|노즐|nozzle)/i },
  { label: '포장·라벨 설비', text: /(포장\s*(기|라인)|라벨(러|링)?|카톤|실링\s*기|packing|labeler|carton|sealing)/i,
    asset: /(포장|packing|package|라벨|label|카톤|carton|실링|sealing)/i },
  { label: '교반·분산기(아지·디스퍼)', text: /(아지\s*믹서|디스퍼|disper|agitator|교반기|패들\s*믹서)/i,
    asset: /(아지|agi|디스퍼|disper|교반|stir|paddle)/i },
  { label: '클린룸·공조', text: /(클린\s*룸|clean\s*room|무진실|공조\s*설비|헤파|HEPA)/i,
    asset: /(클린룸|cleanroom|clean_room|무진|hepa|공조)/i },
  { label: '시험·품질 설비', text: /(항온\s*(조|항습)|점도계|경도계|입도\s*분석|시험\s*실|실험실|분석\s*장비)/i,
    asset: /(시험|실험|lab|검사|inspect|분석|analy|현미경|micro)/i },
  { label: '보관·물류(창고)', text: /(자동\s*창고|물류\s*센터|원료\s*창고|보관\s*시설|팔레트)/i,
    asset: /(창고|warehouse|물류|logis|보관|storage)/i },
];
// ── 화장품 충전·포장 설비 사전 (설비 탭) ──
// grp: 충전 / 제조 / 포장 / 부대. text=본문 문구, asset=이미지 파일명·alt 단서
const FILL_EQUIP = [
  // ── 충전 설비(제형·용기 형태별) ──
  { label: '튜브 충전기', grp: '충전', text: /튜브\s*(충전|필링|성형)|tube\s*fill/i, asset: /튜브|tube/i },
  { label: '용기(보틀) 충전기', grp: '충전', text: /(용기|보틀|병)\s*(충전|필링)|bottle\s*fill/i, asset: /보틀|bottle|용기/i },
  { label: '멀티 충전기', grp: '충전', text: /멀티\s*(충전|필러|라인)|multi\s*fill/i, asset: /멀티|multi/i },
  { label: '멀티셀 충전기', grp: '충전', text: /멀티\s*셀|multi\s*cell/i, asset: /멀티셀|multicell|multi_cell/i },
  { label: '단발(단발기) 충전', grp: '충전', text: /단발\s*(기|충전|라인)?/i, asset: /단발|danbal/i },
  { label: '대용량 충전기', grp: '충전', text: /대용량\s*(충전|필링|라인|생산)/i, asset: /대용량|large|bulk/i },
  { label: '마스크팩 충전기', grp: '충전', text: /마스크\s*(팩)?\s*(충전|자동|라인|성형)|시트\s*마스크\s*충전/i, asset: /마스크|mask/i },
  { label: '파우치 충전기', grp: '충전', text: /파우치\s*(충전|필링|성형)|pouch\s*fill|스파우트/i, asset: /파우치|pouch|스파우트|spout/i },
  { label: '앰플·바이알 충전기', grp: '충전', text: /(앰플|앰퓰|바이알)\s*(충전|필링)?/i, asset: /앰플|ampoule|ampul|vial/i },
  { label: '스틱 충전기', grp: '충전', text: /스틱\s*(충전|필링|포장)|stick\s*fill/i, asset: /스틱|stick/i },
  { label: '스파우트·젤리스틱', grp: '충전', text: /젤리\s*스틱|스틱\s*파우치/i, asset: /jelly|젤리/i },
  { label: '에어리스·펌프 충전', grp: '충전', text: /에어리스|airless|펌프\s*(용기|충전)/i, asset: /airless|에어리스|pump/i },
  { label: '스프레이·에어졸 충전', grp: '충전', text: /(스프레이|에어졸|에어로졸)\s*(충전|라인)?/i, asset: /스프레이|spray|aerosol/i },
  { label: '쿠션·콤팩트 충전', grp: '충전', text: /(쿠션|콤팩트|팩트)\s*(충전|성형|라인)?/i, asset: /쿠션|cushion|compact/i },
  { label: '립스틱·성형 충전', grp: '충전', text: /(립스틱|립밤)\s*(성형|충전|몰딩)?/i, asset: /립스틱|lipstick|lipbalm/i },
  { label: '자동·로터리 충전 라인', grp: '충전', text: /(자동|로터리|인라인|직선식)\s*충전\s*(기|라인)?/i, asset: /rotary|auto.?fill|로터리/i },
  { label: '반자동 충전기', grp: '충전', text: /반자동\s*(충전|필링)/i, asset: /반자동|semi.?auto/i },
  // ── 제조(벌크) 설비 ──
  { label: '제조·유화 가마(탱크)', grp: '제조', text: /(가마|제조\s*탱크|유화\s*(기|탱크|가마)|진공\s*유화|emulsif)/i, asset: /가마|gama|kama|유화|emul|탱크|tank/i },
  { label: '호모믹서·디스퍼', grp: '제조', text: /(호모\s*믹서|homo\s*mixer|디스퍼|disper|아지\s*믹서|교반기)/i, asset: /호모|homo|디스퍼|disper|아지|agi/i },
  { label: '숙성·저장 탱크', grp: '제조', text: /(숙성\s*탱크|저장\s*탱크|보관\s*탱크|holding\s*tank)/i, asset: /숙성|storage.?tank/i },
  { label: '칭량·원료 계량', grp: '제조', text: /(칭량|원료\s*계량|평량)\s*(실|시스템)?/i, asset: /칭량|weighing/i },
  // ── 포장 설비 ──
  { label: '실링·캡핑기', grp: '포장', text: /(실링|씰링|캡핑|캡\s*체결)\s*(기|라인)?|sealing|capping/i, asset: /실링|sealing|캡핑|capping/i },
  { label: '라벨러·인쇄', grp: '포장', text: /(라벨(러|링)?|레이저\s*인쇄|각인)\s*(기|라인)?|labeler/i, asset: /라벨|label/i },
  { label: '카톤·박스 포장기', grp: '포장', text: /(카톤|단상자|박스)\s*(포장|삽입)?\s*(기|라인)?|carton/i, asset: /카톤|carton|박스|box/i },
  { label: '수축포장·쉬링크', grp: '포장', text: /(수축\s*포장|쉬링크|shrink)/i, asset: /shrink|쉬링크/i },
  // ── 부대 설비 ──
  { label: '클린룸·공조', grp: '부대', text: /(클린\s*룸|clean\s*room|무진실|공조\s*설비|헤파|HEPA)/i, asset: /클린룸|cleanroom|clean_room|hepa/i },
  { label: '정제수 제조(RO)', grp: '부대', text: /(정제수|순수|RO\s*시스템|역삼투)/i, asset: /정제수|purified|ro.?system/i },
  { label: '금속검출·중량선별', grp: '부대', text: /(금속\s*검출|중량\s*선별|checkweigher|metal\s*detect)/i, asset: /금속검출|metal.?detect|checkweigh/i },
  { label: '시험·품질 설비', grp: '부대', text: /(항온\s*(조|항습)|점도계|경도계|입도\s*분석|시험\s*실|실험실|분석\s*장비)/i, asset: /시험|실험|lab|검사|분석|현미경/i },
  { label: '자동창고·물류', grp: '부대', text: /(자동\s*창고|물류\s*센터|원료\s*창고|팔레트)/i, asset: /창고|warehouse|물류|logis/i },
];
// ── 설비/인증 용어 사전(어휘 매칭) ──
// 카테고리 라벨만 보여주면 실제로 무엇이 적혀 있었는지 알 수 없으므로,
// 사이트에 '실제로 표기된 용어'를 그대로 회수해 그룹별로 보여준다.
const EQUIP_LEX = [
  { grp: '제조 설비', re: /(제조탱크|저장탱크|원료탱크|유상용해조|수상용해조|용해조|가온탱크|냉각탱크|교반탱크|아지테이터|아지호모믹서|진공호모믹서|호모믹서|진공유화기|유화기|디스퍼믹서|디스퍼|고속믹서|헨셀믹서|3단\s?롤밀|롤밀|분산기|분쇄기|분말혼합기|파우더압축기|추출기|농축기|초순수제조기|정제수\s?제조설비|정제수\s?제조기|RO\s?설비|UV\s?살균기|필터하우징|CIP\s?세척설비|SIP\s?살균설비|위생용\s?펌프|로브펌프|다이어프램펌프|이송컨베이어|원료칭량대|원료보관랙|검체보관설비|제조용\s?배관|위생배관|가마)/gi },
  { grp: '충전 설비', re: /(액상충전기|스킨충전기|토너충전기|로션충전기|에센스충전기|세럼충전기|크림충전기|연고충전기|겔충전기|점도액충전기|피스톤충전기|서보충전기|중량식충전기|유량식충전기|정량충전기|다열충전기|자동충전기|반자동충전기|튜브충전기|병충전기|자용기충전기|드로퍼충전기|스포이드충전기|에어리스용기충전기|펌프용기충전기|스틱충전기|립밤충전기|립글로스충전기|가온충전기|마스크팩충전기|파우치충전기|샘플충전기|형상파우치충전기|분말충전기|타정기|질소충전설비|다노즐충전기|충전노즐|자동용기공급기|정렬기|세병기|누액검사기|중량검사기|멀티셀|단발기|대용량\s?충전)/gi },
  { grp: '포장 설비', re: /(자동캡핑기|인라인캡핑기|토크캡핑기|펌프캡핑기|스포이드캡핑기|캡핑기|튜브실링기|고주파실링기|초음파실링기|파우치실링기|마스크팩실링기|알루미늄실링기|인덕션실러|열접착기|자동라벨링기|원형라벨러|양면라벨러|수축라벨러|라벨러|로트인쇄기|유통기한인쇄기|잉크젯프린터|레이저마킹기|자동카토너|카토너|박스포장기|케이스포장기|필름포장기|수축포장기|랩핑기|번들포장기|세트포장기|비전검사기|자동검사기|금속검출기|중량선별기|봉함기|테이핑기|박스실러|팔레타이저|로봇패킹|컨베이어|자동이송시스템|바코드검증기|QR코드검증기)/gi },
  { grp: '품질·시험 설비', re: /(pH\s?미터|Brookfield\s?점도계|점도계|비중계|수분측정기|굴절계|색차계|색도계|입도분석기|원심분리기|항온항습기|항온조|안정성시험기|가속시험기|광안정성시험기|동결융해시험기|열충격시험기|미생물시험설비|배양기|무균작업대|클린벤치|오토클레이브|ICP-?MS|HPLC|GC-?MS|\bGC\b|FT-?IR|UV-?VIS|밀봉강도시험기|낙하시험기|인장시험기)/gi },
  { grp: '시설·안전', re: /(클린룸|클린벤치|공조설비|항온항습|국소배기장치|국소배기|집진설비|집진기|방폭설비|방폭인증|폐수처리설비|대기오염방지시설|압력용기\s?검사|소방시설|위험물관리|SUS\s?316L|SUS\s?304|데드레그|클린유틸리티|압축공기\s?품질관리|정제수\s?품질관리|스마트팩토리|\bMES\b|\bERP\b|제조실행시스템)/gi },
];
const CERT_LEX = [
  { grp: '등록·인허가', re: /(화장품제조업\s?등록|화장품책임판매업\s?등록|책임판매관리자|제조관리자|품질관리자|제조소\s?현장심사|GMP\s?적합판정|제조소\s?등록)/gi },
  { grp: '품질시스템', re: /(우수화장품\s?제조\s?및\s?품질관리기준|품질관리시스템|품질경영시스템|환경경영시스템|안전보건경영시스템|제조기록서|품질기록서|원료관리|일탈관리|변경관리|불만처리|회수관리|교육훈련|내부심사|공급업체평가|추적성|교정관리)/gi },
  { grp: '밸리데이션·적격성', re: /(세척밸리데이션|공정밸리데이션|충전밸리데이션|시험법밸리데이션|컴퓨터시스템밸리데이션|밸리데이션|설비적격성평가|적격성평가|\bDQ\b|\bIQ\b|\bOQ\b|\bPQ\b)/gi },
  { grp: '시험·평가 항목', re: /(제품안전성평가|미생물시험|방부력시험|안정성시험|피부자극시험|인체적용시험|기능성화장품\s?심사|기능성화장품\s?보고|표시[·\s]?광고\s?실증|전성분\s?표시|알레르기\s?유발성분\s?표시)/gi },
  { grp: '안전·환경 규제', re: /(산업안전보건법|위험성평가|전기안전|KC\s?인증|전기용품\s?안전인증|화학물질관리|MSDS|폐기물관리|에너지관리|온실가스관리|CE\s?인증|UL\s?인증|ATEX\s?인증)/gi },
];
// 텍스트에서 사전에 실제로 등장한 용어를 그대로 회수(표기 형태 보존, 중복 제거)
function extractLexicon(text, lex) {
  const out = [];
  for (const l of lex) {
    const re = new RegExp(l.re.source, l.re.flags);
    const seen = new Map(); // 소문자 정규화 키 → 원문 표기
    let m;
    while ((m = re.exec(text)) && seen.size < 40) {
      const term = (m[1] || m[0]).replace(/\s+/g, ' ').trim();
      const key = term.toLowerCase().replace(/\s/g, '');
      if (!seen.has(key)) seen.set(key, term);
    }
    if (seen.size) out.push({ grp: l.grp, terms: [...seen.values()] });
  }
  return out;
}

// ── 키워드 카테고리 분류 ──
// 빈도 상위 키워드를 성격별로 묶어 보여준다(평면 나열보다 무엇을 하는 회사인지 빨리 파악).
const KW_CATS = [
  { cat: '설비·시설', re: /(설비|장비|시설|공장|라인|탱크|가마|믹서|유화|충전|포장|캡핑|실링|라벨|클린룸|정제수|컨베이어|기계|자동화|인프라)/ },
  { cat: '인증·품질', re: /(인증|CGMP|GMP|ISO|할랄|HALAL|비건|VEGAN|코셔|MoCRA|FDA|NMPA|CPNP|특허|품질|시험|검사|밸리데이션|적합|기준|관리기준|안전)/i },
  // 짧은 토막(립·팩 등)은 다른 단어에 섞여 오분류되므로(설'립' → 제품) 완전한 형태로만 매칭
  { cat: '제품·제형', re: /(화장품|스킨케어|스킨|토너|로션|에센스|세럼|앰플|크림|마스크팩|시트마스크|마스크|선크림|선케어|클렌징|샴푸|헤어|바디|색조|메이크업|쿠션|립스틱|립밤|립글로스|립틴트|기능성|제형|원료|성분|브랜드|제품)/ },
  { cat: '생산·사업', re: /(제조|생산|OEM|ODM|OBM|위탁|납품|수출|공급|개발|연구|연구소|R&D|처방|물류|가동)/i },
  { cat: '기업정보', re: /(설립|대표|본사|사옥|직원|임직원|중소기업|법인|업종|소재|주소|연혁|비전|경영|서울|부산|인천|대구|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/ },
];
function categorizeKeywords(kws) {
  const buckets = new Map();
  const etc = [];
  for (const k of kws || []) {
    const w = typeof k === 'object' ? k.word : k;
    const hit = KW_CATS.find((c) => c.re.test(String(w)));
    if (hit) { if (!buckets.has(hit.cat)) buckets.set(hit.cat, []); buckets.get(hit.cat).push(k); }
    else etc.push(k);
  }
  const out = KW_CATS.filter((c) => buckets.has(c.cat)).map((c) => ({ cat: c.cat, items: buckets.get(c.cat) }));
  if (etc.length) out.push({ cat: '기타', items: etc });
  return out;
}

// ── 생산 CAPA 추출 (CAPA 탭) ──
// 월/일/연/시간당 생산량, 설비별 수량(라인 수·가마 기수), 규모(면적) 등을 수치와 함께 회수
const CAPA_RULES = [
  // 기간별 생산능력을 먼저 매칭(뒤의 '설비 용량' 규칙이 같은 수치를 가로채지 않도록 순서 중요)
  { kind: '월 생산능력', re: /(?:월\s*(?:간|평균|최대)?\s*(?:생산량|생산능력|생산|capa|캐파)?\s*[:\-]?\s*)([\d,.]+\s*(?:만|억)?\s*(?:개|ea|EA|톤|t\b|kg|L\b|리터|pcs|병|본))/gi },
  { kind: '일 생산능력', re: /(?:(?:1\s*)?일\s*(?:평균|최대)?\s*(?:생산량|생산능력|생산|capa)?\s*[:\-]?\s*)([\d,.]+\s*(?:만|억)?\s*(?:개|ea|EA|톤|t\b|kg|L\b|리터|pcs|병|본))/gi },
  { kind: '연 생산능력', re: /(?:연\s*(?:간|평균|최대)?\s*(?:생산량|생산능력|생산|capa)?\s*[:\-]?\s*)([\d,.]+\s*(?:만|억)?\s*(?:개|ea|EA|톤|t\b|kg|L\b|리터|pcs|병|본))/gi },
  { kind: '시간당 생산능력', re: /([\d,.]+\s*(?:개|ea|EA|pcs|병|본)\s*\/\s*(?:시간|hr|h|분|min))/gi },
  { kind: '시간당 생산능력', re: /(?:시간\s*당|분\s*당|hr당)\s*([\d,.]+\s*(?:만)?\s*(?:개|ea|EA|pcs|병|본))/gi },
  { kind: '설비 용량', re: /([\d,.]+\s*(?:톤|t\b|ton|L\b|리터|kg)\s*(?:짜리|규모|용량)?\s*(?:가마|탱크|유화기|믹서|제조기)?)/gi },
  { kind: '설비 보유 수량', re: /((?:가마|탱크|유화기|충전기|충전\s*라인|생산\s*라인|라인)\s*[\d,.]+\s*(?:기|대|식|개|라인|EA|ea))/gi },
  { kind: '설비 보유 수량', re: /([\d,.]+\s*(?:기|대|식|라인)\s*(?:의\s*)?(?:가마|탱크|유화기|충전기|충전\s*라인|생산\s*라인))/gi },
  { kind: '공장 규모', re: /([\d,.]+\s*(?:㎡|m2|평)\s*(?:규모|부지|대지|연면적|건평)?)/gi },
];
function extractCapa(text) {
  const out = []; const seen = new Set();
  const claimed = []; // 이미 더 구체적인 규칙이 가져간 구간 — 중복 분류 방지("일 생산 12톤"이 설비 용량으로도 잡히는 문제)
  const overlaps = (a, b) => claimed.some(([s, e]) => a < e && b > s);
  for (const r of CAPA_RULES) {
    const re = new RegExp(r.re.source, r.re.flags);
    let m;
    while ((m = re.exec(text)) && out.length < 24) {
      const val = (m[1] || m[0]).replace(/\s{2,}/g, ' ').trim();
      if (!/\d/.test(val)) continue;
      const start = m.index, end = m.index + m[0].length;
      if (overlaps(start, end)) continue;
      const key = `${r.kind}|${val}`;
      if (seen.has(key)) continue;
      seen.add(key); claimed.push([start, end]);
      // 근거 문장(앞뒤 맥락) 확보
      const ctx = text.slice(Math.max(0, start - 45), Math.min(text.length, end + 45))
        .replace(/\s+/g, ' ').trim();
      out.push({ kind: r.kind, value: val, context: ctx });
    }
  }
  return out;
}

// 이미지 태그에서 (파일명, alt) 쌍을 뽑아 설비 사진 후보로 사용
function imageAssets(html) {
  const out = []; const re = /<img\b[^>]*>/gi; let m;
  while ((m = re.exec(html)) && out.length < 400) {
    const tag = m[0];
    const alt = ((tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim();
    let src = ((tag.match(/\b(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
    if (!src && !alt) continue;
    let file = src.split(/[?#]/)[0].split('/').pop() || '';
    try { file = decodeURIComponent(file); } catch { /* 인코딩 아님 */ }
    out.push({ file, alt, src });
  }
  return out;
}
// 설비 추정 — {label, confidence, basis, evidence}
function inferEquipment(html, text) {
  const assets = imageAssets(html || '');
  const T = String(text || '');
  const results = [];
  for (const t of EQUIP_TYPES) {
    const inText = t.text.test(T);
    const hits = assets.filter((a) => t.asset.test(`${a.file} ${a.alt}`)).slice(0, 3);
    if (!inText && !hits.length) continue;
    // 본문에도 있고 사진 단서도 있으면 확실, 하나만 있으면 추정
    const confidence = inText && hits.length ? 'high' : (inText ? 'mid' : 'low');
    const ev = [];
    if (inText) { const s = pickSentences(T, t.text, { cap: 1 }); if (s.length) ev.push(`본문: ${s[0].slice(0, 70)}`); else ev.push('본문에 관련 문구 있음'); }
    hits.forEach((h) => ev.push(`이미지: ${(h.alt || h.file).slice(0, 50)}`));
    results.push({ label: t.label, confidence, basis: inText && hits.length ? '본문+이미지' : (inText ? '본문' : '이미지 파일명/alt'), evidence: ev.slice(0, 3) });
  }
  // 가마 제조사 — 설비 문맥 주변에서만 인정(회사명 오탐 방지)
  const vendorHits = [];
  for (const v of EQUIP_VENDORS) {
    const near = new RegExp(`${v.re.source}[^\\n]{0,30}(가마|탱크|유화|믹서|설비|기계)|(가마|탱크|유화|믹서|설비|기계)[^\\n]{0,30}${v.re.source}`, 'i');
    const inText = near.test(T);
    const inAsset = assets.some((a) => v.re.test(`${a.file} ${a.alt}`));
    if (inText || inAsset) vendorHits.push({ name: v.name, where: inText ? '본문' : '이미지' });
  }
  // 용량 표기(3톤 가마, 500L 등) — 설비 규모 추정 근거
  const capHits = [];
  const capRe = /(\d[\d,.]*)\s*(톤|t\b|ton|L\b|리터|kg)\s*(?:짜리|규모|용량)?\s*(가마|탱크|유화|믹서|제조)?/gi;
  let cm; const seenCap = new Set();
  while ((cm = capRe.exec(T)) && capHits.length < 5) {
    const whole = cm[0].trim();
    if (!cm[3] && !/톤|ton|L|리터/i.test(cm[2])) continue;
    if (seenCap.has(whole)) continue; seenCap.add(whole);
    capHits.push(whole);
  }
  return { items: results, vendors: vendorHits, capacities: capHits, imageCount: assets.length };
}

async function siteDeepHeuristic(name, hpUrl, seeds) {
  let baseUrl = hpUrl;
  const seedList = [...(seeds || [])];
  if (!baseUrl) { // 홈페이지 미확보 시 검색으로 확보 — 확정 실패면 최고점 후보라도 사용
    const hp = await findHomepage(name, {}).catch(() => null);
    const best = hp && Array.isArray(hp.candidates) ? hp.candidates.find((c) => (c.score || 0) >= 2) : null;
    const pickC = (hp && hp.proposed) ? hp.proposed : best;
    baseUrl = pickC ? pickC.url : null;
    // 검색결과가 가리킨 실제 내용 페이지를 씨앗으로 함께 넘김
    if (pickC && pickC.origLink) seedList.push(pickC.origLink);
  }
  if (!baseUrl) return { data: null, source: 'heuristic', reason: '홈페이지 미확보 — 아래에 주소를 직접 입력하면 분석합니다' };
  const g = await gatherSiteText(baseUrl, name, seedList);
  if (!g || !g.text) return { data: null, source: 'heuristic', reason: '페이지를 열 수 없음(주소 오류·접속 차단) — 다른 주소로 다시 시도해 보세요', base: baseUrl };
  const T = g.text;
  const arrOrNull = (a) => (a && a.length ? a : null);
  const business_type = arrOrNull(['OEM', 'ODM', 'OGM', 'OBM'].filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(T)));
  // 인증은 '보유'로 판정된 것만 사실 필드에 넣는다. 언급뿐인 것은 아래 탭에 별도 표시한다.
  const certAll = CERT_PATTERNS.filter((c) => c.re.test(T)).map((c) => {
    const ev = pickSentences(T, c.re, { cap: 1 })[0] || null;
    return { label: c.label, grp: c.grp, evidence: ev ? ev.slice(0, 110) : null, ...certOwnership(ev) };
  });
  const quality_certifications = arrOrNull(certAll.filter((c) => c.level === 'own').map((c) => c.label));
  const product_categories = arrOrNull(PROD_CATS.filter(([, re]) => re.test(T)).map(([l]) => l));
  const export_markets = arrOrNull(EXPORT_MKTS.filter((c) => new RegExp(`수출[^\\n]{0,40}${c}|${c}[^\\n]{0,10}수출|${c}\\s*(진출|법인|현지)`, 'i').test(T) || (/(수출|해외|글로벌|export)/i.test(T) && new RegExp(`\\b${c}\\b`).test(T))));
  // 집계·채용 사이트 문구가 섞여 들어오면 사실이 아닌 문장이 필드에 박히므로 걸러낸다
  const JUNK = /(공장찾기|위세브|기업정보|기업분석|신용등급|매출액순위|채용|구인|연봉|복리후생|근무환경|자동등록방지|보안절차|전화번호정보없음|정보없음|무단수집)/;
  const clean = (arr) => (arr || []).filter((s) => !JUNK.test(s));
  // 문장을 통째로 담으면 보도자료 서술이 설비·생산품으로 둔갑한다(유스케어팜: '가교 히아루론산
  // 제조 기술을 화장품에 적용한…' 문장이 설비로 잡혔다). 실제 설비어가 든 문장만 남긴다.
  const hasEquipTerm = (str) => EQUIP_LEX.some((l) => new RegExp(l.re.source, 'i').test(str));
  const equipment = arrOrNull(clean(pickSentences(T, EQUIP_RE, { cap: 10 })).filter(hasEquipTerm).slice(0, 6));
  const production_items = arrOrNull(clean(pickSentences(T, /(출시|납품|수상|대표\s*제품|주요\s*제품|베스트셀러|히트\s*상품|개발\s*완료|런칭)/i, { cap: 8 }))
    // 제품명·제형이 실제로 들어간 문장만 — 홍보 서술은 제외
    .filter((x) => PROD_CATS.some(([, re]) => re.test(x)) || /(브랜드|제품|라인업|시리즈)/.test(x)).slice(0, 4));
  const production_sites = arrOrNull(clean(pickSentences(T, /(제\s*\d\s*공장|본사\s*공장|생산\s*(공장|사업장|시설)|제조소).{0,60}(시|군|구|도)\b|(경기|서울|인천|부산|대구|충|전|경|강원|제주)[^\n]{0,40}(공장|생산)/, { cap: 3 })));
  const rnd = /(기업부설연구소|부설\s*연구소|R\s*&?\s*D\s*(센터|연구소)|연구개발\s*(센터|본부)|기술연구원)/i.test(T);
  const rnd_centers = rnd ? ['기업부설연구소·R&D 조직 언급(홈페이지 게재)'] : null;
  const capa = extractCapaSnippets(T);
  const notable = arrOrNull([...(capa || []), ...pickSentences(T, /(글로벌\s*브랜드|유명\s*브랜드|대기업\s*납품|OEM\s*파트너|특허\s*\d|수출\s*\d)/i, { cap: 2 })].slice(0, 5));
  // 주소는 도로명+번지에서 끊는다(뒤에 붙는 설명문이 딸려오는 문제 방지: "…59입니다. 화장품제조업")
  //  "남동동로138번길 59" 처럼 번길이 낀 도로명도 끝까지 잡되, 그 뒤 설명문("…입니다. 화장품제조업")은 버린다
  const addrM = T.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{2,40}?(?:로|길)\s?\d+(?:번길\s?\d+)?(?:-\d+)?)/);
  const phoneM = T.match(/(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/);
  // 키워드는 홈페이지 본문 우선, 본문이 빈약할 때만 검색 스니펫으로 보완(출처를 구분해 표기)
  const kwSource = T.replace(/\s/g, '').length >= 300 ? T : `${T}\n${g.webText || ''}`;
  const keywords = extractKeywords(kwSource);
  // 설비 추정 — 이미지 파일명/alt + 본문 문구를 설비 지식베이스와 대조(OCR 대체)
  const inf = inferEquipment(g.html, T);
  const equipment_inferred = (inf.items.length || inf.vendors.length || inf.capacities.length)
    ? { items: inf.items, vendors: inf.vendors, capacities: inf.capacities, imageCount: inf.imageCount }
    : null;

  // ── 탭 데이터 ── 인증 / 설비 / 생산CAPA / 기타
  const assets = imageAssets(g.html || '');
  // ① 인증 — 그룹별로 묶고 근거 문장을 함께
  const certDetail = certAll;
  // ② 설비 — 충전/제조/포장/부대. 본문·이미지 단서를 각각 확인해 신뢰도 부여
  const fillEquip = FILL_EQUIP.map((e) => {
    const inTextHit = e.text.test(T);
    const hits = assets.filter((a) => e.asset.test(`${a.file} ${a.alt}`)).slice(0, 2);
    if (!inTextHit && !hits.length) return null;
    const ev = [];
    if (inTextHit) { const s = pickSentences(T, e.text, { cap: 1 }); ev.push(s[0] ? `본문: ${s[0].slice(0, 70)}` : '본문 언급'); }
    hits.forEach((h) => ev.push(`이미지: ${(h.alt || h.file).slice(0, 45)}`));
    return {
      label: e.label, grp: e.grp,
      confidence: inTextHit && hits.length ? 'high' : (inTextHit ? 'mid' : 'low'),
      basis: inTextHit && hits.length ? '본문+이미지' : (inTextHit ? '본문' : '이미지'),
      evidence: ev.slice(0, 3),
    };
  }).filter(Boolean);
  // ③ 생산 CAPA — 수치 표현을 종류별로
  const capaItems = extractCapa(T);
  // ④ 사이트에 실제 표기된 설비·인증 용어를 그대로 회수(카테고리 라벨보다 구체적)
  const equipTerms = extractLexicon(T, EQUIP_LEX);
  const certTerms = extractLexicon(T, CERT_LEX);
  const tabs = {
    cert: certDetail.length ? certDetail : null,
    certTerms: certTerms.length ? certTerms : null,
    equip: fillEquip.length ? fillEquip : null,
    equipTerms: equipTerms.length ? equipTerms : null,
    capa: capaItems.length ? capaItems : null,
  };
  const data = {
    company_name: name || null, business_type, product_categories, production_items,
    quality_certifications, production_sites, equipment, rnd_centers, export_markets,
    hq_address: addrM ? addrM[1].trim() : null, phone: phoneM ? phoneM[1] : null, notable,
    keywords: keywords.length ? keywords : null, equipment_inferred, tabs,
  };
  const any = Object.entries(data).some(([k, v]) => k !== 'company_name' && v != null && (!Array.isArray(v) || v.length));
  return {
    data: any ? data : null, source: 'heuristic', pages: g.pages, base: baseUrl,
    harvest: { webFallback: !!g.webFallback, thin: !!g.thin, chars: g.text.length },
    reason: any ? null : '페이지에서 의미 있는 텍스트를 찾지 못했습니다(이미지 전용 사이트 가능)',
  };
}
// LLM 비값 위에 휴리스틱으로 공백 채우기(둘 다 있으면 병합)
function mergeDeep(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const out = { ...secondary };
  for (const [k, v] of Object.entries(primary)) {
    const empty = v == null || (Array.isArray(v) && !v.length) || v === '';
    if (!empty) out[k] = v;
  }
  return out;
}

// ── 도메인 ↔ 상호 유사도 (로마자 표기 흔들림 흡수) ──
// 국내 화장품사 도메인은 상호의 로마자 축약형인 경우가 많다(바이오코스텍 → biocostec).
// 엄격한 로마자 변환으로는 매칭이 안 되므로(baio≠bio, koseu≠cos) '자음 골격'으로 비교한다.
const HAN_CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const HAN_JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const HAN_JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
function hangulToLatin(s) {
  let out = '';
  for (const ch of String(s || '')) {
    const c = ch.charCodeAt(0) - 0xac00;
    // 모음 자리에 'a'를 박아 넣던 것을 실제 모음으로 옮긴다. 옛 방식은 '아이큐어'처럼
    // 초성이 전부 ㅇ(무음)인 상호를 골격 한 글자로 뭉개 버려 비교 자체가 불가능했다.
    if (c >= 0 && c < 11172) out += HAN_CHO[Math.floor(c / 588)] + HAN_JUNG[Math.floor((c % 588) / 28)] + HAN_JONG[c % 28];
    else out += ch;
  }
  return out.toLowerCase();
}
// ── 자음 골격 ──
// 한글 표기와 회사가 고른 영문 표기는 같은 소리를 다르게 적는다. 한 갈래로 모을 수 없는
// 대응은 갈래를 나눠 전부 만들어 두고, 어느 하나라도 맞으면 같은 이름으로 본다.
//   ㅅ ↔ c(셀랩=cellab) · th(제니스=zenith)   ㄹ ↔ r/l(초성r·종성l이지만 같은 소리)
//   받침은 소리가 중화된다(랩→p인데 영문은 lab) → b/d/g와 p/t/k를 같은 것으로 본다
function skeletonForms(s) {
  const base = String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const forms = new Set();
  for (const th of ['t', 's']) {
    for (const c of ['k', 's']) {
      const v = base
        .replace(/ph|f/g, 'p').replace(/th/g, th).replace(/ch/g, 'c')
        .replace(/x/g, 'ks').replace(/q/g, 'k').replace(/c/g, c).replace(/z/g, 'j')
        .replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k')
        .replace(/[aeiouwy]/g, '')
        .replace(/r/g, 'l')
        .replace(/(.)\1+/g, '$1');
      if (v.length >= 2) forms.add(v);
    }
  }
  return forms;
}
const consonantSkeleton = (s) => [...skeletonForms(s)][0] || '';
// 두 골격의 최장 공통 연속부분 길이
function lcsLen(a, b) {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}
function domainAffinity(korName, host) {
  const dom = String(host || '').replace(/^www\./, '').split('.')[0];
  const A = skeletonForms(hangulToLatin(stripCorp(korName)));
  const B = skeletonForms(dom);
  for (const a of A) {
    for (const b of B) {
      if (a.length < 3 || b.length < 3) continue;
      if (a.includes(b) || b.includes(a)) return true;
      // 상호 일부만 딴 도메인(한국콜마 → kolmar)도 인정: 공통부분 3자 이상 + 짧은 쪽의 절반 이상
      const n = lcsLen(a, b);
      if (n >= 3 && n >= Math.min(a.length, b.length) * 0.5) return true;
    }
  }
  return false;
}

// ── 대표번호 · 대표메일 ──
// 확정된 홈페이지 본문과 채용사이트(기업정보·공고)에서 읽는다. 채용사이트 고객센터(15xx 등)와
// 사이트 자체 메일(help@saramin…)은 회사 연락처가 아니라서 버린다. 팩스는 '전화/TEL' 표시가 없어 걸리지 않는다.
const CONTACT_TEL_RE = /(?:대표\s*(?:전화|번호)|전화\s*(?:번호)?|연락처|TEL|Tel|T\s*[.:)]|☎|📞)\s*[:.)]?\s*(0\d{1,2}[-.)\s]?\d{3,4}[-.\s]?\d{4})(?!\d)/;
const CONTACT_MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CONTACT_MAIL_JUNK = /(saramin|jobkorea|incruit|catch\.co|albamon|work\.go|worknet|jobplanet|wanted|peoplenjob|superookie|example\.|sentry|wixpress|imweb\.me$|cafe24\.com$|godo\.co|domain\.|yourmail|email\.com$|\.(png|jpe?g|gif|webp|svg)$|noreply|no-reply|webmaster@)/i;
function fmtTel(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!/^0/.test(d) || d.length < 9 || d.length > 11) return null;
  if (d.startsWith('02')) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
function extContacts(text, html) {
  const T = String(text || '').replace(/\s+/g, ' ');
  const H = String(html || '');
  const telLink = H.match(/href=["']tel:([0-9+\-\s().]{8,20})["']/i);
  let tel = telLink ? fmtTel(telLink[1].replace(/^\+?82/, '0')) : null;
  if (!tel) { const m = T.match(CONTACT_TEL_RE); if (m) tel = fmtTel(m[1]); }
  const mailLink = H.match(/href=["']mailto:([^"'?\s]+)/i);
  const mails = [...(mailLink ? [decodeURIComponent(mailLink[1])] : []), ...(T.match(CONTACT_MAIL_RE) || [])]
    .map((e) => e.replace(/[.,;:]+$/, '').toLowerCase()).filter((e) => !CONTACT_MAIL_JUNK.test(e));
  return { tel, email: mails[0] || null };
}

// ── 업체 소재 시·군 ──
// 본점 주소 하나만 보던 탓에, 금융위에 없는 업체(개인·소규모 법인)나 본점과 공장이 다른 업체는
// '양주시 미스킨' 같은 지역+상호 검색을 아예 하지 않았다. 공장등록·식약처·의약품안전나라·
// 국민연금·채용공고 근무지 주소를 모두 받아 시·군(광역시는 구)을 뽑는다.
function addrRegions(addrs) {
  const out = [];
  (addrs || []).forEach((a) => {
    const s = String(a || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return;
    const p = nbAddrParts(s);
    let sgg = p.sgg || (s.match(/(?:^|\s)([가-힣]{1,5}(?:시|군))(?=\s|$)/) || [])[1] || '';
    if (/(특별시|광역시|특별자치시|특별자치도)$/.test(sgg)) sgg = '';
    if (!sgg && p.sido === '세종') sgg = '세종시';
    if (sgg && !out.includes(sgg)) out.push(sgg);
  });
  return out;
}
// '양주시' → '양주'. 기사·웹문서는 '양주 소재', '양주의' 식으로 시·군을 떼고 쓰는 일이 많다.
const regionShort = (r) => (String(r || '').length >= 3 ? String(r).replace(/(시|군)$/, '') : String(r || ''));

// ── 상호가 '그 회사 이름으로' 나왔는가 ──
// '미스킨'은 '코미스킨'·'아이미스킨랩'·'픽미스킨'에도 들어 있다. 글자가 포함됐는지만 보면 남의 회사
// 기사가 그대로 섞인다. 앞 글자가 한글이면(코|미스킨) 다른 상호의 일부로, 뒤에 조사·회사 표지가
// 아닌 한글이 붙으면(미스킨|랩) 역시 다른 상호로 본다.
const NAME_TAIL_OK = /^(?:은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|측|이다|입니다|대표|회장|사장|공장|본사|화장품|코스메틱|주식회사|㈜|\(주\))/;
function nameHits(text, nm) {
  const key = stripCorp(nm).replace(/\s/g, '');
  if (key.length < 2) return { exact: 0, similar: [] };
  const T = String(text || '').replace(/<\/?b>/g, '');
  // 상호 글자 사이 공백 허용('미 스킨'은 드물지만 '한국 콜마'는 흔하다)
  const re = new RegExp(key.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s?'), 'g');
  let exact = 0; const similar = new Set();
  for (const m of T.matchAll(re)) {
    const before = T.slice(Math.max(0, m.index - 6), m.index);
    const after = T.slice(m.index + m[0].length, m.index + m[0].length + 6);
    const headCorp = /(\(주\)|㈜|주식회사)\s?$/.test(before);
    const prevHan = /[가-힣A-Za-z0-9]$/.test(before) && !headCorp;
    const nextHan = /^[가-힣A-Za-z0-9]/.test(after) && !NAME_TAIL_OK.test(after);
    if (prevHan || nextHan) {
      const w = ((before.match(/[가-힣A-Za-z0-9]*$/) || [''])[0] + m[0] + (after.match(/^[가-힣A-Za-z0-9]*/) || [''])[0]).slice(0, 14);
      similar.add(w);
    } else exact++;
  }
  return { exact, similar: [...similar] };
}
// ── 뉴스·웹문서가 이 업체 이야기인가 ──
// ctx: { name, regions[], rep, bzno, hosts[], tels[] }
// 상호가 정확히 나오고(다른 상호의 일부가 아니고) 업체를 가리키는 근거(지역·대표자·사업자번호·
// 홈페이지·전화)가 하나라도 있으면 '관련'. 상호만 있으면 화장품 문맥이 있을 때 '관련 가능',
// 상호가 다른 회사 이름의 일부로만 나오거나 아예 없으면 '무관'으로 거른다.
function relevanceOf(text, ctx) {
  const T = String(text || '').replace(/<\/?b>/g, '');
  const flat = T.replace(/\s/g, '');
  const h = nameHits(T, ctx.name);
  if (!h.exact) {
    return { level: 'off', why: h.similar.length ? `다른 상호(${h.similar.slice(0, 2).join('·')})` : '업체명 없음' };
  }
  const ev = [];
  const regions = ctx.regions || [];
  const rHit = regions.find((r) => flat.includes(r) || flat.includes(regionShort(r)));
  if (rHit) ev.push(`소재지(${regionShort(rHit)})`);
  const rep = String(ctx.rep || '').replace(/\s/g, '');
  if (rep.length >= 2 && flat.includes(rep)) ev.push('대표자');
  const bz = String(ctx.bzno || '').replace(/\D/g, '');
  if (bz.length === 10 && flat.replace(/-/g, '').includes(bz)) ev.push('사업자번호');
  if ((ctx.hosts || []).some((x) => x && T.toLowerCase().includes(x))) ev.push('홈페이지');
  if ((ctx.tels || []).some((x) => x && T.replace(/\D/g, '').includes(x))) ev.push('전화');
  const cos = /화장품|코스메틱|cosmetic|OEM|ODM|제조|스킨케어|기초화장|색조|뷰티/i.test(T);
  // 다른 상호가 같은 글에 함께 나오면(코미스킨·미스킨 나란히) 근거가 있어도 한 번 더 본다
  const mixed = h.similar.length ? ` · 비슷한 상호 ${h.similar.slice(0, 2).join('·')} 함께 언급` : '';
  if (ev.length) return { level: 'rel', why: ev.join('·') + mixed, ev };
  if (cos) {
    // 네 글자 이상 상호는 화장품 문맥만으로도 같은 회사일 공산이 크다. 짧은 상호(미스킨)는 아니다.
    const longName = stripCorp(ctx.name).replace(/\s/g, '').length >= 4;
    return longName ? { level: 'rel', why: `상호·화장품 문맥${mixed}`, ev: ['상호'] }
      : { level: 'maybe', why: `상호·화장품 문맥만(지역·대표자 미확인)${mixed}` };
  }
  return { level: 'off', why: '화장품·업체 근거 없음(동명 다른 뜻일 수 있음)' };
}
// 리포트에서 관련성 판정 맥락을 만든다(뉴스·웹 언급과 홈페이지 추적이 같이 쓴다)
function relCtxOf(name, o) {
  const tels = (o.tels || []).map((t) => String(t || '').replace(/\D/g, '')).filter((t) => t.length >= 9);
  const hosts = (o.hosts || []).map((x) => { try { return new URL(/^https?:/i.test(x) ? x : `https://${x}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }).filter(Boolean);
  return { name, regions: addrRegions(o.addrs), rep: o.rep || '', bzno: o.bzno || '', hosts, tels };
}

// 리포트가 아는 업체 주소 전부 — 본점·공장/제조소·연금 사업장·선정 공장·의약품안전나라 제조소·채용 근무지
function reportAddrs(report) {
  const b = (report && report.basic) || [];
  const m = (report && report.meta) || {};
  const v = (k) => { const f = b.find((x) => x.key === k); return f && f.value ? String(f.value) : ''; };
  return [...new Set([v('본점주소'), ...v('공장/제조소 소재지').split(/\n|\s+\/\s+/), v('사업장 주소 (연금기준)'),
    m.visit_addr, m.site && m.site.addr, ...((m.mfds_sites || []).map((x) => x && x.addr)),
    ...(((report && report.hiring && report.hiring.workAddrs) || []))]
    .map((a) => String(a || '').trim()).filter(Boolean))];
}

async function findHomepage(nm, corp, hpHints) {
  if (!getProxy()) return null;
  // 본점 주소만 보던 것을 확장 — 공장·제조소·연금·채용 근무지 주소를 모두 지역 단서로 쓴다
  const allAddrs = [corp && corp.addr, ...((corp && corp.addrs) || [])].filter(Boolean);
  const regions = addrRegions(allAddrs);
  const knownTels = ((corp && corp.tels) || []).map((t) => String(t || '').replace(/\D/g, '')).filter((t) => t.length >= 9);
  // 공장등록부에 홈페이지가 있으면 그게 공식 확정 — 웹검색보다 신뢰
  // 공장등록부에 적힌 주소는 유력한 후보지만 그대로 확정하면 안 된다. 신고 당시 주소라
  //   도메인이 팔려 엉뚱한 사이트가 되어 있거나, 그룹사 대표 사이트가 적혀 있기도 한다.
  //   실제로 '일치 여부' 칸이 비어 있던 건 이 경로가 대조를 통째로 건너뛰었기 때문이다.
  //   후보 목록의 맨 앞에 넣어 다른 후보와 똑같이 페이지를 열어 대조한다.
  const fctHp = corp && corp.factoryHomepage ? String(corp.factoryHomepage).trim() : '';
  const seen = new Set(); const cands = [];
  const skipped = {};                       // 어떤 유형이 몇 건 걸러졌는지 — 못 찾은 이유 설명용
  const addCand = (link, title, via) => {
    let host;
    try { host = new URL(link).hostname.replace(/^www\./, ''); } catch { return; }
    const why = hpSkipReason(host);
    if (why) { skipped[why] = (skipped[why] || 0) + 1; return; }
    if (seen.has(host)) {
      // 지역+상호 검색에서 다시 나온 후보는 표시만 해 둔다(줄 세울 때 앞으로)
      if (via === 'region') { const c = cands.find((x) => x.host === host); if (c) c.regionQ = true; }
      return;
    }
    seen.add(host);
    // url은 후보 '시작점'일 뿐 — fetchPageSmart가 https/http·www 변형을 시도해 실제 열리는 주소를 찾는다.
    cands.push({ url: `https://${host}`, host, origLink: link, title: String(title || '').replace(/<\/?b>/g, ''),
      via: via === 'region' ? 'web' : via, regionQ: via === 'region' });
  };

  // ⓪ 공장등록부에 적힌 주소 — 가장 유력한 출발점이라 맨 앞에 둔다(대조는 똑같이 받는다)
  if (fctHp && /^https?:\/\//i.test(fctHp)) addCand(fctHp, '', 'factory');
  // ⓪-2 채용사이트 기업정보에 적힌 홈페이지 — 사람인·잡코리아는 기업이 직접 등록한 주소다.
  //   네이버 웹문서가 못 잡는 소규모 사이트(아임웹·모두·카페24 등)가 여기서 자주 나온다.
  (hpHints || []).forEach((u) => addCand(u, '', 'hire'));

  // ① 네이버 지역검색 — 사업자 등록정보 기반이라 link가 곧 그 업체의 홈페이지다.
  //    웹문서 검색보다 정확한데 지금까지 쓰지 않고 있었다(프록시에는 이미 열려 있었다).
  let localHit = null;
  const nkLocal = stripCorp(nm).replace(/\s/g, '');
  // 상호만으로 찾으면 전국의 동명 업소가 섞여 5건 안에 안 들어온다 — 소재 시·군을 붙인 질의도 던진다
  const localQs = [nm, ...regions.slice(0, 2).map((r) => `${regionShort(r)} ${stripCorp(nm)}`)];
  for (const lq of localQs) {
    try {
      const lo = await proxyOnlyGet('naverLocal', { query: lq, display: '5' });
      const lit = (lo && lo.items) || [];
      for (const it of lit) {
        const t = String(it.title || '').replace(/<\/?b>/g, '').replace(/\s/g, '');
        if (nkLocal && !t.includes(nkLocal) && !nkLocal.includes(t)) continue;      // 동명 타업소 배제
        // 상호가 다른 상호의 일부로만 맞는 업소(코미스킨)는 버린다
        if (!nameHits(it.title, nm).exact) continue;
        const la = it.roadAddress || it.address || '';
        if (regions.length && la && !regions.some((r) => la.includes(regionShort(r)))) continue;   // 다른 지역 동명 업소
        if (it.link) { addCand(it.link, it.title, 'local'); if (!localHit) localHit = { link: it.link, addr: la }; }
      }
    } catch { /* 지역검색 실패는 치명적이지 않다 — 웹문서로 계속 */ }
  }

  // ② 웹문서 다각도 검색 — 한 질의로는 후보가 3~4건뿐이고 그마저 노이즈인 경우가 많다.
  //    상호 단독·업종·홈페이지·소재지 조합으로 넓힌다.
  const qs = [`${nm} 화장품`, `${nm} OEM ODM`, `${nm} 홈페이지`, `"${nm}"`, `${nm} 제조`,
    // 소규모 업체는 자기 도메인 없이 빌더에 얹는 경우가 많아, 회사소개·공식 표현으로도 훑는다
    `${nm} 회사소개`, `${nm} 공식홈페이지`];
  // 지역+상호 — '양주시 미스킨'처럼 사람이 실제로 찾는 방식. 상호가 짧고 흔할수록 이 질의가 결정적이다.
  const regionQs = regions.slice(0, 3).flatMap((r) => [`${r} ${stripCorp(nm)}`, `${stripCorp(nm)} ${regionShort(r)} 화장품`]);
  const webs = await mapLimit([...regionQs, ...qs], 3, async (q) => {
    try { return { q, r: await proxyOnlyGet('naverWeb', { query: q, display: '20' }) }; } catch { return { q, r: null }; }
  });
  let webErr = null;
  if (webs.every((w) => !w.r)) webErr = '네이버 웹문서 검색 실패';
  webs.forEach((w) => ((w.r && w.r.items) || []).forEach((it) => addCand(it.link, it.title, regionQs.includes(w.q) ? 'region' : 'web')));

  if (!cands.length) {
    const why = Object.entries(skipped).map(([k, v]) => `${k} ${v}건`).join(' · ');
    return { proposed: null, candidates: [], err: webErr,
      reason: why ? `검색결과가 모두 제외 대상이었습니다 (${why}) — 자체 홈페이지가 없는 업체일 수 있습니다` : '검색결과 없음' };
  }
  // ── 대조할 후보 고르기 ──
  // 여태 '먼저 도착한 순서'로 12개를 잘랐다. 웹문서 질의 8개가 각 20건을 주니 호스트가
  // 12개를 넘기기 일쑤인데, 그러면 뒤쪽 질의에서 나온 진짜 홈페이지가 열어 보지도 못하고
  // 잘려 나간다. 페이지를 열기 전에도 알 수 있는 단서로 먼저 줄을 세우고 자른다.
  const nameForRank = stripCorp(nm).replace(/\s/g, '');
  const VIA_RANK = { factory: 0, hire: 1, local: 2, web: 3 };   // 출처 자체가 근거인 것부터
  // 지역+상호 질의에서 나온 후보는 웹문서라도 공식 등록 다음 순서로 — '양주시 미스킨'에서 나온
  //   miskinvenus.com이 '미스킨 화장품'류 질의의 다른 미스킨들에 밀려 12개 밖으로 잘리던 문제
  const preScore = (c) => (domainAffinity(nm, c.host) ? 2 : 0)
    + (nameForRank && String(c.title || '').replace(/\s/g, '').includes(nameForRank) ? 1 : 0)
    + (c.regionQ ? 2 : 0);
  cands.sort((a, b) => (VIA_RANK[a.via] ?? 9) - (VIA_RANK[b.via] ?? 9) || preScore(b) - preScore(a));
  // 대조 비용 상한 — 다만 도메인이 상호와 닮았거나 지역+상호 질의에서 나온 후보는 상한 밖이어도 연다
  const head = cands.slice(0, 12);
  const extra = cands.slice(12).filter((c) => c.regionQ || domainAffinity(nm, c.host)).slice(0, 6);
  cands.splice(0, cands.length, ...head, ...extra);

  const nameCore = stripCorp(nm).replace(/\s/g, '');
  const rep = corp && corp.rep ? String(corp.rep).replace(/\s/g, '') : '';
  const bz = corp && corp.bzno ? String(corp.bzno).replace(/\D/g, '') : '';
  const bzFmt = bz.length === 10 ? `${bz.slice(0, 3)}-${bz.slice(3, 5)}-${bz.slice(5)}` : '';
  // 주소 대조도 본점 주소 하나가 아니라 공장·제조소·연금 주소 전부로(시·도 이름처럼 흔한 토막은 뺀다)
  const addrCores = [...new Set(allAddrs.flatMap((a) => hpAddrCores(a)))]
    .filter((a) => !/(특별시|광역시|특별자치시|특별자치도|도)$/.test(a) || /(로|길)$/.test(a));

  // 근거별 가중치 — 사업자번호가 가장 확실하고, 도메인·제목은 페이지 본문을 못 읽어도 얻을 수 있는 단서.
  // 지역등록: 네이버 지역검색은 사업자 등록정보 기반이라 사업자번호에 준하는 근거로 본다.
  // 지역: 본문에 소재 시·군이 나옴(주소 번지까지는 못 맞춰도 같은 고장의 같은 상호)
  const W = { 사업자번호: 4, 지역등록: 4, 대표번호: 4, 공장등록부: 3, 채용사이트: 3, 상호: 3, 대표자: 3, 주소: 2, 도메인: 2, 제목: 2, 지역: 1, 업종: 1 };
  const scored = await Promise.all(cands.map(async (c) => {
    // https/http · www 변형을 시도(국내 중소사 홈페이지는 http·www 전용이 흔함)
    let got = await fetchPageSmart(c.url);
    // 루트가 프레임셋/스플래시라 내용이 빈약하면 검색결과가 가리킨 실제 내용 페이지도 시도
    if (c.origLink && c.origLink !== c.url) {
      const thin = !got.html || htmlToText(got.html).replace(/\s/g, '').length < 200;
      if (thin) { const deep = await fetchPageSmart(c.origLink); if (deep.html) got = deep; }
    }
    const rawHtml = String(got.html || '');
    const url = got.url || c.url;                 // 실제 열린 주소로 갱신
    // ★ 본문만 보지 않는다 — meta·임베드 JSON·이미지 alt까지 훑어야 SPA·이미지형 사이트에서도 잡힌다
    const rawText = rawHtml ? harvestFromHtml(rawHtml, url).text : '';
    const text = rawText.replace(/\s/g, '');
    const title = String(c.title || '').replace(/\s/g, '');
    const m = [];
    // 상호는 '다른 상호의 일부'가 아닌 자리에 나와야 한다(코미스킨 사이트에서 '미스킨' 글자를 근거로 삼지 않게)
    if (nameCore && text.includes(nameCore) && nameHits(rawText, nm).exact) m.push('상호');
    if (rep && text.includes(rep)) m.push('대표자');
    if (bz && (text.includes(bz) || (bzFmt && text.includes(bzFmt)))) m.push('사업자번호');
    if (addrCores.length && addrCores.some((a) => text.includes(a))) m.push('주소');
    else if (regions.length && regions.some((r) => text.includes(r))) m.push('지역');
    if (knownTels.length && knownTels.some((t) => text.replace(/\D/g, '').includes(t))) m.push('대표번호');
    // 페이지를 못 읽어도 판단할 수 있는 단서 두 가지
    if (nameCore && title.includes(nameCore) && nameHits(c.title, nm).exact) m.push('제목');
    if (domainAffinity(nm, c.host)) m.push('도메인');
    if (c.via === 'local') m.push('지역등록');     // 네이버 지역검색이 이 업체 홈페이지로 등록한 주소
    if (c.via === 'factory') m.push('공장등록부');  // 공장등록 신고서에 적힌 주소
    if (c.via === 'hire') m.push('채용사이트');     // 기업이 채용사이트에 등록한 주소
    // 화장품 제조 문맥 — 동명 타업종 사이트를 걸러내는 보조 신호
    if (/화장품|코스메틱|cosmetic|OEM|ODM|제조/i.test(text) || /화장품|코스메틱|cosmetic/i.test(title)) m.push('업종');
    const score = m.reduce((s, k) => s + (W[k] || 1), 0);
    // 본문을 실제로 읽어 확인한 근거와, 페이지를 안 열고도 알 수 있는 근거(제목·도메인·등록)는
    // 무게가 다르다. 둘을 갈라 둬야 '본문에 상호가 없는데 확정된' 상황을 잡아낼 수 있다.
    const BODY = new Set(['상호', '대표자', '사업자번호', '주소', '대표번호']);
    const bodyHits = m.filter((k) => BODY.has(k));
    return { ...c, url, matches: m, score, bodyHits, chars: text.length, html: rawHtml };
  }));
  scored.sort((a, b) => b.score - a.score);
  // 4점 이상 = 강한 근거 1개 + 보조, 또는 보조 근거 2~3개. (예: 제목+도메인+업종 = 5)
  // 다만 본문 대조가 0건이면 확정하지 않는다. (주)셀랩 조회에서 icellab.com 이 제목(2)+
  // 지역등록(4) = 6점으로 확정됐는데, 정작 그 페이지 어디에도 상호가 없었다. 상호가 비슷한
  // 다른 회사이거나 자바스크립트로 그려지는 사이트인데, 어느 쪽인지 모른 채 확정한 셈이다.
  const top = scored[0] || null;
  const strong = top && top.score >= 4;
  const proposed = strong && top.bodyHits.length ? top : null;
  const reason = proposed ? null
    : (strong
      ? `가장 유력한 후보(${top.host})는 근거 ${top.score}점이지만 페이지 본문에서 상호·대표자·사업자번호·주소를 하나도 확인하지 못했습니다`
        + (top.chars < 200
          ? ' — 본문을 거의 읽지 못했습니다(자바스크립트로 그려지는 사이트일 수 있음). 직접 열어 확인하세요.'
          : ' — 상호가 비슷한 다른 업체일 수 있습니다. 직접 열어 확인하세요.')
      : (top
        ? `가장 근접한 후보(${top.host})도 근거 ${top.score}점으로 확정 기준(4점)에 못 미쳤습니다`
          + (top.matches.length ? ` — 확인된 근거: ${top.matches.join('·')}` : ' — 페이지에서 상호·대표자·사업자번호를 찾지 못했습니다')
        : '대조할 후보가 없습니다'));
  // 확정 사이트에서만 인증·생산능력 추출(오매칭 사이트 정보 방지). 이미 받은 HTML 재사용.
  if (proposed) { try { proposed.extract = await extractSiteInfo(proposed.url, proposed.html); } catch { /* 무시 */ } }
  // 대표번호·대표메일 — 확정 사이트에서만(남의 사이트 연락처를 붙이지 않게)
  if (proposed) { try { proposed.contact = extContacts(htmlToText(proposed.html), proposed.html); } catch { /* 무시 */ } }
  scored.forEach((c) => { delete c.html; }); // 원문 HTML은 저장 용량 커서 제거
  return { proposed, candidates: scored, reason, skipped, tried: cands.length };
}

// 레코드/문자열에서 사업자등록번호 추출 — 대시형 우선, 없으면 10자리.
function findBznoIn(rec) {
  if (!rec) return null;
  for (const [k, v] of Object.entries(rec)) {
    if (!/사업자|BIZR|BZNO|BSNM|CORP_?NO|business|regist.*no/i.test(k)) continue;
    const m = String(v == null ? '' : v).match(/(\d{3})-?(\d{2})-?(\d{5})/);
    if (m) return m[1] + m[2] + m[3];
  }
  for (const v of Object.values(rec)) {
    const s = String(v == null ? '' : v);
    if (/\d{3}-\d{2}-\d{5}/.test(s)) { const m = s.match(/(\d{3})-(\d{2})-(\d{5})/); if (m) return m[1] + m[2] + m[3]; }
  }
  return null;
}

// 비공식 사업자정보 집계 사이트(marketbz·bizno 등) 조회 코드가 여기 있었다.
// 공식 data.go.kr 자료만 신뢰하기로 하면서 호출을 끊었고(bizAgg는 늘 null),
// 그 뒤로 아무도 부르지 않는 43줄로 남아 있었다. 되살릴 일이 생기면 git 이력에 있다.

// 카카오 이동거리 — 한국콜마(기준점)→방문지.
//  1순위: 카카오모빌리티 길찾기(실측). 이용신청 안 돼 있으면 실패 → 2순위.
//  2순위: 카카오맵 Local API로 양 지점 정확 좌표 → 하버사인×도로계수로 추정(모빌리티 불필요).
// 좌표 변환(주소검색)까지 실패하면 throw → 상태 패널에 사유 표시(키·재배포 확인).
const KOLMAR_ADDR = '세종특별자치시 전의면 산단길 22-17'; // 한국콜마 기준점
let _kolmarCoord = null; // 세션 내 캐시(기준점 좌표는 고정)
// ── 주소 품질 ──
// 식약처 제조업 레코드는 주소가 여러 칸(기본·상세)으로 나뉘어 올 때가 있다. 첫 칸만 집으면
// '세종특별자치시' 한 단어가 방문 주소가 되고, 그 좌표(시 중심점)로 방문거리 38km가 계산됐다
// (실제 한국콜마 공장은 기준점에서 몇 km 거리). 주소 칸을 모두 모아 이어 붙인다.
function joinAddrFields(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const parts = [];
  Object.entries(rec).forEach(([k, v]) => {
    if (!/ADDR|ADRES|주소|소재지|LOCP|SITE/i.test(k) || /ZIP|POST|우편|TEL|FAX/i.test(k)) return;
    const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!t || parts.some((p) => p.includes(t))) return;
    for (let i = parts.length - 1; i >= 0; i--) if (t.includes(parts[i])) parts.splice(i, 1);   // 더 긴 쪽이 이긴다
    parts.push(t);
  });
  if (!parts.length) return null;
  // 시·도로 시작하는 칸을 앞에 — 기본주소 + 상세주소 순서가 되게
  // '전동면'이 '전'(전북·전남)으로 시작한다고 시·도로 오인하지 않게 시·도 이름을 온전히 적는다
  const SIDO_HEAD = /^(서울|부산|대구|인천|광주광역|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;
  parts.sort((a, b) => (SIDO_HEAD.test(b) ? 1 : 0) - (SIDO_HEAD.test(a) ? 1 : 0));
  return parts.join(' ');
}
// 방문지로 쓸 만한 주소인가 — 시·도 이름만 있거나 번지 숫자가 없으면 좌표가 시·동 중심으로 떨어진다
// 도로 이름에 숫자가 낀 경우('제약공단1길 27', '평천로73번길 14')도 번지까지 있는 주소다
const isFullAddr = (a) => { const t = String(a || '').trim(); return t.length >= 8 && /\d/.test(t) && /[가-힣][가-힣0-9]*(로|길|동|리|가)\s*\d|[가-힣]+(로|길)\d/.test(t); };
const pickFullAddr = (...cands) => cands.find(isFullAddr) || cands.find((a) => a && String(a).trim()) || null;
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

async function kakaoGeocode(addr, opts = {}) {
  const data = await proxyOnlyGet('kakaoGeocode', { query: addr }); // 실패 시 proxyErrMsg 전파(401 등)
  const docs = (data && data.documents) || [];
  // 번지까지 맞은 결과(ROAD_ADDR·REGION_ADDR)를 먼저 쓴다. 시·동까지만 맞은 결과는 그 지역의
  // 중심점이라, 거리를 재면 틀린다 — exact면 아예 받지 않는다.
  const doc = docs.find((d) => d.address_type === 'ROAD_ADDR' || d.address_type === 'REGION_ADDR')
    || (opts.exact ? null : docs[0]);
  if (!doc) return null;
  const lng = Number(doc.x), lat = Number(doc.y);
  return (isFinite(lng) && isFinite(lat)) ? { lng, lat } : null;
}
// 지저분한 주소(괄호·"834층" 같은 상세)를 점진적으로 단순화하며 좌표변환 시도
async function kakaoGeocodeFlex(addr, opts = {}) {
  const base = String(addr || '');
  const noParen = base.replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  const noDetail = noParen.replace(/[\s,·]*\d*\s*(층|호|호실)\D*$/, '').trim();
  for (const a of [...new Set([base, noParen, noDetail])]) {
    if (!a) continue;
    const r = await kakaoGeocode(a, opts).catch(() => null);
    if (r) return r;
  }
  return null;
}
// ── 건축물대장 — 공장 면적 ──
// 주소 → 카카오 주소검색으로 법정동코드(b_code)·지번(본번/부번)·산 여부를 얻고 →
// 건축물대장 표제부(동별)와 총괄표제부(대지 전체)를 함께 부른다.
// 공장등록이 없는 임대·소규모 공장도 건물만 있으면 나온다.
const bldPad4 = (v) => (String(v == null ? '' : v).replace(/\D/g, '') || '0').padStart(4, '0').slice(-4);
function bldAddrVariants(a) {
  const out = [];
  const push = (x) => { x = String(x || '').replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim(); if (x && !out.includes(x)) out.push(x); };
  const base = String(a || '').replace(/\s+/g, ' ').trim();
  push(base);
  const noParen = base.replace(/\([^)]*\)/g, ' ').replace(/외\s*\d+\s*필지/g, ' ');
  const road = noParen.match(/^(.*?\S(?:로|길)\s*\d+(?:-\d+)?)(?=\D|$)/); if (road) push(road[1]);
  const lot = noParen.match(/^(.*?\S(?:동|리|가)\s*(?:산\s*)?\d+(?:-\d+)?)(?=\D|$)/); if (lot) push(lot[1]);
  return out.slice(0, 3);
}
async function bldAddrKey(addr) {
  for (const q of bldAddrVariants(addr)) {
    let docs = [];
    try { docs = ((await proxyOnlyGet('kakaoGeocode', { query: q })) || {}).documents || []; } catch (e) { if (/401|403|KEY|키/.test(e.message)) throw e; }
    // 번지까지 맞은 결과만 — 동 단위 결과의 법정동코드로 부르면 엉뚱한 번지의 건물이 나온다
    const d = docs.find((x) => (x.address_type === 'ROAD_ADDR' || x.address_type === 'REGION_ADDR') && x.address && x.address.b_code && x.address.main_address_no);
    if (!d) continue;
    const a = d.address;
    const ra = d.road_address || null;
    return { sigunguCd: String(a.b_code).slice(0, 5), bjdongCd: String(a.b_code).slice(5, 10),
      platGbCd: a.mountain_yn === 'Y' ? '1' : '0', bun: bldPad4(a.main_address_no), ji: bldPad4(a.sub_address_no),
      jibun: a.address_name, road: ra ? ra.address_name : '',
      // 도로명 + 건물번호 — 대장의 새주소(newPlatPlc)와 맞대 보는 두 번째 열쇠
      roadName: ra && ra.road_name ? ra.road_name : '', bldNo: ra && ra.main_building_no ? String(ra.main_building_no) : '',
      bldSub: ra && ra.sub_building_no && ra.sub_building_no !== '0' ? String(ra.sub_building_no) : '' };
  }
  return null;
}
const bldNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) && n > 0 ? n : 0; };
// 대장 항목이 이 주소의 건물인가 — 새주소(도로명+건물번호) 또는 건물명에 상호가 들어 있으면 같은 건물로 본다
const bldCompact = (s) => String(s || '').replace(/\s+/g, '');
function bldItemMatches(x, k, name) {
  if (k.roadName && k.bldNo) {
    const want = bldCompact(`${k.roadName}${k.bldNo}${k.bldSub ? `-${k.bldSub}` : ''}`);
    const got = bldCompact(x.newPlatPlc);
    const at = got.indexOf(want);
    if (at >= 0 && !/[\d-]/.test(got.charAt(at + want.length))) return true;
  }
  const key = bldCompact(stripCorp(name || ''));
  return key.length >= 2 && bldCompact(`${x.bldNm || ''}${x.dongNm || ''}`).includes(key);
}
// 주소 → 건축물대장. 열쇠는 법정동코드(b_code 10자리) + 산 여부 + 본번·부번.
// 도로명주소가 가리키는 대표 지번에 건물이 안 걸린 경우가 있다(셀랩: 윤보선로 291 → 신남리 731-20엔
// 대장 없음). 공장 건물은 같은 본번의 다른 부번에 등재돼 있는 일이 흔하므로, 1차가 비면
// 본번만으로 다시 부르고 그 가운데 새주소(도로명+건물번호)나 건물명이 맞는 것만 받는다.
// 남의 건물을 섞지 않으려고, 2차에서 아무것도 안 맞으면 받지 않는다.
async function bldAreaLookup(addr, opts = {}) {
  if (!getProxy()) throw new Error('프록시 미설정');
  if (!addr) throw new Error('공장 주소 없음');
  const k = await bldAddrKey(addr);
  if (!k) throw new Error(`주소를 지번(법정동·번지)으로 바꾸지 못했습니다 — ${addr}`);
  // 후보 주소 여러 개가 같은 필지로 모이면(도로명·지번·카카오 장소) 한 번만 부른다
  if (opts.seen) {
    const sig = `${k.sigunguCd}${k.bjdongCd}-${k.platGbCd}-${k.bun}-${k.ji}`;
    if (opts.seen.has(sig)) { const e = new Error('같은 필지'); e.dup = true; throw e; }
    opts.seen.add(sig);
  }
  const base ={ sigunguCd: k.sigunguCd, bjdongCd: k.bjdongCd, platGbCd: k.platGbCd, bun: k.bun, rows: '100' };
  const items = (d) => listOf(d, ['response.body.items.item', 'body.items.item', 'body.items']).filter((x) => x && typeof x === 'object');
  const fetchLot = async (params) => {
    const [t, r] = await Promise.allSettled([proxyGet('bldTitle', params), proxyGet('bldRecap', params)]);
    if (t.status === 'rejected' && r.status === 'rejected') throw new Error(`건축물대장 조회 실패 — ${t.reason && t.reason.message || t.reason}`);
    return { rawT: t.status === 'fulfilled' ? items(t.value) : [], rawR: r.status === 'fulfilled' ? items(r.value) : [] };
  };
  let { rawT, rawR } = await fetchLot({ ...base, ji: k.ji });
  let matchedBy = 'lot';
  if (!rawT.length && !rawR.length) {
    const wide = await fetchLot(base).catch(() => ({ rawT: [], rawR: [] }));
    const hitT = wide.rawT.filter((x) => bldItemMatches(x, k, opts.name));
    const hitR = wide.rawR.filter((x) => bldItemMatches(x, k, opts.name));
    // 맞은 건물이 선 필지(대지위치)를 찾고, 그 필지의 동은 모두 받는다 — 새주소가 비어 있는
    // 창고·부속동도 같은 공장 면적이다. 남의 필지는 섞지 않는다.
    const lots = new Set([...hitT, ...hitR].map((x) => bldCompact(x.platPlc)).filter(Boolean));
    rawT = lots.size ? wide.rawT.filter((x) => lots.has(bldCompact(x.platPlc))) : hitT;
    rawR = lots.size ? wide.rawR.filter((x) => lots.has(bldCompact(x.platPlc))) : hitR;
    matchedBy = 'road';
  }
  const titles = rawT.map((x) => ({
    name: x.bldNm || '', dong: x.dongNm || '', purpose: x.mainPurpsCdNm || '', etc: x.etcPurps || '',
    arch: bldNum(x.archArea), tot: bldNum(x.totArea), plat: bldNum(x.platArea),
    floors: Number(x.grndFlrCnt) || null, under: Number(x.ugrndFlrCnt) || null,
    apr: String(x.useAprDay || '').trim(), kind: x.mainAtchGbCdNm || '', regKind: x.regstrKindCdNm || '', strct: x.strctCdNm || '',
    lot: String(x.platPlc || '').replace(/\s*번지\s*$/, '').trim() }));
  const recap = rawR[0] || null;
  if (!titles.length && !recap) {
    throw new Error(`건축물대장에 이 지번(${k.jibun})의 건물이 없습니다`
      + (k.roadName ? ` — 같은 본번(${Number(k.bun)}번지)의 다른 부번에서도 「${k.roadName} ${k.bldNo}」 건물을 찾지 못했습니다` : '')
      + ' · 신축·미등재이거나 공장이 다른 필지에 있을 수 있습니다');
  }
  // 실제로 맞은 대장상 지번 — 2차로 찾았으면 조회 지번과 다르다
  const lotHit = (recap && String(recap.platPlc || '').replace(/\s*번지\s*$/, '').trim()) || (titles.find((x) => x.lot) || {}).lot || '';
  // 2차에서 새주소가 아니라 건물명(상호)으로만 맞았으면 그렇게 적는다
  if (matchedBy === 'road' && !rawT.concat(rawR).some((x) => bldItemMatches(x, k, null))) matchedBy = 'name';
  const sum = (arr, f) => arr.reduce((a, x) => a + x[f], 0);
  const isFactory = (x) => /공장|제조/.test(`${x.purpose} ${x.etc}`);
  const fac = titles.filter(isFactory);
  // 총괄표제부가 있으면 대지 전체 합계를 쓰고, 없으면 동별을 더한다
  const arch = recap && bldNum(recap.archArea) ? bldNum(recap.archArea) : sum(titles, 'arch');
  const tot = recap && bldNum(recap.totArea) ? bldNum(recap.totArea) : sum(titles, 'tot');
  const plat = (recap && bldNum(recap.platArea)) || Math.max(0, ...titles.map((x) => x.plat));
  const aprs = (fac.length ? fac : titles).map((x) => x.apr).filter((x) => /^\d{8}$/.test(x)).sort();
  return {
    jibun: matchedBy === 'lot' ? k.jibun : (lotHit || k.jibun), keyJibun: k.jibun, matchedBy,
    key: `${k.sigunguCd}${k.bjdongCd}-${k.platGbCd}-${k.bun}${matchedBy === 'lot' ? `-${k.ji}` : ''}`,
    road: k.road, arch, tot, plat,
    factoryArch: sum(fac, 'arch'), factoryTot: sum(fac, 'tot'),
    bldgCount: titles.length, factoryCount: fac.length,
    purposes: [...new Set(titles.map((x) => x.purpose).filter(Boolean))],
    collective: titles.some((x) => /집합/.test(x.regKind)),      // 지식산업센터 등 — 면적이 건물 전체다
    firstApr: aprs[0] || null,
    bldgs: titles.slice(0, 40),
    src: recap ? '총괄표제부+표제부' : '표제부',
  };
}
// 비교 기준 — 한국콜마 세종 기준점(산단길 22-17) 한 곳의 건축물대장 건평.
// 예전에는 노장공단길 23·덕고개길 12-11까지 세 주소를 더했는데, 기준점은 방문거리와 같은
// 산단길 22-17 하나로 맞춘다(사용자 요청). 여러 주소를 다시 더하려면 아래 배열에 넣으면 된다.
// (참고: 예전 합산 대상이었던 주소들)
//   산단공 공장등록 소재지(노장공단길 23) · 금융위 본점 주소(덕고개길 12-11)
// 같은 지번은 한 번만 센다. 결과는 30일간 저장해 둔다(자주 바뀌지 않는다).
//   산단공 공장등록 소재지 '세종특별자치시 전동면 노장공단길 23' · 금융위 본점 '세종특별자치시 전의면 덕고개길 12-11'
const KOLMAR_BLD_ADDRS = [KOLMAR_ADDR];
const REF_BLD_KEY = 'vs_ref_bld2';
try { localStorage.removeItem('vs_ref_bld'); } catch { /* 옛 단일 지번 캐시 */ }
async function refBldArea() {
  const sig = KOLMAR_BLD_ADDRS.join('|');
  try {
    const c = JSON.parse(localStorage.getItem(REF_BLD_KEY) || 'null');
    if (c && c.sig === sig && Date.now() - c.at < 30 * 864e5 && c.data) return c.data;
  } catch { /* 없음 */ }
  const got = await mapLimit(KOLMAR_BLD_ADDRS, 2, (addr) => bldAreaLookup(addr).then((d) => ({ addr, d })).catch((e) => ({ addr, err: e.message })));
  const seen = new Set(); const ok = [];
  got.forEach((g) => { if (g.d && g.d.arch && !seen.has(g.d.jibun)) { seen.add(g.d.jibun); ok.push(g); } });
  if (!ok.length) throw new Error(got.map((g) => g.err).filter(Boolean)[0] || '한국콜마 건축물대장 조회 실패');
  const sum = (k) => ok.reduce((a2, g) => a2 + (g.d[k] || 0), 0);
  const data = {
    arch: sum('arch'), tot: sum('tot'), plat: sum('plat'), factoryArch: sum('factoryArch'),
    bldgs: ok.flatMap((g) => g.d.bldgs || []),
    parts: ok.map((g) => ({ addr: g.addr, jibun: g.d.jibun, arch: g.d.arch, tot: g.d.tot })),
    failed: got.filter((g) => g.err).map((g) => ({ addr: g.addr, err: g.err })),
    jibun: ok.map((g) => g.d.jibun).join(' · '),
  };
  try { localStorage.setItem(REF_BLD_KEY, JSON.stringify({ sig, at: Date.now(), data })); } catch {}
  return data;
}

// ── 실제 공장 소재지 선정 ──
// 한 회사의 주소가 기록마다 다르다. 셀랩을 예로 들면
//   식약처 제조업 허가: '충청남도 아산시'(시·군까지만) · 금융위 본점: 아산시 둔포면 윤보선로 291
//   국민연금 사업장: 서울 서초구(사무소) · 카카오맵 등록 장소: 아산시 둔포면 윤보선로 291
// 제조소 주소는 허가 기록(산단공 공장등록 > 식약처 제조업)이 법적 근거라 그 시·도·시·군을
// '공장 지역'으로 삼는다. 그 지역 밖 주소(서울 사무소 등)는 후보에서 뺀다. 지역 안 주소 가운데
// 번지까지 있는 것을, 허가 기록 > 카카오맵 등록 장소 > 본점 > 연금 순으로, 다른 기록과 같은
// 읍·면·동이면 가산해 고른다. 고른 주소는 건축물대장 열쇠(법정동코드+지번)로 이어진다.
const SITE_SRC = { factory: '공장등록(산단공)', maker: '제조업 허가(식약처)', place: '카카오맵 등록 장소', hq: '본점(금융위 등기)', nps: '연금 사업장' };
// 공장등록은 생산 설비가 실제로 있는 곳의 신고라 다른 기록과 읍·면이 달라도 앞세운다
const SITE_W = { factory: 9, maker: 5, place: 4, hq: 2, nps: 1 };
const siteRegion = (p) => (p && p.sido ? [p.sido, p.sgg, p.emd].filter(Boolean).join(' ') : '');
const sameArea = (a, p) => !!(a && a.sido && p && p.sido === a.sido && (!a.sgg || !p.sgg || a.sgg === p.sgg));
// 카카오맵에서 상호로 등록 장소 찾기 — 공장 지역을 알면 그 시·군 안의 것만 받는다
async function kakaoPlaceOf(name, area) {
  const nm = stripCorp(name);
  if (bldCompact(nm).length < 2) return null;
  const q = area && area.sgg ? `${area.sgg.replace(/(시|군|구)$/, '')} ${nm}` : nm;
  let docs = [];
  try { docs = ((await proxyOnlyGet('kakaoKeyword', { query: q, size: '10' })) || {}).documents || []; } catch { return null; }
  const key = bldCompact(nm);
  const hits = docs.filter((d) => bldCompact(stripCorp(d.place_name)).includes(key)
    && (!area || sameArea(area, nbAddrParts(d.address_name || d.road_address_name))));
  // 같은 이름의 카페·매장보다 화장품·제조 업종을 먼저
  hits.sort((a, b) => (/화장품|제조|공장|산업/.test(b.category_name || '') ? 1 : 0) - (/화장품|제조|공장|산업/.test(a.category_name || '') ? 1 : 0));
  const d = hits[0];
  if (!d) return null;
  return { addr: d.road_address_name || d.address_name, jibun: d.address_name || '', place: d.place_name, category: d.category_name || '', url: d.place_url || '' };
}
async function pickFactorySite({ name, fAddr, mAddr, mAddrs, nedAddrs, hqAddr, npsAddr }) {
  const makers = (mAddrs && mAddrs.length ? mAddrs : [mAddr]).filter(Boolean);
  const ned = new Set(nedAddrs || []);
  const cands = [['factory', fAddr], ...makers.map((a) => ['maker', a]), ['hq', hqAddr], ['nps', npsAddr]]
    .filter(([, a]) => a && String(a).trim())
    .map(([src, addr]) => ({ src, addr: String(addr).trim() }));
  cands.forEach((c) => { c.p = nbAddrParts(c.addr); c.full = isFullAddr(c.addr); if (c.src === 'maker' && ned.has(c.addr)) c.ned = true; });
  // 제조소가 여러 시·군에 있으면(코스맥스: 화성·평택) 그 지역들이 모두 공장 지역이다
  const anchors = cands.filter((c) => (c.src === 'factory' || c.src === 'maker') && c.p.sido);
  const anchorC = anchors[0] || null;
  const area = anchorC ? anchorC.p : null;
  const inAnyArea = (p) => anchors.some((a) => sameArea(a.p, p));
  const place = await kakaoPlaceOf(name, area).catch(() => null);
  if (place && place.addr) {
    const c = { src: 'place', addr: place.addr, jibun: place.jibun, place, p: nbAddrParts(place.addr), full: isFullAddr(place.addr) || isFullAddr(place.jibun) };
    cands.push(c);
  }
  cands.forEach((c) => {
    c.inArea = area ? inAnyArea(c.p) : null;
    c.agree = cands.filter((o) => o !== c && o.p.sido && o.p.sido === c.p.sido && o.p.sgg === c.p.sgg && (!c.p.emd || !o.p.emd || o.p.emd === c.p.emd)).map((o) => o.src);
    c.score = (c.full ? 20 : 0) + (c.inArea === false ? -100 : 0) + SITE_W[c.src] + c.agree.length * 2;
  });
  const ranked = cands.slice().sort((a, b) => b.score - a.score);
  // 공장 지역 밖 주소는 번지가 있어도 고르지 않는다 — 지역 안 주소가 시·군까지만 있으면 그것을 쓴다
  const pick = ranked.find((c) => c.full && c.inArea !== false) || ranked.find((c) => c.inArea !== false) || ranked[0] || null;
  if (!pick) return null;
  const why = [];
  if (area) {
    const regs = [...new Set(anchors.map((a) => siteRegion({ sido: a.p.sido, sgg: a.p.sgg })))];
    why.push(`허가 기록상 공장 지역 ${regs.join('·')} (${SITE_SRC[anchorC.src]})`);
  }
  const nMk = cands.filter((c) => c.src === 'maker' && c.full).length;
  if (nMk > 1) why.push(`식약처 등록 제조소 ${nMk}곳 중 하나 — 나머지는 '공장 면적' 탭에서 합산할 수 있습니다`);
  if (pick.agree.length) why.push(`${[...new Set(pick.agree.map((s) => SITE_SRC[s]))].join('·')}와 같은 지역`);
  if (!pick.full) why.push('번지까지 있는 주소가 없어 시·군 단위로만 확인');
  return {
    addr: pick.addr, src: pick.src, label: SITE_SRC[pick.src], why: why.join(' · '),
    area: area ? siteRegion({ sido: area.sido, sgg: area.sgg }) : null,
    place: place || null,
    cands: ranked.map((c) => ({ src: c.src, label: c.ned ? '제조업 허가(의약품안전나라)' : SITE_SRC[c.src], addr: c.addr, full: c.full,
      state: c === pick ? 'pick' : c.inArea === false ? 'out' : !c.full ? 'partial' : 'alt' })),
  };
}
// 선정 주소로 건축물대장을 찾고, 비면 공장 지역 안의 다른 번지 주소로 이어서 찾는다
async function bldAreaForSite(site, name) {
  if (!site) throw new Error('공장 주소 없음');
  const tries = [site.addr, ...site.cands.filter((c) => c.state === 'alt' && c.full).map((c) => c.addr)];
  if (site.place && site.place.jibun) tries.push(site.place.jibun);
  const seen = new Set(); const lots = new Set(); let firstErr = null;
  for (const a of tries) {
    const k = bldCompact(String(a).replace(/\([^)]*\)/g, ''));
    if (!a || seen.has(k)) continue;
    seen.add(k);
    try { return { ...(await bldAreaLookup(a, { name, seen: lots })), queried: a }; } catch (e) {
      if (e.dup) continue;
      if (/프록시|활용신청|NOT_REGISTERED|401|403/.test(e.message)) throw e;
      if (!firstErr) firstErr = e;
    }
  }
  throw firstErr || new Error('건축물대장 조회 실패');
}

// ── 여러 필지 합산 · 사용자가 고친 면적 주소 ──
// 공장이 여러 필지에 걸쳐 있으면 필지마다 대장이 따로 있다. 필지별 결과를 같은 지번은 한 번만 세어
// 더하고, 필지별 내역(parts)을 남겨 '공장 면적' 탭에서 하나씩 보이고 뺄 수 있게 한다.
function bldCombine(list, extra = {}) {
  const seen = new Set();
  const ps = list.filter((p) => p && p.jibun && !seen.has(p.jibun) && seen.add(p.jibun));
  if (!ps.length) return null;
  const s = (k) => ps.reduce((a, p) => a + (p[k] || 0), 0);
  const p0 = ps[0];
  return {
    ...p0,
    arch: s('arch'), tot: s('tot'), plat: s('plat'), factoryArch: s('factoryArch'), factoryTot: s('factoryTot'),
    bldgCount: s('bldgCount'), factoryCount: s('factoryCount'),
    purposes: [...new Set(ps.flatMap((p) => p.purposes || []))],
    collective: ps.some((p) => p.collective),
    firstApr: ps.map((p) => p.firstApr).filter(Boolean).sort()[0] || null,
    bldgs: ps.flatMap((p) => (p.bldgs || []).map((b) => ({ ...b, lotOf: p.jibun }))),
    jibun: ps.map((p) => p.jibun).join(' · '),
    parts: ps.map((p) => ({ queried: p.queried, jibun: p.jibun, keyJibun: p.keyJibun, matchedBy: p.matchedBy, key: p.key, road: p.road,
      arch: p.arch, tot: p.tot, plat: p.plat, factoryArch: p.factoryArch, factoryTot: p.factoryTot,
      bldgCount: p.bldgCount, factoryCount: p.factoryCount, purposes: p.purposes, collective: p.collective, firstApr: p.firstApr,
      bldgs: p.bldgs, src: p.src })),
    ...extra,
  };
}
// 업체별로 고친 면적 주소 { addr, lots:[추가 필지 주소] } — 다음 조회에도 그대로 쓴다
const AREA_OV_KEY = 'vs_area_addr';
const areaOvId = (name) => bldCompact(stripCorp(name || ''));
function areaOvGet(name) {
  try { const all = JSON.parse(localStorage.getItem(AREA_OV_KEY) || '{}'); return all[areaOvId(name)] || null; } catch { return null; }
}
function areaOvSet(name, v) {
  try {
    const all = JSON.parse(localStorage.getItem(AREA_OV_KEY) || '{}');
    if (v && (v.addr || (v.lots && v.lots.length))) all[areaOvId(name)] = v; else delete all[areaOvId(name)];
    localStorage.setItem(AREA_OV_KEY, JSON.stringify(all));
  } catch { /* 저장 차단 — 이번 화면에서만 적용 */ }
}
// 본 필지 결과(main) + 추가 필지 주소들 → 필지별 조회 후 합산. 추가 필지가 안 잡히면 사유를 남긴다.
async function bldWithLots(main, lots, name, extra = {}) {
  const got = lots.length
    ? await mapLimit(lots, 2, (a) => bldAreaLookup(a, { name }).then((d) => ({ ...d, queried: a })).catch((e) => ({ err: e.message, queried: a })))
    : [];
  return bldCombine([main, ...got.filter((g) => !g.err)], {
    ...extra, lots: lots.slice(),
    failedLots: got.filter((g) => g.err).map((g) => ({ addr: g.queried, err: g.err })),
  });
}

async function kakaoTravel(destAddr) {
  if (!getProxy()) throw new Error('프록시 미설정');
  if (!destAddr) throw new Error('방문 주소 없음');
  if (!_kolmarCoord) _kolmarCoord = await kakaoGeocode(KOLMAR_ADDR); // 실패(401 등) 시 여기서 throw
  if (!_kolmarCoord) throw new Error('기준점(한국콜마) 좌표 변환 실패');
  const dest = await kakaoGeocodeFlex(destAddr, { exact: true });
  if (!dest) throw new Error(`방문지 주소가 번지까지 확인되지 않아 거리를 재지 않았습니다: ${destAddr}`);

  // 1순위: 모빌리티 실측
  try {
    const dir = await proxyOnlyGet('kakaoDirections', {
      origin: `${_kolmarCoord.lng},${_kolmarCoord.lat}`,
      destination: `${dest.lng},${dest.lat}`,
    });
    const route = dir && dir.routes && dir.routes[0];
    if (route && (route.result_code == null || route.result_code === 0) && route.summary) {
      // 카카오는 통행료·택시요금도 함께 준다. 여태 거리·시간만 쓰고 버렸는데, 왕복 통행료는
      // 방문 품의를 올릴 때 바로 필요한 숫자다.
      const toll = route.summary.fare && isFinite(Number(route.summary.fare.toll))
        ? Number(route.summary.fare.toll) : null;
      return { km: Math.round(route.summary.distance / 1000), min: Math.round(route.summary.duration / 60),
        toll: toll && toll > 0 ? toll : null, method: 'navi', dest, destAddr };
    }
  } catch { /* 모빌리티 미이용 → 좌표 기반 추정으로 폴백 */ }

  // 2순위: 정확 좌표 하버사인 × 도로우회계수(1.3), 평균 62km/h
  const straight = haversineKm(_kolmarCoord.lat, _kolmarCoord.lng, dest.lat, dest.lng);
  if (straight < 1.5) return { km: 0, min: 0, same: true, method: 'coord', dest, destAddr };
  const km = Math.round(straight * 1.3);
  return { km, min: Math.round((km / 62) * 60), method: 'coord', dest, destAddr };
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

// 레코드에서 키 패턴에 맞는 첫 값 추출(식약처 필드명이 API마다 달라 견고 추출)
function pickByKey(rec, re) {
  for (const [k, v] of Object.entries(rec || {})) {
    if (v == null || String(v).trim() === '') continue;
    if (re.test(k)) return String(v).trim();
  }
  return null;
}
// 식약처 화장품제조업(CsmtcsMfcrtrInfoService01) — 제조소(공장) 한 곳당 한 건, 전체 약 3.3만 건.
// 실제 응답을 진단 워크플로우(diag-mfds)로 확인했다(2026-10):
//   항목 = INDUTY · ENTP_SEQ · ENTP_NAME · ENTP_PERMIT_DATE · FACTORY_ADDR · BIZRNO
//   FACTORY_ADDR는 '경기도 평택시'처럼 시·군·구까지만 준다 — 도로명·번지는 공개 API에 없다.
//   상호 필터는 entp_name만 먹는다. bssh_nm·entpName 등은 무시되고 무필터 500건이 와서 시간만 잡아먹었다.
// 번지까지 있는 제조소 주소는 의약품안전나라 업체정보(nedrugMaker)에서 따로 받는다.
// 주의: numOfRows 최대 500(초과 시 전체 호출 거부).
const MAKER_NAME_PARAMS = ['entp_name'];
// ── 의약품안전나라 화장품제조업 업체정보 ──
// 공개 API에 없는 '번지까지 있는 제조소 주소'와 업허가번호가 여기 있다(사용자가 보는 그 화면).
//   목록: /pbp/CCBBA01/getList?cobCode=V(화장품제조)&entpName=상호 → 업체명·업종·허가일자·주소(제조소 전부를 한 줄로)
//   상세: getItem?…&entpSeq= → 업허가번호와 공장정보 표(제조소 한 곳당 한 줄)
// 화면을 읽는 것이라 구조가 바뀌면 조용히 빈 값이 된다 — 그때는 공개 API 값으로 물러선다.
const NEDRUG = 'https://nedrug.mfds.go.kr';
const nedTxt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function nedrugListRows(html) {
  return [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const tr = m[1];
    const href = (tr.match(/href=["']([^"']*getItem[^"']*)["']/i) || [])[1];
    if (!href) return null;
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => nedTxt(x[1]));
    // 순번 · 업체명 · 업종 · 허가일자 · 주소
    return { href: href.replace(/&amp;/g, '&'), name: tds[1] || '', induty: tds[2] || '', date: tds[3] || '', addr: tds[4] || '',
      seq: (href.match(/entpSeq=(\d+)/) || [])[1] || '' };
  }).filter(Boolean);
}
function nedrugDetail(html) {
  const h = String(html || '');
  const t = nedTxt(h);
  const permitNo = (t.match(/업허가번호\s*([0-9A-Za-z-]+)/) || [])[1] || null;
  // 공장정보 표 — '공장정보' 뒤의 행들. 머리줄(th)은 건너뛴다.
  const at = h.search(/공장정보/);
  const seg = at >= 0 ? h.slice(at, at + 20000) : '';
  const factories = [...seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => nedTxt(x[1])))
    .filter((tds) => tds.length >= 2 && /(시|군|구|도)\s/.test(tds[1]))
    .map((tds) => ({ name: tds[0] && tds[0] !== 'N/A' ? tds[0] : '', addr: tds[1] }));
  return { permitNo, factories };
}
// '경기도 화성시 만세구 향남읍 제약공단1길 27 , 2길 46, 경기도 평택시 청북읍 고렴산단로 51, 1동, 2동, …'
// 처럼 한 줄에 여러 제조소가 이어진 주소를 곳별로 나눈다. 쉼표 뒤가
//   시·도로 시작 → 새 주소 / '2길 46'처럼 길 번호만 → 앞 주소의 도로 이름을 이어 새 주소 /
//   '○○로 12' → 앞 주소의 읍·면·동까지 붙여 새 주소 / 그 밖('1동', '2층') → 앞 주소의 상세
function splitSiteAddrs(str) {
  const SIDO = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;
  const out = [];
  String(str || '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean).forEach((tok) => {
    const prev = out[out.length - 1];
    if (SIDO.test(tok) || !prev) { out.push({ base: tok, detail: [] }); return; }
    const road = prev.base.match(/^(.*?\s)([가-힣A-Za-z0-9]+?)(\d+)(번?길)\s*\d/);         // 제약공단1길 27 → 앞부분·도로 이름
    if (/^\d+번?길\s*\d/.test(tok) && road) { out.push({ base: `${road[1]}${road[2]}${tok}`, detail: [] }); return; }
    const region = prev.base.match(/^(.*?(?:읍|면|동|가)\s)/) || prev.base.match(/^(.*?(?:시|군|구)\s)/);
    if (/^[가-힣A-Za-z0-9]+(?:로|길)\s*\d/.test(tok) && region) { out.push({ base: `${region[1]}${tok}`, detail: [] }); return; }
    prev.detail.push(tok);
  });
  // 도로명 번호 뒤의 동·층('1동 1층 일부')은 주소가 아니라 상세다 — 좌표·건축물대장은 번호까지로 찾는다
  return out.map((o) => {
    const base = o.base.replace(/\s+/g, ' ').trim();
    const m = base.match(/^(.*?(?:로|길)\s*\d+(?:-\d+)?)(?:\s+(.+))?$/);
    return m ? { addr: m[1], detail: [m[2], ...o.detail].filter(Boolean).join(', ') } : { addr: base, detail: o.detail.join(', ') };
  });
}
async function nedrugMakerRaw(name) {
  const key = stripCorp(name).replace(/\s/g, '');
  if (key.length < 2) return null;
  const listUrl = `${NEDRUG}/pbp/CCBBA01/getList?searchYn=true&page=1&limit=50&cobCode=V&entpName=${encodeURIComponent(stripCorp(name))}`;
  const lr = await proxyOnlyGet('fetchPage', { url: listUrl });
  const rows = nedrugListRows(lr && lr.text);
  const nk = (s) => stripCorp(s).replace(/\s/g, '');
  const exact = rows.filter((r) => nk(r.name) === key);
  const hit = exact[0] || (rows.length === 1 && nk(rows[0].name).includes(key) ? rows[0] : null);
  if (!hit) return { found: false, rows: rows.map((r) => r.name), url: listUrl };
  let det = { permitNo: null, factories: [] };
  try { const d = await proxyOnlyGet('fetchPage', { url: `${NEDRUG}${hit.href}` }); det = nedrugDetail(d && d.text); } catch { /* 목록 주소로 */ }
  // 공장정보 표가 있으면 그 줄들을, 없으면 목록의 한 줄 주소를 나눠 쓴다. 표의 한 줄에도 여러 곳이 이어질 수 있어 다시 나눈다.
  const src = det.factories.length ? det.factories.map((f) => f.addr) : [hit.addr];
  const seen = new Set();
  const sites = src.flatMap(splitSiteAddrs).filter((x) => x.addr && !seen.has(x.addr) && seen.add(x.addr));
  return { found: true, name: hit.name, induty: hit.induty, permitDate: hit.date, permitNo: det.permitNo, addrLine: hit.addr,
    sites, entpSeq: hit.seq, url: `${NEDRUG}${hit.href}`, others: exact.length > 1 ? exact.length - 1 : 0 };
}
const nedrugMaker = (name) => memoAsync(`ned|${stripCorp(name)}`, 600000, () => nedrugMakerRaw(name));

// 후보 추천(mfdsCandidates)과 리포트 조립(finishLive)이 같은 상호로 연달아 부른다 — 10분간 한 벌로
const makerLookup = (nm) => memoAsync(`maker|${nm}`, 600000, () => makerLookupRaw(nm));
async function makerLookupRaw(nm) {
  const settled = await Promise.allSettled(
    MAKER_NAME_PARAMS.map((p) => proxyOnlyGet('maker', { [p]: nm, numOfRows: '500' })),
  );
  const merged = [];
  const seen = new Set();
  let anyOk = false, lastErr = '';
  for (const s of settled) {
    if (s.status !== 'fulfilled') { lastErr = String(s.reason && s.reason.message || s.reason); continue; }
    anyOk = true;
    // 항목이 { item: {...} }로 한 겹 싸여 오는 응답도 있다 — 벗겨서 쓴다
    // 이 API에는 제조업 말고 책임판매업(2.8만 건)·맞춤형판매업도 섞여 온다(진단 2026-10: 화장품제조 4,318 ·
    // 화장품책임판매 28,374 · 맞춤형화장품판매 234). 업종이 '제조'가 아니면 제조업 등록으로 보지 않는다.
    const list = listOf(s.value, ['response.body.items.item', 'body.items', 'items']).map((r) => (r && r.item && typeof r.item === 'object' ? r.item : r))
      .filter((r) => !r || r.INDUTY == null || (/제조/.test(String(r.INDUTY)) && !/판매/.test(String(r.INDUTY))));
    for (const r of list) {
      const sig = JSON.stringify(r);
      if (seen.has(sig)) continue;      // 후보키 간 중복 제거
      seen.add(sig);
      merged.push(r);
      if (merged.length >= 4000) break; // 안전 상한
    }
    if (merged.length >= 4000) break;
  }
  if (!anyOk) throw new Error(lastErr || '식약처 제조업 조회 실패');
  // 상호 키가 하나도 안 먹으면 위 응답은 '무필터 첫 500건'이라, 명단 뒤쪽(최근 허가 업체)은
  // 영영 안 걸린다(에스제이바이오: 2026-03 허가 → 제조업 미등록으로 보임). 이 업체가 안 보이면
  // 식약처 명단 전체(근처 업체 탭과 같은 세션 캐시)에서 다시 찾는다.
  let register = null;
  if (!matchByNameApp(nm, merged) && typeof nbMfdsAll === 'function') {
    try {
      const all = await nbMfdsAll();
      const key = nbNorm(nm);
      const hits = key.length >= 2 ? all.list.filter((x) => x.key && (x.key === key || (key.length >= 3 && x.key.includes(key)))) : [];
      hits.forEach((x) => { if (x.raw) merged.unshift(x.raw); });
      register = { searched: true, total: all.total, size: all.list.length, full: all.full, hits: hits.length };
    } catch (e) { register = { searched: false, err: e && e.message ? e.message : String(e) }; }
  }
  return { items: merged, register };
}

// 식약처 화장품제조업 등록업체 기준 후보 — 상호명으로 조회해 등록 업체명(중복제거) 목록화
async function mfdsCandidates(name) {
  let list = [];
  try { list = listOf(await makerLookup(name), ['items']); } catch { return []; }
  // 상호 실제 포함 레코드만(무필터 응답 노이즈 제거) — 후보가 남의 회사로 오염되지 않도록
  const nk = stripCorp(name).replace(/\s/g, '');
  if (nk.length >= 2) list = list.filter((r) => Object.values(r).some((v) => stripCorp(String(v == null ? '' : v)).replace(/\s/g, '').includes(nk)));
  const seen = new Set(); const out = [];
  for (const r of list) {
    const nm = pickByKey(r, /BSSH_NM|CMPNY_NM|ENTRPS_?NM|MANF|업체|회사|제조사/i) || pickByKey(r, /_NM$/i);
    if (!nm) continue;
    const key = stripCorp(nm).replace(/\s/g, '');
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      corpNm: nm,
      rep: pickByKey(r, /PRSNL|PRSDNT|RPRSNTV|REPRE|대표/i),
      addr: pickByKey(r, /ADDR|SITE|LOCP|소재지|주소/i),
      lcns: pickByKey(r, /LCNS_?NO|PERMIT|허가/i),
      mfds: true,
    });
    if (out.length >= 12) break;
  }
  // 공개 API에 없으면(최근 허가 등) 의약품안전나라 업체 검색으로 후보를 만든다
  if (!out.length) {
    try {
      const url = `${NEDRUG}/pbp/CCBBA01/getList?searchYn=true&page=1&limit=50&cobCode=V&entpName=${encodeURIComponent(stripCorp(name))}`;
      const r = await proxyOnlyGet('fetchPage', { url });
      nedrugListRows(r && r.text).filter((x) => stripCorp(x.name).replace(/\s/g, '').includes(nk)).slice(0, 12)
        .forEach((x) => out.push({ corpNm: x.name, rep: null, addr: x.addr, lcns: null, mfds: true, nedrug: true }));
    } catch { /* 의약품안전나라도 못 읽으면 후보 없음 */ }
  }
  return out;
}
// 식약처 후보 선택 시: 정확한 등록업체명으로 금융위 재조회(법인 매칭되면 법인/재무 확보) → 없으면 상호명 조회
async function finishLiveMfds(name, cand) {
  const nk = (s) => stripCorp(s || '').replace(/\s/g, '');
  try {
    const cc = window.mapCorpCandidates(await proxyGet('corp', { name: cand.corpNm }));
    const exact = cc.find((x) => nk(x.corpNm) === nk(cand.corpNm)) || (cc.length === 1 ? cc[0] : null);
    if (exact) return await finishLive(cand.corpNm, exact);
  } catch { /* 금융위 재조회 실패 → 상호명 기반 */ }
  return await finishLive(cand.corpNm, { corpNm: cand.corpNm });
}

// 1단계: 기준정보(동명업체 후보) 조회 → {candidates} 또는 {report}
//  금융위 법인 후보 우선 → 없으면 식약처 등록업체 기준 후보 추천 → 그래도 없으면 상호명 조회
async function liveLookup(name) {
  // ── 사업자등록번호 입력/병기 지원 ── "143-81-19635" 또는 "코스맥스 143-81-19635"처럼
  //    번호가 섞이면 금융위 corp를 bzno로 직접 조회(동명 계열사 중 정확한 법인 특정 → 신뢰성↑)
  const bnoM = String(name).match(/(\d{3})-?(\d{2})-?(\d{5})/) || String(name).match(/(?<!\d)(\d{10})(?!\d)/);
  const bno = bnoM ? bnoM[0].replace(/\D/g, '') : null;
  const nameOnly = bno ? String(name).replace(bnoM[0], '').replace(/[\s,]+/g, ' ').trim() : String(name);
  const tryCorp = async (q, extra) => { try { return window.mapCorpCandidates(await proxyGet('corp', { ...(q ? { name: q } : {}), ...(extra || {}) })); } catch { return []; } };
  if (bno) {
    // (1) 금융위 corp를 bzno 파라미터로 직접 조회(지원 시 정확) …
    let byBno = await tryCorp(null, { bzno: bno });
    // (2) …미지원/0건이면 상호로 후보를 받아 bzno가 일치하는 법인을 선별(병기 조회 = 신뢰성↑).
    //     동명 계열사(코스맥스(주) vs 코스맥스엔비티) 중 요청한 사업자번호의 법인만 특정.
    if (!byBno.length && nameOnly) {
      const byName = await tryCorp(nameOnly);
      const exact = byName.filter((c) => String(c.bzno || '').replace(/\D/g, '') === bno);
      if (exact.length) byBno = exact;
      else if (byName.length) {
        // bzno가 후보에 없으면(금융위 미수록) 상호 후보를 그대로 제시 — 사용자가 선택
        return byName.length === 1
          ? { report: await finishLive(nameOnly, { ...byName[0], bzno: byName[0].bzno || bno }) }
          : { candidates: byName, name: `${nameOnly} (사업자 ${bno})`, source: 'fsc' };
      }
    }
    if (byBno.length === 1) return { report: await finishLive(nameOnly || byBno[0].corpNm, { ...byBno[0], bzno: byBno[0].bzno || bno }) };
    if (byBno.length >= 2) {
      const hit = nameOnly ? matchByNameApp(nameOnly, byBno) : null;
      if (hit) return { report: await finishLive(nameOnly, { ...hit, bzno: hit.bzno || bno }) };
      return { candidates: byBno, name: nameOnly || bno, source: 'fsc' };
    }
    // 금융위 법인 0건 → 사업자번호로 국세청·국민연금·식약처·집계까지 최대 조회(개인/소규모 대응)
    return { report: await finishLive(nameOnly || bno, { corpNm: nameOnly || bno, bzno: bno }) };
  }

  let cands = await tryCorp(name);
  // 금융위가 순수 상호로 0건이면 법인 형태 변형으로 재시도(개인→법인 전환·표기차 대응)
  // 세 표기를 차례로 부르면 0건일 때마다 왕복이 쌓인다 — 한꺼번에 부르고 앞 순서부터 채택
  if (!cands.length) {
    const vs = await Promise.all([`주식회사 ${name}`, `${name} 주식회사`, `(주)${name}`].map((v) => tryCorp(v)));
    cands = vs.find((x) => x.length) || [];
  }

  if (cands.length === 1) return { report: await finishLive(name, cands[0]) };
  if (cands.length >= 2) return { candidates: cands, name, source: 'fsc' };

  // 금융위 법인 0건(애매·개인사업자·명칭불일치) → 식약처 등록업체 기준 추천
  const mfdsC = await mfdsCandidates(name);
  if (mfdsC.length >= 2) return { candidates: mfdsC, name, source: 'mfds' };
  if (mfdsC.length === 1) return { report: await finishLiveMfds(name, mfdsC[0]) };

  // ── 유사 상호 추천 ──
  // 정확히 같은 이름이 없다고 바로 포기하지 않는다. 표기를 조금 다르게 쳤을 뿐인 경우가 많다.
  // 앞 두세 글자로 후보를 넓게 받아, 표기 흔들림을 접은 유사도로 골라 제시한다.
  const core = stripCorp(name).replace(/\s/g, '');
  if (core.length >= 3) {
    const pool = new Map();
    const seeds = [...new Set([core.slice(0, 2), core.slice(0, 3), core.slice(0, 4)])].filter((x) => x.length >= 2);
    const got = await mapLimit(seeds, 3, (q) => tryCorp(q));
    got.forEach((list) => (list || []).forEach((c) => {
      const k = String(c.crno || c.bzno || c.corpNm);
      if (!pool.has(k)) pool.set(k, c);
    }));
    const near = [...pool.values()]
      .map((c) => ({ ...c, _sim: nameSimilarity(core, c.corpNm || '') }))
      .filter((c) => c._sim >= 0.8)                       // 표기 흔들림 수준까지만 — 다른 회사는 배제
      .sort((a, b) => b._sim - a._sim)
      .slice(0, 8);
    if (near.length === 1 && near[0]._sim >= 0.95) {
      return { report: await finishLive(near[0].corpNm, near[0]), similarUsed: { typed: name, picked: near[0].corpNm } };
    }
    if (near.length) return { candidates: near, name, source: 'fsc', similar: true };
  }

  // 식약처에도 후보 없음 → 상호명 기반으로 나머지 소스 최대한 조회
  return { report: await finishLive(name, { corpNm: name }) };
}

// ── 상호 유사도 ──
// 같은 회사를 사람마다 다르게 적는다. (주)다산씨엔텍을 다산씨앤텍·다산씨엔택으로 치는 식이다.
// 대부분 한글 표기 흔들림이라, 자모로 분해해 헷갈리는 소리끼리 같은 값으로 접은 뒤 비교한다.
//   모음  ㅐ·ㅒ·ㅔ·ㅖ → 하나로 (씨엔텍 = 씨앤텍, 텍 = 택)
//         ㅙ·ㅚ·ㅞ → 하나로 (왜·외·웨)
//         ㅢ → ㅣ (의 = 이)
//   초성  된소리를 예사소리로 (ㅆ→ㅅ 씨 = 시, ㄲ→ㄱ, ㄸ→ㄷ, ㅃ→ㅂ, ㅉ→ㅈ)
//   받침  ㄲ·ㅋ → ㄱ, ㅆ → ㅅ
const V_FOLD = { 3: 1, 5: 1, 7: 1, 10: 11, 15: 11, 19: 20 };
const C_FOLD = { 1: 0, 4: 3, 8: 7, 10: 9, 13: 12 };
const T_FOLD = { 2: 1, 24: 1, 20: 19 };
function hangulFold(str) {
  let out = '';
  for (const ch of String(str || '').toLowerCase()) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c >= 0 && c < 11172) {
      let cho = Math.floor(c / 588), jung = Math.floor((c % 588) / 28), jong = c % 28;
      cho = C_FOLD[cho] ?? cho; jung = V_FOLD[jung] ?? jung; jong = T_FOLD[jong] ?? jong;
      out += `${cho},${jung},${jong}|`;
    } else if (/[a-z0-9]/.test(ch)) {
      out += `${ch}|`;
    }
    // 공백·기호는 버린다 — 띄어쓰기 차이로 다른 회사가 되지 않게
  }
  return out;
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
// 0~1. 1이면 표기 흔들림까지 감안해 같은 이름.
function nameSimilarity(a, b) {
  const A = hangulFold(stripCorp(a)).split('|').filter(Boolean);
  const B = hangulFold(stripCorp(b)).split('|').filter(Boolean);
  if (!A.length || !B.length) return 0;
  const d = levenshtein(A, B);
  return 1 - d / Math.max(A.length, B.length);
}

// 법인 접두/접미어 제거 — 식약처/국민연금은 순수 상호로 조회해야 매칭됨
function stripCorp(s) {
  return String(s || '').replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사/g, '').trim();
}
// 목록에서 상호가 실제 일치하는 레코드만 반환(불일치 시 null — 남의 회사 데이터 오염 방지). samples.js와 동일 로직.
function matchByNameApp(name, list) {
  const key = stripCorp(name).replace(/\s/g, '');
  if (key.length < 2 || !Array.isArray(list)) return null;
  return list.find((it) => Object.values(it).some((v) => {
    const gn = stripCorp(String(v == null ? '' : v)).replace(/\s/g, '');
    // 종전 조건은 gn.length >= 3 이었다. 그런데 '주식회사 셀랩'에서 법인격을 떼면 '셀랩'
    // 두 글자라, 두 글자 상호는 자기 레코드에도 영영 걸리지 못했다(제조업 등록이 통째로 빈 채로).
    // 값이 검색어보다 짧을 수 없다는 조건이면 충분하고, 그건 includes가 이미 보장한다.
    return gn.length >= key.length && gn.includes(key);
  })) || null;
}

// NPS(B552015) 응답 파서 — resultType=json이면 서버가 500 크래시 → XML로 받아 파싱.
// (혹시 JSON이면 그대로 파싱) 반환: item 객체 배열.
// 국민연금 2단계(V2·JSON): 사업장 검색 → 첫 건 seq로 상세조회(가입자수 jnngpCnt는 상세에만 있음)
// 사업자등록번호(bzowrRgstNo) 우선, 0건이면 상호명(wkplNm)으로 폴백.
async function npsLookup(nm, bzno) {
  const digits = bzno ? String(bzno).replace(/\D/g, '') : '';
  let items = [], byBzno = false;
  if (digits.length >= 10) {
    try { items = itemsOf(await proxyGet('npsSearch', { bz: digits })); byBzno = items.length > 0; } catch { /* 상호명으로 폴백 */ }
  }
  if (!items.length) items = itemsOf(await proxyGet('npsSearch', { name: nm }));
  if (!items.length) return { search: null, detail: null, count: 0, total: null, sites: 0, byBzno };

  // 대기업은 본사·공장별로 국민연금 사업장이 분리 등록됨 → 가입자수를 사업장별로 조회해 합산.
  // 가입자수(jnngpCnt)는 상세조회에만 있어 seq별 호출(상위 18개, 동시 6개로 제한 — 연결 포화 방지).
  const targets = items.slice(0, 18).filter((it) => it.seq != null && it.seq !== '');
  const details = await mapLimit(targets, 6, (it) =>
    proxyGet('npsDetail', { seq: it.seq, ym: it.dataCrtYm }).then((d) => itemsOf(d)[0] || null).catch(() => null));
  const cnt = (d) => Number(d && (d.jnngpCnt ?? d.subscrCnt)) || 0;
  const counts = details.map(cnt);
  const sumAll = counts.reduce((a, b) => a + b, 0);
  let maxIdx = 0; counts.forEach((c, i) => { if (c > counts[maxIdx]) maxIdx = i; });

  // ★ 그동안 버리던 월 갱신 지표 회수 — 재무가 오래된 업체에서 '현재 상태'를 보여주는 핵심 근거.
  //   신규취득/상실 = 인력 증감(채용·감원), 당월고지금액 = 인건비 규모 추정 재료.
  const numOf = (d, ...keys) => { for (const k of keys) { const v = d && d[k]; if (v != null && v !== '') { const n = Number(String(v).replace(/,/g, '')); if (isFinite(n)) return n; } } return 0; };
  const hasKey = (d, ...keys) => keys.some((k) => d && d[k] != null && d[k] !== '');
  const pick = byBzno ? details : [details[maxIdx] || details[0]];   // 상호조회는 대표 사업장만(타사 혼입 방지)
  const NEW_K = ['nwAcqzrCnt', 'newAcqzrCnt', 'acqzrCnt', 'nwAcqzrCnt1'];
  const LOST_K = ['lssJnngpCnt', 'lossJnngpCnt', 'lssCnt', 'lssJnngpCnt1'];
  let newCnt = 0, lostCnt = 0, noticeAmt = 0, churnKnown = false;
  pick.forEach((d) => {
    if (!d) return;
    // ★ 값이 0인 것(그 달에 입·퇴사 없음)과 필드 자체가 없는 것을 구분해야 한다.
    //   0을 '자료 없음'으로 처리하면 '변동 없음'이 공백으로 보인다.
    if (hasKey(d, ...NEW_K) || hasKey(d, ...LOST_K)) churnKnown = true;
    newCnt += numOf(d, ...NEW_K);
    lostCnt += numOf(d, ...LOST_K);
    noticeAmt += numOf(d, 'crrmmNtcAmt', 'currentMonthNoticeAmount', 'ntcAmt');
  });
  // 필드를 못 찾았을 때 실제 응답의 숫자형 키를 남겨 다음 조회에서 이름을 확인할 수 있게 한다
  const sample = pick.find(Boolean) || null;
  const numKeys = churnKnown || !sample ? null
    : Object.keys(sample).filter((k) => /cnt|amt|co$/i.test(k)).slice(0, 12).join(', ');
  // 국민연금 보험료율 9%(근로자+사용자) → 고지금액 ÷ 0.09 ≈ 사업장 기준소득월액 합계.
  // 기준소득월액에 상한·하한이 있어 고소득자는 과소 반영되므로 '하한 추정'으로만 사용.
  const payrollEst = noticeAmt > 0 ? Math.round(noticeAmt / 0.09) : null;

  // 사업자번호 조회면 전 사업장이 동일 사업자 → 합산 안전. 상호명 조회는 타 계열사 혼입 위험 → 최대 사업장 1곳만.
  const total = byBzno ? (sumAll || null) : (counts[maxIdx] || null);
  const activeSites = counts.filter((c) => c > 0).length;
  return {
    search: items[maxIdx] || items[0] || null,      // 대표(최대) 사업장 — 주소/기준월 표기용
    detail: details[maxIdx] || details[0] || null,
    count: items.length,
    total,
    sites: byBzno ? activeSites : 1,
    byBzno,
    newCnt, lostCnt, noticeAmt, payrollEst,          // 월 갱신 지표
    churnKnown, numKeys,                             // 취득·상실 필드 확보 여부 / 미확보 시 후보 키 목록
  };
}

// ── 금융위 재무 조회 (최신 연도 확보 강화) ──
// 한 페이지만 받으면 레코드가 많은 법인은 최신 회계연도가 잘려 옛 자료만 남는다.
// ① 여러 페이지를 모아 받고 ② 그래도 최신이 오래됐으면 최근 연도를 bizYear로 직접 조회해 보완.
async function financeLookup(crno) {
  const all = [];
  const paths = ['response.body.items.item', 'body.items'];
  const yearOf = (r) => Number(r && (r.bizYear || r.biz_year)) || 0;
  // ① 페이지 수집(최대 3페이지 × 500건)
  let firstErr = null;
  for (let page = 1; page <= 3; page++) {
    let d;
    try { d = await proxyGet('finance', { crno, rows: '500', page: String(page) }); }
    catch (e) { if (page === 1) firstErr = e; break; }
    const list = listOf(d, paths);
    all.push(...list);
    if (list.length < 500) break;         // 마지막 페이지
  }
  if (!all.length && firstErr) throw firstErr;
  // ② 최신 연도가 2년 이상 뒤처지면 최근 연도를 직접 지정해 재조회(누락 회수)
  const nowY = new Date().getFullYear();
  let maxY = all.reduce((m, r) => Math.max(m, yearOf(r)), 0);
  // 왜 최신 연도를 못 얻었는지 화면에서 판단할 수 있도록 시도 결과를 기록(실패를 조용히 삼키지 않음)
  const diag = { summaryYears: [...new Set(all.map(yearOf).filter(Boolean))].sort((a, b) => b - a), probe: null, acct: null };
  if (maxY && maxY < nowY - 1) {
    const probes = [];
    for (let y = nowY - 1; y > maxY && probes.length < 6; y--) probes.push(y);
    const got = await Promise.allSettled(probes.map((y) =>
      proxyGet('finance', { crno, year: String(y), rows: '100' })));
    let hit = 0, err = null;
    got.forEach((g, i) => {
      if (g.status === 'fulfilled') { const rows = listOf(g.value, paths); hit += rows.length; all.push(...rows); }
      else if (!err) err = `${probes[i]}년: ${String(g.reason && g.reason.message || g.reason).slice(0, 60)}`;
    });
    diag.probe = { years: probes, rows: hit, err };
  }
  // ③ 요약재무에 최근 연도가 없으면, 같은 서비스의 재무상태표·손익계산서(계정과목 단위)로 보완.
  //    요약재무제표는 미수록이어도 계정 단위 자료는 있는 경우가 있어 최신 연도를 살릴 수 있다.
  maxY = all.reduce((m, r) => Math.max(m, yearOf(r)), 0);
  if (!maxY || maxY < nowY - 1) {
    const wants = [];
    for (let y = nowY - 1; y > Math.max(maxY, nowY - 6); y--) wants.push(y);
    const got = await Promise.allSettled(wants.flatMap((y) => [
      proxyGet('financeBs', { crno, year: String(y), rows: '200' }).then((d) => ({ y, kind: 'bs', d })),
      proxyGet('financeIs', { crno, year: String(y), rows: '200' }).then((d) => ({ y, kind: 'is', d })),
    ]));
    const byYear = new Map();
    let acctRows = 0, acctErr = null;
    got.forEach((g) => {
      if (g.status !== 'fulfilled') {
        if (!acctErr) acctErr = String(g.reason && g.reason.message || g.reason).slice(0, 80);
        return;
      }
      const { y, d } = g.value;
      const rows = listOf(d, paths);
      acctRows += rows.length;
      if (!rows.length) return;
      const rec = byYear.get(y) || { bizYear: String(y), _fromAccounts: true };
      // 계정명·금액 필드명이 확정적이지 않아 키 패턴으로 견고하게 추출
      for (const r of rows) {
        let nm = null, amt = null;
        for (const [k, v] of Object.entries(r)) {
          if (v == null || v === '') continue;
          if (nm == null && /(acit|acnt|acct|계정|item).*(nm|name|명)?/i.test(k) && /[가-힣]/.test(String(v))) nm = String(v);
          if (amt == null && /(crtm|thqr|당기|amt|amount)/i.test(k) && /^-?[\d,.]+$/.test(String(v).trim())) amt = String(v).replace(/,/g, '');
        }
        if (!nm || amt == null) continue;
        const n = nm.replace(/\s/g, '');
        if (/^매출액$|^수익\(매출액\)$|^영업수익$/.test(n) && rec.enpSaleAmt == null) rec.enpSaleAmt = amt;
        else if (/^영업이익/.test(n) && rec.enpBzopPft == null) rec.enpBzopPft = amt;
        else if (/^자산총계$/.test(n) && rec.enpTastAmt == null) rec.enpTastAmt = amt;
        else if (/^부채총계$/.test(n) && rec.enpTdbtAmt == null) rec.enpTdbtAmt = amt;
        else if (/^자본금$/.test(n) && rec.enpCptlAmt == null) rec.enpCptlAmt = amt;
        // 당기순이익도 계정과목에 있다. 여태 안 읽어서, 공시가 있는 업체인데도 순이익만은
        // 채용사이트 값(등급 C)으로 표시됐다.
        else if (/^당기순이익/.test(n) && rec.enpCrtmNpf == null) rec.enpCrtmNpf = amt;
      }
      byYear.set(y, rec);
    });
    // 값이 하나라도 채워진 연도만 채택
    let adopted = 0;
    for (const rec of byYear.values()) {
      if (rec.enpSaleAmt != null || rec.enpTastAmt != null || rec.enpBzopPft != null) { all.push(rec); adopted++; }
    }
    diag.acct = { years: wants, rows: acctRows, adopted, err: acctErr };
  }
  if (!all.length) throw new Error('재무 레코드 없음');
  return { body: { items: all }, _diag: diag }; // assembleLiveReport의 listOf가 읽는 형태 + 진단
}

// ── 국세청 사업자등록 진위확인 ──
// 상태조회(휴·폐업)와 달리 "사업자번호 + 개업일 + 대표자명"이 등록증과 일치하는지 검증한다.
// 금융위 기업기본정보의 대표자·설립일이 국세청 원부와 맞는지 확인 = 실체 검증의 핵심 근거.
async function ntsValidate(bzno, repNm, startDt) {
  const b = String(bzno || '').replace(/\D/g, '');
  const d = String(startDt || '').replace(/\D/g, '').slice(0, 8);
  const p = String(repNm || '').trim();
  if (b.length !== 10 || d.length !== 8 || !p) return null;      // 3요소 다 있어야 검증 가능
  let res;
  try { res = await proxyOnlyGet('ntsValidate', { b_no: b, start_dt: d, p_nm: p }); }
  catch (e) { return { ok: false, err: e && e.message ? e.message : String(e) }; }
  const it = res && Array.isArray(res.data) ? res.data[0] : null;
  if (!it) return { ok: false, err: '응답 없음' };
  // valid: '01' 일치 / '02' 확인 불가(불일치)
  return {
    ok: true, valid: it.valid === '01',
    code: it.valid || null,
    msg: (it.valid_msg || '').trim() || null,
    checked: { bzno: b, rep: p, startDt: d },
  };
}

// ── 채용공고 추적 (다개년) ──
// 왜 필요한가: 이 시스템의 대상은 대부분 뉴스도 홈페이지도 없는 영세 제조업체다. 그런 업체도
//   사람은 뽑기 때문에, 채용공고는 거의 유일하게 꾸준히 남는 활동 흔적이다.
// 무엇을 읽어내는가:
//   · 같은 직종이 짧은 주기로 반복 → 충원이 안 되거나 이탈이 잦다(이직 신호)
//   · 최근 공고가 급증하고 직종이 넓어짐 → 증설·라인 신설 가능성
//   · 채용 사이트가 공개하는 사원수(기준일 포함)를 연금 가입자수와 대조 → 인력 증감 확인
// 한계(반드시 함께 표시): 마감된 공고는 사이트에서 내려가 검색에 잡히지 않는다. 따라서
//   '수집된 범위 안에서의' 빈도이며 과거일수록 적게 잡히는 편향이 있다. 공고 건수는 채용
//   인원이 아니며 같은 자리를 반복 게시한 것일 수도 있다. 그래서 결과는 전부 추정으로 낸다.

const HIRE_HOSTS = /(jobkorea|saramin|incruit|albamon|alba\.co\.kr|work24|worknet|jobplanet|wanted\.co\.kr|catch\.co\.kr|kosmes|jobaba|hrd\.go\.kr|superpass|rocketpunch)/i;
const HIRE_WORDS = /(채용|구인|모집|경력직|신입|입사지원|리크루트|일자리)/;
// 화장품 제조 현장 기준 직종 분류 — 어느 직종이 반복되는지가 해석의 핵심이다
const HIRE_ROLES = [
  ['생산·제조', /(생산|제조|충전|충포장|포장|현장직|오퍼레이터|조색|칭량|믹싱|반제품|라인)/],
  ['품질(QC·QA)', /(품질|\bQC\b|\bQA\b|시험|검사|미생물|분석)/i],
  ['연구개발', /(연구|R&D|개발|처방|제형|연구소)/i],
  ['설비·공무', /(공무|설비|보전|기계|전기|시설|유틸리티)/],
  ['물류·자재', /(물류|자재|구매|입출고|창고|지게차|배송)/],
  ['영업·해외', /(영업|수출|해외|무역|마케팅|\bMD\b)/i],
  ['사무·관리', /(경리|회계|총무|인사|사무|재무|관리직)/],
];
function hireRole(text) {
  const s = String(text || '');
  for (const [label, re] of HIRE_ROLES) if (re.test(s)) return label;
  return '기타·불명';
}
// 공고 텍스트에서 연·월을 뽑는다.
// 채용 사이트 제목에는 "2026년 유스케어팜 채용", "2026년 진행 중인 공고 확인하기"처럼
// 검색 노출용으로 '현재 연도'가 박혀 있다. 공고 시점이 아니라 페이지를 언제 보든 올해가 붙는다.
// 유스케어팜 조회에서 10건 중 8건이 이 문구였고, 그 탓에 전부 최근 12개월로 집계돼
// "최근 10건 vs 직전 0건 → 증설 급증"이라는 없는 신호가 만들어졌다.
// 그래서 근거가 분명한 두 가지만 인정한다.
//   ① 등록·게시·마감처럼 날짜 라벨이 붙은 것   ② 연·월·일이 모두 있는 완전한 날짜
// 맨연도(2026년)는 버린다. 두 자리 연도도 오탐이 많아 쓰지 않는다.
const HIRE_DATE_LABEL = /(등록|게시|작성|수정|마감|접수|모집|공고|시작|종료)\s*(?:일자|일|기간)?\s*[:：~\-]?\s*(20\d{2})\s*[.\-/년]\s*(\d{1,2})?/g;
const HIRE_DATE_FULL = /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g;
function hireDates(text) {
  const out = new Set();
  const s = String(text || '');
  const maxY = new Date().getFullYear() + 1;
  const take = (y, mo) => {
    y = Number(y);
    if (y < 2000 || y > maxY) return;                                // 사업자번호 등 숫자 오탐 차단
    const m = mo ? Math.min(12, Math.max(1, Number(mo))) : null;
    out.add(m ? `${y}-${String(m).padStart(2, '0')}` : String(y));
  };
  // 라벨형: (1)라벨 (2)연 (3)월  /  완전일자형: (1)연 (2)월 (3)일 — 그룹 위치가 달라 따로 읽는다
  let m;
  const rl = new RegExp(HIRE_DATE_LABEL.source, 'g');
  while ((m = rl.exec(s))) take(m[2], m[3]);
  const rf = new RegExp(HIRE_DATE_FULL.source, 'g');
  while ((m = rf.exec(s))) take(m[1], m[2]);
  return [...out];
}

// 채용 사이트 기업정보 페이지에서 '사원수 43명 (2025.12.31)' 같은 값을 뽑는다.
// 연금 가입자수와 시점이 다른 두 번째 인력 관측치라, 증감 방향을 볼 수 있다.
function hireHeadcount(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  // 사이트마다 표기가 달라(사원수·직원수·종업원수·임직원수) 모두 받는다
  // 기준일은 '43명 (2025.09)'처럼 숫자 바로 뒤에 붙는다. 사이에 글자가 끼는 걸 허용했더니
  // '사원수: 44명, 설립: 2017.03.08'에서 설립일을 사원수 기준일로 읽었다(잡플래닛).
  // 8년 묵은 날짜가 현재 인원의 기준일로 찍히면 인력 증감 판단이 통째로 어긋난다.
  // 공백과 괄호만 사이에 둔다.
  const m = s.match(/(?:사원수|직원수|종업원수|임직원수|총\s?인원)[^0-9]{0,10}([0-9,]{1,7})\s*명(?:[\s(]{0,3}(20\d{2})[.\-/년]\s*(\d{1,2})?)?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!isFinite(n) || n <= 0 || n > 100000) return null;
  return { count: n, asOf: m[2] ? `${m[2]}${m[3] ? '-' + String(m[3]).padStart(2, '0') : ''}` : null };
}

// ── 채용 사이트 '기업정보'에서 뽑을 항목 ──
// 처음에는 기업개요·평판·채용조건까지 넓게 뽑았는데, 실제 결과를 보니 대부분 쓸모가 없었다.
//   · 설립일·대표자·주소·업종은 이미 금융위·국세청에서 A등급으로 받는다. 채용 사이트 값은
//     같은 걸 더 낮은 신뢰도로 한 번 더 적을 뿐이고, 자본금은 5,000만원 vs 공시 1억으로 갈렸다.
//   · 리뷰 1건짜리 평점, 모집분야·급여·마감일은 공고 1건의 조건이지 업체의 속성이 아니다.
// 남기는 건 공시에 없으면서 업체 규모를 가늠하게 해 주는 인력·급여뿐이다. 재무는 extFinance가
// 따로 다룬다. 값은 사이트가 자체 수집한 것이므로 공식 자료와 같은 칸에 두지 않는다.
const EXT_PROFILE_FIELDS = [
  // [카테고리, 항목, 정규식(1그룹=값), 읽을 페이지 성격(null=전부)]
  ['인력·급여', '평균연봉', /평균\s*연봉\s*:?\s*([0-9,]{2,9}\s*(?:만원|만|원))/, 'company'],
  ['인력·급여', '신입초봉', /(?:신입\s*)?초봉\s*:?\s*([0-9,]{2,9}\s*(?:만원|만|원))/, 'company'],
  ['인력·급여', '평균근속', /평균\s*근속(?:연수|년수)?\s*:?\s*([0-9.]{1,4}\s*년)/, 'company'],
];
// 값이 라벨만 다시 잡히거나 통째로 문장이 딸려 오는 걸 막는다
const PROFILE_JUNK = /(로그인|회원가입|채용정보|더보기|검색|바로가기|자세히|https?:\/\/[^\s]*(?:jobkorea|saramin|incruit|catch)|^[.\-·,\s]*$)/;
// 값 앞에 딸려 오는 부스러기를 떼어 낸다.
// 실제 수집분에서 근무지가 '주소 : 경기 부천시', 급여가 '조건 : 월급 250만원'으로 나왔다 —
// 사이트가 라벨을 두 겹으로 쓴 것이라 앞의 '○○ :'는 값이 아니다.
function cleanProfileValue(v, atEnd) {
  let s = String(v).replace(/\s+/g, ' ')
    .replace(/^[\s.,\-·|;:]+/, '')
    .replace(/^[가-힣]{1,4}\s*[:：]\s*/, '')
    .replace(/[\s.,\-·|;:]+$/, '')
    .trim();
  // 검색 스니펫은 문장 중간에서 잘린다. 끝이 한 글자짜리 토막이면 잘린 조각이라 보고 버린다
  // ('경기 부천시 수…' → '경기 부천시').
  if (atEnd) s = s.replace(/\s[가-힣]$/, '');
  return s.trim();
}
// 채용사이트 기업정보에 기업이 직접 등록한 홈페이지 주소.
// 프로필 항목에서는 뺐지만(공시로 알 수 있는 값이라) 홈페이지 추적에는 이만한 단서가 없다.
// 네이버 웹문서가 못 잡는 소규모 사이트(아임웹·모두·카페24)가 여기서 자주 나온다.
const HP_HINT_RE = /(?:홈페이지|회사\s*홈페이지|웹사이트|사이트\s*주소|home\s*page)\s*:?\s*((?:https?:\/\/)?[a-z0-9][a-z0-9.-]{3,60}\.[a-z]{2,10}(?:\/[^\s"'<>]{0,40})?)/i;
function extHomepageHint(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(HP_HINT_RE);
  if (!m) return null;
  let u = m[1].replace(/[).,]+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  let host;
  try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
  // 채용사이트 자기 도메인이나 포털이 잡히면 홈페이지가 아니다
  if (hpSkipReason(host)) return null;
  return u;
}
// 채용공고의 근무지주소 — '사람이 실제로 출근하는 곳'이라 등기·신고 주소와 성격이 다르다.
// 회사가 직접 올린 값이라 등기보다 최신인 경우가 많아, 주소 대조의 네 번째 출처로 쓴다.
const WORK_ADDR_RE = /(?:근무지\s*주소|근무\s*지역|근무지|근무\s*장소)\s*[:：]?\s*((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣0-9\s()\-·]{4,40}?)(?:\s*[·|]|\s*지도|\s*$)/;
function extWorkAddr(text) {
  const m = String(text || '').replace(/\s+/g, ' ').match(WORK_ADDR_RE);
  if (!m) return null;
  const v = m[1].replace(/\s+/g, ' ').replace(/[\s,·|-]+$/, '').trim();
  // 시·군·구까지는 있어야 대조에 쓸 수 있다
  return /(시|군|구)\s|(시|군|구)$/.test(v) && v.length >= 6 ? v : null;
}
function extProfile(text, host, link, kind) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = [];
  for (const [cat, key, re, want] of EXT_PROFILE_FIELDS) {
    // 공고 페이지의 '모집인원'을 사원수로 오해하는 식의 혼선을 막으려고 페이지 성격을 가린다
    if (want && kind && want !== kind) continue;
    const m = t.match(re);
    if (!m || !m[1]) continue;
    const v = cleanProfileValue(m[1], m.index + m[0].length >= t.length - 1);
    if (!v || v.length < 1 || v.length > 50 || PROFILE_JUNK.test(v)) continue;
    out.push({ cat, key, value: v, host, link });
  }
  return out;
}
// 같은 항목을 여러 사이트가 다르게 적는다. 하나만 남기지 않고 전부 보여 준다 — 어긋난다는 사실
// 자체가 확인해야 할 항목이기 때문이다. 대표값은 최다 득표로 고른다.
function reconcileProfile(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    const k = `${r.cat}|${r.key}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const out = [];
  for (const [, list] of groups) {
    const perHost = new Map();
    list.forEach((r) => { if (!perHost.has(r.host)) perHost.set(r.host, r); });
    const uniq = [...perHost.values()];
    const votes = new Map();
    uniq.forEach((r) => votes.set(r.value, (votes.get(r.value) || 0) + 1));
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      cat: uniq[0].cat, key: uniq[0].key, value: best,
      sources: uniq.map((r) => ({ host: String(r.host || '').replace(/^www\./, ''), value: r.value, link: r.link })),
      agree: votes.size === 1,
    });
  }
  return out.sort((a, b) => EXT_PROFILE_FIELDS.findIndex((f) => f[1] === a.key) - EXT_PROFILE_FIELDS.findIndex((f) => f[1] === b.key));
}

// 채용 사이트 기업정보에는 매출·자본총계·순이익이 실려 있다(인크루트·잡코리아·캐치 등).
// 금융위 재무가 몇 년 전에서 끊긴 업체의 '그 이후'를 가늠할 수 있는 몇 안 되는 무료 단서다.
// 다만 공시가 아니라 사이트가 자체 수집·표기한 값이라 공식 자료와 같은 칸에 두면 안 된다.
// 뽑아 오되 출처를 '외부사이트자료'로 못 박아 구분한다.
const EXT_FIN_KEYS = [
  // '매출'만으로 잡으면 영업이익 설명문("매출총액에서 원가…를 뺀 금액")에 걸려
  // 영업이익 숫자를 매출액으로 가져간다. 실제로 셀랩메드에서 그렇게 어긋났다.
  ['매출액', /(매출액|매출(?!총액))/],
  ['영업이익', /영업\s*이익/],
  ['당기순이익', /(?:당기\s*)?순이익/],
  ['자본금', /자본금/],
  ['자본총계', /자본\s*총계/],
  ['자산총계', /자산\s*총계/],
];
// 어느 항목 라벨이든 하나 — 한 항목의 값 구간이 다음 항목까지 넘어가지 않게 경계로 쓴다.
// 다산씨엔텍에서 당기순이익이 20억으로 나왔는데 매출 68억·영업이익 3억짜리 회사에서
// 순이익률 29%는 나올 수 없다. 순이익 칸이 비어 있어 그 다음 항목(자본금)의 값을 끌어온 것이다.
const FIN_LABEL_ANY = new RegExp(EXT_FIN_KEYS.map(([, re]) => `(?:${re.source})`).join('|'), 'g');
// "44억", "4,400백만", "4,400,000,000원" → 억 단위 숫자
// 음수 표기가 사이트마다 다르다. 이시스코스메틱 조회에서 사람인은 107억, 잡코리아는 -107억으로
// 같은 값의 부호가 갈렸다. 사람인이 마이너스를 '△'로 쓰는데 우리가 '-'만 봤기 때문이다.
// 회계 표기에서 음수는 -, △, ▲, ▽, ( ) 다섯 가지로 나타난다. 전부 음수로 읽는다.
const NEG_HEAD = /^[-−–—△▲▽▼(]/;
function extAmountEok(str) {
  const raw = String(str || '').replace(/\s/g, '');
  const neg = NEG_HEAD.test(raw);
  const s = raw.replace(/^[-−–—△▲▽▼(]+/, '').replace(/\)+$/, '');
  const sign = neg ? -1 : 1;
  // 억은 소수 한 자리까지 살린다. 사람인은 '68.1억 / 100.7억'처럼 적는데 정수로 반올림하면
  // 매출 100.7억이 101억이 되고, 외감 기준선(100억)을 넘었는지 같은 판단이 흐려진다.
  let m = s.match(/^([\d,.]+)억/);
  if (m) return Math.round(Number(m[1].replace(/,/g, '')) * 10) / 10 * sign;
  m = s.match(/^([\d,]+)백만/);
  if (m) return Math.round(Number(m[1].replace(/,/g, '')) / 100) * sign;
  m = s.match(/^([\d,]{6,})원?/);
  if (m) { const n = Number(m[1].replace(/,/g, '')); if (n >= 1e6) return Math.round(n / 1e8) * sign; }
  return null;
}
// 페이지 안에서 '재무표가 있을 법한 구간'만 잘라 낸다.
// 기업정보 페이지에는 설립일·사원수 기준일·리뷰 작성일처럼 연·월이 붙은 숫자가 곳곳에 있다.
// 페이지 전체를 훑으면 그런 날짜가 결산 머리글로 오인된다(씨앤티드림: 사원수 기준일 2017.04과
// 설립일 2011.09가 머리글로 잡혀 매출액에 -1억이 실렸다). 재무 문맥 안에서만 읽는다.
const FIN_ANCHOR = /(재무\s*(?:정보|현황|제표|지표|상태)|매출액|영업\s*이익|자산\s*총계|자본\s*총계|손익\s*계산)/g;
function financeSections(t) {
  const spans = [];
  let m;
  const re = new RegExp(FIN_ANCHOR.source, 'g');
  while ((m = re.exec(t))) {
    const s = Math.max(0, m.index - 120), e = Math.min(t.length, m.index + 600);
    const last = spans[spans.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);   // 겹치면 합친다
    else spans.push([s, e]);
  }
  return spans;
}
function extFinance(text, host, link) {
  // 사람인 재무 탭은 항목마다 '○○ Information <설명문> 닫기' 툴팁을 본문에 그대로 깔아 둔다.
  // 그 설명문에 다른 항목 이름이 섞여 있어(영업이익 설명에 '매출총액', 당기순이익 설명에
  // '영업이익'), 라벨이 설명문에 걸리면 옆 항목 숫자를 제 것으로 읽는다. 먼저 도려낸다.
  const full = String(text || '').replace(/\s+/g, ' ')
    .replace(/Information\s.{0,200}?닫기/g, ' ');
  const out = [];
  // 같은 항목 라벨이 한 페이지에 여러 번 나온다. 사람인 재무 탭은 페이지 제목에도
  // '매출액 68억 1,834만원 영업이익, 자본금 …'이 있어, 첫 출현에서 멈추면 연도 없는 값
  // 하나만 얻고 정작 아래의 4개년 표를 못 본다. 모든 출현을 훑어 후보로 모은 뒤,
  // 연도가 붙은 후보가 하나라도 있으면 그쪽만 채택한다.
  const cands = [];
  const nowY = new Date().getFullYear();
  const inRange = (y) => y >= 2010 && y <= nowY;
  // 음수 표기(△·▲·괄호)까지 포함해 금액을 잡는다
  const AMT = /((?:[-−–—△▲▽▼(])?[0-9][0-9,.]*\s*(?:억|백만|원)\)?)/g;

  for (const [s0, e0] of financeSections(full)) {
    const t = full.slice(s0, e0);

    // ── 결산 연도 머리글 찾기 ──
    // 채용 사이트 재무표는 "2025.12 2024.12 2023.12" 처럼 연도를 한 줄에 늘어놓고
    // 그 아래 항목별로 값을 나열한다. 머리글을 찾아 값과 순서대로 짝지운다.
    // 단, 결산 머리글은 반드시 '연속된 연도'이고 한 방향으로만 간다. 2017·2011·2025처럼
    // 띄엄띄엄하거나 오르내리는 조합은 표 머리글이 아니라 딴 날짜가 섞인 것이므로 버린다.
    const YR = /(20\d{2})\s*[.\-/년]\s*(?:0?[1-9]|1[0-2])\b/g;
    const yrHits = [...t.matchAll(YR)].map((m) => ({ y: Number(m[1]), at: m.index })).filter((x) => inRange(x.y));
    let header = [];
    for (let a = 0; a < yrHits.length; a++) {
      const run = [yrHits[a]];
      for (let b = a + 1; b < yrHits.length && yrHits[b].at - run[run.length - 1].at < 40; b++) run.push(yrHits[b]);
      // 뒤에서부터 줄여 가며 '연속·단조'를 만족하는 가장 긴 조각을 취한다
      for (let len = run.length; len >= 2; len--) {
        const ys = run.slice(0, len).map((x) => x.y);
        const uniq = new Set(ys);
        if (uniq.size !== len) continue;                                   // 같은 해 중복 = 머리글 아님
        if (Math.max(...ys) - Math.min(...ys) !== len - 1) continue;        // 연속이어야 한다
        const asc = ys.every((v, i) => i === 0 || v > ys[i - 1]);
        const desc = ys.every((v, i) => i === 0 || v < ys[i - 1]);
        if (!asc && !desc) continue;                                        // 오르내리면 머리글 아님
        if (len > header.length) header = run.slice(0, len);
        break;
      }
    }
    const headYears = header.length >= 2 ? header.map((x) => x.y) : null;
    const headAt = header.length ? header[0].at : -1;

    for (const [key, re] of EXT_FIN_KEYS) {
      const lab = new RegExp(re.source, 'gi');
      let lm;
      while ((lm = lab.exec(t))) {
        // ── 이 항목의 값 구간 ──
        // 다음 재무 항목 라벨이 나오면 거기서 끊는다. 넘어가면 옆 항목 값을 제 것으로 읽는다.
        const after = lm.index + lm[0].length;
        let end = Math.min(t.length, after + 220);
        FIN_LABEL_ANY.lastIndex = after;
        const nx = FIN_LABEL_ANY.exec(t);
        if (nx && nx.index > after && nx.index < end) end = nx.index;
        const win = t.slice(after, end);
        if (!win) continue;

        // ── ① 연도와 금액이 번갈아 나오는 표 ──
        // 사람인 재무 탭은 머리글 없이 '매출액 2025.12 68억 2024.12 55억 …' 식으로 늘어놓는다.
        // 연도가 라벨 뒤에 오기 때문에 머리글로 인정되지 않아, 지금까지 첫 해 하나만 읽고
        // 나머지 연도를 통째로 잃었다(다산씨엔텍: 22~25년 표에서 25년 한 해만 실렸다).
        // 연도는 '2025년 기준'처럼 붙기도 하고 '2022 97.6억'처럼 맨숫자로만 오기도 한다.
        // 사람인 재무 탭 원문이 정확히 후자였다 —
        //   "2025년 기준 68.1억 동종업계 상위 20% 2022 97.6억 2023 99.4억 2024 100.7억"
        // 점이나 '년'을 요구하는 바람에 맨연도 세 해를 통째로 놓쳤다. 맨연도도 받되,
        // 금액·비율·인원 단위가 바로 뒤에 붙은 숫자(2022억, 20%)는 연도가 아니므로 뺀다.
        const YRT = /(?:^|[^\d,.])(20\d{2})(?:\s*[.\-/년]\s*(?:0?[1-9]|1[0-2])?)?(?![\d,.])(?!\s*(?:억|원|백만|만|%|명|건|위|개|배))/g;
        const yts = [...win.matchAll(YRT)]
          .map((m) => ({ y: Number(m[1]), at: m.index + m[0].indexOf(m[1]), end: m.index + m[0].length }))
          .filter((x) => inRange(x.y));
        const ats = [...win.matchAll(AMT)].map((m) => ({ s: m[1], at: m.index, end: m.index + m[0].length }));
        let paired = 0;
        if (yts.length && ats.length) {
          const usedY = new Set();
          ats.forEach((am) => {
            // 연도는 값 '앞'에 온다 — "2025년 기준 3.2억 2022 5.1억 2023 4.8억".
            // 거리만 재면 3.2억이 바로 뒤의 2022에 붙어 표 전체가 한 칸씩 밀린다(실제로
            // 영업이익이 그렇게 어긋났다). 앞에 있는 연도를 먼저 찾고, 없을 때만 뒤를 본다
            // ('매출액 68억 (2025.12)'처럼 뒤에 붙는 표기도 있기 때문).
            let best = null, bd = Infinity;
            yts.forEach((yt, i) => {
              if (yt.end > am.at) return;                 // 값보다 뒤에 있는 연도는 이번엔 제외
              const d = am.at - yt.end;
              if (d >= 0 && d < bd && d <= 30) { bd = d; best = i; }
            });
            if (best == null) {
              yts.forEach((yt, i) => {
                if (yt.at < am.end) return;
                const d = yt.at - am.end;
                if (d >= 0 && d < bd && d <= 25) { bd = d; best = i; }
              });
            }
            if (best == null || usedY.has(best)) return;
            const eok = extAmountEok(am.s);
            if (eok == null || !isFinite(eok)) return;
            if (key === '매출액' && eok < 0) return;
            usedY.add(best);
            cands.push({ key, eok, years: [yts[best].y], host, link });
            paired++;
          });
        }
        if (paired) continue;                              // 짝이 맞았으면 여기서 끝

        // ── ② 머리글이 위에 따로 있는 표 ──
        const useHead = headYears && headAt < lm.index;
        const amts = ats.slice(0, useHead ? headYears.length : 1);
        if (!amts.length) continue;
        amts.forEach((am, idx) => {
          const eok = extAmountEok(am.s);
          if (eok == null || !isFinite(eok)) return;
          if (key === '매출액' && eok < 0) return;          // 매출이 음수인 회사는 없다 — 열이 어긋난 것
          let years = null;
          if (useHead && amts.length === headYears.length) years = [headYears[idx]];
          else {
            // ── ③ 값 주변의 결산 표기 하나 ──
            // 한 금액이 여러 해에 동시에 속할 수는 없으므로 후보 중 '가장 가까운' 하나만 쓴다.
            const at = after + am.at;
            const from = Math.max(0, at - 60);
            const around = t.slice(from, at + 60);
            const yrCands = [...around.matchAll(/(20\d{2})\s*(?:[.\-/]\s*(?:0?[1-9]|1[0-2])\b|년\s*(?:0?[1-9]|1[0-2])\s*월|년\s*(?:기준|말|결산))/g)]
              .map((m) => ({ y: Number(m[1]), at: from + m.index, lead: around.slice(Math.max(0, m.index - 14), m.index) }))
              // 설립일·사원수 기준일·공고 등록일에 붙은 연도는 결산 연도가 아니다
              .filter((c) => inRange(c.y) && !/(설립|창립|사원수|직원수|종업원수|임직원수|기준|등록|작성|수정|마감|입사|가입)/.test(c.lead));
            yrCands.sort((a2, b2) => Math.abs(a2.at - at) - Math.abs(b2.at - at));
            years = yrCands.length ? [yrCands[0].y] : null;
          }
          cands.push({ key, eok, years, host, link });
        });
      }
    }
  }
  // 항목별로 연도가 붙은 후보가 있으면 그것만 쓴다. 연도 없는 값은 공시와 대조도,
  // 추이 반영도 안 되므로 다른 후보가 있는 한 굳이 남길 이유가 없다.
  for (const [key] of EXT_FIN_KEYS) {
    const mine = cands.filter((c) => c.key === key);
    if (!mine.length) continue;
    const dated = mine.filter((c) => c.years && c.years.length);
    out.push(...(dated.length ? dated : [mine[0]]));
  }
  // 같은 구간이 여러 앵커에 걸쳐 두 번 읽힐 수 있다 — 항목·연도·값이 같으면 1건으로
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.key}|${(r.years || []).join(',')}|${r.eok}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// 채용 사이트는 재무를 별도 탭에 둔다. 기업정보 본문에는 '재무정보'라는 글자만 있고
// 숫자는 다른 주소에 있다(한웅메디칼 조회에서 사람인 본문 3,148자를 받고도 재무가 0건이었다).
// 회사 페이지 주소에서 재무 탭 주소를 만들어 함께 연다.
function financeTabUrls(link) {
  const u = String(link || '');
  const out = [];
  let m;
  // csn은 경로(/csn/XXX)로도 쿼리(?csn=XXX)로도 온다. 앞의 [^?]*가 물음표를 못 넘어가
  // '?csn=' 형태에서는 재무 탭 주소가 아예 만들어지지 않았다 — 사람인 기업정보 대표 주소가
  // 바로 그 형태다(zf_user/company-info/view?csn=…). 다산씨엔텍에서 재무 탭이 열린 건
  // 우연히 다른 경로형 주소가 같이 잡혔기 때문이고, 그 주소가 없는 업체는 통째로 놓쳤다.
  // 쿼리형은 &·# 앞까지, 경로형은 다음 / 앞까지가 csn이다. 한 규칙으로 묶으면 경로형에서
  // 뒤 세그먼트(/company_nm/…)까지 csn에 딸려 들어간다. base64라 '/'가 값에 들어갈 수 있어
  // 두 형태를 따로 읽는다.
  const csn = (u.match(/saramin\.co\.kr\/\S*?[?&]csn=([^&#\s]+)/i)
    || u.match(/saramin\.co\.kr\/\S*?\/csn\/([^/?#\s]+)/i) || [])[1];
  if (csn) {
    out.push(`https://m.saramin.co.kr/job-search/company-info-view/finance?csn=${csn}`);
    out.push(`https://www.saramin.co.kr/zf_user/company-info/view-financial-summary/csn/${csn}`);
  }
  if ((m = u.match(/jobkorea\.co\.kr\/company\/(\d+)/i))) {
    out.push(`https://www.jobkorea.co.kr/company/${m[1]}/Finance`);
  }
  if ((m = u.match(/catch\.co\.kr\/Comp\/[A-Za-z]+\/(\d+)/i))) {
    out.push(`https://www.catch.co.kr/Comp/CompFinance/${m[1]}`);
  }
  if ((m = u.match(/incruit\.com\/company\/(\d+)/i))) {
    out.push(`https://www.incruit.com/company/${m[1]}/finance`);
  }
  return out;
}

function reconcileExtFin(rows) {
  const groups = new Map();
  (rows || []).forEach((r) => {
    const ys = (r.years && r.years.length) ? r.years : [null];
    ys.forEach((y) => {
      const k = `${r.key}|${y || ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ ...r, year: y });
    });
  });
  const out = [];
  for (const [, list] of groups) {
    // 같은 사이트가 여러 번 잡히면 1건으로
    const perHost = new Map();
    list.forEach((r) => { if (!perHost.has(r.host) || r.from === 'page') perHost.set(r.host, r); });
    const uniq = [...perHost.values()];
    // 값별 득표
    const votes = new Map();
    uniq.forEach((r) => { votes.set(r.eok, (votes.get(r.eok) || 0) + 1); });
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const vals = uniq.map((r) => r.eok);
    const min = Math.min(...vals), max = Math.max(...vals);
    out.push({
      key: uniq[0].key, year: uniq[0].year, eok: best,
      sources: uniq.map((r) => ({ host: String(r.host || '').replace(/^www\./, ''), eok: r.eok, link: r.link })),
      agree: min === max,
      spread: min === max ? null : { min, max },
    });
  }
  // 연도 있는 것 먼저, 그 안에서 최신순
  return out.sort((a, b) => (b.year || 0) - (a.year || 0) || a.key.localeCompare(b.key));
}

async function hiringTrace(nm) {
  if (!getProxy() || !nm) return null;
  // ① 다각도 검색 — 한 질의로는 사이트별로 누락이 커서 여러 각도로 훑는다.
  //    연도 키워드를 섞어 과거 공고가 조금이라도 더 잡히게 한다(마감분은 상당수 사라진다).
  const y = new Date().getFullYear();
  const queries = [
    `${nm} 채용`, `${nm} 채용공고`, `${nm} 구인`,
    `${nm} 잡코리아`, `${nm} 사람인`, `${nm} 워크넷`,
    `${nm} 생산직 채용`, `${nm} 경력 채용`,
    `${nm} ${y} 채용`, `${nm} ${y - 1} 채용`, `${nm} ${y - 2} 채용`,
  ];
  const got = await mapLimit(queries, 4, async (q) => {
    try { return await proxyOnlyGet('naverWeb', { query: q, display: '30' }); } catch { return null; }
  });

  // ② 채용 사이트 결과만 남기고 링크 기준 중복 제거
  const seen = new Set();
  const posts = [];
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
  const key = stripCorp(nm).replace(/\s/g, '');
  got.forEach((d) => {
    const items = (d && Array.isArray(d.items)) ? d.items : [];
    items.forEach((it) => {
      const link = String(it.link || it.originallink || '');
      const title = strip(it.title), desc = strip(it.description);
      const blob = `${title} ${desc}`;
      if (!HIRE_HOSTS.test(link) || !HIRE_WORDS.test(blob)) return;
      // 상호가 실제로 들어간 결과만 — 동종 업체 공고가 섞이면 전부 무의미해진다
      if (!stripCorp(blob).replace(/\s/g, '').includes(key)) return;
      const id = link.replace(/[?#].*$/, '');
      if (seen.has(id)) return;
      seen.add(id);
      posts.push({ title, desc, link, host: (link.match(/^https?:\/\/([^/]+)/) || [])[1] || '', role: hireRole(blob), dates: hireDates(blob) });
    });
  });

  // ③ 검색 스니펫 먼저 훑는다.
  //    인크루트 스니펫에는 "사원수 8명 · 매출 44억"이 그대로 실려 오는데, 지금까지 재무만 보고
  //    사원수는 페이지에서만 찾았다. 그래서 눈앞에 있는 값을 놓쳤다(heads가 빈 채로 나왔다).
  const heads = [];
  const extFin = [];
  const extProf = [];
  const hpHints = [];
  const workAddrs = [];
  posts.forEach((p) => {
    const blob = `${p.title} ${p.desc}`;
    const hc = hireHeadcount(blob);
    if (hc) heads.push({ ...hc, host: p.host, link: p.link, from: 'snippet' });
    extFin.push(...extFinance(blob, p.host, p.link));
    extProf.push(...extProfile(blob, p.host, p.link, null));
    const hh = extHomepageHint(blob);
    if (hh) hpHints.push(hh);
    const wa = extWorkAddr(blob);
    if (wa) workAddrs.push(wa);
  });

  // ④ 페이지를 직접 연다. 두 가지를 노린다.
  //    (가) 기업정보 페이지 — 사원수·재무의 정확한 값과 기준연도
  //    (나) 공고·공고목록 페이지 — 스니펫에 없는 등록일·수정일(연도 미상 공고를 되살린다)
  const isCompanyPage = (u) => /\/company\/\d+|\/companies\/\d+|Co_Read|company-info|Comp\/Comp|\/company\/[^/]+$/i.test(u);
  const targets = [];
  // 같은 사이트의 같은 성격 페이지를 여러 번 여는 건 낭비다. 이시스코스메틱 조회에서
  // 20칸 중 16칸을 중복이 먹었다(사람인 7회 전부 타임아웃, 잡플래닛 5회 모두 빈 응답 58자).
  // 그 바람에 정작 숫자가 있는 재무 탭이 뒤로 밀렸다. 호스트·성격별로 상한을 둔다.
  const perHost = new Map();
  const pushT = (p, kind) => {
    if (targets.length >= 20) return;
    if (targets.some((t) => t.link === p.link)) return;
    const k = `${p.host}|${kind}`;
    const n = perHost.get(k) || 0;
    if (n >= (kind === 'finance' ? 2 : 1)) return;      // 회사·공고는 호스트당 1개, 재무 탭은 2개까지
    perHost.set(k, n + 1);
    targets.push({ ...p, kind });
  };
  // 재무 탭을 먼저 넣는다 — 숫자는 거기에만 있다.
  // 그중에서도 사람인을 맨 앞에 둔다. 여러 업체를 돌려 보면 매출·영업이익·당기순이익·자본금을
  // 연도별로 다 주는 곳은 사람인 재무 탭이 사실상 유일하다. 20칸이 다른 사이트로 차서
  // 사람인이 뒤로 밀리면 재무를 통째로 못 얻는다.
  const compPosts = posts.filter((p) => isCompanyPage(p.link))
    .sort((a, b) => (/saramin/i.test(b.link) ? 1 : 0) - (/saramin/i.test(a.link) ? 1 : 0));
  const finSeen = new Set();
  compPosts.forEach((p) => financeTabUrls(p.link).forEach((u) => {
    if (finSeen.has(u)) return; finSeen.add(u);
    pushT({ ...p, link: u }, 'finance');
  }));
  compPosts.forEach((p) => pushT(p, 'company'));
  posts.filter((p) => !p.dates.length && !isCompanyPage(p.link)).forEach((p) => pushT(p, 'post'));

  // 접속 결과를 남긴다 — 지금까지 실패를 조용히 삼켜, 값이 안 나온 게 차단 때문인지
  // 페이지에 정보가 없어서인지 구분할 수 없었다.
  const extDiag = [];
  const contacts = { tels: [], emails: [] };
  const pages = await mapLimit(targets, 3, async (p) => {
    try {
      const r = await proxyOnlyGet('fetchPage', { url: p.link });
      const text = (r && r.text) || '';
      return { ...p, text, status: r && r.status };
    } catch (e) { return { ...p, text: '', err: (e && e.message) || String(e) }; }
  });
  pages.forEach((pg) => {
    if (!pg) return;
    if (!pg.text) { extDiag.push({ host: pg.host, kind: pg.kind, ok: false, why: pg.err || `본문 없음(HTTP ${pg.status || '?'})` }); return; }
    const txt = htmlToText(pg.text);
    const found = [];
    // 사원수는 기업정보·재무 탭에서만 읽는다. 공고 페이지에도 '50명'처럼 숫자가 있지만 그건
    // 모집인원이다. 이시스코스메틱 조회에서 공고 페이지의 50명이 실제 사원수 19명과 맞서
    // '인력 수치 불일치' 경고를 만들어 냈다 — 애초에 같은 항목이 아니었다.
    if (pg.kind === 'company' || pg.kind === 'finance') {
      const hc = hireHeadcount(txt);
      if (hc) { heads.push({ ...hc, host: pg.host, link: pg.link, from: 'page' }); found.push('사원수'); }
    }
    const fin = extFinance(txt, pg.host, pg.link);
    if (fin.length) { extFin.push(...fin); found.push(`재무 ${fin.length}`); }
    const prof = extProfile(txt, pg.host, pg.link, pg.kind === 'finance' ? 'company' : pg.kind);
    if (prof.length) { extProf.push(...prof); found.push(`정보 ${prof.length}`); }
    const hh = extHomepageHint(txt);
    if (hh) { hpHints.push(hh); found.push('홈페이지'); }
    const wa = extWorkAddr(txt);
    if (wa) { workAddrs.push(wa); found.push('근무지'); }
    // 연락처 — 기업정보·공고 페이지에서(재무 탭은 숫자표라 건너뛴다)
    if (pg.kind !== 'finance') {
      const ct = extContacts(txt, pg.text);
      if (ct.tel) { contacts.tels.push({ v: ct.tel, host: pg.host, link: pg.link }); found.push('전화'); }
      if (ct.email) { contacts.emails.push({ v: ct.email, host: pg.host, link: pg.link }); found.push('메일'); }
    }
    // 페이지에서 찾은 날짜를 해당 공고에 돌려준다 — 스니펫에 없던 등록일이 여기 있다.
    // 단 기업정보 페이지는 공고가 아니다. 거기 있는 날짜는 설립일·사원수 기준일이라
    // 공고 시점으로 세면 안 된다(씨앤티드림: 설립 2011.09과 기준일 2017.04이 공고 날짜로
    // 들어가 없는 연도 분포를 만들었다). 공고 페이지에서만 가져온다.
    if (pg.kind === 'post') {
      const ds = hireDates(txt);
      if (ds.length) {
        const tgt = posts.find((x) => x.link === pg.link);
        if (tgt && !tgt.dates.length) { tgt.dates = ds.slice(0, 3); tgt.dateFrom = 'page'; found.push(`날짜 ${ds[0]}`); }
      }
    }
    // 재무 탭 원문은 값을 뽑았든 못 뽑았든 남긴다.
    // 사이트마다 표기가 달라 실제 문구를 봐야 패턴을 맞출 수 있는데, 지금까지 '0건일 때만'
    // 남기다 보니 일부만 뽑힌 경우(다산씨엔텍: 4개년 표에서 1개년만)는 원인을 볼 수가 없었다.
    // 재무를 한 건이라도 뽑았거나 재무 탭이면 원문을 남긴다. 여태 '재무 탭이거나 0건일 때'만
    // 남겨서, 잡코리아 회사 페이지가 재무 9건을 잘못 뽑아도 원문을 볼 수가 없었다.
    let sample = null;
    {
      const at = txt.search(/(매출액|매출|자본금|자본총계|당기순이익|재무정보)/);
      if (at >= 0) sample = txt.slice(at, at + (fin.length || pg.kind === 'finance' ? 480 : 160)).replace(/\s+/g, ' ').trim();
    }
    extDiag.push({
      host: pg.host, kind: pg.kind, ok: true, chars: txt.length,
      found: found.length ? found.join('·') : '해당 정보 없음',
      ...(sample ? { finSample: sample } : {}),
    });
  });
  // 사이트마다 수집 시점과 출처가 달라 같은 항목도 값이 갈린다. 한 곳만 남기고 버리면
  // 어느 값이 맞는지 판단할 근거가 사라진다. 항목·연도별로 모아 서로 대조한다.
  let finRows = reconcileExtFin(extFin);
  // ── 산술로 말이 안 되는 값은 싣지 않는다 ──
  // 셀랩메드에서 매출 60.5·72.9·69.9억에 영업이익이 -60·-72·-69억으로 나왔다. 해마다
  // 매출의 거울상이다 — 표의 열이 한 칸 어긋나 매출 숫자를 영업이익 칸에서 읽은 것이다.
  // 한 해만 보면 '큰 영업손실'과 구분이 안 되지만, 여러 해가 나란히 매출과 같으면 파싱 사고다.
  // 당기순이익이 매출을 넘는 것도 마찬가지로 자본총계·자산총계가 섞인 흔적이다.
  const dropped = [];
  {
    const revBy = new Map();
    finRows.forEach((r) => { if (r.key === '매출액' && r.year) revBy.set(r.year, Math.abs(r.eok)); });
    const near = (a2, b2) => b2 > 0 && Math.abs(Math.abs(a2) - b2) <= b2 * 0.05;
    const mirrorYears = finRows.filter((r) => r.key === '영업이익' && r.year && near(r.eok, revBy.get(r.year))).length;
    const opBroken = mirrorYears >= 2;      // 두 해 이상 겹치면 우연이 아니다
    finRows = finRows.filter((r) => {
      const rev = r.year ? revBy.get(r.year) : null;
      if (r.key === '영업이익' && opBroken) {
        dropped.push(`${r.year} 영업이익 ${r.eok}억 — 매출과 같은 값이 ${mirrorYears}개년 반복(열 어긋남)`);
        return false;
      }
      if (rev && r.key === '당기순이익' && Math.abs(r.eok) > rev) {
        dropped.push(`${r.year} 당기순이익 ${r.eok}억 — 같은 해 매출 ${rev}억보다 큼(자본·자산 혼입 의심)`);
        return false;
      }
      return true;
    });
  }
  if (dropped.length) extDiag.push({ host: '—', kind: 'sanity', ok: true, found: `비정상 값 ${dropped.length}건 제외`, dropped });
  // 사원수는 기준일이 있는 값을 우선한다(페이지 > 스니펫)
  heads.sort((a, b) => (b.asOf ? 1 : 0) - (a.asOf ? 1 : 0) || (b.from === 'page' ? 1 : 0) - (a.from === 'page' ? 1 : 0));
  return { posts, heads, extFin: finRows, extProfile: reconcileProfile(extProf),
    hpHints: [...new Set(hpHints)], workAddrs: [...new Set(workAddrs)], extDiag, contacts };
}

// 수집된 공고를 연도·직종으로 집계하고 신호를 판정한다. 전부 '추정'이며 근거를 함께 남긴다.
function analyzeHiring(posts, heads, npsCount, npsAsOf, extDiag, extProfile, hpHints, workAddrs) {
  if (!posts || !posts.length) return { ok: false, reason: '채용 사이트에서 이 업체 공고를 찾지 못했습니다', posts: [], heads: heads || [], extProfile: extProfile || [], hpHints: hpHints || [], workAddrs: workAddrs || [] };
  const now = new Date();
  const curY = now.getFullYear();
  const ym = (s) => (String(s).length >= 7 ? String(s) : `${s}-06`);          // 연도만 있으면 연중으로 근사
  const monthsAgo = (s) => {
    const [yy, mm] = ym(s).split('-').map(Number);
    return (curY - yy) * 12 + (now.getMonth() + 1 - mm);
  };
  // 공고 1건에 여러 날짜가 있으면 가장 최근 것을 그 공고의 시점으로 본다(등록일보다 마감일이 뒤)
  const dated = [], undated = [];
  posts.forEach((p) => {
    if (!p.dates.length) { undated.push(p); return; }
    const best = p.dates.map(ym).sort().pop();
    dated.push({ ...p, at: best, age: monthsAgo(best) });
  });

  const byYear = {}, byRole = {};
  dated.forEach((p) => { const yy = p.at.slice(0, 4); byYear[yy] = (byYear[yy] || 0) + 1; });
  posts.forEach((p) => { byRole[p.role] = (byRole[p.role] || 0) + 1; });

  const recent = dated.filter((p) => p.age <= 12).length;                     // 최근 12개월
  const prior = dated.filter((p) => p.age > 12 && p.age <= 24).length;        // 직전 12개월
  const spanYears = Object.keys(byYear).length;
  const signals = [];

  // ㉠ 최근 급증 + 직종 확장 → 증설·라인 신설 의심
  const recentRoles = new Set(dated.filter((p) => p.age <= 12).map((p) => p.role));
  const oldRoles = new Set(dated.filter((p) => p.age > 12).map((p) => p.role));
  const newRoles = [...recentRoles].filter((r) => !oldRoles.has(r) && r !== '기타·불명');
  if (recent >= 3 && recent >= prior * 2) {
    signals.push({
      kind: 'expand', level: newRoles.length ? 'high' : 'mid',
      title: '최근 채용 급증 — 증설·증원 가능성',
      detail: `최근 12개월 ${recent}건 vs 직전 12개월 ${prior}건`
        + (newRoles.length ? ` · 이전에 없던 직종이 새로 등장(${newRoles.join('·')})` : '')
        + `. 설비 증설이나 신규 라인 가동을 준비 중일 수 있습니다.`,
      ask: '최근 1년 내 증설·라인 신설 계획이 있었는지, 현재 가동 라인 수와 교대 운영 형태를 확인하세요.',
    });
  }
  // ㉡ 같은 직종 반복 → 이탈이 잦거나 충원이 안 됨
  Object.entries(byRole).forEach(([role, n]) => {
    if (role === '기타·불명' || n < 3) return;
    const rd = dated.filter((p) => p.role === role);
    if (rd.length < 3) return;
    const span = Math.max(1, Math.max(...rd.map((p) => p.age)) - Math.min(...rd.map((p) => p.age)));
    const cycle = Math.round(span / Math.max(1, rd.length - 1));              // 평균 재공고 주기(개월)
    if (cycle <= 6) {
      signals.push({
        kind: 'churn', level: cycle <= 3 ? 'high' : 'mid',
        title: `${role} 반복 공고 — 이탈·충원난 신호`,
        detail: `${rd.length}건이 평균 ${cycle}개월 주기로 반복 게시됐습니다. 같은 자리를 계속 다시 뽑고 있다는 뜻일 수 있습니다.`,
        ask: `${role} 인력의 평균 근속연수와 최근 1년 퇴사 인원을 물어보세요. 반복 공고는 이직률이 높거나(현장 부담) 채용이 안 되는(입지·처우) 두 가지로 갈립니다.`,
      });
    }
  });
  // ㉢ 채용 강도 — 재직자수 대비 연평균 공고 건수(회전율의 거친 대용치)
  let intensity = null;
  const emp = Number(npsCount);
  if (isFinite(emp) && emp > 0 && dated.length >= 3 && spanYears >= 2) {
    const perYear = dated.length / spanYears;
    const r = perYear / emp;
    const band = r >= 0.5 ? '매우 높음' : r >= 0.25 ? '높음' : r >= 0.1 ? '보통' : '낮음';
    intensity = { perYear: Math.round(perYear * 10) / 10, ratio: Math.round(r * 100), band, emp };
    if (r >= 0.25) {
      signals.push({
        kind: 'churn', level: r >= 0.5 ? 'high' : 'mid',
        title: `채용 강도 ${band}`,
        detail: `재직자 ${emp}명 대비 연평균 공고 ${intensity.perYear}건(${intensity.ratio}%). 상시 충원 성격이 강합니다.`,
        ask: '연간 퇴사 인원과 생산직 근속 분포를 확인하세요. 성장에 따른 증원인지, 이탈에 따른 충원인지는 근속연수로 갈립니다.',
      });
    }
  }
  // ㉣ 사원수 관측치 대조 — 채용사이트 공시 사원수 vs 연금 가입자수
  let headTrend = null;
  const hAll = (heads || []).filter((x) => x && x.count);
  // 사이트마다 값이 다르다(한웅메디칼: 사람인 54 · 잡코리아 57 · 원티드 49).
  // 한 곳만 쓰면 왜 그 값인지 알 수 없으므로 전부 남기고, 대표는 기준일 있는 값 우선.
  const h = [...hAll].sort((a, b) => String(b.asOf || '').localeCompare(String(a.asOf || '')))[0];
  if (h && isFinite(emp) && emp > 0) {
    const counts = hAll.map((x) => x.count);
    const diff = emp - h.count;
    headTrend = {
      site: h, nps: { count: emp, asOf: npsAsOf || null }, diff,
      sites: hAll.map((x) => ({ host: String(x.host || '').replace(/^www\./, ''), count: x.count, asOf: x.asOf || null })),
      spread: counts.length > 1 ? { min: Math.min(...counts), max: Math.max(...counts) } : null,
    };
    if (Math.abs(diff) >= Math.max(3, h.count * 0.1)) {
      // 기준일이 없으면 언제 값인지 알 수 없어 증감으로 단정할 수 없다. 불일치로만 알린다.
      // 증감이라고 말하려면 두 값이 '언제 것인지' 알아야 하고, 서로 견줄 만큼 가까워야 한다.
      // 씨앤티드림에서 잡코리아의 2017년 19명과 2025년 연금 14명을 비교해 '인력 감소 확인'을
      // 냈는데, 8년 차이 나는 두 시점이라 감소인지 알 수 없다. 게다가 잡플래닛은 6명이었다.
      // 기준일이 3년 넘게 지났거나 사이트끼리 2배 이상 벌어지면 불일치로만 알린다.
      const ageY = h.asOf ? (curY - Number(String(h.asOf).slice(0, 4))) : null;
      const stale = ageY == null || ageY > 3;
      const cs = headTrend.sites.map((v) => v.count);
      const wide = cs.length > 1 && Math.max(...cs) >= Math.min(...cs) * 2;
      const solid = !stale && !wide;
      const why = stale
        ? (h.asOf ? ` — 채용 사이트 값이 ${h.asOf} 기준이라 연금 시점과 ${ageY}년 차이가 납니다. 증감으로 볼 수 없습니다.`
          : ' — 채용 사이트 값이 언제 것인지 표기돼 있지 않아 증감으로 볼 수 없습니다.')
        : wide ? ` — 사이트끼리 ${Math.min(...cs)}~${Math.max(...cs)}명으로 벌어져 어느 값이 맞는지 알 수 없습니다.` : '';
      signals.push({
        kind: solid ? (diff > 0 ? 'expand' : 'shrink') : 'churn', level: solid ? 'mid' : 'low',
        title: solid ? (diff > 0 ? '인력 증가 확인' : '인력 감소 확인') : '인력 수치 불일치',
        detail: (hAll.length > 1
          ? `채용사이트 ${hAll.length}곳 표기 — ${headTrend.sites.map((v) => `${v.host} ${v.count}명${v.asOf ? `(${v.asOf})` : ''}`).join(' / ')}`
          : `${h.host} 표기 사원수 ${h.count}명${h.asOf ? `(${h.asOf} 기준)` : '(기준일 미상)'}`)
          + ` ↔ 국민연금 가입자 ${emp}명${npsAsOf ? `(${npsAsOf} 기준)` : ''} · 차이 ${diff > 0 ? '+' : ''}${diff}명`
          + why,
        ask: solid
          ? (diff > 0 ? '증원 사유(수주 증가·증설)와 신규 인력의 배치 라인을 확인하세요.' : '감소 사유(수주 축소·자동화·외주 전환)를 확인하세요.')
          : '현재 상시 근무 인원을 직접 확인하세요. 국민연금 가입자수가 가장 최신이며, 채용 사이트 표기는 갱신이 늦거나 오래된 신고값 그대로인 경우가 많습니다.',
      });
    }
  }

  return {
    ok: true, posts, heads: heads || [], extDiag: extDiag || null, extProfile: extProfile || [],
    hpHints: hpHints || [], workAddrs: workAddrs || [], byYear, byRole,
    dated: dated.length, undated: undated.length,
    recent, prior, spanYears, intensity, headTrend,
    signals: signals.sort((a, b) => (b.level === 'high' ? 1 : 0) - (a.level === 'high' ? 1 : 0)),
  };
}

// 회수·판매중지는 업체명으로 조회하는 파라미터가 없어 목록을 받아 프론트에서 거른다.
// 그런데 지금까지 1페이지만 받았다(page 파라미터를 매핑조차 안 해 뒀다). 이 API는 전체를
// 한 번에 주지 않으므로, 받은 범위 밖의 이력은 '없음'으로 보였다 — 어느 업체를 조회해도
// 0건이던 이유다. totalCount를 보고 필요한 만큼 더 받고, 얼마나 훑었는지를 함께 남긴다.
const RECALL_PAGE = 500;
const RECALL_MAX_PAGES = 6;                   // 3,000건 상한 — 호출 시간과 맞바꾼 현실적 한계
async function recallLookup() {
  const first = await proxyGet('recall', { rows: String(RECALL_PAGE), page: '1' });
  const pick = (d) => {
    for (const path of ['response.body.items.item', 'body.items.item', 'body.items', 'items']) {
      let cur = d, ok = true;
      for (const seg of path.split('.')) { if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg]; else { ok = false; break; } }
      if (ok && cur != null) return Array.isArray(cur) ? cur : [cur].filter(Boolean);
    }
    return [];
  };
  const totalOf = (d) => {
    for (const path of ['response.body.totalCount', 'body.totalCount', 'totalCount']) {
      let cur = d, ok = true;
      for (const seg of path.split('.')) { if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg]; else { ok = false; break; } }
      if (ok && cur != null && isFinite(Number(cur))) return Number(cur);
    }
    return null;
  };
  const items = pick(first);
  const total = totalOf(first);
  const pages = total != null ? Math.min(RECALL_MAX_PAGES, Math.ceil(total / RECALL_PAGE)) : 1;
  if (pages > 1) {
    const rest = await mapLimit(
      Array.from({ length: pages - 1 }, (_, i) => i + 2), 3,
      async (pg) => { try { return pick(await proxyGet('recall', { rows: String(RECALL_PAGE), page: String(pg) })); } catch { return []; } });
    rest.forEach((arr) => items.push(...arr));
  }
  return { items, total, scanned: items.length, pages };
}

// 공장등록대장은 기본·용지·시설·생산 오퍼레이션으로 나뉜다. 여태 '생산정보'만 불러서
// 주요생산품·종업원수까지만 얻고 건축면적은 통째로 놓쳤다(마움코스메틱 조회에서 면적 D등급).
// 나머지 오퍼레이션을 함께 불러 면적이 실린 쪽을 쓴다. 어느 오퍼레이션이 답했는지도 남겨
// 둔다 — 산단공이 오퍼레이션 이름을 바꾸면 그 사실이 바로 드러나야 한다.
// 실제 응답을 받아 보니 생산정보에는 면적이 없는 게 확실해졌다. 응답 항목은 이게 전부다.
//   fctryManageNo · cmpnyNm · rnAdres · rprsntvNm · cvplChrgOrgnztNm · cmpnyTelno ·
//   cmpnyFxnum · allEmplyCo · frstFctryRegistDe · rprsntvIndutyCode · indutyCodes ·
//   indutyNm · mainProductCn · hmpadr · irsttNm
// 그리고 상호(cmpnyNm)로 부른 상세 오퍼레이션 셋이 모두 HTTP 400을 냈다. 400은 '그런
// 오퍼레이션이 없다'가 아니라 '요청이 잘못됐다'는 뜻이다 — 공장 상세는 상호가 아니라
// 공장관리번호(fctryManageNo)로 찾는 게 자연스럽고, 그 번호는 생산정보 응답에 들어 있다.
// 그래서 관리번호를 먼저 얻은 뒤 그것을 키로 상세를 부른다. 키가 문제가 아닐 수도 있으므로
// 상호로도 한 번 더 시도하고, 실패하면 상류가 보낸 오류 본문을 그대로 남긴다.
// ※ 여기서 산단공 '용지·시설·기본' 오퍼레이션 셋(getFctryLand/Fclty/BassService_v2)을 불러
//   면적을 찾으려 했는데, 이 이름들은 추정이었고 매번 HTTP 400으로 실패했다(조회 1회당 헛요청 6건).
//   받을 수 있는 생산정보에는 면적 항목이 아예 없다. 면적은 건축물대장(bldAreaLookup)으로 옮겼다.

// factoryWithDetail은 응답을 { prod, detail, manageNo }로 감싸 준다. 여기서 감싼 채로 목록을 찾으면
// 늘 빈 배열이 된다 — 실제로 그래서 공장 주소가 방문 주소로 한 번도 쓰이지 않았고(방문거리·면적이
// 본점 주소 기준으로 계산됨), 공장 레코드에서 사업자번호를 되찾는 보완도 죽어 있었다.
const factoryProd = (d) => (d && d.prod ? d.prod : d);
// 산단공 공장등록 생산정보(주소·대표자·전화·종업원수·생산품). 면적은 여기 없다.
async function factoryWithDetail(nm) {
  const prod = await proxyGet('factory', { name: nm, rows: '30' });
  let items = [];
  for (const path of ['response.body.items.item', 'body.items.item', 'body.items', 'items']) {
    let cur = prod, ok = true;
    for (const seg of path.split('.')) { if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg]; else { ok = false; break; } }
    if (ok && cur != null) { items = Array.isArray(cur) ? cur : [cur].filter(Boolean); break; }
  }
  const mn = (items.find((x) => x && x.fctryManageNo) || {}).fctryManageNo || null;
  return { prod, detail: [], manageNo: mn };
}

// 2단계: 선택된 업체의 재무·식약처·국민연금·제조업 병렬 조회 → 진단 포함 조립
// 느린 소스 하나(산단공은 19초 타임아웃까지 가곤 한다) 때문에 리포트 전체가 묶이지 않게,
// 이 시간 안에 온 자료로 먼저 그리고 나머지는 도착하는 대로 채운다. 늦은 자료도 이 시간을 넘기면 포기한다.
const LIVE_SOFT_MS = 5000;
// 방문지 단계가 산단공을 기다리는 한도 — 넘기면 식약처·본점 주소로 먼저 구하고, 공장 주소가 늦게 오면 다시 구한다
const LIVE_ADDR_MS = 3000;
const LIVE_LATE_MAX_MS = 45000;
async function finishLive(name, corp) {
  const nm = stripCorp(corp.corpNm || name);
  const calls = {
    finance: corp.crno ? financeLookup(corp.crno) : Promise.reject(new Error('법인등록번호 없음')),
    rpt: proxyGet('rpt', { name: nm, rows: '100' }),
    nps: npsLookup(nm, corp.bzno),
    maker: makerLookup(nm),
    // 의약품안전나라 업체정보 — 번지까지 있는 제조소 주소(공개 API는 시·군까지만)·업허가번호
    nedrug: nedrugMaker(corp.corpNm || name),
    // CGMP 적합업소·회수 목록 — 실시간 우선, 느리거나 실패하면 7일 이내 저장본(liveFirstList)
    gmp: liveFirstList('vs_c_gmp', () => proxyGet('gmp', { rows: '500' })),
    // 공장 상세(면적)는 생산정보가 주는 공장관리번호를 키로 써야 해서 순서를 지킨다
    factory: factoryWithDetail(nm),
    recall: liveFirstList('vs_c_recall', recallLookup),
    nts: corp.bzno ? proxyOnlyGet('ntsStatus', { b_no: String(corp.bzno).replace(/\D/g, '') }) : Promise.reject(new Error('사업자번호 없음')),
    naverNews: proxyOnlyGet('naverNews', { query: nm, display: '30', sort: 'date' }),
    // 제조원 역추적 — 이 업체를 '제조원/제조사'로 표기한 웹문서(납품 브랜드·제품 추정)
    oemTrace: proxyOnlyGet('naverWeb', { query: `${nm} 제조원`, display: '10' }),
    // 외부 집계(marketbz 등) 비공식 보강 — 사용자 요청으로 비활성화(공식 data.go.kr API 자료만 신뢰).
    bizAgg: Promise.resolve(null),
    // 채용공고 추적 — 뉴스도 홈페이지도 없는 영세업체의 거의 유일한 활동 흔적
    hiring: hiringTrace(nm),
    // 국세청 진위확인 — 사업자번호·대표자·개업일 3요소 대조(상태조회와 동일 서비스)
    ntsVal: ntsValidate(corp.bzno, corp.rep, corp.estbDt),
  };
  const keys = Object.keys(calls);
  const res = {};
  const settleOf = {};
  keys.forEach((k) => {
    settleOf[k] = Promise.resolve(calls[k]).then(
      // 보완 단계가 이미 더 나은 값(사업자번호로 다시 부른 국민연금 등)을 넣어 뒀으면 덮지 않는다
      (v) => { if (!(k in res)) res[k] = { ok: true, data: v }; },
      (e) => { if (!(k in res)) res[k] = { ok: false, err: String(e && e.message || e) }; });
  });
  const allDone = Promise.all(keys.map((k) => settleOf[k]));
  const soft = new Promise((r) => setTimeout(r, LIVE_SOFT_MS));

  // 방문지·면적 단계는 주소를 주는 소스(식약처 제조업·산단공·국민연금)만 기다린다.
  // 뉴스·채용·재무가 끝나길 기다릴 이유가 없고, 산단공이 19초 타임아웃으로 묶여도 기준 시간이 지나면 진행한다.
  const addrWait = new Promise((r) => setTimeout(r, LIVE_ADDR_MS));
  await Promise.race([Promise.all([settleOf.maker, settleOf.nps, Promise.race([settleOf.factory, addrWait]), Promise.race([settleOf.nedrug, addrWait])]), soft]);
  await liveBackfill(res, corp, name, nm);
  let siteSig = await liveSiteStage(res, corp, name);
  await Promise.race([allDone, soft]);

  // 기준 시간 안에 못 온 소스는 '불러오는 중'으로 먼저 그리고, 도착하면 다시 조립해 자동으로 바꿔 그린다(render가 _late를 본다)
  const pending = keys.filter((k) => !res[k]);
  const snap = { ...res };
  pending.forEach((k) => { snap[k] = { ok: false, err: '불러오는 중 — 도착하면 자동으로 채웁니다', pending: true }; });
  const report = window.assembleLiveReport(corp.corpNm || name, corp, snap);
  if (pending.length) {
    const late = Promise.race([allDone, new Promise((r) => setTimeout(r, LIVE_LATE_MAX_MS))]).then(async () => {
      keys.forEach((k) => { if (!res[k]) res[k] = { ok: false, err: '타임아웃(응답 지연)' }; });
      await liveBackfill(res, corp, name, nm);
      // 늦게 온 자료로 방문지 후보가 바뀌었으면(산단공 공장 주소 등) 방문거리·면적을 다시 구한다
      if (liveSiteInputs(res, corp, name).sig !== siteSig) siteSig = await liveSiteStage(res, corp, name);
      return window.assembleLiveReport(corp.corpNm || name, corp, res);
    }).catch(() => null);
    Object.defineProperty(report, '_late', { value: late, enumerable: false });
    Object.defineProperty(report, '_pendingKeys', { value: pending, enumerable: false });
  }
  return report;
}

// 1차에서 확보한 사업자번호로 막혔던 소스(국세청·국민연금)를 다시 부른다. 늦게 온 자료로 한 번 더 돌려도 된다.
async function liveBackfill(res, corp, name, nm) {
  // ── 2차 보완 — 1차에서 확보한 사업자번호로 막혔던 소스 재조회(서로 보완해 채우기) ──
  if (!corp.bzno) {
    const mkR = res.maker && res.maker.ok ? listOf(res.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
    const fcR = res.factory && res.factory.ok ? listOf(factoryProd(res.factory.data), ['response.body.items.item', 'body.items', 'items']) : [];
    const aggBzno = res.bizAgg && res.bizAgg.ok && res.bizAgg.data ? res.bizAgg.data.bzno : null;
    // ★ 상호 일치 레코드에서만 사업자번호 추출 — maker/factory API가 상호 필터링을 안 하므로
    //    전체를 훑으면 '남의 회사' 사업자번호를 잡아 국세청 재조회가 오염됨(할루시네이션 방지).
    const bzFrom = (list) => { const r = matchByNameApp(name, list); return r ? findBznoIn(r) : null; };
    // 집계(법인) 번호를 앞에 — 국세청 등록 확률이 높음. 식약처 제조업 번호는 그 다음.
    const cands = [aggBzno, bzFrom(mkR), bzFrom(fcR)]
      .map((b) => b ? String(b).replace(/\D/g, '') : null).filter((b) => b && b.length === 10);
    const uniqBz = [...new Set(cands)];
    // 국세청 사업자상태 — 후보 번호들로 재조회, 실제 상태값 나오는 번호 채택. 실패 사유는 표면화.
    const ntsStatusOf = (d) => { const it = d && Array.isArray(d.data) ? d.data[0] : null; return it && it.b_stt ? String(it.b_stt).trim() : ''; };
    if (uniqBz.length && (!res.nts || !res.nts.ok || !ntsStatusOf(res.nts.data))) {
      const errs = [];
      for (const b of uniqBz) {
        try {
          const d = await proxyOnlyGet('ntsStatus', { b_no: b });
          if (!res.nts || !res.nts.ok || ntsStatusOf(d)) res.nts = { ok: true, data: d };
          if (ntsStatusOf(d)) break;
        } catch (e) { errs.push(`${b}→${e && e.message ? e.message : e}`); }
      }
      // 전부 실패했으면 원래의 "사업자번호 없음" 대신 실제 사유 노출
      if ((!res.nts || !res.nts.ok) && errs.length) res.nts = { ok: false, err: `국세청 재조회 실패 (${errs.join(' / ')})` };
    }
    // 국민연금 — 상호검색 결과가 약하면(합산 미확보) 사업자번호로 정확 재조회
    if (uniqBz[0] && (!res.nps || !res.nps.ok || !(res.nps.data && res.nps.data.total))) {
      try { const npsBz = await npsLookup(nm, uniqBz[0]); if (npsBz && npsBz.count) res.nps = { ok: true, data: npsBz }; } catch { /* 유지 */ }
    }
  }
}

// 방문지 후보 주소 — 산단공 공장 · 식약처 제조소 · 연금 사업장. sig가 바뀌면 방문지 단계를 다시 돈다.
function liveSiteInputs(res, corp, name) {
  const fList = res.factory && res.factory.ok ? listOf(factoryProd(res.factory.data), ['response.body.items.item', 'body.items', 'items']) : [];
  const fHit = matchByNameApp(name, fList) || (fList.length === 1 ? fList[0] : null); // 상호 일치 건만(단건이면 그대로)
  const fAddr = fHit ? (fHit.rnAdres ?? fHit.lnmAdres ?? fHit.lotNoAddr ?? fHit.roadNmAddr ?? fHit.adres ?? fHit.ADRES ?? fHit.fctryAddr ?? null) : null;
  const mList = res.maker && res.maker.ok ? listOf(res.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const looksAddr = (v) => /[가-힣]{2,}(시|군|구|읍|면)\s|[가-힣]+(로|길)\s?\d/.test(String(v || ''));
  const mkHit = matchByNameApp(name, mList); // 상호 일치 건만(남의 회사 주소 오염 방지)
  const mAddr = mkHit ? (joinAddrFields(mkHit) || Object.values(mkHit).find(looksAddr) || null) : null;
  // 제조소가 여러 곳이면 공개 API에 곳마다 한 건씩 온다 — 같은 회사(사업자번호·상호) 건을 모두 모은다
  const sameCo = mkHit ? mList.filter((r) => r === mkHit || (mkHit.BIZRNO && r.BIZRNO === mkHit.BIZRNO) || (mkHit.ENTP_NAME && r.ENTP_NAME === mkHit.ENTP_NAME)) : [];
  const apiAddrs = [...new Set(sameCo.map((r) => joinAddrFields(r)).filter(Boolean))];
  // 의약품안전나라 — 번지까지 있는 제조소 주소. 있으면 이쪽을 앞세운다
  const ned = res.nedrug && res.nedrug.ok && res.nedrug.data && res.nedrug.data.found ? res.nedrug.data : null;
  const nedAddrs = ned ? ned.sites.map((x) => x.addr) : [];
  const mAddrs = [...new Set([...nedAddrs, ...apiAddrs])];
  const npsSrch = res.nps && res.nps.ok && res.nps.data ? res.nps.data.search : null;
  const npsAddr = npsSrch ? (npsSrch.wkplRoadNmDetAddr || npsSrch.wkplRoadNmDtlAddr || npsSrch.ldongAddr || null) : null;
  return { fAddr, mAddr: mAddrs[0] || mAddr, mAddrs, nedAddrs, npsAddr, sig: [fAddr, mAddrs.join(';'), npsAddr].join('|') };
}
// 실제 공장 소재지 선정 → 카카오 방문거리 + 건축물대장 면적. res.site · res.kakao · res.bld를 채운다.
async function liveSiteStage(res, corp, name) {
  const { fAddr, mAddr, mAddrs, nedAddrs, npsAddr, sig } = liveSiteInputs(res, corp, name);
  // 선정이 실패해도(카카오 오류 등) 예전 순서(공장 > 제조소 > 본점)로 방문지를 정한다.
  const site = await pickFactorySite({ name: corp.corpNm || name, fAddr, mAddr, mAddrs, nedAddrs, hqAddr: corp.addr, npsAddr }).catch(() => null);
  res.site = site ? { ok: true, data: site } : { ok: false, err: '공장 소재지 후보 주소 없음' };
  const visitAddr = site ? site.addr : pickFullAddr(fAddr, mAddr, corp.addr);
  // 방문 거리와 공장 면적(건축물대장)은 같은 주소로 부르므로 함께 돌린다
  // 사용자가 '공장 면적' 탭에서 주소를 고쳐 둔 업체는 그 주소(와 추가 필지)로 면적을 찾는다
  const areaOv = areaOvGet(corp.corpNm || name);
  const bldQueried = areaOv && areaOv.addr ? areaOv.addr : visitAddr;
  const bnm = corp.corpNm || name;
  const mainJob = areaOv && areaOv.addr ? bldAreaLookup(areaOv.addr, { name: bnm }).then((d) => ({ ...d, queried: areaOv.addr }))
    : site ? bldAreaForSite(site, bnm)
      : bldAreaLookup(visitAddr, { name: bnm }).then((d) => ({ ...d, queried: visitAddr }));
  const bldJob = mainJob.then((main) => bldWithLots(main, (areaOv && areaOv.lots) || [], bnm, { edited: !!(areaOv && areaOv.addr) }));
  const [trR, bldR] = await Promise.allSettled([kakaoTravel(visitAddr), bldJob]);
  const travel = trR.status === 'fulfilled' ? trR.value : null;
  const kakaoErr = trR.status === 'rejected' ? (trR.reason && trR.reason.message ? trR.reason.message : String(trR.reason)) : null;
  res.kakao = travel
    ? { ok: true, data: travel }
    : { ok: false, err: `${kakaoErr || '실패'} — 추정치 대체` };
  res.bld = bldR.status === 'fulfilled'
    ? { ok: true, data: { queried: bldQueried, ...bldR.value } }
    : { ok: false, err: bldR.reason && bldR.reason.message ? bldR.reason.message : String(bldR.reason), queried: bldQueried };

  return sig;
}

// 동명업체 선택 UI — source: 'fsc'(금융위 법인) | 'mfds'(식약처 등록업체 기준)
function renderCandidates(name, cands, source, similar) {
  const root = $('#report');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const isMfds = source === 'mfds';
  const box = el('div', 'candbox');
  const headSrc = isMfds ? '식약처 화장품제조업 등록업체 기준' : '금융위 법인 기준';
  // 유사 추천은 '같은 이름을 못 찾았다'는 사실을 먼저 알려야 한다 — 정확 일치로 오해하면 안 된다
  box.appendChild(el('div', 'candhead',
    similar
      ? `「${esc(name)}」와 <b>정확히 같은 상호를 찾지 못했습니다</b> — 표기가 비슷한 업체 <b>${cands.length}건</b>`
        + `<span class="candsub">${esc(headSrc)} · 한글 표기 차이(ㅐ↔ㅔ, 된소리, 띄어쓰기)를 감안해 골랐습니다. 대표자·주소로 같은 회사인지 확인하세요</span>`
      : `「${esc(name)}」 ${isMfds ? '식약처 등록업체' : '동명·유사 업체'} <b>${cands.length}건</b> — 조회할 업체를 선택하세요`
        + `<span class="candsub">${esc(headSrc)}${isMfds ? ' · 금융위 법인 미검색이라 식약처 등록명으로 추천' : ''}</span>`));
  cands.forEach((c) => {
    const card = el('button', 'cand');
    const meta = [
      c.rep ? '대표 ' + esc(c.rep) : '',
      c.bzno ? '사업자 ' + esc(c.bzno) : '',
      c.lcns ? '허가 ' + esc(c.lcns) : '',
      c.addr ? esc(c.addr) : '',
    ].filter(Boolean).join(' · ');
    const tag = (c.mfds ? '<span class="cand-tag">식약처 등록</span>' : '')
      + (c._sim != null ? `<span class="cand-sim">표기 유사 ${Math.round(c._sim * 100)}%</span>` : '');
    card.innerHTML = `<div class="cn">${esc(c.corpNm || '(상호미상)')}${tag}</div><div class="cm">${meta || '추가정보 없음'}</div>`;
    card.addEventListener('click', async () => {
      root.innerHTML = loadingHtml(`「${esc(c.corpNm || name)}」 나머지 카테고리 조회 중…`);
      mountTrend(root);
      try { render(await (c.mfds ? finishLiveMfds(name, c) : finishLive(name, c))); }
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
// 설명문을 읽기 좋게 자른다. 원문은 '★ 핵심 … ※ 단서 … ▣ 보완' 식으로 여러 문단이 한 줄에
// 이어 붙어 있어, 통째로 뿌리면 문단이 흐른다. 표식 앞에서 끊어 줄로 나눈다.
function noteLines(note) {
  return String(note || '').split(/\s*(?=[★※▣])/).map((s) => s.trim()).filter(Boolean);
}
// 3열 압축 행: [등급+항목] | [값] | [출처(우측 소형)]
function fieldRow(fld) {
  const isGap = fld.data_gap || fld.value == null;
  const row = el('div', 'field' + (isCgmpField(fld) ? ' cgmp' : ''));

  const k = el('div', 'k');
  k.appendChild(el('span', 'gdot g' + fld.grade, esc(fld.grade)));
  k.appendChild(el('span', 'ktxt', esc(fld.key)));
  row.appendChild(k);

  const stale = fld.fresh === false ? ' <span class="stale">⚠기간초과</span>' : '';
  // 설명은 예전에 title 툴팁이었다. 네 문장짜리 주석이 마우스만 올려도 화면을 덮었고,
  // 휴대폰에서는 아예 볼 방법이 없었다. 눌러서 펴는 방식으로 바꾼다.
  const info = fld.note ? ` <button type="button" class="ninfo" aria-expanded="false" aria-label="설명 보기">ⓘ</button>` : '';
  const valHtml = Array.isArray(fld.checklist)
    ? checklistHtml(fld.checklist) + info
    : (isGap ? '해당 없음' : esc(fld.value)) + stale + info;
  row.appendChild(el('div', 'v' + (isGap && !fld.checklist ? ' gap' : ''), valHtml));

  const src = el('div', 'src');
  src.innerHTML = esc(fld.source || '—') + (fld.as_of ? `<br><span class="asof">${esc(fld.as_of)}</span>` : '');
  row.appendChild(src);

  if (fld.note) {
    const nt = el('div', 'fnote', noteLines(fld.note).map((s) => `<p>${esc(s)}</p>`).join(''));
    nt.hidden = true;
    row.appendChild(nt);
    row.querySelector('.ninfo').addEventListener('click', (e) => {
      e.preventDefault();
      nt.hidden = !nt.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!nt.hidden));
    });
  }
  return row;
}

function block(title, icon, fields, cat) {
  const b = el('div', 'block' + (cat ? ' cat-' + cat : ''));
  // 값이 없는 항목은 접어 둔다. 씨앤티드림 조회에서 '생산역량·인원' 9개 중 4개가 빈칸이었고
  // 각각 긴 설명까지 달려 블록의 절반을 먹었다. 없다는 사실은 한 줄이면 충분하다.
  const gaps = fields.filter((f) => f.data_gap || f.value == null);
  const filled = fields.filter((f) => !(f.data_gap || f.value == null));
  b.appendChild(el('h3', null, `${icon ? `<span class="ic">${icon}</span>` : ''}${esc(title)}`
    + `<span class="cnt">${fields.length}개 필드${gaps.length ? ' · 공백 ' + gaps.length : ''}</span>`));
  filled.forEach((f) => b.appendChild(fieldRow(f)));
  if (gaps.length) {
    const d = el('details', 'gapfold');
    d.appendChild(el('summary', null, `<span class="gf-n">확인 안 됨 ${gaps.length}건</span>`
      + `<em>${esc(gaps.map((g) => g.key).join(' · '))}</em>`));
    gaps.forEach((f) => d.appendChild(fieldRow(f)));
    b.appendChild(d);
  }
  return b;
}

// 재무 지표 정의 (금액 4종 + 비율 2종), 색상 구분
const FIN_SERIES = [
  { name: '매출액', unit: '억', grp: 'amt', color: '#3b82f6', g: (d) => d.revenue },
  { name: '영업이익', unit: '억', grp: 'amt', color: '#ef4444', g: (d) => d.operatingProfit },
  { name: '총자산', unit: '억', grp: 'amt', color: '#10b981', g: (d) => d.assets },
  { name: '총부채', unit: '억', grp: 'amt', color: '#f59e0b', invert: true, g: (d) => d.debt },
  // 비율은 분자·분모가 둘 다 있을 때만 낸다. null 은 산술에서 0 으로 취급되기 때문에,
  // 영업이익이 비어 있는 해가 '영업이익률 0%'로 찍혔다 — 이익이 0이라는 뜻이 되어 버린다.
  // 자료가 없는 것과 값이 0인 것은 전혀 다른 말이라, 없으면 빈칸으로 둔다.
  { name: '영업이익률', unit: '%', grp: 'rat', color: '#a855f7',
    g: (d) => (d.revenue && d.operatingProfit != null ? +(d.operatingProfit / d.revenue * 100).toFixed(1) : null) },
  { name: '부채비율', unit: '%', grp: 'rat', color: '#94a3b8', invert: true,
    g: (d) => {
      if (d.assets == null || d.debt == null) return null;
      const eq = d.assets - d.debt;
      return eq > 0 ? +(d.debt / eq * 100).toFixed(0) : null;
    } },
];

// 지표별 스파크 카드 — 각자 자기 스케일이라 수치 크기가 달라도 추이가 전부 보인다
function sparkCard(se, years) {
  const vals = se.vals;
  const idxs = vals.map((v, i) => (v != null ? i : null)).filter((i) => i != null);
  if (!idxs.length) {
    return `<div class="spark" style="border-top-color:${se.color}"><div class="sphead">${esc(se.name)} <span class="u">(${se.unit})</span></div><div class="spmiss">데이터 없음</div></div>`;
  }
  const first = vals[idxs[0]], last = vals[idxs[idxs.length - 1]];
  // 증감 배지: 금액은 %(첫해 대비), 비율(%)은 %p 차이.
  // 관측치가 한 해뿐이면 견줄 대상이 없다. 그때도 first === last 라 '0%p'가 찍혀
  // 변화가 없었다는 뜻으로 읽혔다 — 비교를 못 한 것과 변화가 없는 것은 다르다.
  let chg = '—', dir = 0;
  if (idxs.length < 2) chg = '1개년';
  else if (se.unit === '%') { const d = +(last - first).toFixed(1); chg = `${d > 0 ? '+' : ''}${d}%p`; dir = Math.sign(d); }
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
  const b = el('div', 'block full cat-fin');
  const chartN = hist.length ? '그래프 6지표 · 표 자본금' : `${fields.length}개 필드`;
  b.appendChild(el('h3', null, `재무<span class="cnt">${chartN}</span>`));

  // 재무 건전성 평가 배너 (양호/주의/위험)
  const fh = report.finance_health;
  if (fh) {
    const lv = fh.level === '위험' ? 'bad' : fh.level === '주의' ? 'mid' : 'good';
    const fb = el('div', 'finhealth ' + lv);
    fb.innerHTML =
      `<span class="fh-badge">${esc(fh.level)}</span>` +
      `<span class="fh-txt">${esc(fh.year)}년 · ${esc(fh.reasons.join(' · '))}</span>` +
      `<span class="fh-note" title="근거: 부채비율 200% 이하 양호(한국은행 기업경영분석 통상 기준)·400% 초과 위험, 자본잠식(자본총계≤0) 부실, 영업손실 주의. 참고지표이며 최종판단은 신용조회 권장">ⓘ 기준</span>`;
    b.appendChild(fb);
  }

  if (hist.length) {
    const years = hist.map((d) => d.year);
    const w = el('div', 'finwrap');
    // 외부사이트에서 채운 연도는 표시를 남긴다 — 공시와 같은 선에 그려지므로 구분이 없으면 오해한다
    const extYears = hist.filter((d) => d.src === 'ext').map((d) => d.year);
    const extHost = (hist.find((d) => d.src === 'ext') || {}).host;
    w.appendChild(el('div', 'finhead',
      `<span>재무 지표 ${years.length}개년 추이 (${years[0]}~${years[years.length - 1]}, 최신연도 기준)</span>`
      + `<span class="finnote">지표별 자기 스케일 — 추이 비교용</span>`
      + (extYears.length
        ? `<span class="finext">${extYears.join('·')}년은 외부사이트자료${extHost ? `(${esc(extHost)})` : ''} — 공시 아님</span>`
        : '')));
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

// ═══ 최근 활동 · 웹 자료 ═══
// 뉴스 신호 타임라인 + 웹 언급 추적 + 최신 관련기사.
// 확인'사항'은 위 '방문 전 확인필요' 표 하나로 모았고, 여기는 그 근거가 되는 원문이다.
function renderCheckWeb(report) {
  const ins = report.insights;
  const timeline = (ins && ins.timeline) || [];
  const assess = ins && ins.assessment;
  const oem = report.oem_trace || [];
  const news = report.news || [];
  const rc = report.rel_check || null;
  const excl = (rc && rc.excluded) || [];
  if (!timeline.length && !oem.length && !news.length && !excl.length) return null;
  // 관련 판정 근거 배지 — 왜 이 업체 자료로 봤는지
  const relB = (w) => (w ? `<span class="rel-ev" title="관련 판정 근거">✓ ${esc(w)}</span>` : '');

  const box = el('div', 'chkbox chk-web');
  const downs = assess ? assess.downs : 0;
  let html = `<h3>최근 활동 · 웹 자료 <b>· 확인사항의 근거</b>` +
    `<span class="chk-sum ${downs ? 'on' : ''}">${downs ? `주의 신호 ${downs}건` : (timeline.length ? `신호 ${timeline.length}건` : `언급 ${oem.length + news.length}건`)}</span>` +
    `<button type="button" class="chk-add" data-chkadd="1">➕ 체크리스트에 추가</button></h3>` +
    `<div class="chk-note">네이버 뉴스·웹문서 중 <b>이 업체 자료로 확인된 것만</b> 보입니다 — 상호가 다른 상호의 일부가 아닌 자리에 나오고, `
    + `소재지${rc && rc.regions && rc.regions.length ? `(${esc(rc.regions.map(regionShort).join('·'))})` : ''}·대표자·사업자번호·홈페이지 중 하나가 함께 나와야 합니다`
    + `(네 글자 이상 상호는 화장품 문맥도 인정). 사실관계는 원문 확인 권장.</div>`;
  if (!timeline.length && !oem.length && !news.length) html += `<div class="rel-none">관련 자료로 확인된 뉴스·웹문서가 없습니다 — 검색된 ${excl.length}건은 아래와 같이 다른 업체나 무관한 자료로 판정했습니다.</div>`;

  // 종합 판단(재량)
  if (assess) html += `<div class="chk-take ib-${esc(assess.level)}"><b>종합 판단</b> ${esc(assess.note)}</div>`;

  // ── 신호 타임라인(시점 있는 항목) ──
  // 같은 사건을 여러 매체가 같은 날 보도하면 타임라인이 중복으로 길어진다(코빅스: 하루 6건).
  // 날짜별로 묶어 대표 1건만 펴 보이고 나머지는 '외 N건'으로 접는다. 날짜가 다르면 그대로 둔다.
  if (timeline.length) {
    const groups = [];
    const idx = new Map();
    timeline.forEach((t) => {
      const k = t.date || '—';
      if (!idx.has(k)) { idx.set(k, groups.length); groups.push({ date: k, items: [] }); }
      groups[idx.get(k)].items.push(t);
    });
    html += `<div class="chk-sec">신호 타임라인 <i>발행일 기준 · 같은 날 보도는 대표 1건</i></div><ul class="ib-tl">`;
    groups.forEach((g) => {
      // 대표는 설명이 가장 충실한 기사 — 같은 사건이면 정보량이 많은 쪽이 낫다
      const sorted = [...g.items].sort((a, b) => String(b.desc || '').length - String(a.desc || '').length);
      const t = sorted[0], rest = sorted.slice(1);
      const tags = [...new Set(g.items.map((x) => x.tag))];
      html += `<li class="ib-${esc(t.tone)}">` +
        `<span class="ib-date">${esc(g.date)}</span>` +
        `<span class="ib-tag ib-tag-${esc(t.tone)}">${esc(t.tag)}</span>` +
        `<div class="ib-body"><a href="${esc(t.link || '#')}" target="_blank" rel="noopener">${esc(t.title)}</a>${relB(t.rel)}` +
        (t.desc ? `<div class="ib-desc">${esc(t.desc)}</div>` : '');
      if (rest.length) {
        html += `<details class="ib-more"><summary>외 ${rest.length}건`
          + (tags.length > 1 ? ` · ${esc(tags.slice(1).join('·'))} 포함` : '') + `</summary><ul>`
          + rest.map((r) => `<li><a href="${esc(r.link || '#')}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(r.title)}</a>`
            + (r.tag !== t.tag ? `<span class="ib-subtag">${esc(r.tag)}</span>` : '') + `</li>`).join('')
          + `</ul></details>`;
      }
      html += `</div></li>`;
    });
    html += '</ul>';
  }

  // ── 웹 언급 추적(제조원·채용·기업보고서) ──
  if (oem.length) {
    html += `<div class="chk-sec">웹 언급 추적 <i>활동·거래 단서</i></div><ul class="ot-list">`;
    oem.forEach((o) => {
      const tagCls = o.tag === '채용' ? 'ot-hire' : o.tag === '기업보고서' ? 'ot-report' : o.tag === '제조원/납품' ? 'ot-oem' : 'ot-etc';
      const t = o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.title || o.link)}</a>` : esc(o.title || '');
      html += `<li><div class="ot-t"><span class="ot-tag ${tagCls}">${esc(o.tag || '언급')}</span>${t}${relB(o.rel)}</div>` +
        (o.desc ? `<div class="ot-d">${esc(o.desc)}</div>` : '') + `</li>`;
    });
    html += '</ul>';
    if (oem.some((o) => o.tag === '기업보고서')) {
      html += `<div class="ot-hint">ℹ️ 기업신용보고서가 존재 — 비공개 재무자료 있음(신용조회 시 재무 확인 가능)</div>`;
    }
    if (oem.some((o) => o.tag === '채용')) {
      html += `<div class="ot-hint">ℹ️ 채용공고 확인 — 현재 가동·인력 충원 중일 가능성(생산 활동성 단서)</div>`;
    }
  }

  // ── 최신 관련기사(신호로 분류되지 않은 일반 기사) ──
  const tlLinks = new Set(timeline.map((t) => t.link));
  const others = news.filter((n) => !tlLinks.has(n.originallink || n.link));
  if (others.length) {
    html += `<div class="chk-sec">최신 관련기사</div><ul class="newslist">`;
    others.slice(0, 5).forEach((n) => {
      const title = String(n.title || '').replace(/<\/?b>/g, '');
      const desc = String(n.description || '').replace(/<\/?b>/g, '');
      const date = n.pubDate ? new Date(n.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      html += `<li><a href="${esc(n.link || '#')}" target="_blank" rel="noopener" class="ntitle">${esc(title)}</a>` +
        `<div class="ndesc">${esc(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}</div>` +
        `<div class="nmeta">${esc(date)}${relB(n._rel)}</div></li>`;
    });
    html += '</ul>';
  }
  // ── 관련성 검증에서 제외한 자료 ── 숨기지 않고 사유와 함께 접어 둔다(판정이 틀렸으면 사람이 바로잡을 수 있게)
  if (excl.length) {
    const maybe = excl.filter((x) => x.level === 'maybe');
    const off = excl.filter((x) => x.level !== 'maybe');
    const row = (x) => `<li><span class="rx-kind">${esc(x.kind)}</span>`
      + (x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title || x.link)}</a>` : esc(x.title || ''))
      + `<span class="rx-why ${x.level === 'maybe' ? 'maybe' : ''}">${esc(x.why)}</span>${x.date ? `<span class="rx-date">${esc(x.date)}</span>` : ''}</li>`;
    html += `<details class="rel-x"><summary>관련성 검증에서 제외 ${excl.length}건`
      + (maybe.length ? ` · 확인 필요 ${maybe.length}` : '') + (off.length ? ` · 다른 업체·무관 ${off.length}` : '') + `</summary>`
      + (maybe.length ? `<div class="rx-sec">확인 필요 — 상호와 화장품 문맥은 맞지만 이 업체임을 가리키는 근거(소재지·대표자 등)가 없음</div><ul>${maybe.map(row).join('')}</ul>` : '')
      + (off.length ? `<div class="rx-sec">다른 업체·무관</div><ul>${off.map(row).join('')}</ul>` : '')
      + `</details>`;
  }
  box.innerHTML = html;
  return box;
}

// 🧑‍🏭 채용공고 추적 렌더 — 추정임을 숨기지 않는다. 수집 편향과 해석의 갈림길을 함께 적는다.
function renderHiring(h) {
  if (!h) return null;
  const box = el('div', 'hirebox');
  if (!h.ok) {
    box.innerHTML = `<h4>채용공고 추적 <span>잡코리아·사람인·워크넷 등</span></h4>`
      + `<div class="hire-none">${esc(h.reason || '조회 불가')}</div>`;
    return box;
  }
  const yrs = Object.keys(h.byYear).sort();
  const maxN = Math.max(1, ...Object.values(h.byYear));
  let html = `<h4>채용공고 추적 <span>공고 ${h.posts.length}건${h.spanYears ? ` · ${h.spanYears}개년 확인` : ''}</span></h4>`;

  // 판정 신호 — 가장 중요한 결론이므로 맨 위
  if (h.signals.length) {
    html += '<div class="hire-sig">' + h.signals.map((s) => `<div class="hs ${esc(s.level)} ${esc(s.kind)}">`
      + `<b>${esc(s.title)}</b><i>${esc(s.detail)}</i><em>▸ ${esc(s.ask)}</em></div>`).join('') + '</div>';
  } else {
    html += `<div class="hire-none">뚜렷한 신호 없음 — 반복 공고나 급증 패턴이 확인되지 않았습니다.</div>`;
  }

  // ── 좌우 2단 ──
  // 왼쪽은 '공고가 몇 건이었나'(사실), 오른쪽은 '그래서 무슨 뜻인가'(해석)로 나눈다.
  // 세로로 길게 늘어놓으면 건수를 보다가 해석까지 스크롤해야 해서 둘을 맞대 보기 어려웠다.
  let left = '', right = '';

  // [좌] 연도별 분포 — 3개년 흐름을 한눈에
  if (yrs.length) {
    left += `<div class="hire-sec">연도별 공고 <em>날짜가 확인된 ${h.dated}건 기준</em></div><div class="hire-bars">`
      + yrs.map((y) => `<div class="hbar"><i>${esc(y)}</i>`
        + `<span style="width:${Math.round((h.byYear[y] / maxN) * 100)}%"></span><b>${h.byYear[y]}건</b></div>`).join('')
      + '</div>';
  }
  // [좌] 직종 분포 — 어느 자리가 반복되는지가 이탈 해석의 핵심. 건수와 같은 '공고' 이야기다.
  const roles = Object.entries(h.byRole).sort((a, b) => b[1] - a[1]);
  if (roles.length) {
    left += `<div class="hire-sec">모집 직종</div><div class="hire-roles">`
      + roles.map(([r, n]) => `<span class="hrole">${esc(r)}<b>${n}</b></span>`).join('') + '</div>';
  }

  // [우] 인력 관측치 대조 — 채용사이트 공시 사원수 ↔ 연금 가입자수
  if (h.headTrend) {
    const t = h.headTrend;
    right += `<div class="hire-sec">인력 관측치 대조 <em>출처가 다른 두 시점</em></div><div class="hire-head">`
      + `<div><i>${esc(t.site.host)}</i><b>${t.site.count}명</b><u>${esc(t.site.asOf || '기준일 미상')}</u></div>`
      + `<div class="arrow">→</div>`
      + `<div><i>국민연금</i><b>${t.nps.count}명</b><u>${esc(t.nps.asOf || '')}</u></div>`
      + `<div class="delta ${t.diff > 0 ? 'up' : t.diff < 0 ? 'down' : ''}">${t.diff > 0 ? '+' : ''}${t.diff}명</div>`
      + '</div>';
  }
  // [우] 채용 강도
  if (h.intensity) {
    const i = h.intensity;
    right += `<div class="hire-sec">채용 강도 <em>회전율 대용치</em></div>`
      + `<div class="hire-int">재직자 ${i.emp}명 대비 연평균 공고 <b>${i.perYear}건</b> = <b>${i.ratio}%</b> · ${esc(i.band)}</div>`;
  }
  // [우] 급여 수준 — 공시에는 없고 채용 사이트에만 있는 몇 안 되는 실질 정보
  const prof = h.extProfile || [];
  if (prof.length) {
    right += `<div class="hire-sec">급여 수준 <em>채용사이트 게재값 · 공시 아님</em></div><div class="pf-kv">`
      + prof.map((r) => {
        const alt = r.agree ? '' : `<u>${esc(r.sources.map((s) => `${s.host} ${s.value}`).join(' / '))}</u>`;
        return `<div class="pf-k">${esc(r.key)}</div>`
          + `<div class="pf-v${r.agree ? '' : ' dis'}">${esc(r.value)}`
          + `<small>${esc(r.sources.map((s) => s.host).join(', '))}</small>${alt}</div>`;
      }).join('')
      + '</div>';
  }
  // 한쪽이 비면 2단으로 둘 이유가 없다 — 남은 쪽을 폭 전체로 편다.
  if (left && right) html += `<div class="hire-split"><div class="hire-col">${left}</div><div class="hire-col">${right}</div></div>`;
  else if (left || right) html += left || right;
  // 오른쪽이 통째로 빌 수도 있다(연금·채용사이트 값 미확보). 왜 비었는지는 말해 준다.
  if (left && !right) {
    html += `<div class="hire-warn">인력 관측치·채용 강도·급여 수준은 국민연금 가입자수나 채용사이트 기업정보가 있어야 계산됩니다 — 이번에는 확보하지 못했습니다.</div>`;
  }

  // 근거 원문 — 추정의 출처를 사용자가 직접 열어볼 수 있어야 한다
  const show = h.posts.slice(0, 6);
  html += `<div class="hire-sec">공고 원문 <em>클릭 시 해당 사이트</em></div><ul class="hire-list">`
    + show.map((p) => `<li><span class="hdt">${esc((p.dates[0] || '').slice(0, 7) || '—')}</span>`
      + `<a href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title.slice(0, 60))}</a>`
      + `<span class="hrl">${esc(p.role)}</span></li>`).join('')
    + (h.posts.length > show.length ? `<li class="more">외 ${h.posts.length - show.length}건</li>` : '')
    + '</ul>';
  // 한계 고지 — 이걸 빼면 추정이 사실처럼 읽힌다
  html += `<div class="hire-warn">※ 마감된 공고는 사이트에서 내려가 검색에 잡히지 않습니다. 과거일수록 적게 집계되며`
    + (h.undated ? `, 날짜를 확인하지 못한 공고가 ${h.undated}건 있습니다` : '')
    + `. 공고 건수는 채용 인원이 아니고 같은 자리를 다시 올린 것일 수 있습니다 — 모든 판정은 추정이며 방문 시 근속연수로 확인하세요.</div>`;
  box.innerHTML = html;
  return box;
}

// 홈페이지 추적 결과를 박스에 렌더 (검색중 → 결과 교체)
function renderHomepageInto(box, hp) {
  const chip = (m) => `<span class="hp-m">✓ ${esc(m)}</span>`;
  if (!hp) { box.innerHTML = '<h4>홈페이지 추적</h4><div class="hp-none">검색 실패 또는 프록시 미설정</div>'; return; }
  if (hp.err) { box.innerHTML = `<h4>홈페이지 추적</h4><div class="hp-none">검색 실패: ${esc(hp.err)}</div>`; return; }
  const p = hp.proposed;
  let html = `<h4>홈페이지 추적 <span>지역검색+웹문서 ${hp.tried ? `후보 ${hp.tried}건` : ''} → 페이지 대조</span></h4>`;
  if (p) {
    html += `<div class="hp-top">` +
      `<span class="hp-badge">확정 제안</span>` +
      `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="hp-url">${esc(p.host)}</a>` +
      `<div class="hp-ms">${p.matches.map(chip).join('')} `
      // 본문에서 실제로 확인한 근거를 따로 밝힌다 — 제목·도메인만으로 맞춘 것과는 무게가 다르다
      + `<em>(근거 ${p.matches.length}종 · 신뢰점수 ${p.score}`
      + `${p.bodyHits && p.bodyHits.length ? ` · 본문 확인 ${p.bodyHits.join('·')}` : ''})</em></div>` +
      `</div>`;
    // 홈페이지 발췌 — 생산능력·인증(자동추출). 홈페이지 게재값이라 방문 시 원본 확인 필요.
    const ex = p.extract;
    if (ex && (ex.certs.length || ex.capa.length || ex.oemOdm.length)) {
      html += `<div class="hp-ext"><div class="hp-ext-h">홈페이지 발췌 <span>자동추출 · 게재정보(방문 시 인증서 원본 확인)</span></div>`;
      if (ex.oemOdm.length) html += `<div class="hp-row"><i>생산모델</i><span>${ex.oemOdm.map((o) => `<b class="hp-tag">${esc(o)}</b>`).join(' ')}</span></div>`;
      if (ex.certs.length) html += `<div class="hp-row"><i>인증</i><span>${ex.certs.map((c) => `<b class="hp-cert">${esc(c)}</b>`).join(' ')}</span></div>`;
      if (ex.capa.length) html += `<div class="hp-row"><i>생산능력</i><ul class="hp-capa">${ex.capa.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`;
      html += `</div>`;
    } else {
      html += `<div class="hp-ext-none">홈페이지에서 인증·생산능력 문구를 추출하지 못함 (자바스크립트 렌더링 사이트이거나 미게재 — 사이트 직접 확인)</div>`;
    }
  } else {
    // 왜 확정 못 했는지 밝힌다 — 후보가 없어서인지, 있는데 근거가 약해서인지는 대응이 다르다.
    html += `<div class="hp-none">${esc(hp.reason || '확정 기준(신뢰점수 4점) 미달')}`
      + `<br>아래 후보를 직접 확인하거나, 심층분석의 <b>주소 직접 입력</b>을 쓰세요.</div>`;
    const sk = hp.skipped && Object.keys(hp.skipped).length
      ? Object.entries(hp.skipped).map(([k, v]) => `${k} ${v}`).join(' · ') : null;
    if (sk) html += `<div class="hp-skip">제외한 검색결과: ${esc(sk)} — 채용·집계·제작대행 사이트는 업체 홈페이지가 아니라 후보에서 뺍니다.</div>`;
  }
  const others = (hp.candidates || []).filter((c) => !p || c.host !== p.host);
  if (others.length) {
    html += `<div class="hp-cands"><i>후보</i>` + others.map((c) =>
      `<a href="${esc(c.url)}" target="_blank" rel="noopener" class="hp-cand">${esc(c.host)}${c.matches.length ? ` <b>${c.matches.join('·')}</b>` : ''}${c.score ? ` <em>${c.score}점</em>` : ''}</a>`).join('') + `</div>`;
  }
  box.innerHTML = html;
}

// ── 공식 API와 홈페이지 주장 대조 ──
// 홈페이지 문구는 회사가 스스로 쓴 것이라 사실 확인이 안 된다. 같은 항목을 공공 API가
// 알고 있다면 그쪽이 정답이다. 특히 CGMP는 식약처 적합업소 명단이 유일한 근거인데,
// 사이트 문구만 보고 인증으로 표시하면 미인증 업체가 인증 업체로 뒤바뀐다.
function reconcileDeep(state, report) {
  const d = state && state.data;
  if (!d) return state;
  const conflicts = [];
  // 식약처 GMP 조회 결과 — src_status의 gmp 항목이 판정 근거
  const gmpSrc = ((report.meta && report.meta.src_status) || []).find((x) => x.key === 'gmp');
  const gmpListed = !!(gmpSrc && gmpSrc.ok && !gmpSrc.warn);
  const gmpChecked = !!gmpSrc;
  const claimsCgmp = (arr) => (arr || []).some((c) => /CGMP|우수화장품/i.test(typeof c === 'string' ? c : c.label));
  if (gmpChecked && !gmpListed && (claimsCgmp(d.quality_certifications) || claimsCgmp(d.tabs && d.tabs.cert))) {
    conflicts.push({
      label: 'CGMP',
      detail: '홈페이지에는 CGMP 관련 문구가 있으나 식약처 CGMP 적합업소 명단에는 없습니다. '
        + '해외 cGMP·원료 인증·계획 단계를 가리키는 문구일 수 있습니다 — 방문 시 인증서 원본과 적용 범위를 확인하세요.',
    });
    // 사실 필드에서는 뺀다. 명단이 정답이고, 여기 남으면 미인증 업체가 인증 업체로 보인다.
    if (d.quality_certifications) {
      d.quality_certifications = d.quality_certifications.filter((c) => !/CGMP|우수화장품/i.test(c));
      if (!d.quality_certifications.length) d.quality_certifications = null;
    }
    if (d.tabs && Array.isArray(d.tabs.cert)) {
      d.tabs.cert = d.tabs.cert.map((c) => (/CGMP|우수화장품/i.test(c.label)
        ? { ...c, level: 'conflict', why: '식약처 적합업소 명단에 없음' } : c));
    }
  }
  state.conflicts = conflicts.length ? conflicts : null;
  return state;
}

// ── 🔬 홈페이지 심층분석 — 실제 생산 CAPA·인증 구조화 추출 ──
// 기본: 무료 키워드 휴리스틱(API키 불필요). 옵션: ANTHROPIC_API_KEY가 있으면 LLM 웹조사로 보강.
async function siteDeepExtract(name, url) {
  const res = await proxyOnlyGet('siteExtract', { name: name || '', url: url || '' });
  return res && res.data ? res.data : null;
}
// 오케스트레이터: 휴리스틱(항상) + LLM(키 있을 때) 병합. LLM 값 우선, 공백은 휴리스틱으로 채움.
async function siteDeepAnalyze(name, hpUrl, seeds) {
  const heur = await siteDeepHeuristic(name, hpUrl, seeds).catch(() => null);
  let llm = null, llmErr = null;
  try { llm = await siteDeepExtract(name, hpUrl); } catch (e) { llmErr = e && e.message ? e.message : String(e); }
  const data = mergeDeep(llm, heur && heur.data ? heur.data : null);
  const source = llm ? (heur && heur.data ? 'ai+kw' : 'ai') : 'kw';
  const base = (heur && heur.base) || hpUrl || null;
  if (!data) return { source, base, err: (heur && heur.reason) || llmErr || '추출 결과 없음', keyless: !llm };
  return { data, source, base, pages: heur && heur.pages, harvest: heur && heur.harvest };
}
const SITE_DEEP_FIELDS = [
  { key: 'keywords', label: '추출 키워드', kind: 'chips' },
  // 설비 추정은 전용 UI로 그리지만, '결과 있음' 판정에 포함돼야 하므로 목록에 둔다
  { key: 'equipment_inferred', label: '생산설비 추정', kind: 'skip' },
  { key: 'business_type', label: '사업 유형', kind: 'chips', hot: true },
  { key: 'quality_certifications', label: '품질·인증', kind: 'chips', hot: true },
  { key: 'product_categories', label: '제형 카테고리', kind: 'chips' },
  { key: 'export_markets', label: '수출국', kind: 'chips' },
  { key: 'production_items', label: '대표 생산품·사례', kind: 'list' },
  { key: 'equipment', label: '생산 설비', kind: 'list' },
  { key: 'production_sites', label: '생산 사업장', kind: 'list' },
  { key: 'rnd_centers', label: 'R&D 연구소', kind: 'list' },
  { key: 'notable', label: '특이사항', kind: 'list' },
  { key: 'hq_address', label: '본사 주소', kind: 'text' },
  { key: 'phone', label: '대표번호', kind: 'text' },
];
function siteDeepCell(val, kind, hot) {
  const empty = val == null || (Array.isArray(val) && !val.length) || val === '';
  if (empty) return '<span class="sd-empty">—</span>';
  if (kind === 'chips') {
    const arr = Array.isArray(val) ? val : [val];
    return `<div class="sd-chips">${arr.map((x) => `<span class="sd-chip${hot ? ' hot' : ''}">${esc(String(x))}</span>`).join('')}</div>`;
  }
  if (kind === 'list') {
    const arr = Array.isArray(val) ? val : [val];
    return `<ul class="sd-list">${arr.map((x) => `<li>${esc(String(typeof x === 'object' ? JSON.stringify(x) : x))}</li>`).join('')}</ul>`;
  }
  return `<span class="sd-text">${esc(String(val))}</span>`;
}
function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } }
const SD_SRC_TAG = { kw: '키워드 기반(무료)', ai: 'AI 웹조사', 'ai+kw': 'AI+키워드' };
// 수동 주소 입력 UI — 홈페이지 추적 실패/오탐 시 사용자가 직접 주소를 넣어 재분석
function sdManualRow(base) {
  return `<div class="sd-manual">` +
    `<label>홈페이지 주소 직접 입력</label>` +
    `<div class="sd-manual-in">` +
    `<input type="url" class="sd-url" placeholder="https://example.co.kr" value="${esc(base || '')}">` +
    `<button type="button" class="sd-go">이 주소로 분석</button>` +
    `</div>` +
    `<span class="sd-hint">추적이 실패했거나 다른 사이트가 잡혔을 때, 정확한 주소를 넣고 다시 분석하세요.</span>` +
    `</div>`;
}
function renderSiteDeepInto(box, state) {
  if (state.loading) {
    box.innerHTML = '<h4>홈페이지 심층분석 <span>홈페이지 조사 중…</span></h4>' +
      '<div class="sd-load">본문·메타·임베드 JSON·이미지 정보까지 훑어 키워드를 추출하고 있습니다…</div>';
    return;
  }
  const srcTag = state.source ? `<b class="sd-tag">${esc(SD_SRC_TAG[state.source] || state.source)}</b>` : '';
  if (state.err && !state.data) {
    box.innerHTML = `<h4>홈페이지 심층분석 ${srcTag}</h4>` +
      `<div class="sd-none">${esc(state.err)}</div>` + sdManualRow(state.base);
    return;
  }
  const d = state.data;
  if (!d) { box.innerHTML = `<h4>홈페이지 심층분석 ${srcTag}</h4><div class="sd-none">추출 결과 없음</div>` + sdManualRow(state.base); return; }
  const rows = SITE_DEEP_FIELDS
    .map((f) => ({ f, has: !(d[f.key] == null || (Array.isArray(d[f.key]) && !d[f.key].length) || d[f.key] === '') }))
    .filter((r) => r.has);
  let html = `<h4>홈페이지 심층분석 ${srcTag}<span>홈페이지 게재 정보 · 참고용(방문 시 원본 확인)</span></h4>`;
  // 수집 방식 안내 — 이미지 전용/SPA라 웹검색으로 보완했다면 명시(신뢰도 판단용)
  const hv = state.harvest;
  if (hv && (hv.thin || hv.webFallback)) {
    html += `<div class="sd-warnline">${hv.webFallback
      ? '⚠ 페이지 본문이 적어(자바스크립트 렌더링·이미지 전용) <b>키워드에 한해</b> 웹 검색 결과를 보탰습니다. ' +
        '인증·주소·사업장 등 <b>사실 항목은 홈페이지 본문에서만</b> 추출합니다.'
      : '⚠ 페이지 본문이 적어 메타·이미지·임베드 데이터에서 보조 추출했습니다.'}</div>`;
  }
  // 공식 API와 어긋나는 주장은 맨 위에 — 아래 목록만 보면 인증 보유로 오해한다
  if (state.conflicts && state.conflicts.length) {
    html += '<div class="sd-conflict">' + state.conflicts.map((c) =>
      `<b>⚠ ${esc(c.label)} — 공식자료와 불일치</b><i>${esc(c.detail)}</i>`).join('') + '</div>';
  }
  // 수집 범위 — 몇 페이지를 봤는지 알아야 '없다'는 결과를 믿을 수 있다
  if (Array.isArray(state.pages) && state.pages.length) {
    html += `<div class="sd-scope">수집 ${state.pages.length}개 페이지`
      + (hv && hv.chars ? ` · 본문 ${Math.round(hv.chars / 1000)}천자` : '')
      + ` <em>이 범위 안에서 찾은 내용입니다</em></div>`;
  }
  const tabs = d.tabs || {};
  const certs = tabs.cert || [];
  const certTerms = tabs.certTerms || [];
  const equip = tabs.equip || [];
  const equipTerms = tabs.equipTerms || [];
  const capa = tabs.capa || [];
  const nTerms = (list) => list.reduce((s, g) => s + g.terms.length, 0);
  // 사이트에 실제 표기된 용어를 그룹별 칩으로
  const termBlock = (list, note) => list.length
    ? list.map((g) => `<div class="sd-sec">${esc(g.grp)} <em>${g.terms.length}건</em></div>` +
        `<div class="lex-chips">${g.terms.map((t) => `<span class="lex-chip">${esc(t)}</span>`).join('')}</div>`).join('') +
      (note ? `<div class="sd-mini">${note}</div>` : '')
    : '';
  const eqi = d.equipment_inferred;
  // 기타 탭에 들어갈 나머지 필드(인증·설비·CAPA 전용 항목 제외)
  const ETC_SKIP = new Set(['keywords', 'equipment_inferred', 'quality_certifications', 'equipment']);
  const etcRows = rows.filter(({ f }) => !ETC_SKIP.has(f.key));
  const kw = d.keywords || [];

  if (!rows.length && !certs.length && !equip.length && !capa.length) {
    html += '<div class="sd-none">생산·인증 정보를 확인하지 못했습니다.</div>';
  } else {
    const CONF = { high: ['확실', 'ec-high'], mid: ['추정', 'ec-mid'], low: ['약한 추정', 'ec-low'] };
    // ── 탭 헤더 ──
    const defs = [
      { id: 'cert', label: '인증', n: certs.length + nTerms(certTerms) },
      { id: 'equip', label: '설비', n: equip.length + nTerms(equipTerms) },
      { id: 'capa', label: '생산CAPA', n: capa.length },
      { id: 'etc', label: '기타', n: etcRows.length + (kw.length ? 1 : 0) },
    ];
    const first = (defs.find((t) => t.n > 0) || defs[0]).id;
    html += '<div class="sd-tabs" role="tablist">' + defs.map((t) =>
      `<button type="button" class="sd-tab${t.id === first ? ' on' : ''}" data-tab="${t.id}">` +
      `${esc(t.label)}<span>${t.n}</span></button>`).join('') + '</div>';

    // ── ① 인증 ──
    html += `<div class="sd-pane${'cert' === first ? ' on' : ''}" data-pane="cert">`;
    if (!certs.length && !certTerms.length) html += '<div class="sd-none">홈페이지에서 인증 표기를 찾지 못했습니다.</div>';
    else {
      const byGrp = {};
      certs.forEach((c) => { (byGrp[c.grp || '기타'] = byGrp[c.grp || '기타'] || []).push(c); });
      for (const [grp, list] of Object.entries(byGrp)) {
        html += `<div class="sd-sec">${esc(grp)}</div><ul class="cert-list">` + list.map((c) =>
          `<li class="cert-${esc(c.level || 'own')}"><span class="cert-b">${esc(c.label)}</span>` +
          (c.level && c.level !== 'own' ? `<span class="cert-lv">${esc({ conflict: '⚠ 공식자료와 불일치', mention: '언급만 확인', weak: '근거 약함' }[c.level] || c.level)}</span>` : '') +
          (c.why ? `<i class="cert-why">${esc(c.why)}</i>` : '') +
          (c.evidence ? `<em>${esc(c.evidence)}</em>` : '') + `</li>`).join('') + '</ul>';
      }
      // 사이트에 그대로 적혀 있던 품질시스템·밸리데이션·규제 용어
      html += termBlock(certTerms, '사이트에 표기된 용어를 그대로 회수한 것입니다(원문 표현).');
      html += '<div class="sd-mini">게재 표기 기준 — 인증서 원본·유효기간·적용범위는 방문 시 확인하세요.</div>';
    }
    html += '</div>';

    // ── ② 설비 ──
    html += `<div class="sd-pane${'equip' === first ? ' on' : ''}" data-pane="equip">`;
    if (eqi && (eqi.vendors || []).length) {
      html += `<div class="eq-vend">가마·설비 제조사 단서: ` +
        eqi.vendors.map((v) => `<b>${esc(v.name)}</b><span>(${esc(v.where)})</span>`).join(' ') + `</div>`;
    }
    // 사이트에 실제로 적힌 설비명(제조/충전/포장/품질시험/시설) — 가장 구체적인 근거라 먼저
    html += termBlock(equipTerms, '사이트에 표기된 설비명을 그대로 회수한 것입니다(원문 표현).');
    if (!equip.length && !equipTerms.length) html += '<div class="sd-none">충전·제조 설비 언급을 찾지 못했습니다.</div>';
    else if (!equip.length) { /* 어휘 매칭만 있는 경우 — 위 목록으로 충분 */ }
    else {
      html += '<div class="sd-sec">설비 유형 판정 <em>본문·이미지 대조</em></div>';
      const order = ['충전', '제조', '포장', '부대'];
      const byGrp = {};
      equip.forEach((e) => { (byGrp[e.grp] = byGrp[e.grp] || []).push(e); });
      for (const grp of order) {
        const list = byGrp[grp]; if (!list || !list.length) continue;
        html += `<div class="sd-sec">${esc(grp)} 설비 <em>${list.length}종</em></div><ul class="eq-list">` +
          list.map((it) => {
            const [lbl, cls] = CONF[it.confidence] || CONF.low;
            return `<li><span class="eq-conf ${cls}">${lbl}</span>` +
              `<span class="eq-name">${esc(it.label)}</span>` +
              `<span class="eq-basis">${esc(it.basis)}</span>` +
              `<div class="eq-ev">${(it.evidence || []).map((e) => esc(e)).join(' · ')}</div></li>`;
          }).join('') + '</ul>';
      }
      html += `<div class="sd-mini">이미지 ${eqi ? (eqi.imageCount || 0) : 0}장 분석 — 사진 속 글자는 읽지 못하며 파일명·alt·본문 문구 기반입니다. 실물·대수는 방문 확인.</div>`;
    }
    html += '</div>';

    // ── ③ 생산 CAPA ──
    html += `<div class="sd-pane${'capa' === first ? ' on' : ''}" data-pane="capa">`;
    if (!capa.length) html += '<div class="sd-none">생산능력 수치를 찾지 못했습니다 — 월/일 생산량·라인 수는 방문 시 직접 확인하세요.</div>';
    else {
      const byKind = {};
      capa.forEach((c) => { (byKind[c.kind] = byKind[c.kind] || []).push(c); });
      html += '<ul class="capa-list">';
      for (const [kind, list] of Object.entries(byKind)) {
        list.slice(0, 6).forEach((c) => {
          html += `<li><span class="capa-kind">${esc(kind)}</span>` +
            `<span class="capa-val">${esc(c.value)}</span>` +
            `<div class="capa-ctx">…${esc(c.context)}…</div></li>`;
        });
      }
      html += '</ul><div class="sd-mini">홈페이지 게재 수치 — 설계 CAPA와 실가동은 다를 수 있습니다. 가동률·MOQ·리드타임은 방문 확인.</div>';
    }
    html += '</div>';

    // ── ④ 기타 ──
    html += `<div class="sd-pane${'etc' === first ? ' on' : ''}" data-pane="etc">`;
    if (kw.length) {
      const max = Math.max(...kw.map((k) => (typeof k === 'object' ? k.score : 1) || 1));
      const chip = (k) => {
        const w = typeof k === 'object' ? k.word : k;
        const s = typeof k === 'object' ? (k.score || 1) : 1;
        const lv = s >= max * 0.6 ? ' kw-hi' : (s >= max * 0.3 ? ' kw-mid' : '');
        return `<span class="sd-kw${lv}" title="빈도 점수 ${s}">${esc(String(w))}</span>`;
      };
      const groups = categorizeKeywords(kw);
      html += `<div class="sd-kwbox"><i>추출 키워드 <em>빈도 상위 ${kw.length}개 · 성격별 분류</em></i>`;
      groups.forEach((g) => {
        html += `<div class="kw-cat">${esc(g.cat)} <b>${g.items.length}</b></div>` +
          `<div class="sd-kws">${g.items.map(chip).join('')}</div>`;
      });
      html += '</div>';
    }
    if (etcRows.length) {
      html += '<div class="sd-grid">' + etcRows.map(({ f }) =>
        `<div class="sd-row${f.hot ? ' hot' : ''}"><i>${esc(f.label)}</i><div class="sd-v">${siteDeepCell(d[f.key], f.kind, f.hot)}</div></div>`).join('') + '</div>';
    }
    if (!kw.length && !etcRows.length) html += '<div class="sd-none">추가 정보 없음</div>';
    html += '</div>';

    if (state.base) html += `<div class="sd-foot">출처: <a href="${esc(state.base)}" target="_blank" rel="noopener">${esc(domainOf(state.base))}</a>` +
      `${state.pages && state.pages.length > 1 ? ` 외 ${state.pages.length - 1}개 페이지` : ''}${state.source === 'kw' ? ' · 키워드 자동추출' : ''}</div>`;
  }
  html += sdManualRow(state.base);
  box.innerHTML = html;
}

// 방문지 주소 선택 — 제조소(식약처) > 본점(금융위) > 사업장(연금) 순
function visitAddress(report) {
  const fields = [...(report.basic || []), ...(report.capacity || [])];
  const val = (k) => { const f = fields.find((x) => x.key === k); return f && f.value ? f.value : null; };
  return val('공장/제조소 소재지') || val('본점주소') || val('사업장 주소 (연금기준)') || null;
}

// ★ 핵심 요약 밴드 — 방문 판단에 가장 중요한 사실을 큰 타일로 최상단 노출
// ── 종합판정 카드 ──
// 등급 글자 하나만 크게 띄우던 자리다. 'B'만 봐서는 무엇을 하라는 건지 알 수 없어서,
// 판정 문구와 근거 한 줄을 함께 낸다. 그리고 종합판정(업체를 방문할 만한가)과
// 데이터 등급(그 숫자를 얼마나 믿을 수 있나)은 다른 이야기라 화면에서도 갈라 놓는다.
const VERDICT = {
  A: { label: '방문 우선 검토', tone: 'good' },
  B: { label: '방문 검토 가능', tone: 'good' },
  C: { label: '추가 확인 후 판단', tone: 'warn' },
  D: { label: '자료 부족 — 보완 후 판단', tone: 'muted' },
};
function verdictReason(report) {
  const B = report.basic || [], C = report.capacity || [];
  const has = (arr, k) => { const x = arr.find((v) => v.key === k); return x && x.value ? x.value : null; };
  const ups = [], downs = [];
  if (has(B, '제조업 등록')) ups.push('식약처 화장품 제조업 등록');
  if (has(C, 'CGMP 적합업소')) ups.push('CGMP 적합업소');
  if (has(B, '공장/제조소 소재지')) ups.push('공장등록 확인');
  const hire = report.hiring;
  if (hire && hire.ok && hire.posts && hire.posts.length) ups.push('최근 채용활동 확인');
  const ins = report.insights && report.insights.assessment;
  if (ins && ins.level === 'good') ups.push('대외활동 확인');
  (report.risk_flags || []).forEach((r) => downs.push(r.type));
  const gaps = [...B, ...C, ...(report.finance || [])].filter((x) => x.data_gap).length;
  if (gaps) downs.push(`공개자료 미확인 ${gaps}건`);
  return { ups, downs };
}
// '약 162km · 차량 3시간 20분' → 앞줄 '약 162km' / 아랫줄 '차량 3h20m'
// 시간 표기를 그대로 쓰면 좁은 화면에서 한 줄이 칸을 넘는다. 뜻은 그대로 두고 길이만 줄인다.
const distMain = (v) => String(v).split('·')[0].trim();
function distSub(v) {
  const tail = String(v).split('·').slice(1).join('·').trim();
  if (!tail) return '';
  return tail
    .replace(/(\d+)\s*시간\s*(\d+)\s*분/, '$1h$2m')
    .replace(/(\d+)\s*시간(?!\d)/, '$1h')
    .replace(/(\d+)\s*분/, '$1m')
    .replace(/\s+/g, ' ');
}
function renderVerdict(report) {
  const m = report.meta || {};
  const g = m.overall_grade || 'D';
  const v = VERDICT[g] || VERDICT.D;
  const B = report.basic || [], C = report.capacity || [];
  const bv = (k) => { const x = B.find((y) => y.key === k); return x && x.value ? x.value : null; };
  const cv = (k) => { const x = C.find((y) => y.key === k); return x && x.value ? x.value : null; };
  const { ups, downs } = verdictReason(report);
  // 업종·지역 한 줄 — 어떤 업체인지부터 알아야 판정이 읽힌다
  const sector = bv('업종') || '화장품 관련';
  // 지역은 본점(등기) 기준으로 적는다. 공장 주소를 먼저 쓰면 R&D센터가 잡혀 실제 소재지와
  // 다르게 보인다(다산씨엔텍: 본점 경기 김포인데 공장란은 서울 강서 R&D센터였다).
  // 두 주소가 다르다는 사실 자체는 아래 '방문 전 확인 필요'에서 따로 알린다.
  const addr = String(bv('본점주소') || bv('공장/제조소 소재지') || '');
  const region = (addr.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s*[가-힣]*시?군?/) || [])[0] || '';

  const box = el('div', 'verdict v-' + v.tone);
  let html = `<div class="vd-head">`
    + `<button type="button" class="vd-badge badge-${esc(g)}" data-act="verdict-why" aria-haspopup="dialog" title="판단 기준 보기"><b>${esc(g)}</b><span>종합판정 ⓘ</span></button>`
    + `<div class="vd-title"><h2>${esc(m.vendor_name || '')}</h2>`
    + `<div class="vd-sub">${esc(sector)}${region ? ` · ${esc(region)}` : ''}</div>`
    + `<div class="vd-contact" data-vd-contact>${contactHtml(report)}</div></div>`
    + `<div class="vd-verd">${esc(v.label)}</div></div>`;
  // 판정 근거 — 무엇이 좋아서/걸려서 이 등급인지
  if (ups.length || downs.length) {
    html += `<div class="vd-why">`
      + (ups.length ? `<div class="vw up"><i>확인됨</i><span>${ups.map(esc).join(' · ')}</span></div>` : '')
      + (downs.length ? `<div class="vw down"><i>확인필요</i><span>${downs.map(esc).join(' · ')}</span></div>` : '')
      + `</div>`;
  }
  // ── 기본 현황 ──
  // 값만 늘어놓으면 어느 칸을 봐야 하는지 알 수 없다. 방문 판단이 갈리는 지점만 색으로 세운다.
  //   bad(빨강)  거래 전 반드시 해소해야 하는 것 — 미등록·휴폐업·회수이력·자본잠식
  //   warn(주황) 확인하고 넘어가야 하는 것 — 영세 인력·높은 부채비율·먼 거리
  //   good(초록) 가산점 — CGMP 같은 보유 자체가 강점인 것
  // 나머지는 색을 쓰지 않는다. 다 칠하면 아무것도 강조되지 않는다.
  const revF = (report.finance || []).find((x) => x.key === '매출액' && x.value);
  const revEok = revF ? Number(String(revF.value).replace(/[^0-9.-]/g, '')) : null;
  const recallN = Array.isArray(report.recalls) && report.recalls.length ? report.recalls.length : 0;
  const dist = cv('방문 이동거리');
  const maker = bv('제조업 등록'), bstt = String(bv('사업자 상태') || ''), fct = bv('공장/제조소 소재지');
  const cgmp = cv('CGMP 적합업소');
  const empRaw = cv('재직자수 (국민연금 가입자)');
  // '14명 · 2025.10 기준' 에서 숫자를 다 긁으면 기준일까지 붙어 14202510 이 된다.
  // 맨 앞 숫자만 읽는다.
  const empN = (() => {
    const m = String(empRaw || '').match(/^\s*([\d,]+)/);
    const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
    return isFinite(n) ? n : null;
  })();
  const fh = report.finance_health || null;

  // 이동시간(분) — 1시간·2시간 경계로 색이 갈린다. 당일 왕복이 되는지가 여기서 갈린다.
  const durMin = (() => {
    const t = String(dist || '');
    const h = Number((t.match(/(\d+)\s*시간/) || [])[1] || 0);
    const m = Number((t.match(/(\d+)\s*분/) || [])[1] || 0);
    return h || m ? h * 60 + m : null;
  })();

  const chips = [
    ['제조업 등록', maker ? '확인' : '미확인', maker ? 'ok' : 'bad'],
    ['사업자 상태', /계속/.test(bstt) ? '정상' : (bstt || '미확인'), /계속/.test(bstt) ? 'ok' : 'bad'],
    ['공장등록', fct ? '확인' : '미확인', fct ? 'ok' : 'warn'],
    // CGMP는 없다고 결격은 아니지만 있으면 확실한 강점이라, 보유했을 때만 색을 준다.
    ['CGMP', cgmp ? '적합' : '미등재', cgmp ? 'good' : 'na'],
    // 5명 이하면 생산 물량·교대 운영을 감당할 수 있는지부터 확인해야 한다.
    ['직원수', empRaw ? String(empRaw).replace(/\s*·.*$/, '') : '미확인',
      empN == null ? 'na' : (empN <= 5 ? 'warn' : 'num')],
    ['설립', String(bv('설립일 / 등록일') || '').slice(0, 4) || '미확인', bv('설립일 / 등록일') ? 'num' : 'na'],
    ['매출', revF ? revF.value + (revF.grade === 'C' ? '*' : '') : '미확인',
      revEok == null || !isFinite(revEok) ? 'na' : (revEok <= 0 ? 'bad' : 'num')],
    // 부채비율 — 자본잠식이면 비율 자체가 성립하지 않는다. 숫자 대신 상태를 적는다.
    ...(fh ? [['부채비율',
      fh.equity != null && fh.equity <= 0 ? '자본잠식'
        : (fh.debtRatio != null ? `${fh.debtRatio}%` : '산출불가'),
      fh.equity != null && fh.equity <= 0 ? 'bad'
        : fh.debtRatio == null ? 'na'
        : fh.debtRatio >= 400 ? 'bad' : fh.debtRatio >= 200 ? 'warn' : 'num',
      fh.year ? `${fh.year}년 기준` : '']] : []),
    ['회수·판매중지', recallN ? `${recallN}건` : '없음', recallN ? 'bad' : 'ok', '',
      recallN ? '#vcRecall' : null],
    // 거리와 소요시간을 둘 다 보여주되 칸을 넘지 않게 두 줄로 나눈다.
    ['방문 거리', dist ? distMain(dist) : '미확인',
      durMin == null ? 'na' : (durMin > 120 ? 'bad' : durMin > 60 ? 'warn' : 'num'),
      dist ? distSub(dist) : ''],
  ];
  html += `<div class="vd-chips">` + chips.map(([k, val, t, sub, href]) => {
    const inner = `<i>${esc(k)}</i><b>${esc(val)}${sub ? `<small>${esc(sub)}</small>` : ''}</b>`;
    // 회수 이력은 건수만 보여주고 끝내면 안 된다 — 무슨 일이 있었는지로 바로 갈 수 있어야 한다.
    return href
      ? `<a class="vch vch-${t} vch-link" href="${esc(href)}">${inner}</a>`
      : `<div class="vch vch-${t}">${inner}</div>`;
  }).join('') + `</div>`;
  html += `<div class="vd-foot">종합판정은 <b>업체를 방문할 만한지</b>에 대한 검토 결과이고, `
    + `항목마다 붙는 A·B·C·D는 <b>그 값을 어디서 얻었고 얼마나 믿을 수 있는지</b>를 나타냅니다 — 서로 다른 이야기입니다.`
    + (revF && revF.grade === 'C' ? ` <em>* 매출은 공시가 아닌 외부 기업정보 참고값입니다.</em>` : '')
    + `</div>`;
  box.innerHTML = html;
  box.querySelector('[data-act="verdict-why"]').addEventListener('click', () => openVerdictWhy(report));
  return box;
}

// 업체명 옆 대표번호·대표메일 — 홈페이지 > 채용사이트 > 공장등록 순. 여러 곳에서 같은 값이 나오면 그만큼 믿을 만하다.
function contactOf(report) {
  const hp = report._homepage && report._homepage.proposed ? report._homepage.proposed : null;
  const hc = report.hiring && report.hiring.contacts ? report.hiring.contacts : { tels: [], emails: [] };
  const fct = ((report.capacity || []).find((x) => x.key === '공장 연락처' && x.value) || {});
  const pick = (hpV, list, extra) => {
    const all = [];
    if (hpV) all.push({ v: hpV, src: '홈페이지', link: hp.url });
    (list || []).forEach((x) => all.push({ v: x.v, src: '채용사이트', link: x.link }));
    if (extra) all.push(extra);
    if (!all.length) return null;
    const n = (v) => all.filter((x) => x.v === v).length;
    const top = all[0];
    const srcs = [...new Set(all.filter((x) => x.v === top.v).map((x) => x.src))];
    return { v: top.v, srcs, n: n(top.v) };
  };
  const fctTel = fct.value ? fmtTel(fct.value) : null;
  return {
    tel: pick(hp && hp.contact && hp.contact.tel, hc.tels, fctTel ? { v: fctTel, src: '공장등록' } : null),
    email: pick(hp && hp.contact && hp.contact.email, hc.emails, null),
  };
}
function contactHtml(report) {
  const c = contactOf(report);
  const item = (x, kind) => {
    if (!x) return '';
    const href = kind === 'tel' ? `tel:${x.v.replace(/\D/g, '')}` : `mailto:${x.v}`;
    return `<a class="vc-${kind}" href="${esc(href)}"><span aria-hidden="true">${kind === 'tel' ? '☎' : '✉'}</span> ${esc(x.v)}</a><small>${esc(x.srcs.join('·'))}</small>`;
  };
  const parts = [item(c.tel, 'tel'), item(c.email, 'mail')].filter(Boolean);
  if (parts.length) return parts.join('<i class="vd-csep" aria-hidden="true">·</i>');
  return report.meta && report.meta.live && report._homepage === undefined ? '<small class="vd-cwait">대표번호·메일 찾는 중…</small>' : '';
}
function refreshContact(report) {
  const box = document.querySelector('[data-vd-contact]');
  if (box && currentReport === report) box.innerHTML = contactHtml(report);
}

// 종합판정 판단 기준 — 등급이 어떻게 나왔는지 이 업체의 실제 숫자로 보여 준다.
// 계산은 samples.js assembleLiveReport와 같다: 값이 확인된 항목들의 신뢰도 등급(A~D)을
// 좋은 순으로 세웠을 때 가운데 값. 값이 없는 항목(공백)은 셈에서 빠진다.
function openVerdictWhy(report) {
  const m = report.meta || {};
  const g = m.overall_grade || 'D';
  const all = [...(report.basic || []), ...(report.capacity || []), ...(report.finance || [])];
  const got = all.filter((x) => !x.data_gap);
  const gaps = all.length - got.length;
  const cnt = { A: 0, B: 0, C: 0, D: 0 };
  got.forEach((x) => { if (cnt[x.grade] != null) cnt[x.grade]++; });
  const { ups, downs } = verdictReason(report);
  const mid = got.length ? Math.floor(got.length / 2) + 1 : 0;
  const bar = got.length
    ? ['A', 'B', 'C', 'D'].filter((k) => cnt[k]).map((k) => `<span class="vw-seg badge-${k}" style="flex:${cnt[k]}">${k} ${cnt[k]}</span>`).join('')
    : '<span class="vw-seg none">확인된 항목 없음</span>';
  const rows = ['A', 'B', 'C', 'D'].map((k) => `<tr class="${k === g ? 'on' : ''}"><td><b class="vw-g badge-${k}">${k}</b></td><td>${esc(VERDICT[k].label)}</td>`
    + `<td>${esc(GRADE_LABEL[k])}${k === 'D' ? '' : ' 위주'}</td></tr>`).join('');
  const dlg = document.createElement('dialog');
  dlg.className = 'vwhy';
  dlg.setAttribute('aria-labelledby', 'vwhyTitle');
  dlg.innerHTML = `<div class="vwhy-in">`
    + `<div class="vwhy-head"><h3 id="vwhyTitle">종합판정 <b class="vw-g badge-${esc(g)}">${esc(g)}</b> ${esc((VERDICT[g] || VERDICT.D).label)}</h3>`
    + `<button type="button" class="vwhy-x" aria-label="닫기">✕</button></div>`
    + `<section><h4>어떻게 정하나</h4><p>리포트에서 <b>값이 확인된 항목</b>의 신뢰도 등급(A~D)을 좋은 순으로 세웠을 때 `
    + `<b>가운데 등급</b>이 종합판정입니다. 값이 없는 항목은 셈에서 뺍니다. `
    + (got.length ? `이 업체는 확인된 항목 ${got.length}개 중 ${mid}번째 등급입니다.` : '이 업체는 확인된 항목이 하나도 없어 D입니다.') + `</p>`
    + `<div class="vw-bar">${bar}</div>`
    + `<p class="vw-note">이 업체: A ${cnt.A} · B ${cnt.B} · C ${cnt.C} · D ${cnt.D}${gaps ? ` · 공백 ${gaps}(제외)` : ''} → 가운데 값 <b>${esc(g)}</b></p></section>`
    + `<section><h4>등급별 판정</h4><table class="vw-tbl"><thead><tr><th>등급</th><th>판정</th><th>항목 출처</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<p class="vw-note">항목 등급 — A 공식 API(식약처·금융위·국세청 등 원부 자료) · B 공공DB 간접(국민연금·실측 경로 등) · C 추정·외부 자료 · D 데이터 공백</p></section>`
    + `<section><h4>이 업체에서 본 것</h4>`
    + (ups.length ? `<div class="vw up"><i>확인됨</i><span>${ups.map(esc).join(' · ')}</span></div>` : '')
    + (downs.length ? `<div class="vw down"><i>확인필요</i><span>${downs.map(esc).join(' · ')}</span></div>` : '')
    + (!ups.length && !downs.length ? '<p class="vw-note">표시할 근거가 없습니다.</p>' : '')
    + `</section>`
    + `<p class="vw-caution">⚠ 종합판정은 <b>자료를 얼마나 믿을 수 있는지</b>로 정해집니다. 회수 이력·자본잠식 같은 위험 신호는 등급을 직접 낮추지 않으니, `
    + `<b>확인필요</b>와 아래 <b>방문 전 확인필요</b> 표를 함께 보세요.</p>`
    + `</div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.querySelector('.vwhy-x').addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });   // 바깥(배경) 누르면 닫힘
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

// ── ⚠ 방문 전 반드시 확인 ──
// 흩어져 있던 위험 신호(주소 상이·교차검증 경고·자료 공백)를 한자리에 모아 맨 위로 올린다.
// 문서의 요구는 분명했다 — 방문 전에 3분 만에 '무엇을 확인해야 하는가'가 보여야 한다.


// ✅ 방문 전 체크리스트 — 기본정보(API) + 뉴스 신호 + 교차검증을 종합해 실사 확인 항목 자동 제안
// 웹 신호(기사 태그) → 방문 시 확인할 질문·인사이트 매핑
const WEB_SIGNAL_ASK = {
  '투자·자본': { pri: 'mid', cat: '투자', ask: '투자유치 자금의 사용처(증설·설비·운전자금) 및 우리 물량 대응 여력 확인', ins: '자금 유입은 CAPA 확대 신호 — 단, 지분 변동으로 의사결정 라인이 바뀌었을 수 있음' },
  '증설·시설': { pri: 'high', cat: '증설', ask: '증설 라인의 실제 가동 여부·추가 CAPA(월 생산량)·가동 시점 확인', ins: '증설 보도는 수주 여력 확대 신호 — 준공만 하고 미가동인 경우가 있어 현장 확인 필수' },
  '수출·계약': { pri: 'high', cat: '수주', ask: '기존 수출/공급계약이 점유한 생산능력 비중과 우리 발주 가능 슬롯 확인', ins: '대형 계약이 있으면 라인이 이미 차 있어 납기가 밀릴 수 있음' },
  '신제품·개발': { pri: 'mid', cat: '제품', ask: '보도된 신제품의 제형이 우리 발주 품목과 일치하는지, 양산 실적·수율 확인', ins: '해당 제형 양산 경험은 개발 리스크를 크게 낮춤' },
  '인증·수상': { pri: 'mid', cat: '인증', ask: '보도된 인증의 인증서 원본·유효기간·적용 범위(공장/품목) 대조', ins: '인증 범위가 특정 라인에만 적용되는 경우가 있어 범위 확인 필요' },
  '실적호조': { pri: 'low', cat: '실적', ask: '보도된 매출 성장의 지속성과 생산 여력(추가 수주 가능량) 확인', ins: '' },
  '리콜·회수': { pri: 'high', cat: '리스크', ask: '리콜 원인·재발방지 대책·이후 품질지표(불량률) 개선 자료 요청', ins: '품질 사고 이력 — 동일 제형이면 특히 주의' },
  '제재·위반': { pri: 'high', cat: '리스크', ask: '행정처분/과징금 사유와 해소(이행완료) 여부, 현재 영업 제한 유무 확인', ins: '제재 이력은 거래 적격성에 직결 — 처분서·이행완료 증빙 요청' },
  '분쟁·소송': { pri: 'high', cat: '리스크', ask: '소송 진행 상황과 생산·납품에 미치는 영향 확인', ins: '분쟁 상대가 원료사/고객사면 공급망 리스크로 전이될 수 있음' },
  '재무위험': { pri: 'high', cat: '리스크', ask: '적자·자본잠식 보도 관련 최근 재무제표·신용평가서 요청', ins: '재무 악화는 납기 지연·단가 인상 리스크로 이어짐' },
};
// ✅ 방문 전 체크리스트 — 웹 기반 정보(기사·채용공고·기술/인증·판매제품)에서 확인사항·인사이트 도출
function buildVisitChecklist(report) {
  // {src, pri, cat, text, why, ins}
  // src = 이 확인사항이 어디서 나왔는지. 기준정보(공공 API 대조)와 웹기반(기사·채용·홈페이지)은
  // 신뢰도가 전혀 다른데, 여태 세 블록에 흩어져 있어 한 건을 세 군데서 보게 됐다.
  const items = [];
  const add = (pri, cat, text, why, ins, src) =>
    items.push({ src: src || '웹기반', pri, cat, text, why: why || '', ins: ins || '' });

  // ── ⓪ 기준정보 대조에서 나온 확인사항 ──
  // 리스크 플래그·교차검증 경고·공개자료 공백. 예전에는 '체크 필요사항 · 기준정보 기반'이라는
  // 별도 블록이었는데, 읽는 사람 입장에서는 방문해서 확인할 항목이라는 점이 똑같다.
  (report.risk_flags || []).forEach((r) => {
    add('high', '기준정보', r.detail || r.type, r.type || '', '', '기준정보');
  });
  ((report.cross_diag || {}).items || []).forEach((c) => {
    if (c.status !== 'warn') return;
    if (items.some((i) => i.text === c.detail)) return;
    add(c.severe ? 'high' : 'mid', '기준정보', c.detail || c.label, `교차검증 · ${c.label}`, '', '기준정보');
  });
  (report.recalls || []).slice(0, 8).forEach((r) => {
    add('high', '기준정보', `회수·판매중지 이력 — ${r.reason || '원인·재발방지책 확인'}`,
      [r.date, r.product].filter(Boolean).join(' · ') || '식약처 이력', '', '기준정보');
  });
  const gapKeys = [...(report.capacity || []), ...(report.basic || [])].filter((x) => x.data_gap).map((x) => x.key);
  if (gapKeys.length) {
    add('mid', '기준정보', `${gapKeys.join(' · ')} — 공개 API에서 확인되지 않았습니다. '없음'이 아니라 '확인되지 않음'이므로 현장에서 직접 확인하세요.`,
      `공개자료 미확인 ${gapKeys.length}건`, '', '기준정보');
  }
  // 공장이 작으면 물류가 먼저 걸린다. 발주량을 정하기 전에 확인해야 하는 것들이라
  // 확인사항으로 자동으로 올린다.
  const areaF = (report.capacity || []).find((x) => x.key === '공장 건축면적 (건평)' && x.value);
  if (areaF) {
    const py = Number((String(areaF.value).match(/약\s*([\d,]+)\s*평/) || [])[1]?.replace(/,/g, ''));
    if (isFinite(py) && py < 300) {
      add(py < 100 ? 'high' : 'mid', '설비',
        py < 100
          ? `건평 약 ${py}평 — 자재·완제품 보관 공간과 상하차 방식(도크 유무·지게차·수작업), 대형 화물차 진입·회차 가능 여부를 확인하세요`
          : `건평 약 ${py}평 — 5톤 이상 화물차 진입·회차 공간과 상하차 도크 유무, 자재 보관 구역 분리 여부를 확인하세요`,
        `공장등록 신고 면적 ${areaF.value}`,
        py < 100
          ? '보관 공간이 부족하면 한 번에 받을 수 있는 물량이 제한되고, 소형차 분할 배송으로 물류비가 올라갑니다'
          : '도크가 없으면 하차에 시간이 더 걸리고 파손 위험도 커집니다',
        '기준정보');
    }
  }
  const finRows = report.finance || [];
  if (finRows.some((x) => x.value && x.grade === 'C') && !finRows.some((x) => x.value && x.grade === 'A')) {
    add('high', '재무', '공식 공시 재무자료가 확인되지 않아 외부 기업정보를 참고값으로 사용했습니다 — 최근 결산서·표준재무제표증명(국세청 발급)을 요청하세요.',
      '금융위 재무 API 미수록', '', '기준정보');
  }

  const timeline = (report.insights && report.insights.timeline) || [];
  const oem = report.oem_trace || [];
  const news = report.news || [];
  const deep = (report._siteDeep && report._siteDeep.data) || null;

  // ── ① 기사 신호 → 확인 질문 (같은 태그는 최신 1건만, 근거 날짜 표기) ──
  const seenTag = new Set();
  timeline.forEach((t) => {
    const map = WEB_SIGNAL_ASK[t.tag];
    if (!map || seenTag.has(t.tag)) return;
    seenTag.add(t.tag);
    const when = t.date ? `${t.date} 보도` : '기사';
    add(map.pri, map.cat, map.ask, `${when} · ${String(t.title || '').slice(0, 46)}`, map.ins);
  });

  // ── ② 채용공고 → 가동·인력 인사이트 ──
  // 채용공고 추적 모듈이 낸 판정을 그대로 방문 질문으로 옮긴다(모듈이 없으면 웹 언급으로 대체).
  const hire = report.hiring;
  if (hire && hire.ok && hire.signals.length) {
    hire.signals.forEach((sig) => {
      add(sig.level === 'high' ? 'high' : 'mid', '채용', sig.ask, sig.detail,
        sig.kind === 'expand' ? '증설이 사실이면 납기 여력은 늘지만 신규 라인 초기 수율이 불안정할 수 있습니다 — 시생산 이력을 함께 확인하세요.'
          : sig.kind === 'shrink' ? '인력 감소는 수주 축소일 수도, 자동화·외주 전환일 수도 있습니다 — 어느 쪽인지에 따라 리스크가 완전히 다릅니다.'
            : '반복 공고는 이직률이 높거나(현장 부담) 채용이 안 되는(입지·처우) 두 가지로 갈립니다 — 근속연수로 구분됩니다.');
    });
    if (hire.byRole['연구개발']) {
      add('low', '채용', '연구개발 인력 채용 — 자체 처방 개발 역량·연구소 규모 확인',
        `연구개발 직군 공고 ${hire.byRole['연구개발']}건`, '자체 처방이 가능하면 개발 의존도가 낮아집니다');
    }
  } else {
    const hires = oem.filter((o) => o.tag === '채용');
    if (hires.length) {
      const txt = hires.map((h) => `${h.title} ${h.desc}`).join(' ');
      const roles = [];
      if (/생산|제조|포장|충전|라인/.test(txt)) roles.push('생산');
      if (/품질|QC|QA|시험/.test(txt)) roles.push('품질');
      if (/연구|개발|R&D|처방|배합/.test(txt)) roles.push('연구개발');
      if (/영업|해외|무역|수출/.test(txt)) roles.push('영업');
      const roleTxt = roles.length ? `모집 직군: ${roles.join('·')}` : '직군 불명';
      add('mid', '채용', `채용공고 ${hires.length}건 — 현재 근무 인원·교대 운영 여부를 현장에서 확인(공고상 인력과 대조)`,
        `${roleTxt} · 웹 채용공고 ${hires.length}건`,
        roles.includes('생산') ? '생산직 상시 채용은 가동률이 높거나 이직률이 높다는 두 가지 해석이 가능 — 근속연수를 물어보세요'
          : '채용 활동은 사업 확장·가동 지속 신호(단, 공고가 오래된 것일 수 있어 게시일 확인)');
      if (roles.includes('연구개발')) add('low', '채용', '연구개발 인력 채용 — 자체 처방 개발 역량·연구소 규모 확인', '연구직 채용공고 확인', '자체 처방이 가능하면 개발 의존도가 낮아짐');
    }
  }

  // ── ③ 기술·인증(홈페이지 심층분석) → 원본 대조 ──
  if (deep) {
    const certs = deep.quality_certifications;
    if (certs && certs.length) add('high', '인증', `게재 인증(${certs.slice(0, 3).join(', ')}${certs.length > 3 ? ` 외 ${certs.length - 3}` : ''}) 인증서 원본·유효기간·적용범위 대조`, '홈페이지 게재 기준', '게재 ≠ 현재 유효 — 만료·범위 축소 사례가 많음');
    const cats = deep.product_categories;
    if (cats && cats.length) add('high', '제품', `취급 제형(${cats.slice(0, 4).join(', ')})과 우리 발주 품목 일치 여부·양산 실적 확인`, '홈페이지 게재 카테고리', '미취급 제형이면 신규 개발 리드타임·수율 리스크 발생');
    const eq = deep.equipment;
    if (eq && eq.length) add('mid', '설비', '게재 설비의 실물·대수·노후도·가동 상태 현장 확인', `게재 설비 ${eq.length}건`, '설비 목록은 과장되기 쉬움 — 실제 가동 대수를 세어보세요');
    const rnd = deep.rnd_centers;
    if (rnd && rnd.length) add('low', '기술', 'R&D 조직의 실제 인원·처방 개발 범위(자체/외주) 확인', '홈페이지 R&D 조직 언급', '');
    const exp = deep.export_markets;
    if (exp && exp.length) add('mid', '수출', `수출국(${exp.slice(0, 4).join(', ')}) 관련 현지 인증(NMPA·FDA·CPNP 등) 보유 여부 확인`, '홈페이지 게재 수출국', '수출 실적은 규제 대응 역량의 간접 지표');
    const items0 = deep.production_items;
    if (items0 && items0.length) add('low', '제품', '게재된 대표 생산품의 실제 납품처·수량·재구매 여부 확인', `게재 생산품 ${items0.length}건`, '레퍼런스는 단발성 샘플인 경우가 있음');
  } else {
    add('mid', '제품', '취급 제형·대표 생산품·보유 설비를 홈페이지/자료로 확인 (심층분석 미실행)', '아래 🔬 심층분석 실행 시 자동 채워짐', '');
  }

  // ── ④ 제조원/납품 언급 → 레퍼런스 검증 ──
  const oemRef = oem.filter((o) => o.tag === '제조원/납품');
  if (oemRef.length) add('mid', '레퍼런스', `타 브랜드 제조원으로 표기된 웹문서 ${oemRef.length}건 — 실제 납품 관계·유사 카테고리 경험 확인`, oemRef[0].title ? String(oemRef[0].title).slice(0, 46) : '', '경쟁 브랜드 납품 시 처방 유출·우선순위 이슈를 협의하세요');
  const rep = oem.filter((o) => o.tag === '기업보고서');
  if (rep.length) add('low', '재무', '기업신용보고서 존재 — 신용조회(NICE·KED)로 비공개 재무 확인 가능', '웹상 기업보고서 언급', '비상장이라 공시 재무가 없어도 신용조회로 매출·부채 확인 가능');

  // ── ⑤ 웹 흔적 자체가 없을 때 — '정보 없음'도 신호 ──
  if (!timeline.length && !oem.length && !news.length) {
    add('high', '실체', '온라인 활동 흔적이 거의 없음 — 사업자등록증·제조업 등록증·공장 실물 등 실체 확인 비중을 높이세요', '기사·웹문서·채용공고 모두 0건',
      '신생·영세이거나 B2B 전용(홍보 안 함)일 수 있음. 반드시 현장 방문으로 검증');
    add('mid', '실체', '거래 레퍼런스(납품처 2~3곳) 요청 후 직접 확인', '웹상 레퍼런스 확인 불가', '');
  } else if (!timeline.length) {
    add('mid', '실체', '최근 보도된 사업 동향이 없음 — 최근 3년 주요 실적·설비 투자 이력을 직접 질의', '신호성 기사 0건', '언론 노출이 적은 것 자체가 문제는 아니나, 성장/침체 판단 근거가 부족');
  }

  const order = { high: 0, mid: 1, low: 2 };
  items.sort((x, y) => order[x.pri] - order[y.pri]);
  return items;
}
const PRI_LABEL = { high: '필수', mid: '권장', low: '참고' };
const PRI_ORDER = { high: 0, mid: 1, low: 2 };
// 심층분석 등 비동기 결과 도착 시 체크리스트만 제자리 갱신(전체 재렌더 없이)
function refreshVisitChecklist(report, opts = {}) {
  const old = document.getElementById('visitChecklist');
  if (!old) return;
  const next = renderVisitChecklist(report);
  if (!next) return;
  next.id = 'visitChecklist';
  old.replaceWith(next);
  // 연속으로 여러 건 적는 경우가 많아, 추가 직후에는 입력창을 열어둔 채 커서를 되돌린다
  if (opts.keepAddOpen) {
    const d = next.querySelector('#vcAdd');
    if (d) { d.open = true; const t = next.querySelector('.vc-in-text'); if (t) t.focus(); }
  }
  if (opts.focusEdit) {
    const t = next.querySelector('.vc-ed-text');
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
}
function renderVisitChecklist(report) {
  const vid = (report.meta && report.meta.vendor_id) || null;
  const auto = buildVisitChecklist(report);
  const mine = getCustomChecks(vid).map((c) => ({ ...c, uid: c.id, mine: true }));
  const items = [...auto, ...mine];
  // 자동 항목이 없어도 직접 추가할 수 있어야 하므로 패널 자체는 항상 그린다
  const box = el('div', 'vcbox');
  const checked = getCheckedSet(vid);
  const hi = items.filter((i) => i.pri === 'high').length;
  const done = items.filter((i) => checked.has(checkKeyOf(i))).length;
  const memos = getMemos(vid);
  const bySrc = { 기준정보: 0, 웹기반: 0, 기타: 0 };
  items.forEach((i) => { bySrc[i.src || '기타'] = (bySrc[i.src || '기타'] || 0) + 1; });
  let html = `<h4>방문 전 확인필요 <span>확인사항 ${items.length}건`
    + `${hi ? ` · 필수 ${hi}` : ''} · 완료 ${done}/${items.length}`
    + ` · 기준정보 ${bySrc['기준정보'] || 0} / 웹기반 ${bySrc['웹기반'] || 0}${bySrc['기타'] ? ` / 기타 ${bySrc['기타']}` : ''}</span></h4>`;

  // 한 줄 = 확인사항 하나. 출처 · 중요도 · 분류 · 내용 · 메모.
  // 예전에는 세 블록(방문 전 체크리스트 / 체크 필요사항 기준정보 / 체크 필요사항 웹기반)에
  // 같은 건이 흩어져 있어 한 항목을 세 군데서 다시 읽어야 했다. 한 표로 합치고,
  // 어디서 나온 이야기인지(출처)를 첫 칸에 세워 신뢰도를 바로 가늠하게 한다.
  const SRC_CLS = { 기준정보: 'off', 웹기반: 'web', 기타: 'etc' };
  const seenRecallAnchor = { used: false };
  const rowHtml = (it) => {
    const k = checkKeyOf(it);
    if (it.mine && it.id === _editingCheck) {
      return `<div class="vr vc-editing" data-id="${esc(it.id)}"><div class="vc-form">`
        + `<input type="text" class="vc-ed-text" maxlength="200" value="${esc(it.text || '')}">`
        + `<select class="vc-ed-pri">`
        + ['high', 'mid', 'low'].map((v) => `<option value="${v}"${it.pri === v ? ' selected' : ''}>${PRI_LABEL[v]}</option>`).join('')
        + `</select>`
        + `<button type="button" class="vc-in-btn vc-ed-save">저장</button>`
        + `<button type="button" class="vc-ed-cancel">취소</button>`
        + `</div><input type="text" class="vc-in-why vc-ed-why" maxlength="200" placeholder="근거·메모 (선택)" value="${esc(it.why || '')}"></div>`;
    }
    const on = checked.has(k);
    const src = it.src || '기타';
    const memo = memos[k] || '';
    // 첫 회수 항목에 앵커를 둔다 — 위 대시보드의 '회수·판매중지 N건'이 여기로 온다
    const isRecall = /회수·판매중지/.test(it.text || '');
    const anchor = isRecall && !seenRecallAnchor.used ? ((seenRecallAnchor.used = true), ' id="vcRecall"') : '';
    return `<div class="vr${on ? ' vc-done' : ''}${isRecall ? ' vr-recall' : ''}" data-key="${esc(k)}"${anchor}>`
      + `<input type="checkbox" class="vr-ck" id="vc-${esc(k)}"${on ? ' checked' : ''} aria-label="확인 완료">`
      + `<span class="vr-src vr-src-${SRC_CLS[src] || 'etc'}">${esc(src)}</span>`
      + `<span class="vr-pri vc-pri-${esc(it.pri)}">${esc(PRI_LABEL[it.pri] || it.pri)}</span>`
      + `<span class="vr-cat">${esc(it.cat || '기타')}</span>`
      + `<div class="vr-body"><label for="vc-${esc(k)}">${esc(it.text)}</label>`
      + (it.why ? `<span class="vc-why">📎 ${esc(it.why)}</span>` : '')
      + (it.ins ? `<span class="vc-ins">💡 ${esc(it.ins)}</span>` : '')
      // 메모는 쓸 때만 꺼낸다. 모든 줄에 입력칸을 깔아 두니 표가 입력 양식처럼 보였다.
      + `<button type="button" class="vr-memo-add" data-key="${esc(k)}"${memo ? ' hidden' : ''}>＋ 메모</button>`
      + `<div class="vr-memo"${memo ? '' : ' hidden'}><input type="text" class="vr-memo-in" data-key="${esc(k)}" maxlength="300"`
      + ` placeholder="물어볼 말이나 현장에서 들은 답" value="${esc(memo)}"></div>`
      + `</div>`
      + `<span class="vr-own">${it.mine ? esc(it.at || '') : ''}</span>`
      + (it.mine ? `<button type="button" class="vc-edit" data-id="${esc(it.id)}" title="이 항목 수정" aria-label="수정">✎</button>` : '<span></span>')
      + (it.mine ? `<button type="button" class="vc-del" data-id="${esc(it.id)}" title="이 항목 삭제" aria-label="삭제">✕</button>` : '<span></span>')
      + `</div>`;
  };

  if (items.length) {
    // 출처 → 중요도 순. 기준정보(공공 API 대조)가 웹 자료보다 근거가 단단해 먼저 본다.
    const SRC_ORDER = { 기준정보: 0, 웹기반: 1, 기타: 2 };
    const sorted = [...items].sort((x, y) =>
      (SRC_ORDER[x.src || '기타'] ?? 9) - (SRC_ORDER[y.src || '기타'] ?? 9)
      || (PRI_ORDER[x.pri] ?? 9) - (PRI_ORDER[y.pri] ?? 9)
      || String(x.cat || '').localeCompare(String(y.cat || '')));
    html += `<div class="vc-tbl">`
      + `<div class="vr vr-head"><span></span><span>출처</span><span>중요도</span><span>분류</span>`
      + `<span>확인 내용 · 메모</span><span></span><span></span><span></span></div>`
      + sorted.map(rowHtml).join('')
      + `</div>`;
  } else {
    html += '<div class="vc-empty">자동 도출된 항목이 없습니다 — 자료를 보다가 확인할 것이 생기면 아래에서 추가하세요.</div>';
  }

  // ── 현장 대조표 ──
  // report.crosscheck는 지금까지 리포트에 담기기만 하고 화면에 나온 적이 없다. 방문해서
  // 맞춰 볼 값을 모아 둔 것인데 정작 방문할 때 볼 수가 없었다. 값이 있는 줄만 여기 싣는다
  // (값이 null인 줄은 위 체크리스트 항목과 같은 내용이라 두 번 적을 이유가 없다).
  const xc = (report.crosscheck || []).filter((x) => x && x.expected != null && x.expected !== '');
  if (xc.length) {
    // 기본은 접어 둔다. 방문해서 맞춰 볼 표라 평소 화면에서는 자리만 차지한다.
    // 인쇄물도 화면을 그대로 따른다 — 필요하면 펼쳐 놓고 인쇄하면 펼쳐진 채로 나온다.
    html += `<details class="vc-xcfold"><summary>현장 대조<span>${xc.length}</span></summary>`
      + `<div class="vc-xc"><div class="xc-h"><i>항목</i><i>우리가 확보한 값</i><i>현장 확인</i></div>`
      + xc.map((x) => `<div class="xc-r"><i>${esc(x.key)}</i>`
        + `<b>${esc(x.expected)}<small>${esc(x.src_type || '')}</small></b>`
        + `<u></u></div>`).join('')
      + `</div><div class="vc-foot">※ 위 값은 공개 자료에서 확보한 것입니다. 현장에서 들은 값이 다르면 그 차이가 확인 대상입니다 — 인쇄해서 오른쪽 칸에 적으세요.</div>`
      + `</details>`;
  }

  // ── 직접 추가 ──
  html += `<details class="vc-add" id="vcAdd"><summary>확인할 항목 직접 추가</summary>`
    + `<div class="vc-form">`
    + `<input type="text" class="vc-in-text" placeholder="확인할 내용 (예: 감사보고서 사본 요청)" maxlength="200">`
    + `<select class="vc-in-pri"><option value="high">필수</option><option value="mid" selected>권장</option><option value="low">참고</option></select>`
    + `<button type="button" class="vc-in-btn">추가</button>`
    + `<button type="button" class="vc-in-cancel">취소</button>`
    + `</div>`
    + `<input type="text" class="vc-in-why" placeholder="근거·메모 (선택)" maxlength="200">`
    + `</details>`;

  html += '<div class="vc-foot">📎 = 근거(웹 출처) · 💡 = 해석 인사이트 · 우선순위: <b>필수</b>/<b>권장</b>/<b>참고</b>. '
    + '체크 상태와 직접 추가한 항목은 이 브라우저에 업체별로 저장됩니다. '
    + '공식 API 대조 결과는 아래 <b>🏛 체크 필요사항 · 기준정보 기반</b>을 참고하세요. 인쇄해서 방문 시 체크하세요.</div>';
  box.innerHTML = html;

  // 체크 상태 저장 — 재렌더(홈페이지 분석 완료 등)에도 살아남게
  box.querySelectorAll('.vc-tbl .vr-ck').forEach((cb) => {
    cb.addEventListener('change', () => {
      const row = cb.closest('.vr');
      toggleChecked(vid, row.dataset.key, cb.checked);
      row.classList.toggle('vc-done', cb.checked);
    });
  });
  // 메모 저장 — 입력하다 말고 다른 데를 눌러도 남아야 하므로 포커스가 빠질 때 저장한다.
  // 목록을 다시 그리지는 않는다(입력 도중 커서가 튀면 쓰던 문장을 잃는다).
  box.querySelectorAll('.vr-memo-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wrap = btn.parentElement.querySelector('.vr-memo');
      btn.hidden = true;
      wrap.hidden = false;
      wrap.querySelector('input').focus();
    });
  });
  box.querySelectorAll('.vr-memo-in').forEach((inp) => {
    const save = () => setMemo(vid, inp.dataset.key, inp.value);
    inp.addEventListener('change', save);
    inp.addEventListener('blur', () => {
      save();
      // 아무것도 안 적고 빠져나오면 다시 접는다 — 빈 칸이 남아 있으면 도로 양식처럼 보인다
      if (!inp.value.trim()) {
        inp.closest('.vr-memo').hidden = true;
        const add = inp.closest('.vr-body').querySelector('.vr-memo-add');
        if (add) add.hidden = false;
      }
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { save(); inp.blur(); } });
  });
  // 직접 추가 항목 삭제
  box.querySelectorAll('.vc-del').forEach((b) => {
    b.addEventListener('click', () => { removeCustomCheck(vid, b.dataset.id); refreshVisitChecklist(report); });
  });
  // 수정 진입
  box.querySelectorAll('.vc-edit').forEach((b) => {
    b.addEventListener('click', () => { _editingCheck = b.dataset.id; refreshVisitChecklist(report, { focusEdit: true }); });
  });
  // 수정 저장·취소
  const ed = box.querySelector('.vc-editing');
  if (ed) {
    const save = () => {
      const text = ed.querySelector('.vc-ed-text').value.trim();
      if (!text) { ed.querySelector('.vc-ed-text').focus(); return; }
      updateCustomCheck(vid, ed.dataset.id, {
        text,
        pri: ed.querySelector('.vc-ed-pri').value,
        why: (ed.querySelector('.vc-ed-why').value || '').trim(),
      });
      _editingCheck = null;
      refreshVisitChecklist(report);
    };
    ed.querySelector('.vc-ed-save').addEventListener('click', save);
    ed.querySelector('.vc-ed-cancel').addEventListener('click', () => { _editingCheck = null; refreshVisitChecklist(report); });
    ed.querySelectorAll('.vc-ed-text, .vc-ed-why').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { _editingCheck = null; refreshVisitChecklist(report); }
      });
    });
  }
  // 추가
  const addNow = () => {
    const t = box.querySelector('.vc-in-text');
    const text = t.value.trim();
    if (!text) { t.focus(); return; }
    addCustomCheck(vid, {
      text,
      src: '기타', cat: '직접추가',
      pri: box.querySelector('.vc-in-pri').value,
      why: (box.querySelector('.vc-in-why').value || '').trim(),
    });
    refreshVisitChecklist(report, { keepAddOpen: true });
  };
  const cancelAdd = () => {
    const d = box.querySelector('#vcAdd');
    box.querySelectorAll('.vc-in-text, .vc-in-why').forEach((i) => { i.value = ''; });
    if (d) d.open = false;
  };
  box.querySelector('.vc-in-btn').addEventListener('click', addNow);
  box.querySelector('.vc-in-cancel').addEventListener('click', cancelAdd);
  box.querySelectorAll('.vc-in-text, .vc-in-why').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addNow(); }
      if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
    });
  });
  return box;
}

// '➕ 체크리스트에 추가' — 체크 필요사항을 보다가 누르면 방문 체크리스트의 입력창으로 데려간다.
// 위임 처리라 패널이 다시 그려져도 계속 동작한다.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-chkadd]');
  if (!b) return;
  const d = document.getElementById('vcAdd');
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const t = d.querySelector('.vc-in-text');
  if (t) setTimeout(() => t.focus(), 260);
});

// ── 공장 규모 비교(모션 그래픽) — 이 업체 vs 한국콜마 기준점 ──
// 숫자 둘을 나란히 두면 '얼마나 작은지'가 감으로 안 온다. 면적에 비례한 정사각형 두 개를
// 겹쳐 그리면 한눈에 보인다(한 변은 면적의 제곱근에 비례). 막대로 건축·연·대지면적도 견준다.
// 움직임은 처음 화면에 들어올 때 한 번만, 움직임 줄이기 설정이면 바로 최종 모습. 인쇄도 최종 모습.
const FIELD_M2 = 7140;                         // 축구장(105m × 68m)
const toPy = (m2) => Math.round(m2 / 3.305785);
// ── 3D 건물 블록 ──
// 바닥 한 변 ∝ √건축면적(두 건물 같은 축척), 높이 ∝ 지상 층수. CSS 3D만 쓴다(라이브러리 없음).
// 공장은 층고 대비 폭이 워낙 넓어 실제 비율로 세우면 납작한 판이 된다 — 높이만 과장하고 그 사실을 적는다.
function acFloors(D) {
  const bl = (D && D.bldgs) || [];
  const fac = bl.filter((x) => /공장|제조/.test(`${x.purpose} ${x.etc}`));
  const fl = Math.max(0, ...(fac.length ? fac : bl).map((x) => Number(x.floors) || 0));
  if (fl) return Math.min(fl, 12);
  return D && D.arch && D.tot ? Math.max(1, Math.min(12, Math.round(D.tot / D.arch))) : 1;
}
function acBox(cls, x, y, w, d, h, label) {
  // 바닥면(XY) 위에 선 상자 — 윗면은 translateZ(h), 네 옆면은 바닥 모서리에서 90° 세운다
  return `<div class="ac3-bld ${cls}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${d.toFixed(1)}px">`
    + `<div class="ac3-rise">`
    + `<i class="f top" style="width:${w.toFixed(1)}px;height:${d.toFixed(1)}px;transform:translateZ(${h.toFixed(1)}px)"></i>`
    + `<i class="f fr" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;top:${d.toFixed(1)}px"></i>`
    + `<i class="f bk" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;top:0"></i>`
    + `<i class="f lf" style="width:${h.toFixed(1)}px;height:${d.toFixed(1)}px;left:0"></i>`
    + `<i class="f rt" style="width:${h.toFixed(1)}px;height:${d.toFixed(1)}px;left:${w.toFixed(1)}px"></i>`
    + `</div><span class="ac3-tag" style="--tz:${(h + 16).toFixed(1)}px">${label}</span></div>`;
}
function acScene3d(B, R, nm) {
  const big = Math.max(B.arch, R.arch);
  const S = 150;                                   // 큰 건물 바닥 한 변(px)
  const sK = Math.max(8, S * Math.sqrt(R.arch / big)), sM = Math.max(8, S * Math.sqrt(B.arch / big));
  const fK = acFloors(R), fM = acFloors(B);
  const perFloor = Math.min(18, 84 / Math.max(fK, fM));   // 가장 높은 건물이 84px 안에 들게
  const hK = fK * perFloor, hM = fM * perFloor;
  const pad = 22, gap = 26;
  const W = pad + sK + gap + sM + pad, D = pad + Math.max(sK, sM) + pad;
  // 바닥 격자 — 20m 칸(두 건물 같은 축척)
  const pxPerM = S / Math.sqrt(big);
  const grid = Math.max(6, 20 * pxPerM);
  const scene = `<div class="ac3-scene" style="width:${W.toFixed(1)}px;height:${D.toFixed(1)}px;--grid:${grid.toFixed(1)}px">`
    + `<div class="ac3-ground"></div>`
    + acBox('k', pad, pad + (Math.max(sK, sM) - sK), sK, sK, hK, '한국콜마')
    + acBox('m', pad + sK + gap, pad + (Math.max(sK, sM) - sM), sM, sM, hM, nm)
    + `</div>`;
  return `<div class="ac3" role="img" aria-label="3D 규모 비교: 한국콜마 건축면적 ${toPy(R.arch).toLocaleString()}평 지상 ${fK}층, ${nm} ${toPy(B.arch).toLocaleString()}평 지상 ${fM}층">`
    + `<div class="ac3-stage" data-rz="-38">${scene}</div>`
    + `<div class="ac3-cap"><span class="m"></span>${nm} · 지상 ${fM}층<span class="k"></span>한국콜마 · 지상 ${fK}층</div>`
    + `<div class="ac3-note">바닥은 같은 축척(격자 한 칸 20m), 높이는 층수를 나타내며 보기 쉽게 과장했습니다 · 끌어서 돌려 보세요</div>`
    + `<button type="button" class="ac3-spin" aria-pressed="true">회전 멈춤</button>`
    + `</div>`;
}
// 끌어서 돌리기 · 회전 멈춤/재생
function acBind3d(box) {
  const stage = box.querySelector('.ac3-stage'), scene = box.querySelector('.ac3-scene'), btn = box.querySelector('.ac3-spin');
  if (!stage || !scene) return;
  let rz = -38, drag = null;
  const tags = [...box.querySelectorAll('.ac3-tag')];
  // 이름표는 장면과 반대로 돌려 늘 정면을 보게 한다
  const set = (v) => {
    rz = v; scene.style.transform = `rotateX(58deg) rotateZ(${rz}deg)`;
    tags.forEach((t) => { t.style.transform = `translate(-50%, -50%) translateZ(var(--tz)) rotateZ(${-rz}deg) rotateX(-58deg)`; });
  };
  const current = () => {                          // 돌고 있던 각도를 읽어 이어 받는다
    const m = getComputedStyle(scene).transform;
    const mm = m && m.startsWith('matrix3d') ? m.slice(9, -1).split(',').map(Number) : null;
    return mm ? Math.atan2(mm[1], mm[0]) * 180 / Math.PI : rz;
  };
  const stop = () => { if (!box.classList.contains('manual')) { const a = current(); box.classList.add('manual'); set(a); } btn.setAttribute('aria-pressed', 'false'); btn.textContent = '회전 재생'; };
  stage.addEventListener('pointerdown', (e) => { stop(); drag = { x: e.clientX, a: rz }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (drag) set(drag.a + (e.clientX - drag.x) * 0.6); });
  stage.addEventListener('pointerup', () => { drag = null; });
  stage.addEventListener('pointercancel', () => { drag = null; });
  btn.addEventListener('click', () => {
    if (box.classList.contains('manual')) { box.classList.remove('manual'); scene.style.transform = ''; tags.forEach((t) => { t.style.transform = ''; }); btn.setAttribute('aria-pressed', 'true'); btn.textContent = '회전 멈춤'; }
    else stop();
  });
}

function renderAreaCompare(report) {
  const M = report.meta || {};
  if (!M.live) return null;                          // 데모 리포트에는 띄우지 않는다
  const box = el('div', 'block full cat-prod ac');
  box.innerHTML = `<h3>공장 규모 비교<span class="cnt">건축물대장 · 한국콜마 세종 대비</span></h3>`
    + `<div class="ac-body"><div class="ac-wait">한국콜마 기준값을 불러오는 중…</div></div>`;
  const body = box.querySelector('.ac-body');
  const nm = esc(stripCorp(M.vendor_name || '') || '이 업체');
  const self = /한국콜마/.test(stripCorp(M.vendor_name || ''));
  let REF = null;
  const refFoot = (R) => (R ? `한국콜마 기준: ${R.parts.length > 1 ? `${R.parts.length}개 주소 합산 — ` : ''}${R.parts.map((p) => `${esc(p.addr)} (대장 지번 ${esc(p.jibun)}) 건축면적 ${toPy(p.arch).toLocaleString()}평`).join(' · ')}`
    + (R.failed && R.failed.length ? ` (조회 안 됨: ${R.failed.map((f) => esc(f.addr)).join(', ')})` : '') : '');

  const paint = () => {
    const R = REF;
    const B0 = M.bld && M.bld.arch ? M.bld : null;
    const B = B0 || (M.bldManual && M.bldManual.arch ? M.bldManual : null);
    // ① 조회한 업체가 한국콜마 자신 — 비교할 대상이 아니라 기준이다
    if (self) {
      body.innerHTML = R
        ? `<div class="ac-head"><b>${nm}</b>은(는) 비교 기준 회사입니다 — 기준점(산단길 22-17) 건축면적 <em>약 ${toPy(R.arch).toLocaleString()}평</em>`
          + (R.tot ? ` · 연면적 약 ${toPy(R.tot).toLocaleString()}평` : '') + '</div>'
          + `<div class="ac-foot">${refFoot(R)}. 다른 업체를 조회하면 이 값과 3D로 비교합니다.</div>`
        : `<div class="ac-head"><b>${nm}</b>은(는) 비교 기준 회사입니다.</div><div class="ac-foot">한국콜마 건축물대장을 불러오지 못했습니다.</div>`;
      return;
    }
    // ② 이 업체 면적이 없음 — 이유를 보이고, 주소를 바꿔 다시 찾거나 직접 넣게 한다
    if (!B) {
      body.innerHTML = `<div class="ac-head"><b>${nm}</b>의 공장 면적을 건축물대장에서 찾지 못해 비교하지 못했습니다</div>`
        + `<div class="ac-why">위 <b>주소 수정</b>으로 실제 공장 주소를 넣어 다시 조회하거나, 면적을 알면 아래에 직접 넣어 비교하세요.</div>`
        + `<form class="ac-form" data-f="manual"><label>면적을 알면 직접 넣어 비교</label>`
        + `<div class="ac-frow"><input class="ac-in sm" name="py" type="number" min="1" step="1" inputmode="numeric" placeholder="건축면적(평)" aria-label="건축면적(평)">`
        + `<input class="ac-in sm" name="fl" type="number" min="1" max="30" step="1" inputmode="numeric" placeholder="지상 층수" aria-label="지상 층수">`
        + `<button type="submit" class="nb-btn">직접 입력해 비교</button></div></form>`
        + (R ? `<div class="ac-foot">${refFoot(R)}</div>` : '');
      return;
    }
    // ③ 비교
    const me = { arch: B.arch, tot: B.tot, plat: B.plat };
    const rf = R ? { arch: R.arch, tot: R.tot, plat: R.plat } : null;
    let head = '', scene = '', bars = '';
    if (rf && rf.arch) {
      const r = me.arch / rf.arch;
      head = r < 1
        ? `<b>${nm}</b>의 건축면적은 한국콜마 세종의 <em>약 ${r < 0.1 ? (r * 100).toFixed(1) : Math.round(r * 100)}%</em>`
          + (r < 0.5 ? ` · <em>1/${Math.round(1 / r)}</em> 규모` : '') + '입니다'
        : `<b>${nm}</b>의 건축면적은 한국콜마 세종의 <em>약 ${r.toFixed(1)}배</em>입니다`;
      scene = acScene3d(B, R, nm);
      const rows = [['건축면적', 'arch', '바닥에 닿은 건물 면적 — 흔히 말하는 건평'], ['연면적', 'tot', '모든 층을 더한 면적 — 실제로 쓰는 공간'], ['대지면적', 'plat', '부지 전체 — 차량 진입·적재 여유']];
      bars = rows.filter(([, k]) => me[k] || rf[k]).map(([lab, k, hint], i) => {
        const mx = Math.max(me[k] || 0, rf[k] || 0) || 1;
        const w = (v) => `${Math.max(0.6, (v / mx) * 100).toFixed(2)}%`;
        return `<div class="ac-row" style="--d:${i * 140}ms"><div class="ac-lab"><b>${lab}</b><small>${hint}</small></div>`
          + `<div class="ac-bars"><div class="ac-bar m"><span style="--w:${w(me[k] || 0)}"></span><i data-n="${toPy(me[k] || 0)}">${me[k] ? toPy(me[k]).toLocaleString() + '평' : '—'}</i></div>`
          + `<div class="ac-bar k"><span style="--w:${w(rf[k] || 0)}"></span><i data-n="${toPy(rf[k] || 0)}">${rf[k] ? toPy(rf[k]).toLocaleString() + '평' : '—'}</i></div></div></div>`;
      }).join('');
    } else {
      head = `<b>${nm}</b>의 건축면적은 약 <em>${toPy(me.arch).toLocaleString()}평</em>입니다`
        + `<small class="ac-warn">한국콜마 기준값을 가져오지 못해 비교는 생략했습니다</small>`;
    }
    const fields = me.arch / FIELD_M2, kf = rf && rf.arch ? rf.arch / FIELD_M2 : null;
    const analog = `<div class="ac-analog">축구장(7,140㎡)으로 치면 <b>${nm} ${fields < 1 ? `약 ${Math.round(fields * 100)}%` : `약 ${fields.toFixed(1)}개`}</b>`
      + (kf ? ` · 한국콜마 세종 <b>약 ${kf.toFixed(1)}개</b>` : '') + '</div>';
    const manualNote = B.manual ? `<div class="ac-manual">직접 입력한 값(${toPy(B.arch).toLocaleString()}평 · 지상 ${B.floors}층)으로 비교 중입니다 <button type="button" class="ac3-spin" data-act="clear-manual">입력 지우기</button></div>` : '';
    body.innerHTML = `<div class="ac-head">${head}</div>${manualNote}`
      + `<div class="ac-grid">${scene ? `<div class="ac-left">${scene}</div>` : ''}<div class="ac-right">${bars}${analog}</div></div>`
      + `<div class="ac-foot">${B.manual ? '이 업체: 직접 입력값' : `이 업체: 국토부 건축물대장 ${esc(B.jibun)} 지번${B.collective ? ' · ⚠ 집합건물이라 건물 전체 면적입니다(업체 전용면적 아님)' : ''}`}. `
      + `${refFoot(R)}.</div>`;
    box.classList.remove('go', 'manual', 'still');
    acBind3d(box);
    animateAreaCompare(box);
  };

  // 직접 입력 · 입력 지우기 (주소 다시 조회는 '공장 면적' 탭 머리줄에서)
  box.addEventListener('submit', async (e) => {
    const f = e.target.closest('.ac-form'); if (!f) return;
    e.preventDefault();
    if (f.dataset.f === 'manual') {
      const py = Number(f.querySelector('[name=py]').value), fl = Number(f.querySelector('[name=fl]').value) || 1;
      if (!(py > 0)) { f.querySelector('[name=py]').focus(); return; }
      const m2 = py * 3.305785;
      M.bldManual = { manual: true, arch: m2, tot: m2 * fl, plat: 0, floors: fl, bldgs: [{ purpose: '공장', floors: fl }] };
      saveLastReport(report);
      paint();
    }
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="clear-manual"]')) { delete M.bldManual; saveLastReport(report); paint(); }
  });
  refBldArea().then((R) => { REF = R; }).catch(() => { REF = null; }).finally(paint);
  return box;
}
// ── 공장 면적 탭 ──
// 면적은 발주 물량·물류 판단에 바로 쓰여 정확해야 한다. 그래서 리포트 칸 하나로 두지 않고 탭으로 뺐다.
//   머리줄: 업체명 (조회 주소) · [주소 수정] — 고친 주소로 바로 다시 조회, 업체별로 저장돼 다음 조회에도 쓴다
//   후보 주소: 공장 소재지 선정 때 본 주소들 — 눌러서 그 주소로 조회
//   합계 · 필지별 내역(필지 추가·빼기) · 동별 건축물대장 표 · 주의할 점 · 한국콜마 3D 비교
const BLD_HOW = { lot: '지번 일치', road: '같은 본번 · 새주소(도로명) 일치', name: '같은 본번 · 건물명(상호) 일치' };
function renderAreaTab(report) {
  const M = report.meta || {};
  if (!M.live) return null;
  const wrap = el('div', 'at');
  const nm = stripCorp(M.vendor_name || '') || '이 업체';
  const B = M.bld && M.bld.arch ? M.bld : null;
  const parts = B ? (B.parts && B.parts.length ? B.parts : [B]) : [];
  const ov = areaOvGet(M.vendor_name);
  const curAddr = (M.bld && M.bld.queried) || (M.site && M.site.addr) || visitAddress(report) || '';
  const today = () => new Date().toISOString().slice(0, 10);
  const py = (m2) => toPy(m2 || 0).toLocaleString();
  const m2 = (v) => (v ? `${Math.round(v).toLocaleString()}㎡` : '—');
  const ui = { editing: false, busy: '', err: '' };

  const headHtml = () => {
    if (ui.editing) {
      return `<form class="nb-oform" data-at="main"><label for="atAddrIn"><b>${esc(nm)}</b> 면적 조회 주소 수정</label>`
        + `<div class="nb-orow"><input id="atAddrIn" class="nb-oin" type="text" value="${esc(curAddr)}" placeholder="예: 충청남도 아산시 둔포면 신남리 731-25" autocomplete="off">`
        + `<button type="submit" class="nb-btn dark"${ui.busy ? ' disabled' : ''}>${ui.busy === 'main' ? '조회 중…' : '이 주소로 다시 조회'}</button>`
        + `<button type="button" class="nb-btn" data-act="at-cancel">취소</button></div>`
        + (ui.err ? `<div class="nb-oerr" role="alert">${esc(ui.err)}</div>` : '<div class="nb-ohint">건축물대장은 지번 기준이라 <b>지번(○○리 123-4)</b>을 넣으면 가장 정확합니다. 도로명(○○로 12)도 됩니다.</div>')
        + '</form>';
    }
    return `<div class="nb-origin-line"><b class="nb-oname">${esc(nm)}</b><span class="nb-oaddr">(${esc(curAddr || '주소 없음')})</span>`
      + (ov && ov.addr ? '<span class="nb-oedited">수정한 주소</span>' : '')
      + `<button type="button" class="nb-btn sm" data-act="at-edit">주소 수정</button>`
      + (ov ? '<button type="button" class="nb-btn sm" data-act="at-reset">원래 주소로</button>' : '')
      + `</div><small class="nb-osub">이 주소 → 법정동코드·지번으로 국토부 건축물대장을 조회한 값입니다${ui.busy === 'reset' ? ' · 다시 조회 중…' : ''}</small>`
      + (!ui.editing && ui.err ? `<div class="nb-oerr" role="alert">${esc(ui.err)}</div>` : '');
  };
  const candHtml = () => {
    const cs = (M.site && M.site.cands) || [];
    if (!cs.length) return '';
    const ST = { pick: '선정', alt: '같은 지역', partial: '시·군까지만', out: '공장 지역 밖' };
    const row = (c) => `<li class="${c.state}"><span class="at-cl">${esc(c.label)}</span><span class="at-ca">${esc(c.addr)}</span><span class="at-cs">${ST[c.state] || ''}</span>`
      + (c.full && c.addr !== curAddr ? `<button type="button" class="nb-btn sm" data-act="at-use" data-addr="${esc(c.addr)}"${ui.busy ? ' disabled' : ''}>이 주소로 조회</button>` : '')
      + '</li>';
    // 선정 주소만 펼쳐 두고 나머지는 접는다 — 필요할 때 열어서 다른 주소로 조회
    const pick = cs.filter((c) => c.state === 'pick'), rest = cs.filter((c) => c.state !== 'pick');
    return `<div class="at-sec"><h4>후보 주소 <small>공장 소재지 선정 때 대조한 주소</small></h4>`
      + `<ul class="at-cands">${pick.map(row).join('')}</ul>`
      + (rest.length ? `<details class="at-more"${ui.candOpen ? ' open' : ''}><summary>다른 후보 주소 ${rest.length}곳 보기 <small>눌러서 그 주소로 조회</small></summary>`
        + `<ul class="at-cands">${rest.map(row).join('')}</ul></details>` : '')
      + '</div>';
  };
  const sumHtml = () => {
    if (!B) {
      const why = (M.bld && M.bld.err) || '공장 주소가 없어 건축물대장을 조회하지 못했습니다';
      return `<div class="at-sec at-miss"><b>건축물대장에서 면적을 찾지 못했습니다</b><p>${esc(why)}</p>`
        + '<p>실제 공장의 <b>지번</b>을 알면 위 <b>주소 수정</b>으로 다시 조회하세요. 카카오맵에서 공장을 찍으면 지번이 나옵니다.</p>'
        + allSitesHtml() + '</div>';
    }
    const stat = (lab, v, sub) => `<div class="at-stat"><span>${lab}</span><b>${v ? `약 ${py(v)}평` : '—'}</b><small>${[v ? m2(v) : '', sub].filter(Boolean).join(' · ')}</small></div>`;
    return `<div class="at-sec"><h4>합계 <small>${parts.length > 1 ? `${parts.length}개 필지 합산 · ` : ''}국토부 건축물대장 (${esc(B.src || '표제부')})</small></h4><div class="at-stats">`
      + stat('건축면적 (건평)', B.arch, '바닥에 닿은 면적')
      + stat('연면적', B.tot, '모든 층 합계')
      + stat('대지면적', B.plat, '부지')
      + stat('공장 용도 건축면적', B.factoryArch, `공장 ${B.factoryCount || 0}동 / 전체 ${B.bldgCount || 0}동`)
      + '</div></div>';
  };
  const lotsHtml = () => {
    if (!B) return '';
    const failed = (M.bld.failedLots || []);
    return `<div class="at-sec"><h4>필지별 내역 <small>공장이 여러 필지에 걸쳐 있으면 필지를 추가해 합산하세요</small></h4>`
      + '<div class="at-tw"><table class="at-tbl"><thead><tr><th>필지 (대장 지번)</th><th>조회 주소</th><th>연결</th><th class="n">건축면적</th><th class="n">연면적</th><th class="n">동수</th><th></th></tr></thead><tbody>'
      + parts.map((p, i) => `<tr><td>${esc(p.jibun)}${p.key ? `<small class="at-key">키 ${esc(p.key)}</small>` : ''}</td><td>${esc(p.queried || '')}</td>`
        + `<td>${esc(BLD_HOW[p.matchedBy] || '지번 일치')}${p.matchedBy && p.matchedBy !== 'lot' ? `<small>대표지번 ${esc(p.keyJibun || '')}엔 대장 없음</small>` : ''}</td>`
        + `<td class="n">${py(p.arch)}평<small>${m2(p.arch)}</small></td><td class="n">${py(p.tot)}평<small>${m2(p.tot)}</small></td><td class="n">${p.bldgCount || 0}</td>`
        + `<td>${i > 0 ? `<button type="button" class="nb-btn sm" data-act="at-drop" data-jibun="${esc(p.jibun)}" data-addr="${esc(p.queried || '')}">빼기</button>` : '<small>본 필지</small>'}</td></tr>`).join('')
      + '</tbody></table></div>'
      + (failed.length ? `<div class="at-warn">추가 필지 중 조회되지 않은 주소: ${failed.map((f) => `${esc(f.addr)} — ${esc(f.err)}`).join(' / ')}</div>` : '')
      + allSitesHtml()
      + `<form class="ac-form" data-at="lot"><label for="atLotIn">필지 추가</label><div class="ac-frow">`
      + `<input id="atLotIn" class="ac-in" type="text" placeholder="같은 공장의 다른 필지 — 예: 충청남도 아산시 둔포면 신남리 731-26" autocomplete="off">`
      + `<button type="submit" class="nb-btn"${ui.busy ? ' disabled' : ''}>${ui.busy === 'lot' ? '조회 중…' : '추가해 합산'}</button></div>`
      + (ui.lotErr ? `<div class="nb-oerr" role="alert">${esc(ui.lotErr)}</div>` : '') + '</form></div>';
  };
  // 식약처(의약품안전나라)에 제조소가 여러 곳 등록돼 있으면 한 번에 모두 더할 수 있게 — 아직 안 더한 곳만 센다
  const mfdsSites = (M.mfds_sites || []).map((x) => x.addr).filter(isFullAddr);
  const siteKey = (a) => bldCompact(String(a || '').replace(/\([^)]*\)/g, ''));
  const notYet = () => mfdsSites.filter((a) => !parts.some((p) => siteKey(p.queried) === siteKey(a)));
  const allSitesHtml = () => {
    if (mfdsSites.length < 2) return '';
    const rest = notYet();
    return `<div class="at-allsites">식약처 등록 제조소 <b>${mfdsSites.length}곳</b>: ${mfdsSites.map(esc).join(' / ')}`
      + (rest.length ? ` <button type="button" class="nb-btn sm" data-act="at-allsites"${ui.busy ? ' disabled' : ''}>${ui.busy === 'all' ? '조회 중…' : `나머지 ${rest.length}곳도 합산`}</button>` : ' <small>— 모두 합산됨</small>')
      + '</div>';
  };
  const bldgHtml = () => {
    if (!B) return '';
    const rows = (B.bldgs || []);
    if (!rows.length) return '';
    const d8 = (s) => (/^\d{8}$/.test(s || '') ? s.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '—');
    const multi = parts.length > 1;
    return `<div class="at-sec"><h4>동별 건축물대장 <small>표제부 ${rows.length}동${B.bldgCount > rows.length ? ` (전체 ${B.bldgCount}동 중)` : ''}</small></h4>`
      + `<div class="at-tw"><table class="at-tbl"><thead><tr>${multi ? '<th>필지</th>' : ''}<th>건물·동</th><th>주용도</th><th class="n">건축면적</th><th class="n">연면적</th><th class="n">층수</th><th>사용승인</th><th>구조</th></tr></thead><tbody>`
      + rows.map((x) => {
        const fac = /공장|제조/.test(`${x.purpose} ${x.etc || ''}`);
        return `<tr class="${fac ? 'fac' : ''}">${multi ? `<td>${esc(x.lotOf || '')}</td>` : ''}<td>${esc([x.name, x.dong].filter(Boolean).join(' ') || (x.kind || '—'))}${x.regKind ? `<small>${esc(x.regKind)}</small>` : ''}</td>`
          + `<td>${esc(x.purpose || '—')}${x.etc && x.etc !== x.purpose ? `<small>${esc(x.etc)}</small>` : ''}</td>`
          + `<td class="n">${x.arch ? `${py(x.arch)}평<small>${m2(x.arch)}</small>` : '—'}</td><td class="n">${x.tot ? `${py(x.tot)}평<small>${m2(x.tot)}</small>` : '—'}</td>`
          + `<td class="n">${x.floors ? `지상 ${x.floors}` : '—'}${x.under ? `<small>지하 ${x.under}</small>` : ''}</td><td>${d8(x.apr)}</td><td>${esc(x.strct || '—')}</td></tr>`;
      }).join('') + '</tbody></table></div></div>';
  };
  const noteHtml = () => {
    if (!B) return '';
    const n = [];
    if (B.collective) n.push('⚠ 집합건물(지식산업센터 등)입니다 — 표의 면적은 건물 전체이고 업체가 쓰는 호실은 훨씬 작습니다. 전용면적을 따로 물어보세요.');
    if (!B.factoryCount) n.push(`대장상 '공장' 용도 건물이 없습니다(용도: ${esc((B.purposes || []).join('·') || '미상')}). 창고·근린생활시설을 공장으로 쓰는지 방문 시 확인하세요.`);
    if (parts.some((p) => p.matchedBy && p.matchedBy !== 'lot')) n.push('도로명주소의 대표지번에는 대장이 없어 같은 본번의 다른 필지로 연결했습니다. 표의 필지가 실제 공장 건물인지 카카오맵 로드뷰로 한 번 대조하세요.');
    n.push('대장 면적은 사용승인 당시 신고값입니다 — 무단 증축·가설 건물은 빠져 있을 수 있습니다.');
    return `<div class="at-sec"><h4>주의할 점</h4><ul class="at-notes">${n.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
  };

  const paint = () => {
    wrap.innerHTML = `<div class="at-head">${headHtml()}</div>${candHtml()}${sumHtml()}${lotsHtml()}${bldgHtml()}${noteHtml()}`;
    const cmp = renderAreaCompare(report);
    if (cmp) wrap.appendChild(cmp);
    if (ui.editing) { const i = wrap.querySelector('#atAddrIn'); if (i) { i.focus(); i.select(); } }
  };
  // 면적이 바뀌면 리포트의 면적·소재지 칸도 같은 값으로 고친 뒤 전부 다시 그린다(탭은 그대로 유지)
  const commit = (bld) => {
    M.bld = bld;
    M.bldUser = true;          // 늦게 온 자료로 리포트를 다시 그려도 사용자가 고친 면적은 지킨다
    const cap = report.capacity || [];
    const i = cap.findIndex((x) => x.key === '공장 건축면적 (건평)');
    if (i >= 0 && window.areaFieldFromBld) cap[i] = window.areaFieldFromBld(bld && bld.arch ? { ok: true, data: bld } : { ok: false, err: bld && bld.err, queried: bld && bld.queried }, null, null, today());
    const j = cap.findIndex((x) => x.key === '실제 공장 소재지 (선정)');
    if (j >= 0 && window.siteField && M.site) cap[j] = window.siteField({ ok: true, data: M.site }, { ok: !!(bld && bld.arch), data: bld }, today());
    saveLastReport(report);
    render(report, { noScroll: true });
  };
  const run = async (kind, job) => {
    ui.busy = kind; ui.err = ''; ui.lotErr = ''; paint();
    try { await job(); } catch (x) {
      ui.busy = '';
      if (kind === 'lot') ui.lotErr = x && x.message ? x.message : String(x); else ui.err = x && x.message ? x.message : String(x);
      paint();
    }
  };
  const lookupMain = async (addr) => {
    const main = { ...(await bldAreaLookup(addr, { name: M.vendor_name })), queried: addr };
    const lots = (ov && ov.lots) || [];
    const bld = await bldWithLots(main, lots, M.vendor_name, { edited: true });
    areaOvSet(M.vendor_name, { addr, lots });
    commit({ queried: addr, ...bld });
  };

  wrap.addEventListener('toggle', (e) => { if (e.target.classList && e.target.classList.contains('at-more')) ui.candOpen = e.target.open; }, true);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || ui.busy) return;
    const act = b.dataset.act;
    if (act === 'at-edit') { ui.editing = true; ui.err = ''; paint(); }
    else if (act === 'at-cancel') { ui.editing = false; ui.err = ''; paint(); }
    else if (act === 'at-use') run('main', () => lookupMain(b.dataset.addr));
    else if (act === 'at-reset') {
      run('reset', async () => {
        areaOvSet(M.vendor_name, null);
        try {
          const main = M.site && M.site.cands ? await bldAreaForSite(M.site, M.vendor_name)
            : { ...(await bldAreaLookup(visitAddress(report), { name: M.vendor_name })), queried: visitAddress(report) };
          commit({ queried: main.queried, ...bldCombine([main]) });
        } catch (x) {
          commit({ err: x && x.message ? x.message : String(x), queried: (M.site && M.site.addr) || visitAddress(report) });
        }
      });
    } else if (act === 'at-allsites') {
      run('all', async () => {
        const rest = notYet();
        const got = await mapLimit(rest, 2, (a) => bldAreaLookup(a, { name: M.vendor_name }).then((d) => ({ ...d, queried: a })).catch((e) => ({ err: e.message, queried: a })));
        const okParts = got.filter((g) => !g.err);
        if (!okParts.length && !B) throw new Error(got.map((g) => `${g.queried} — ${g.err}`).join(' / '));
        const lots = [...new Set([...((ov && ov.lots) || (B && B.lots) || []), ...okParts.map((g) => g.queried)])];
        areaOvSet(M.vendor_name, { addr: ov && ov.addr ? ov.addr : null, lots });
        const base = B ? parts : [];
        commit({ queried: (B && B.queried) || (okParts[0] && okParts[0].queried), ...bldCombine([...base, ...okParts], { edited: B && B.edited, lots,
          failedLots: got.filter((g) => g.err).map((g) => ({ addr: g.queried, err: g.err })) }) });
      });
    } else if (act === 'at-drop') {
      const keep = parts.filter((p) => p.jibun !== b.dataset.jibun);
      const lots = ((ov && ov.lots) || (B && B.lots) || []).filter((a) => a !== b.dataset.addr);
      areaOvSet(M.vendor_name, { addr: ov && ov.addr ? ov.addr : null, lots });
      commit({ queried: B.queried, ...bldCombine(keep, { edited: B.edited, lots, failedLots: [] }) });
    }
  });
  wrap.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-at]'); if (!f) return;
    e.preventDefault();
    if (ui.busy) return;
    const addr = (f.querySelector('input') || {}).value ? f.querySelector('input').value.trim() : '';
    if (f.dataset.at === 'main') {
      if (!addr) { ui.err = '주소를 입력해 주세요'; paint(); return; }
      run('main', () => lookupMain(addr));
    } else if (f.dataset.at === 'lot') {
      if (!addr) { ui.lotErr = '추가할 필지 주소를 입력해 주세요'; paint(); return; }
      run('lot', async () => {
        const part = { ...(await bldAreaLookup(addr, { name: M.vendor_name })), queried: addr };
        if (parts.some((p) => p.jibun === part.jibun)) throw new Error(`이미 들어 있는 필지입니다 (${part.jibun})`);
        const lots = [...(((ov && ov.lots) || (B && B.lots) || [])), addr];
        areaOvSet(M.vendor_name, { addr: ov && ov.addr ? ov.addr : null, lots });
        commit({ queried: B.queried, ...bldCombine([...parts, part], { edited: B.edited, lots, failedLots: [] }) });
      });
    }
  });
  paint();
  return wrap;
}

function animateAreaCompare(box) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { box.classList.add('go', 'still'); return; }
  const run = () => {
    box.classList.add('go');
    // 숫자 올라가기 — 막대가 자라는 동안 같은 속도로
    box.querySelectorAll('.ac-bar i[data-n]').forEach((i) => {
      const n = Number(i.dataset.n); if (!n) return;
      const t0 = performance.now(), dur = 900;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        i.textContent = `${Math.round(n * e).toLocaleString()}평`;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };
  if (!('IntersectionObserver' in window)) { requestAnimationFrame(run); return; }
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); requestAnimationFrame(run); } }, { threshold: 0.25 });
  io.observe(box);
}

function render(report, opts = {}) {
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
  // 길찾기 목적지 — 실데이터 리포트는 meta.visit_addr(공장 실주소) 우선, 없으면 필드값
  const routeAddr = (m && m.visit_addr) || visitAddr;
  const refName = (m && m.ref_point && m.ref_point.name) || '한국콜마';
  const coord = m && m.visit_coord;
  if (visitAddr) {
    // 위치만 띄우면 '얼마나 먼지'를 다시 손으로 찍어봐야 한다. 기준점에서의 경로로 바로 연다.
    // 기준점 주소가 없을 때만 단순 위치 검색으로 물러선다.
    const refAddr = (m && m.ref_point && m.ref_point.addr) || '';
    const dest = routeAddr || visitAddr;
    const canRoute = !!refAddr;
    const mapBtn = el('button', 'act', canRoute ? '🗺 카카오맵 경로' : '🗺 카카오맵에서 공장 위치');
    mapBtn.title = canRoute
      ? `${refName}(${refAddr}) → 「${dest}」 카카오맵 길찾기`
      : `카카오맵에서 「${visitAddr}」 위치를 로드맵으로 표시`;
    const mapUrl = canRoute
      ? `https://map.kakao.com/?sName=${encodeURIComponent(refAddr)}&eName=${encodeURIComponent(dest)}`
      : `https://map.kakao.com/?q=${encodeURIComponent(visitAddr)}`;
    mapBtn.addEventListener('click', () => window.open(mapUrl, '_blank', 'noopener'));
    actions.appendChild(mapBtn);
  }
  // 🚗 티맵 길찾기 (앱 스킴) — 정확 좌표가 있을 때만. 모바일 티맵 앱에서 경로 안내.
  if (coord && isFinite(coord.lat) && isFinite(coord.lng)) {
    const rp = (m && m.ref_point) || {};
    const tmapBtn = el('button', 'act', '🚗 티맵 길찾기');
    tmapBtn.title = `${refName} → 「${routeAddr || '방문지'}」 자동차 경로 (티맵 앱)`;
    const tmapUrl = `tmap://route?goalname=${encodeURIComponent(routeAddr || '방문지')}&goalx=${coord.lng}&goaly=${coord.lat}`
      + (isFinite(rp.lat) && isFinite(rp.lng) ? `&startname=${encodeURIComponent(refName)}&startx=${rp.lng}&starty=${rp.lat}` : '');
    tmapBtn.addEventListener('click', () => { window.location.href = tmapUrl; });
    actions.appendChild(tmapBtn);
  }
  actions.appendChild(dlBtn);
  actions.appendChild(printBtn);
  root.appendChild(actions);
  const allFields = [...report.basic, ...report.capacity, ...report.finance].filter(included);
  const gapTotal = allFields.filter((f) => f.data_gap).length;

  // ── 화면 순서: 종합판정(대시보드) → 기업정보·생산역량·재무 → 방문 전 확인필요 → 그 밖의 상세 ──
  // 예전에는 등급 글자 하나와 '수집 필드 22 / 공백 5' 같은 집계가 맨 위였다. 그건 시스템의
  // 상태이지 업체에 대한 판단이 아니다. 방문 여부를 3분 안에 정하려면 '어떤 업체인가 →
  // 방문할 만한가 → 무엇이 걸리는가 → 가서 뭘 볼 것인가' 순으로 읽혀야 한다.
  // 판정 카드 아래에 큰 타일 줄이 따로 있었는데, 여섯 칸 중 넷(제조업·CGMP·재직자수·
  // 사업자 상태)이 카드의 기본 현황 칩과 같은 말이었다. 겹치지 않던 회수·판매중지와
  // 방문 거리만 칩으로 옮기고 타일 줄은 걷어 냈다.
  root.appendChild(renderVerdict(report));

  // 조회 메타는 판단에 쓰이지 않으니 아래로 내리고 한 줄로 줄인다
  const qDate = new Date(m.query_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  root.appendChild(el('div', 'metaline',
    `조회 <b>${esc(qDate)}</b> · 스냅샷 v${m.version} · 출처 ${m.sources_used.length}종 · `
    + `수집 필드 ${allFields.length}${gapTotal ? ` · 공백 <b class="warn">${gapTotal}</b>` : ''}`
    + `${report.risk_flags.length ? ` · 리스크 <b class="warn">${report.risk_flags.length}</b>` : ''}`));
  // 먼저 그린 리포트 — 아직 안 온 소스를 알리고, 도착하면 자동으로 다시 그린다
  if (report._late && report._pendingKeys && report._pendingKeys.length) {
    root.appendChild(el('div', 'pendbar',
      `<span class="pend-dot" aria-hidden="true"></span><b>${report._pendingKeys.map((k) => esc(LIVE_SRC_NAME[k] || k)).join(' · ')}</b> 불러오는 중 — `
      + '응답이 느린 기관입니다. 도착하면 이 화면에 자동으로 채웁니다.'));
  }

  // 기업 기본정보 · 생산역량 · 재무 — 대시보드 바로 아래, '방문 전 확인필요' 위에 둔다.
  // 확인사항을 읽기 전에 어떤 회사인지(규모·인원·재무)를 먼저 보게 하려는 것이다.
  const core = el('div', 'blocks core-blocks');
  core.appendChild(block('기업 기본정보', '', visible(report.basic), 'basic'));
  // 공장 면적은 '공장 면적' 탭에서 자세히 본다(실데이터일 때). 리포트에는 칸을 두지 않는다.
  const areaTab = renderAreaTab(report);
  core.appendChild(block('생산역량 · 인원', '',
    visible(report.capacity).filter((x) => !(areaTab && x.key === '공장 건축면적 (건평)')), 'prod'));
  if (!excl.has('finance')) core.appendChild(financeBlock(report));
  root.appendChild(core);

  // ✅ 방문 전 체크리스트 — 웹 기반(기사·채용·기술/제품) 실사 제안(실데이터일 때)
  //    심층분석 결과가 나중에 도착하면 갱신해야 하므로 id로 찾아 교체 가능하게 둔다.
  if (m.live) {
    const vc = renderVisitChecklist(report);
    if (vc) { vc.id = 'visitChecklist'; root.appendChild(vc); }
  }

  // 데이터 출처 배너
  if (m.live) {
    root.appendChild(el('div', 'livenote',
      '🟢 <b>실데이터</b> — data.go.kr 공공 API 조회 결과입니다. ' +
      '값이 없는 항목은 <code>data_gap</code>으로 명시합니다.'));
    // 금융위 법인 미검색(개인사업자·법인명 불일치) → 상호명 기반 조회임을 안내
    if (m.no_corp) {
      root.appendChild(el('div', 'gennote',
        '⚠️ <b>금융위 법인 정보를 찾지 못했습니다</b> — 개인사업자이거나 등록 법인명이 검색어와 다른 경우입니다. ' +
        '상호명으로 <b>식약처·국민연금·공장등록·회수이력 등은 조회</b>했으나, <b>법인등록번호·재무·국세청 상태</b>는 법인 매칭이 안 돼 비어 있습니다. ' +
        '정확한 <b>법인명</b> 또는 <b>(주)</b> 포함 명칭으로 다시 검색해 보세요.'));
    }
    // 📡 소스별 조회 상태 — 무엇이 왜 비었는지 + 체크 해제 시 리포트에서 제외
    if (Array.isArray(m.src_status) && m.src_status.length) {
      const excluded = getExcluded();
      // 기본은 접어둔다 — 소스가 십수 개라 늘 펼쳐두면 정작 봐야 할 리포트가 밀린다.
      // 닫힌 상태에서도 성공/실패 건수는 보이게 해, 열어볼지 말지 판단할 수 있게 한다.
      const sp = el('details', 'srcstat');
      const nOk = m.src_status.filter((x) => x.ok && !(x.key && excluded.has(x.key))).length;
      const nNo = m.src_status.filter((x) => !x.ok && !(x.key && excluded.has(x.key))).length;
      const nEx = m.src_status.filter((x) => x.key && excluded.has(x.key)).length;
      const sum = el('summary', 'srchead');
      sum.innerHTML = `📡 데이터 소스 상태 <b class="sscnt">`
        + `<u class="ok">✓ ${nOk}</u>${nNo ? `<u class="no">✗ ${nNo}</u>` : ''}${nEx ? `<u class="ex">⊘ ${nEx}</u>` : ''}</b>`
        + `<span>눌러서 펼치기 · 체크박스 해제 시 리포트에서 제외</span>`;
      sp.appendChild(sum);
      // 사용자가 한 번 펼쳤으면 재렌더(제외 토글) 후에도 열린 상태를 유지한다
      if (_srcOpen) sp.open = true;
      sp.addEventListener('toggle', () => { _srcOpen = sp.open; });
      m.src_status.forEach((s) => {
        const canToggle = !!s.key;
        const ex = canToggle && excluded.has(s.key);
        const row = el('label', 'ss ' + (ex ? 'excl' : (s.warn ? 'warn' : (s.ok ? 'ok' : 'no'))));
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

  // 확인사항은 위 '방문 전 확인필요' 표 하나로 모았다. 여기 남는 것은 그 근거 —
  // 기사 타임라인·웹 언급처럼 '읽어 볼 원문'이지 체크할 항목이 아니다.
  if (!excl.has('news')) { const chkW = renderCheckWeb(report); if (chkW) root.appendChild(chkW); }

  const blocks = el('div', 'blocks');
  // 🧑‍🏭 채용공고 추적 — 재무 뒤(재무가 오래된 업체의 '현재 활동'을 보는 자리이므로 나란히)
  if (!excl.has('hiring')) {
    const hb = renderHiring(report.hiring);
    if (hb) blocks.appendChild(hb);
  }
  // 🔎 홈페이지 추적 — 실데이터일 때만, 지연 로드(첫 렌더 이후 비동기). 결과는 report에 캐시.
  if (m.live) {
    const hpBox = el('div', 'hpbox');
    blocks.appendChild(hpBox);
    // 심층분석 결과를 그린 뒤, 수동 주소 입력 UI에 이벤트를 다시 연결(innerHTML 교체로 리스너가 날아감)
    const paintDeep = (state) => {
      renderSiteDeepInto(sdBox, state);
      // 탭 전환(인증/설비/생산CAPA/기타) — innerHTML 교체 후 매번 다시 연결
      sdBox.querySelectorAll('.sd-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.tab;
          sdBox.querySelectorAll('.sd-tab').forEach((b) => b.classList.toggle('on', b === btn));
          sdBox.querySelectorAll('.sd-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === id));
        });
      });
      const go = sdBox.querySelector('.sd-go');
      const inp = sdBox.querySelector('.sd-url');
      if (!go || !inp) return;
      const submit = () => {
        let u = inp.value.trim();
        if (!u) { inp.focus(); return; }
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;      // 스킴 생략 허용
        try { new URL(u); } catch { inp.setCustomValidity('주소 형식을 확인하세요'); inp.reportValidity(); return; }
        runDeep(u);
      };
      go.addEventListener('click', submit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    };
    // url 인자를 주면 그 주소로, 없으면 추적된 홈페이지로 분석
    const runDeep = (url) => {
      report._siteDeep = { loading: true };
      paintDeep(report._siteDeep);
      // 확정 사이트 우선. 확정 실패라도 최고점 후보(2점 이상)가 있으면 그걸로라도 분석한다
      // — "홈페이지 미확보"로 아무것도 못 보여주는 것보다 낫고, 출처는 화면에 그대로 표시된다.
      const hp = report._homepage;
      const best = hp && !hp.proposed && Array.isArray(hp.candidates)
        ? hp.candidates.find((c) => (c.score || 0) >= 2) : null;
      const pickC = (hp && hp.proposed) ? hp.proposed : best;
      const hpUrl = url || (pickC ? pickC.url : '');
      // 검색결과가 가리킨 실제 내용 페이지(origLink)를 씨앗으로 — 루트가 프레임셋이어도 본문 확보
      const seeds = [];
      if (!url && pickC && pickC.origLink && pickC.origLink !== pickC.url) seeds.push(pickC.origLink);
      if (hp && Array.isArray(hp.candidates)) {
        hp.candidates.forEach((c) => {
          if (c.origLink && pickC && c.host === pickC.host && !seeds.includes(c.origLink)) seeds.push(c.origLink);
        });
      }
      siteDeepAnalyze(report.meta.vendor_name, hpUrl, seeds)
        .then((state) => {
          report._siteDeep = reconcileDeep(state, report);   // 공식 API와 대조해 모순을 표시

          paintDeep(report._siteDeep);
          refreshVisitChecklist(report); // 인증·제형·설비 확인항목을 체크리스트에 반영
          saveLastReport(report);
        })
        .catch((e) => { report._siteDeep = { err: e && e.message ? e.message : String(e), base: hpUrl }; paintDeep(report._siteDeep); });
    };
    if (report._homepage !== undefined) {
      renderHomepageInto(hpBox, report._homepage);
    } else {
      hpBox.innerHTML = '<h4>홈페이지 추적 <span>검색 중…</span></h4>';
      const getV = (k) => { const f = report.basic.find((x) => x.key === k); return f && f.value; };
      // 채용사이트 기업정보에서 뽑아 둔 홈페이지 주소를 후보로 함께 넘긴다
      const hints = (report.hiring && report.hiring.hpHints) || [];
      // 늦은 자료로 리포트를 다시 그려도 홈페이지 검색은 한 번만 — 진행 중인 검색을 이어받는다
      if (!report._hpP) {
        Object.defineProperty(report, '_hpP', { configurable: true, value: findHomepage(report.meta.vendor_name,
          { rep: getV('대표자'), addr: getV('본점주소'), bzno: getV('사업자등록번호'), factoryHomepage: report.meta.factory_homepage,
            addrs: reportAddrs(report), tels: ((report.hiring && report.hiring.contacts && report.hiring.contacts.tels) || []).map((t) => t.v) },
          hints) });
      }
      report._hpP
        .then((hp) => { report._homepage = hp || null; if (hpBox.isConnected) renderHomepageInto(hpBox, report._homepage); refreshContact(report); if (currentReport === report) saveLastReport(report); })
        .catch(() => { report._homepage = null; if (hpBox.isConnected) renderHomepageInto(hpBox, null); refreshContact(report); if (currentReport === report) saveLastReport(report); });
    }
    // 🔬 홈페이지 심층분석 — 버튼 실행(비용/시간 소요). 결과 캐시.
    const sdBox = el('div', 'sdbox');
    blocks.appendChild(sdBox);
    if (report._siteDeep && (report._siteDeep.data || report._siteDeep.err)) {
      paintDeep(report._siteDeep);
    } else {
      sdBox.innerHTML = '<h4>홈페이지 심층분석 <span>사이트 유형(정적·JS·이미지) 무관 키워드 추출 · API키 불필요</span></h4>';
      const btn = el('button', 'sd-run', '🔬 심층분석 실행');
      btn.addEventListener('click', () => runDeep());
      sdBox.appendChild(btn);
      const man = el('div');
      man.innerHTML = sdManualRow('');
      sdBox.appendChild(man);
      const go = man.querySelector('.sd-go'); const inp = man.querySelector('.sd-url');
      const submit = () => {
        let u = inp.value.trim(); if (!u) { inp.focus(); return; }
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        try { new URL(u); } catch { return; }
        runDeep(u);
      };
      go.addEventListener('click', submit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
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

  // 리포트 내용을 '사전검증 리포트' 탭으로 감싸고 옆에 '근처 업체' 탭을 붙인다(nearby.js)
  if (typeof mountReportTabs === 'function') mountReportTabs(root, report, actions, areaTab);

  // 조회 리포트 저장 — 새로고침/재방문 시 복원용 (새 조회 전까지 유지)
  saveLastReport(report);

  if (!opts.noScroll) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  hookLateReport(report);
}

// 먼저 그린 리포트(finishLive의 _late)가 완성되면 같은 업체를 보고 있을 때만 바꿔 그린다.
// 그 사이 사용자가 한 일(홈페이지 추적·심층분석·면적 수정·직접 입력)은 새 리포트로 옮긴다.
const LIVE_SRC_NAME = { finance: '금융위 재무', rpt: '식약처 보고품목', nps: '국민연금', maker: '식약처 제조업', nedrug: '의약품안전나라 제조소', gmp: '식약처 CGMP',
  factory: '산단공 공장등록', recall: '식약처 회수·판매중지', nts: '국세청 사업자상태', naverNews: '뉴스', oemTrace: '웹 언급',
  hiring: '채용공고', ntsVal: '국세청 진위확인' };
function hookLateReport(report) {
  if (!report || !report._late || report._lateHooked) return;
  Object.defineProperty(report, '_lateHooked', { value: true });
  report._late.then((fin) => {
    if (!fin || currentReport !== report) return;
    if (report._homepage !== undefined) fin._homepage = report._homepage;
    if (report._hpP) Object.defineProperty(fin, '_hpP', { configurable: true, value: report._hpP });
    if (report._siteDeep) fin._siteDeep = report._siteDeep;
    const M = report.meta || {}, F = fin.meta || {};
    if (M.bldManual) F.bldManual = M.bldManual;
    if (M.bldUser) {
      F.bld = M.bld; F.bldUser = true;
      ['공장 건축면적 (건평)', '실제 공장 소재지 (선정)'].forEach((k) => {
        const o = (report.capacity || []).find((x) => x.key === k);
        const i = (fin.capacity || []).findIndex((x) => x.key === k);
        if (o && i >= 0) fin.capacity[i] = o;
      });
    }
    const y = window.scrollY;
    render(fin, { noScroll: true });
    window.scrollTo(0, y);
  });
}

function renderDiff(diff) {
  if (!diff || !diff.length) return null;
  const b = el('div', 'block');
  b.appendChild(el('h3', null, `직전 버전 대비 변경<span class="cnt">${diff.length}건</span>`));
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

// ── 최근 검색 (검색창 아래 최대 3개) ──
const RECENT_KEY = 'vs_recent';
const getRecent = () => { try { return JSON.parse(_ls(RECENT_KEY) || '[]'); } catch { return []; } };
function pushRecent(q) {
  q = (q || '').trim();
  if (!q) return;
  const list = getRecent().filter((x) => x !== q);
  list.unshift(q);
  _sls(RECENT_KEY, JSON.stringify(list.slice(0, 3)));
}

// ── 마지막 조회 리포트 유지 (새로고침·탭 복귀·재방문 시 복원, 새 조회 전까지 표시) ──
const LAST_KEY = 'vs_last_report';
function saveLastReport(report) {
  try { if (report && report.meta) _sls(LAST_KEY, JSON.stringify(report)); } catch { /* 용량초과 등 무시 */ }
}
function loadLastReport() {
  try {
    const s = _ls(LAST_KEY);
    if (!s) return null;
    const r = JSON.parse(s);
    // DART 연동을 제거하기 전에 저장된 리포트에는 dart 항목이 남아 있다.
    // 그대로 두면 출처 목록에 조회하지도 않는 소스가 유령처럼 표시되므로 걷어낸다.
    if (r && r.meta && Array.isArray(r.meta.src_status)) {
      r.meta.src_status = r.meta.src_status.filter((x) => x && x.key !== 'dart');
    }
    if (r) delete r.dart;
    return r;
  } catch { return null; }
}
function renderRecent() {
  const box = $('#recent');
  if (!box) return;
  const list = getRecent();
  if (!list.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = '<span class="rc-lbl">최근 검색</span>' + list.map((q) =>
    `<button type="button" class="rc-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  box.querySelectorAll('.rc-chip').forEach((c) =>
    c.addEventListener('click', () => { $('#q').value = c.dataset.q; lookup(c.dataset.q); }));
}

// ── 옛 코드로 도는지 확인 ──
// 캐시 사슬: 브라우저에 index.html이 남아 있으면 그 안의 옛 주소(app.js?v=118)를 다시 요청하고,
// 그 주소는 7일 캐시라 옛 파일이 그대로 나온다. 또 탭을 열어 둔 채 배포가 나가면 새로고침 전까지
// 옛 코드가 계속 돈다 — 실제로 v156 배포 뒤에 v154 코드로 만든 리포트가 올라왔다(없앤 산단공
// 면적 호출 오류가 그대로 찍혀 있었다). 그래서 페이지를 열 때만이 아니라 탭에 돌아올 때와
// 실데이터 조회 직전에도 확인한다. index.html만 캐시 없이 받아 배포 번호와 대조한다.
let _staleCheckedAt = 0;
async function liveBuild() {
  try {
    const r = await Promise.race([
      fetch(`index.html?_=${Date.now()}`, { cache: 'no-store' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500)),   // 느리면 기다리지 않는다
    ]);
    if (!r.ok) return null;
    const live = Number((((await r.text()).match(/app\.js\?v=(\d+)/)) || [])[1]);
    return isFinite(live) ? live : null;
  } catch { return null; }   // file:// · 오프라인 — 확인할 방법이 없으니 조용히 넘어간다
}
const freshUrl = (extra = '') => `${location.pathname}?r=${Date.now()}${extra}`;
async function showStaleBar() {
  const live = await liveBuild();
  if (!live || live <= BUILD || document.querySelector('.stalebar')) return;
  const bar = el('div', 'stalebar',
    `<b>옛 버전으로 실행 중입니다</b> 화면은 v${BUILD}, 배포된 최신은 v${live}입니다. `
    + `이대로 조회하면 옛 코드의 결과가 나옵니다.`
    + `<button type="button" id="stReload">최신으로 새로고침</button>`);
  document.body.appendChild(bar);
  // 주소에 값을 붙여 index.html을 새로 받게 하면, 그 안의 새 ?v= 주소는 캐시에 없어 스크립트도 새로 받는다
  bar.querySelector('#stReload').addEventListener('click', () => location.replace(freshUrl()));
}
// 실데이터 조회 직전 — 옛 코드면 입력값을 들고 새로고침한 뒤 이어서 조회한다(1분에 한 번만 확인)
async function reloadIfStale(q, bno) {
  if (Date.now() - _staleCheckedAt < 60000) return false;
  _staleCheckedAt = Date.now();
  const live = await liveBuild();
  if (!live || live <= BUILD) return false;
  // 배포 직후 CDN이 아직 옛 파일을 주면 새로고침해도 또 옛 코드다 — 1분 안에 두 번은 하지 않는다
  let last = 0; try { last = Number(sessionStorage.getItem('vs_stale_reload') || 0); } catch {}
  if (Date.now() - last < 60000) { showStaleBar(); return false; }
  try { sessionStorage.setItem('vs_stale_reload', String(Date.now())); } catch {}
  location.replace(freshUrl(`&q=${encodeURIComponent(q || '')}&bno=${encodeURIComponent(bno || '')}`));
  return true;
}

// ── 기다리는 동안 볼 업계 소식 ──
// 실시간 조회는 수십 초가 걸린다. 빈 '조회 중…' 한 줄 대신 화장품 제조업 최신 기사를 넘겨 보게 한다.
// 네이버 뉴스(프록시)에서 업계 키워드로 모아 3시간 보관하고, 페이지를 열 때 미리 받아 둔다.
// 기사는 새 탭에서 열려 조회가 끊기지 않는다.
const TREND_KEY = 'vs_trend_v1', TREND_TTL = 3 * 3600e3;
const TREND_QS = ['화장품 ODM', '화장품 제조', 'K뷰티 수출', '화장품 트렌드', '화장품 원료'];
const TREND_TOPICS = [['수출', /수출|해외|미국|중국|일본|유럽|아마존|글로벌/], ['ODM·OEM', /ODM|OEM|위탁|제조사|코스맥스|한국콜마|코스메카/i],
  ['규제·인증', /식약처|규제|인증|CGMP|MoCRA|NMPA|법|허가|금지/i], ['원료·기술', /원료|소재|성분|특허|기술|연구/],
  ['실적·투자', /실적|매출|영업이익|투자|상장|인수|증설|공장/], ['트렌드', /트렌드|유행|인기|소비자|MZ|신제품|출시/]];
let _trendP = null;
const trendDecode = (s) => { const t = document.createElement('textarea'); t.innerHTML = String(s || '').replace(/<\/?b>/g, ''); return t.value; };
function trendNews() {
  try { const c = JSON.parse(localStorage.getItem(TREND_KEY) || 'null'); if (c && Date.now() - c.at < TREND_TTL && c.items.length) return Promise.resolve(c.items); } catch { /* 없음 */ }
  if (_trendP) return _trendP;
  _trendP = (async () => {
    const got = await mapLimit(TREND_QS, 3, async (q) => { try { return await proxyOnlyGet('naverNews', { query: q, display: '20', sort: 'date' }); } catch { return null; } });
    const seen = new Set(), items = [];
    got.forEach((d) => ((d && d.items) || []).forEach((it) => {
      const title = trendDecode(it.title), desc = trendDecode(it.description);
      if (!/화장품|뷰티|코스메틱|K-?뷰티/i.test(title + desc)) return;
      const k = title.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 24);
      if (!k || seen.has(k)) return; seen.add(k);
      const link = it.originallink || it.link || '';
      let host = ''; try { host = new URL(link).hostname.replace(/^(www|m|news)\./, ''); } catch { /* 무시 */ }
      const topic = (TREND_TOPICS.find(([, re]) => re.test(title)) || TREND_TOPICS.find(([, re]) => re.test(desc)) || ['업계'])[0];
      items.push({ title, desc: desc.slice(0, 150), link, host, at: Date.parse(it.pubDate) || 0, topic });
    }));
    items.sort((a, b) => b.at - a.at);
    const out = items.slice(0, 15);
    if (out.length) { try { localStorage.setItem(TREND_KEY, JSON.stringify({ at: Date.now(), items: out })); } catch { /* 저장 못 해도 표시 */ } }
    _trendP = null;
    return out;
  })();
  return _trendP;
}
const trendWhen = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, m)}분 전`;
  if (m < 24 * 60) return `${Math.round(m / 60)}시간 전`;
  const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
// 로딩 화면 — 진행 문구 + 업계 소식 자리
function loadingHtml(msg) {
  return `<div class="empty loadmsg"><span class="ld-spin" aria-hidden="true"></span>${msg}</div>`
    + (getProxy() ? '<div class="trend" data-trend aria-live="off"><div class="tr-h">기다리는 동안 — 화장품 제조업 최신 소식</div><div class="tr-wait">소식을 불러오는 중…</div></div>' : '');
}
function mountTrend(root) {
  const box = root && root.querySelector('[data-trend]');
  if (!box) return;
  trendNews().then((items) => {
    if (!box.isConnected) return;
    if (!items.length) { box.remove(); return; }
    let i = 0, paused = false;
    const feat = items.slice(0, 6), rest = items.slice(6, 12);
    const paint = () => {
      const a = feat[i];
      box.innerHTML = '<div class="tr-h">기다리는 동안 — 화장품 제조업 최신 소식 <small>기사는 새 탭에서 열려요 · 조회는 계속됩니다</small></div>'
        + `<a class="tr-card" href="${esc(a.link)}" target="_blank" rel="noopener"><span class="tr-topic">${esc(a.topic)}</span>`
        + `<b class="tr-title">${esc(a.title)}</b><span class="tr-desc">${esc(a.desc)}</span>`
        + `<span class="tr-meta">${esc([a.host, trendWhen(a.at)].filter(Boolean).join(' · '))} · 원문 읽기 ↗</span></a>`
        + `<div class="tr-nav"><button type="button" class="tr-btn" data-tr="-1" aria-label="이전 기사">‹</button>`
        + feat.map((_, k) => `<button type="button" class="tr-dot${k === i ? ' on' : ''}" data-tr-go="${k}" aria-label="${k + 1}번째 기사"></button>`).join('')
        + `<button type="button" class="tr-btn" data-tr="1" aria-label="다음 기사">›</button></div>`
        + (rest.length ? '<ul class="tr-list">' + rest.map((r) => `<li><span class="tr-topic sm">${esc(r.topic)}</span>`
          + `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a><small>${esc(trendWhen(r.at))}</small></li>`).join('') + '</ul>' : '');
    };
    paint();
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tr]'); if (b) { i = (i + Number(b.dataset.tr) + feat.length) % feat.length; paint(); return; }
      const g = e.target.closest('[data-tr-go]'); if (g) { i = Number(g.dataset.trGo); paint(); }
    });
    box.addEventListener('pointerenter', () => { paused = true; });
    box.addEventListener('pointerleave', () => { paused = false; });
    box.addEventListener('focusin', () => { paused = true; });
    box.addEventListener('focusout', () => { paused = false; });
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setInterval(() => {
      if (!box.isConnected) { clearInterval(t); return; }
      if (paused || reduce || document.hidden) return;
      i = (i + 1) % feat.length; paint();
    }, 7000);
  }).catch(() => { if (box.isConnected) box.remove(); });
}

function lookup(name, bno) {
  const nm = (name || '').trim();
  const bz = (bno || '').replace(/\D/g, '');                 // 사업자번호 10자리(선택)
  const bzDisp = bz.length === 10 ? bz.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3') : '';
  const key = nm || bzDisp;                                  // 표시·최근검색용 라벨
  if (!key) return;
  pushRecent(key); renderRecent();
  const db = window.VENDOR_SAMPLES || {};
  // 샘플/정적 데이터는 업체명 기준으로만 매칭(사업자번호만 있으면 실시간 조회로)
  let report = nm ? db[nm] : null;
  if (!report && nm) {
    // 부분 일치 시도
    const hit = Object.keys(db).find((k) => k.includes(nm) || nm.includes(k));
    report = hit ? db[hit] : null;
  }
  // 식약처 실데이터(빌드타임): Actions가 시크릿으로 구운 정적 JSON에 있으면 실데이터 렌더
  if (!report && nm) {
    const hit = staticHit(nm);
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
    root.innerHTML = loadingHtml(`금융위·식약처 실시간 조회 중… 「${esc(key)}${nm && bz ? ` · 사업자 ${bzDisp}` : ''}」`);
    mountTrend(root);
    // 업체명 + 사업자번호 병기 → liveLookup이 사업자번호 일치 법인만 선별(교집합)
    const liveQuery = [nm, bz].filter(Boolean).join(' ');
    // 옛 코드 확인과 조회를 동시에 시작한다 — 옛 코드면 어차피 새로고침되고, 아니면 기다린 만큼 손해다
    const liveP = liveLookup(liveQuery);
    liveP.catch(() => {});
    reloadIfStale(nm, bz).then((stale) => stale ? new Promise(() => {}) : liveP)
      .then((res) => { if (res.candidates) renderCandidates(res.name, res.candidates, res.source, res.similar); else render(res.report); })
      .catch((e) => {
        root.innerHTML =
          `<div class="empty">실데이터 조회 실패: ${esc(e.message)}<br>` +
          `<span style="font-size:12.5px">프록시 주소·키·API 승인을 확인하세요. 데모 데이터로 대체하려면 아래를 누르세요.</span><br><br>` +
          `<button class="act" id="fallbackBtn">데모 리포트 보기</button></div>`;
        const fb = $('#fallbackBtn');
        if (fb) fb.addEventListener('click', () => render(window.generateReport(nm || key)));
      });
    return;
  }
  // 범용성: 미등록 업체명은 이름 기반으로 데모 리포트 자동 생성
  if (!report && window.generateReport) report = window.generateReport(nm || key);
  if (!report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">업체명을 입력하세요.</div>`;
    return;
  }
  render(report);
}

// 고정 머리줄 높이 → 리포트 탭 줄이 그 바로 아래에 붙도록(--topbar-h). 탭 줄이 붙으면 그림자를 준다.
function trackStickyBars() {
  const tb = document.querySelector('.topbar');
  const setH = () => document.documentElement.style.setProperty('--topbar-h', `${tb ? tb.offsetHeight : 0}px`);
  setH();
  if (tb && window.ResizeObserver) new ResizeObserver(setH).observe(tb);
  const onScroll = () => {
    const bar = document.querySelector('.rtabs');
    if (!bar) return;
    const topH = tb ? tb.offsetHeight : 0;
    bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= topH + 0.5 && window.scrollY > 0);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// 첫 화면(대시보드)으로 — 리포트는 지우지 않고 감춘다(최근 검색에서 다시 열 수 있다)
function goHome() {
  const root = $('#report');
  if (root) root.classList.add('hidden');
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const g = document.getElementById('growth');
  if (g) { g.classList.remove('enter'); void g.offsetWidth; g.classList.add('enter'); }
}

document.addEventListener('DOMContentLoaded', () => {
  trackStickyBars();
  // 로딩 화면용 업계 소식을 미리 받아 둔다(3시간 보관) — 조회를 누른 순간 바로 보이게
  if (getProxy()) setTimeout(() => { trendNews().catch(() => {}); }, 2500);
  const hb = $('#homeBtn');
  if (hb) hb.addEventListener('click', goHome);
  const logo = document.querySelector('.topbar .logo');
  if (logo) { logo.style.cursor = 'pointer'; logo.title = '첫 화면 대시보드로'; logo.addEventListener('click', goHome); }
  loadStaticIndex(); // 식약처 실데이터 인덱스 미리 로드 (있으면)

  // ?proxy= 로 들어오면 저장 (프록시 자동 연결)
  const pParam = new URLSearchParams(location.search).get('proxy');
  if (pParam !== null) { setProxy(pParam.trim()); }

  // 테마 버튼 — 밝게 / 어둡게 / 기기 설정 따름
  document.querySelectorAll('[data-set-theme]').forEach((b) => {
    b.addEventListener('click', () => setTheme(b.getAttribute('data-set-theme')));
  });
  syncThemeUI();

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
      const bnoEl2 = $('#bno');
      const bz2 = bnoEl2 ? bnoEl2.value.trim() : '';
      if (q || bz2) lookup(q, bz2);
    });
    setProxyUI();
  }

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    const bnoEl = $('#bno');
    const bz = bnoEl ? bnoEl.value.trim() : '';
    if (!q && !bz) { // 빈 검색 = 초기화(저장 리포트 삭제 후 초기 화면)
      _sls(LAST_KEY, '');
      currentReport = null;
      const root = $('#report'); root.classList.add('hidden'); root.innerHTML = '';
      return;
    }
    lookup(q, bz);
  });
  renderRecent(); // 최근 검색 칩 초기 표시

  // 실행 중인 스크립트 빌드를 화면에 남긴다 — 배포했는데 브라우저가 옛 캐시를 쓰는 경우를
  // 눈으로 구분하지 못해 원인 추적이 여러 번 헛돌았다. 자기 <script src>에서 버전을 읽는다.
  // 지금까지는 <script src>의 ?v=를 읽어 찍었다. 그런데 그 번호는 '요청한 주소'일 뿐,
  // 돌고 있는 코드가 아니다. 이 파일 안에 박은 상수라야 실제로 실행 중인 코드를 가리킨다.
  const stamp = $('#buildStamp');
  if (stamp) stamp.textContent = `build v${BUILD}`;

  // ── 옛 코드가 도는지 스스로 확인한다 ──
  // 캐시 사슬이 이렇게 이어진다: 브라우저에 index.html이 남아 있으면 그 안의 옛 주소
  // (app.js?v=118)를 다시 요청하고, 그 주소는 7일 캐시라 옛 파일이 그대로 나온다. 배포는
  // 됐는데 화면만 예전인 상태가 되고, 겉으로는 구분이 안 된다 — 실제로 v119를 올린 뒤
  // 4시간 반이 지난 조회에서도 v118 결과가 나왔다. index.html만 캐시 없이 다시 받아
  // 배포된 번호와 대조하면 이 상태를 잡아낼 수 있다.
  showStaleBar();
  // 탭을 오래 열어 두면 그사이 배포가 나간다 — 탭으로 돌아올 때마다 다시 확인
  document.addEventListener('visibilitychange', () => { if (!document.hidden) showStaleBar(); });

  // 조회 직전 새로고침으로 넘어온 경우 — 입력했던 업체를 그대로 이어서 조회한다
  const qp = new URLSearchParams(location.search);
  if (qp.get('q') || qp.get('bno')) {
    const q0 = qp.get('q') || '', b0 = qp.get('bno') || '';
    $('#q').value = q0; const be = $('#bno'); if (be) be.value = b0;
    history.replaceState(null, '', location.pathname);
    lookup(q0, b0);
    return;
  }

  // 마지막 조회 리포트 복원 — 새로고침·탭 복귀·재방문 시 그대로 표시(새 업체 조회 시 교체)
  const last = loadLastReport();
  if (last && last.meta && last.meta.vendor_name) {
    $('#q').value = last.meta.vendor_name;
    render(last, { noScroll: true });
  }
});
