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
  corp:      { name: 'corpNm', bzno: 'bzno' }, // 상호 또는 사업자등록번호로 조회
  finance:   { crno: 'crno', rows: 'numOfRows', page: 'pageNo', year: 'bizYear' },
  rpt:       { name: 'entp_name', rows: 'numOfRows' },
  npsSearch: { name: 'wkplNm', bz: 'bzowrRgstNo' }, // 국민연금 V2 — camelCase
  npsDetail: { seq: 'seq', ym: 'dataCrtYm' },
  maker:     { name: 'bssh_nm', rows: 'numOfRows' },
  gmp:       { rows: 'numOfRows' }, // 적합업체 현황(목록형) — 전체 받아 프론트에서 업체명 필터
  factory:   { name: 'cmpnyNm', rows: 'numOfRows' }, // 산단공 공장등록 — 회사명 검색
  recall:    { rows: 'numOfRows' }, // 화장품 회수·판매중지 — 목록형, 프론트에서 업체명 필터
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
// 2개 이상 매칭되면 '확정 제안'. 포털·블로그·쇼핑·구인 도메인은 후보에서 제외.
const HP_SKIP = /(^|\.)(naver|daum|kakao|tistory|blog|cafe|youtube|instagram|facebook|linkedin|jobkorea|saramin|wanted|incruit|catch|nicebizinfo|wikipedia|namu\.wiki|google|11st|coupang|gmarket|auction|ssg|smartstore|blogspot|medium|threads|x)\./i;
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
function extractLinks(html, baseUrl) {
  let origin = ''; try { origin = new URL(baseUrl).origin; } catch { return []; }
  const out = []; const re = /<a\b[^>]*href\s*=\s*["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && out.length < 80) {
    let abs; try { abs = new URL(m[1], baseUrl).href; } catch { continue; }
    if (!/^https?:/i.test(abs)) continue;
    try { if (new URL(abs).origin !== origin) continue; } catch { continue; }
    out.push({ href: abs, anchor: htmlToText(m[2]) });
  }
  return out;
}
// 생산능력 관련 문장 발췌 (키워드 + 숫자가 함께 있는 짧은 구절)
function extractCapaSnippets(text) {
  const parts = String(text).split(/\n+|[.。!?]\s|\s{3,}/).map((s) => s.trim()).filter(Boolean);
  const KEY = /(생산\s*능력|생산량|월\s*생산|연간?\s*생산|일\s*생산|생산\s*라인|자동화\s*라인|충전\s*라인|생산\s*설비|생산\s*시설|공장\s*면적|연면적|부지|대지\s*면적|생산\s*규모|생산\s*capa|capacity|㎡|평)/i;
  const NUM = /\d/;
  const out = [];
  for (const p of parts) {
    if (p.length < 5 || p.length > 140) continue;
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
async function gatherSiteText(baseUrl, companyName) {
  const got = await fetchPageSmart(baseUrl);
  const html = got.html;
  if (!html) return null;
  baseUrl = got.url || baseUrl;                 // 실제로 열린 주소 기준으로 링크 해석
  const first = harvestFromHtml(html, baseUrl);
  const texts = [first.text]; const pages = [baseUrl];
  const REL = /(인증|certif|품질|quality|생산|시설|facilit|공장|factory|설비|장비|equip|회사\s*소개|about|company|연구|R&?D|사업|business|수출|export|product|제품|브랜드|brand|오시는|contact)/i;
  const seen = new Set([baseUrl.replace(/\/+$/, '')]); const targets = [];
  for (const l of extractLinks(html, baseUrl)) {
    const key = l.href.replace(/\/+$/, ''); if (seen.has(key)) continue;
    if (REL.test(l.anchor) || REL.test(l.href)) { targets.push(l.href); seen.add(key); }
    if (targets.length >= 5) break;
  }
  // 본문이 빈약(SPA 껍데기)하면 흔한 회사소개 경로를 추측해 추가 시도
  if (first.bodyLen < 400 && targets.length < 3) {
    for (const p of ['/about', '/company', '/sub/company', '/company.html', '/about.html', '/introduce', '/kr/company']) {
      try { const u = new URL(p, baseUrl).href; if (!seen.has(u.replace(/\/+$/, ''))) { targets.push(u); seen.add(u.replace(/\/+$/, '')); } } catch { /* 무시 */ }
      if (targets.length >= 5) break;
    }
  }
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
  { grp: '시설·안전', re: /(클린룸|클린벤치|공조설비|항온항습|국소배기장치|국소배기|집진설비|집진기|방폭설비|방폭인증|폐수처리설비|대기오염방지시설|압력용기\s?검사|소방시설|위험물관리|SUS\s?316L|SUS\s?304|데드레그|클린유틸리티|압축공기\s?품질관리|정제수\s?품질관리|스마트팩토리|MES|ERP|제조실행시스템)/gi },
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

async function siteDeepHeuristic(name, hpUrl) {
  let baseUrl = hpUrl;
  if (!baseUrl) { // 홈페이지 미확보 시 검색으로 확보
    const hp = await findHomepage(name, {}).catch(() => null);
    baseUrl = hp && hp.proposed ? hp.proposed.url : null;
  }
  if (!baseUrl) return { data: null, source: 'heuristic', reason: '홈페이지 미확보 — 아래에 주소를 직접 입력하면 분석합니다' };
  const g = await gatherSiteText(baseUrl, name);
  if (!g || !g.text) return { data: null, source: 'heuristic', reason: '페이지를 열 수 없음(주소 오류·접속 차단) — 다른 주소로 다시 시도해 보세요', base: baseUrl };
  const T = g.text;
  const arrOrNull = (a) => (a && a.length ? a : null);
  const business_type = arrOrNull(['OEM', 'ODM', 'OGM', 'OBM'].filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(T)));
  const quality_certifications = arrOrNull(CERT_PATTERNS.filter((c) => c.re.test(T)).map((c) => c.label));
  const product_categories = arrOrNull(PROD_CATS.filter(([, re]) => re.test(T)).map(([l]) => l));
  const export_markets = arrOrNull(EXPORT_MKTS.filter((c) => new RegExp(`수출[^\\n]{0,40}${c}|${c}[^\\n]{0,10}수출|${c}\\s*(진출|법인|현지)`, 'i').test(T) || (/(수출|해외|글로벌|export)/i.test(T) && new RegExp(`\\b${c}\\b`).test(T))));
  // 집계·채용 사이트 문구가 섞여 들어오면 사실이 아닌 문장이 필드에 박히므로 걸러낸다
  const JUNK = /(공장찾기|위세브|기업정보|기업분석|신용등급|매출액순위|채용|구인|연봉|복리후생|근무환경|자동등록방지|보안절차|전화번호정보없음|정보없음|무단수집)/;
  const clean = (arr) => (arr || []).filter((s) => !JUNK.test(s));
  const equipment = arrOrNull(clean(pickSentences(T, EQUIP_RE, { cap: 6 })));
  const production_items = arrOrNull(clean(pickSentences(T, /(출시|납품|수상|대표\s*제품|주요\s*제품|베스트셀러|히트\s*상품|개발\s*완료|런칭)/i, { cap: 4 })));
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
  const certDetail = CERT_PATTERNS.filter((c) => c.re.test(T)).map((c) => {
    const ev = pickSentences(T, c.re, { cap: 1 });
    return { label: c.label, grp: c.grp, evidence: ev[0] ? ev[0].slice(0, 90) : null };
  });
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

async function findHomepage(nm, corp) {
  if (!getProxy()) return null;
  // 공장등록부에 홈페이지가 있으면 그게 공식 확정 — 웹검색보다 신뢰
  const fctHp = corp && corp.factoryHomepage ? String(corp.factoryHomepage).trim() : '';
  if (fctHp && /^https?:\/\//i.test(fctHp)) {
    let host = fctHp; try { host = new URL(fctHp).hostname.replace(/^www\./, ''); } catch {}
    const proposed = { url: fctHp, host, matches: ['공장등록부 등재'], score: 3 };
    try { proposed.extract = await extractSiteInfo(fctHp, null); } catch { /* 추출 실패 무시 */ }
    return { proposed, candidates: [] };
  }
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
    // url은 후보 '시작점'일 뿐 — fetchPageSmart가 https/http·www 변형을 시도해 실제 열리는 주소를 찾는다.
    cands.push({ url: `https://${host}`, host, origLink: it.link, title: String(it.title || '').replace(/<\/?b>/g, '') });
    if (cands.length >= 4) break;
  }
  if (!cands.length) return { proposed: null, candidates: [] };

  const nameCore = stripCorp(nm).replace(/\s/g, '');
  const rep = corp && corp.rep ? String(corp.rep).replace(/\s/g, '') : '';
  const bz = corp && corp.bzno ? String(corp.bzno).replace(/\D/g, '') : '';
  const bzFmt = bz.length === 10 ? `${bz.slice(0, 3)}-${bz.slice(3, 5)}-${bz.slice(5)}` : '';
  const addrCores = hpAddrCores(corp && corp.addr);

  const scored = await Promise.all(cands.map(async (c) => {
    // https/http · www 변형을 시도(국내 중소사 홈페이지는 http·www 전용이 흔함)
    let got = await fetchPageSmart(c.url);
    if (!got.html && c.origLink && c.origLink !== c.url) got = await fetchPageSmart(c.origLink);
    const rawHtml = String(got.html || '');
    if (!rawHtml) return { ...c, matches: [], score: 0 };
    const url = got.url || c.url;                 // 실제 열린 주소로 갱신
    const text = rawHtml.replace(/\s/g, '');
    const m = [];
    if (nameCore && text.includes(nameCore)) m.push('상호');
    if (rep && text.includes(rep)) m.push('대표자');
    if (bz && (text.includes(bz) || (bzFmt && text.includes(bzFmt)))) m.push('사업자번호');
    if (addrCores.length && addrCores.some((a) => text.includes(a))) m.push('주소');
    return { ...c, url, matches: m, score: m.length, html: rawHtml };
  }));
  scored.sort((a, b) => b.score - a.score);
  const proposed = scored[0] && scored[0].score >= 2 ? scored[0] : null; // 2개 이상 매칭 → 확정 제안
  // 확정 사이트에서만 인증·생산능력 추출(오매칭 사이트 정보 방지). 이미 받은 HTML 재사용.
  if (proposed) { try { proposed.extract = await extractSiteInfo(proposed.url, proposed.html); } catch { /* 무시 */ } }
  scored.forEach((c) => { delete c.html; }); // 원문 HTML은 저장 용량 커서 제거
  return { proposed, candidates: scored };
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

// 사업자정보 집계 사이트(비공식) 검색결과 '제목·요약'에서 대표자·사업자번호 추출 — 페이지 fetch 없이(JS렌더 회피).
// 예: marketbz 제목 "주식회사 하이브팩토리-최**...8928702413" → 대표자 최**, 사업자번호 8928702413.
const AGG_HOSTS = /(^|\.)(moneypin\.biz|bizno\.net|nicebizinfo\.|marketbz\.|cretop\.|sbiz24\.|findbiz\.|jaoms\.|ktdb\.|wgbiz\.)/i;
async function aggLookup(nm) {
  if (!getProxy() || !nm) return null;
  const nk = stripCorp(nm).replace(/\s/g, '');
  let web;
  try { web = await proxyOnlyGet('naverWeb', { query: `${nm} 화장품`, display: '25' }); } catch { return null; }
  const items = (web && web.items) || [];
  let bzno = null, rep = null, host = null, url = null, corpName = null;
  for (const it of items) {
    let h = ''; try { h = new URL(it.link).hostname; } catch { continue; }
    const t = (String(it.title || '') + ' ' + String(it.description || '')).replace(/<\/?b>/g, '');
    if (nk.length >= 2 && !t.replace(/\s/g, '').includes(nk)) continue; // 상호 불일치 배제
    const isAgg = AGG_HOSTS.test(h);
    const bm = t.match(/(\d{3})-(\d{2})-(\d{5})/) || t.match(/(?<!\d)(\d{10})(?!\d)/);
    const rm = t.match(/대표자?\s*[:\-]?\s*([가-힣]{2,4}\*{0,2})/) || t.match(/[가-힣]{2,}\s*[-·]\s*([가-힣]{1,3}\*{1,2})/);
    // 집계 도메인이거나, (사업자번호 + 대표자) 둘 다 담긴 신뢰 결과만 채택
    if (!isAgg && !(bm && rm)) continue;
    if (!bzno && bm) bzno = bm[0].replace(/\D/g, '');
    if (!rep && rm) rep = rm[1];
    // 법인 형태 상호(주식회사/(주)) 포착 → 금융위 재검색용
    if (!corpName) { const cm = t.match(/((?:주식회사|㈜|\(주\))\s*[가-힣A-Za-z0-9]{2,}|[가-힣A-Za-z0-9]{2,}\s*(?:주식회사|㈜))/); if (cm && cm[1].replace(/\s/g, '').includes(nk)) corpName = cm[1].replace(/\s+/g, ' ').trim(); }
    if (!host && (bm || rm)) { host = h.replace(/^www\./, ''); url = it.link; } // 실제 값 나온 사이트로 귀속
    if (bzno && rep && corpName) break;
  }
  // 찾은 집계 상세페이지를 fetch해 개업일·업종·전화·영업상태 추가 추출(SSR 사이트면 성공, JS렌더면 제목값만)
  let opneDe = null, bizType = null, status = null, tel = null;
  if (url) {
    try {
      const page = await proxyOnlyGet('fetchPage', { url });
      const text = htmlToText((page && page.text) || '');
      if (text && (nk.length < 2 || text.replace(/\s/g, '').includes(nk))) {
        const g = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
        const od = g(/(?:개업일자?|설립일자?|등록일자?|사업자?\s*등록일)\s*[:：]?\s*(\d{4}[-.]\s?\d{1,2}[-.]\s?\d{1,2})/);
        opneDe = od ? od.replace(/\s/g, '') : null;
        // 업종은 집계 페이지 광고/랭킹 위젯 텍스트를 오추출("건설업" 등)할 위험이 커서 추출 안 함(식약처 기준 사용)
        tel = g(/(?:전화|연락처|대표전화|TEL)\s*[:：]?\s*(0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4})/i) || g(/(0\d{1,2}-\d{3,4}-\d{4})/);
        status = /폐업일자|폐업\s|폐업$/.test(text) ? '폐업(추정)' : (/계속사업자|정상영업|영업중/.test(text) ? '계속사업자(추정)' : null);
        if (!bzno) { const m = text.match(/(\d{3})-(\d{2})-(\d{5})/); if (m) bzno = m[0].replace(/\D/g, ''); }
        if (!rep) { const m = text.match(/(?:대표자명?|대표이사)\s*[:：]?\s*([가-힣]{2,4}\*{0,2})/); if (m) rep = m[1]; }
      }
    } catch { /* 페이지 fetch 실패(JS렌더 등) — 제목 추출값만 사용 */ }
  }
  return (bzno || rep || corpName || opneDe) ? { host: host || '웹검색', url, bzno, rep, corpName, opneDe, bizType, status, tel } : null;
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
// 지저분한 주소(괄호·"834층" 같은 상세)를 점진적으로 단순화하며 좌표변환 시도
async function kakaoGeocodeFlex(addr) {
  const base = String(addr || '');
  const noParen = base.replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  const noDetail = noParen.replace(/[\s,·]*\d*\s*(층|호|호실)\D*$/, '').trim();
  for (const a of [...new Set([base, noParen, noDetail])]) {
    if (!a) continue;
    const r = await kakaoGeocode(a).catch(() => null);
    if (r) return r;
  }
  return null;
}
async function kakaoTravel(destAddr) {
  if (!getProxy()) throw new Error('프록시 미설정');
  if (!destAddr) throw new Error('방문 주소 없음');
  if (!_kolmarCoord) _kolmarCoord = await kakaoGeocode(KOLMAR_ADDR); // 실패(401 등) 시 여기서 throw
  if (!_kolmarCoord) throw new Error('기준점(한국콜마) 좌표 변환 실패');
  const dest = await kakaoGeocodeFlex(destAddr);
  if (!dest) throw new Error(`방문지 좌표 변환 실패: ${destAddr}`);

  // 1순위: 모빌리티 실측
  try {
    const dir = await proxyOnlyGet('kakaoDirections', {
      origin: `${_kolmarCoord.lng},${_kolmarCoord.lat}`,
      destination: `${dest.lng},${dest.lat}`,
    });
    const route = dir && dir.routes && dir.routes[0];
    if (route && (route.result_code == null || route.result_code === 0) && route.summary) {
      return { km: Math.round(route.summary.distance / 1000), min: Math.round(route.summary.duration / 60), method: 'navi', dest, destAddr };
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
// 식약처 화장품제조업(CsmtcsMfcrtrInfoService01) — 약 200만건, 서버측 상호(업소명) 필터가 필수.
// 문제: 정확한 요청 파라미터명이 명세 비공개라 불확실. 잘못된 키는 API가 무시하고 일반(무필터)
//        목록을 주고, '올바른 키'만 상호로 필터됨. → 후보 키들을 병렬로 시도해 결과를 합치면,
//        올바른 키가 준 '이 업체 레코드'가 포함되고 matchByName이 그것만 정확히 집어냄(할루시네이션 없음).
// 주의: numOfRows 최대 500(초과 시 전체 호출 거부). 각 후보 500건.
const MAKER_NAME_PARAMS = ['bssh_nm', 'Bssh_Nm', 'BSSH_NM', 'entpName', 'entp_name', 'prmisnEntpNm'];
async function makerLookup(nm) {
  const settled = await Promise.allSettled(
    MAKER_NAME_PARAMS.map((p) => proxyOnlyGet('maker', { [p]: nm, numOfRows: '500' })),
  );
  const merged = [];
  const seen = new Set();
  let anyOk = false, lastErr = '';
  for (const s of settled) {
    if (s.status !== 'fulfilled') { lastErr = String(s.reason && s.reason.message || s.reason); continue; }
    anyOk = true;
    const list = listOf(s.value, ['response.body.items.item', 'body.items', 'items']);
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
  return { items: merged };
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
  if (!cands.length) {
    for (const v of [`주식회사 ${name}`, `${name} 주식회사`, `(주)${name}`]) {
      cands = await tryCorp(v);
      if (cands.length) break;
    }
  }

  if (cands.length === 1) return { report: await finishLive(name, cands[0]) };
  if (cands.length >= 2) return { candidates: cands, name, source: 'fsc' };

  // 금융위 법인 0건(애매·개인사업자·명칭불일치) → 식약처 등록업체 기준 추천
  const mfdsC = await mfdsCandidates(name);
  if (mfdsC.length >= 2) return { candidates: mfdsC, name, source: 'mfds' };
  if (mfdsC.length === 1) return { report: await finishLiveMfds(name, mfdsC[0]) };

  // 식약처에도 후보 없음 → 상호명 기반으로 나머지 소스 최대한 조회
  return { report: await finishLive(name, { corpNm: name }) };
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
    return gn.length >= 3 && gn.includes(key);
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
  if (maxY && maxY < nowY - 1) {
    const probes = [];
    for (let y = nowY - 1; y > maxY && probes.length < 6; y--) probes.push(y);
    const got = await Promise.allSettled(probes.map((y) =>
      proxyGet('finance', { crno, year: String(y), rows: '100' })));
    got.forEach((g) => { if (g.status === 'fulfilled') all.push(...listOf(g.value, paths)); });
  }
  if (!all.length) throw new Error('재무 레코드 없음');
  return { body: { items: all } };       // assembleLiveReport의 listOf가 읽는 형태로 반환
}

// 2단계: 선택된 업체의 재무·식약처·국민연금·제조업 병렬 조회 → 진단 포함 조립
async function finishLive(name, corp) {
  const nm = stripCorp(corp.corpNm || name);
  const calls = {
    finance: corp.crno ? financeLookup(corp.crno) : Promise.reject(new Error('법인등록번호 없음')),
    rpt: proxyGet('rpt', { name: nm, rows: '100' }),
    nps: npsLookup(nm, corp.bzno),
    maker: makerLookup(nm),
    gmp: proxyGet('gmp', { rows: '500' }),
    factory: proxyGet('factory', { name: nm, rows: '30' }),
    recall: proxyGet('recall', { rows: '500' }),
    nts: corp.bzno ? proxyOnlyGet('ntsStatus', { b_no: String(corp.bzno).replace(/\D/g, '') }) : Promise.reject(new Error('사업자번호 없음')),
    naverNews: proxyOnlyGet('naverNews', { query: nm, display: '30', sort: 'date' }),
    // 제조원 역추적 — 이 업체를 '제조원/제조사'로 표기한 웹문서(납품 브랜드·제품 추정)
    oemTrace: proxyOnlyGet('naverWeb', { query: `${nm} 제조원`, display: '10' }),
    // 외부 집계(marketbz 등) 비공식 보강 — 사용자 요청으로 비활성화(공식 data.go.kr API 자료만 신뢰).
    bizAgg: Promise.resolve(null),
  };
  const keys = Object.keys(calls);
  const settled = await Promise.allSettled(keys.map((k) => calls[k]));
  const res = {};
  keys.forEach((k, i) => {
    res[k] = settled[i].status === 'fulfilled'
      ? { ok: true, data: settled[i].value }
      : { ok: false, err: String(settled[i].reason && settled[i].reason.message || settled[i].reason) };
  });

  // ── 2차 보완 — 1차에서 확보한 사업자번호로 막혔던 소스 재조회(서로 보완해 채우기) ──
  if (!corp.bzno) {
    const mkR = res.maker && res.maker.ok ? listOf(res.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
    const fcR = res.factory && res.factory.ok ? listOf(res.factory.data, ['response.body.items.item', 'body.items', 'items']) : [];
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

  // 카카오 실측 이동거리 — 공장(산단공) > 식약처 제조소 > 본점 순으로 방문지 선택.
  const fList = res.factory && res.factory.ok ? listOf(res.factory.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const fHit = matchByNameApp(name, fList) || (fList.length === 1 ? fList[0] : null); // 상호 일치 건만(단건이면 그대로)
  const fAddr = fHit ? (fHit.rnAdres ?? fHit.lnmAdres ?? fHit.lotNoAddr ?? fHit.roadNmAddr ?? fHit.adres ?? fHit.ADRES ?? fHit.fctryAddr ?? null) : null;
  const mList = res.maker && res.maker.ok ? listOf(res.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const looksAddr = (v) => /[가-힣]{2,}(시|군|구|읍|면)\s|[가-힣]+(로|길)\s?\d/.test(String(v || ''));
  const mkHit = matchByNameApp(name, mList); // 상호 일치 건만(남의 회사 주소 오염 방지)
  const mAddr = mkHit ? (mkHit.ADDR ?? mkHit.SITE_ADDR ?? mkHit.LOCP_ADDR ?? mkHit.locplc ?? Object.values(mkHit).find(looksAddr) ?? null) : null;
  const visitAddr = fAddr || mAddr || corp.addr || null;
  let travel = null, kakaoErr = null;
  try { travel = await kakaoTravel(visitAddr); }
  catch (e) { kakaoErr = e && e.message ? e.message : String(e); }
  res.kakao = travel
    ? { ok: true, data: travel }
    : { ok: false, err: `${kakaoErr || '실패'} — 추정치 대체` };

  return window.assembleLiveReport(corp.corpNm || name, corp, res);
}

// 동명업체 선택 UI — source: 'fsc'(금융위 법인) | 'mfds'(식약처 등록업체 기준)
function renderCandidates(name, cands, source) {
  const root = $('#report');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const isMfds = source === 'mfds';
  const box = el('div', 'candbox');
  const headSrc = isMfds ? '식약처 화장품제조업 등록업체 기준' : '금융위 법인 기준';
  box.appendChild(el('div', 'candhead',
    `「${esc(name)}」 ${isMfds ? '식약처 등록업체' : '동명·유사 업체'} <b>${cands.length}건</b> — 조회할 업체를 선택하세요` +
    `<span class="candsub">${esc(headSrc)}${isMfds ? ' · 금융위 법인 미검색이라 식약처 등록명으로 추천' : ''}</span>`));
  cands.forEach((c) => {
    const card = el('button', 'cand');
    const meta = [
      c.rep ? '대표 ' + esc(c.rep) : '',
      c.bzno ? '사업자 ' + esc(c.bzno) : '',
      c.lcns ? '허가 ' + esc(c.lcns) : '',
      c.addr ? esc(c.addr) : '',
    ].filter(Boolean).join(' · ');
    const tag = c.mfds ? '<span class="cand-tag">식약처 등록</span>' : '';
    card.innerHTML = `<div class="cn">${esc(c.corpNm || '(상호미상)')}${tag}</div><div class="cm">${meta || '추가정보 없음'}</div>`;
    card.addEventListener('click', async () => {
      root.innerHTML = `<div class="empty">「${esc(c.corpNm || name)}」 나머지 카테고리 조회 중…</div>`;
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
    : (isGap ? '해당 없음' : esc(fld.value)) + stale + info;
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

// ═══ 체크 필요사항 ① 기준정보 기반 ═══
// 리스크 플래그 + 회수·판매중지 + 교차검증 자동진단을 하나로 통합.
// 공식 API(국세청·식약처·금융위·국민연금·산단공) 값끼리 대조해 나온 '확인 필요' 항목.
function renderCheckOfficial(report) {
  const flags = report.risk_flags || [];
  const recalls = report.recalls || [];
  const cd = report.cross_diag;
  const cdItems = (cd && cd.items) || [];
  if (!flags.length && !recalls.length && !cdItems.length) return null;

  const rows = []; // {sev, tag, label, detail}
  // 1) 회수·판매중지 — 품질/안전 최우선
  recalls.slice(0, 8).forEach((r) => {
    rows.push({ sev: 'bad', tag: '회수·판매중지',
      label: [r.date, r.product].filter(Boolean).join(' · ') || '이력 확인',
      detail: r.reason || '식약처 회수·판매중지 이력 — 원인·재발방지책 확인' });
  });
  // 2) 리스크 플래그(국세청 상태·재무 등) — 회수는 위에서 이미 표기했으므로 중복 제외
  flags.filter((fl) => !/회수|판매중지/.test(fl.type || '')).forEach((fl) => {
    rows.push({ sev: 'bad', tag: fl.type || '리스크', label: fl.detail || '', detail: '' });
  });
  // 3) 교차검증 — 불일치(warn)는 확인필요, 일치(match)/대조불가(na)는 정합성 근거로 표시
  cdItems.forEach((c) => {
    rows.push({ sev: c.status === 'warn' ? 'warn' : (c.status === 'match' ? 'ok' : 'na'),
      tag: c.label, label: c.detail || '', detail: '' });
  });

  const need = rows.filter((r) => r.sev === 'bad' || r.sev === 'warn').length;
  const box = el('div', 'chkbox chk-official');
  let html = `<h3>🏛 체크 필요사항 <b>· 기준정보 기반</b>` +
    `<span class="chk-sum ${need ? 'on' : ''}">${need ? `확인 필요 ${need}건` : '특이사항 없음'}</span></h3>` +
    `<div class="chk-note">공식 API(국세청·식약처·금융위·국민연금·산단공) 값을 서로 대조한 결과입니다.</div>`;
  html += '<ul class="chk-list">';
  rows.forEach((r) => {
    const ic = r.sev === 'bad' ? '⚠' : r.sev === 'warn' ? '⚠' : r.sev === 'ok' ? '✓' : '—';
    html += `<li class="chk-${esc(r.sev)}">` +
      `<span class="chk-ic">${ic}</span>` +
      `<span class="chk-tag">${esc(r.tag)}</span>` +
      `<span class="chk-body">${esc(r.label)}${r.detail ? `<em>${esc(r.detail)}</em>` : ''}</span>` +
      `</li>`;
  });
  html += '</ul>';
  box.innerHTML = html;
  return box;
}

// ═══ 체크 필요사항 ② 웹 기반 ═══
// 뉴스 신호 타임라인 + 웹 언급 추적 + 최신 관련기사를 하나로 통합.
function renderCheckWeb(report) {
  const ins = report.insights;
  const timeline = (ins && ins.timeline) || [];
  const assess = ins && ins.assessment;
  const oem = report.oem_trace || [];
  const news = report.news || [];
  if (!timeline.length && !oem.length && !news.length) return null;

  const box = el('div', 'chkbox chk-web');
  const downs = assess ? assess.downs : 0;
  let html = `<h3>🌐 체크 필요사항 <b>· 웹 기반</b>` +
    `<span class="chk-sum ${downs ? 'on' : ''}">${downs ? `주의 신호 ${downs}건` : (timeline.length ? `신호 ${timeline.length}건` : `언급 ${oem.length + news.length}건`)}</span></h3>` +
    `<div class="chk-note">네이버 뉴스·웹문서에서 업체명이 실제 포함된 자료만 취합했습니다. 사실관계는 원문 확인 권장.</div>`;

  // 종합 판단(재량)
  if (assess) html += `<div class="chk-take ib-${esc(assess.level)}"><b>종합 판단</b> ${esc(assess.note)}</div>`;

  // ── 신호 타임라인(시점 있는 항목) ──
  if (timeline.length) {
    html += `<div class="chk-sec">신호 타임라인 <i>발행일 기준</i></div><ul class="ib-tl">`;
    timeline.forEach((t) => {
      html += `<li class="ib-${esc(t.tone)}">` +
        `<span class="ib-date">${esc(t.date || '—')}</span>` +
        `<span class="ib-tag ib-tag-${esc(t.tone)}">${esc(t.tag)}</span>` +
        `<div class="ib-body"><a href="${esc(t.link || '#')}" target="_blank" rel="noopener">${esc(t.title)}</a>` +
        (t.desc ? `<div class="ib-desc">${esc(t.desc)}</div>` : '') + `</div></li>`;
    });
    html += '</ul>';
  }

  // ── 웹 언급 추적(제조원·채용·기업보고서) ──
  if (oem.length) {
    html += `<div class="chk-sec">웹 언급 추적 <i>활동·거래 단서</i></div><ul class="ot-list">`;
    oem.forEach((o) => {
      const tagCls = o.tag === '채용' ? 'ot-hire' : o.tag === '기업보고서' ? 'ot-report' : o.tag === '제조원/납품' ? 'ot-oem' : 'ot-etc';
      const t = o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener">${esc(o.title || o.link)}</a>` : esc(o.title || '');
      html += `<li><div class="ot-t"><span class="ot-tag ${tagCls}">${esc(o.tag || '언급')}</span>${t}</div>` +
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
        `<div class="nmeta">${esc(date)}</div></li>`;
    });
    html += '</ul>';
  }
  box.innerHTML = html;
  return box;
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
    // 🏭 홈페이지 발췌 — 생산능력·인증(자동추출). 홈페이지 게재값이라 방문 시 원본 확인 필요.
    const ex = p.extract;
    if (ex && (ex.certs.length || ex.capa.length || ex.oemOdm.length)) {
      html += `<div class="hp-ext"><div class="hp-ext-h">🏭 홈페이지 발췌 <span>자동추출 · 게재정보(방문 시 인증서 원본 확인)</span></div>`;
      if (ex.oemOdm.length) html += `<div class="hp-row"><i>생산모델</i><span>${ex.oemOdm.map((o) => `<b class="hp-tag">${esc(o)}</b>`).join(' ')}</span></div>`;
      if (ex.certs.length) html += `<div class="hp-row"><i>인증</i><span>${ex.certs.map((c) => `<b class="hp-cert">${esc(c)}</b>`).join(' ')}</span></div>`;
      if (ex.capa.length) html += `<div class="hp-row"><i>생산능력</i><ul class="hp-capa">${ex.capa.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`;
      html += `</div>`;
    } else {
      html += `<div class="hp-ext-none">홈페이지에서 인증·생산능력 문구를 추출하지 못함 (자바스크립트 렌더링 사이트이거나 미게재 — 사이트 직접 확인)</div>`;
    }
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

// ── 🔬 홈페이지 심층분석 — 실제 생산 CAPA·인증 구조화 추출 ──
// 기본: 무료 키워드 휴리스틱(API키 불필요). 옵션: ANTHROPIC_API_KEY가 있으면 LLM 웹조사로 보강.
async function siteDeepExtract(name, url) {
  const res = await proxyOnlyGet('siteExtract', { name: name || '', url: url || '' });
  return res && res.data ? res.data : null;
}
// 오케스트레이터: 휴리스틱(항상) + LLM(키 있을 때) 병합. LLM 값 우선, 공백은 휴리스틱으로 채움.
async function siteDeepAnalyze(name, hpUrl) {
  const heur = await siteDeepHeuristic(name, hpUrl).catch(() => null);
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
    box.innerHTML = '<h4>🔬 홈페이지 심층분석 <span>홈페이지 조사 중…</span></h4>' +
      '<div class="sd-load">본문·메타·임베드 JSON·이미지 정보까지 훑어 키워드를 추출하고 있습니다…</div>';
    return;
  }
  const srcTag = state.source ? `<b class="sd-tag">${esc(SD_SRC_TAG[state.source] || state.source)}</b>` : '';
  if (state.err && !state.data) {
    box.innerHTML = `<h4>🔬 홈페이지 심층분석 ${srcTag}</h4>` +
      `<div class="sd-none">${esc(state.err)}</div>` + sdManualRow(state.base);
    return;
  }
  const d = state.data;
  if (!d) { box.innerHTML = `<h4>🔬 홈페이지 심층분석 ${srcTag}</h4><div class="sd-none">추출 결과 없음</div>` + sdManualRow(state.base); return; }
  const rows = SITE_DEEP_FIELDS
    .map((f) => ({ f, has: !(d[f.key] == null || (Array.isArray(d[f.key]) && !d[f.key].length) || d[f.key] === '') }))
    .filter((r) => r.has);
  let html = `<h4>🔬 홈페이지 심층분석 ${srcTag}<span>홈페이지 게재 정보 · 참고용(방문 시 원본 확인)</span></h4>`;
  // 수집 방식 안내 — 이미지 전용/SPA라 웹검색으로 보완했다면 명시(신뢰도 판단용)
  const hv = state.harvest;
  if (hv && (hv.thin || hv.webFallback)) {
    html += `<div class="sd-warnline">${hv.webFallback
      ? '⚠ 페이지 본문이 적어(자바스크립트 렌더링·이미지 전용) <b>키워드에 한해</b> 웹 검색 결과를 보탰습니다. ' +
        '인증·주소·사업장 등 <b>사실 항목은 홈페이지 본문에서만</b> 추출합니다.'
      : '⚠ 페이지 본문이 적어 메타·이미지·임베드 데이터에서 보조 추출했습니다.'}</div>`;
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
          `<li><span class="cert-b">${esc(c.label)}</span>` +
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
function renderCoreBand(report) {
  const B = report.basic || [], C = report.capacity || [];
  const bv = (k) => { const f = B.find((x) => x.key === k); return f && f.value ? f.value : null; };
  const cv = (k) => { const f = C.find((x) => x.key === k); return f && f.value ? f.value : null; };
  const maker = bv('제조업 등록');
  const cgmp = cv('CGMP 적합업소');
  const emp = cv('재직자수 (국민연금 가입자)');
  const bstt = bv('사업자 상태');
  const dist = cv('방문 이동거리');
  const recall = Array.isArray(report.recalls) && report.recalls.length ? report.recalls.length : 0;
  const tiles = [];
  // 제조업 등록 — 이 서비스의 핵심 지표
  tiles.push({ big: maker ? '등록' : '미확인', lab: '화장품 제조업', tone: maker ? 'good' : 'muted',
    sub: maker ? '식약처 허가' : '상호 일치 없음' });
  // CGMP
  tiles.push({ big: cgmp ? '적합' : '미등재', lab: 'CGMP 인증', tone: cgmp ? 'good' : 'muted', sub: '식약처 GMP' });
  // 재직자수
  if (emp) tiles.push({ big: String(emp).replace(/\s.*$/, ''), lab: '재직자수', tone: 'info', sub: '국민연금 기준' });
  // 사업자 상태
  if (bstt) tiles.push({ big: /계속/.test(bstt) ? '정상' : String(bstt).slice(0, 6), lab: '사업자 상태', tone: /계속/.test(bstt) ? 'good' : 'warn', sub: '국세청' });
  // 회수·판매중지 — 있으면 위험
  tiles.push({ big: recall ? `${recall}건` : '없음', lab: '회수·판매중지', tone: recall ? 'bad' : 'good', sub: '식약처 이력' });
  // 이동거리
  if (dist) tiles.push({ big: String(dist).replace(/^약\s*/, '').replace(/\s*·.*$/, ''), lab: '방문 거리', tone: 'info', sub: String(dist).match(/·\s*(.+)$/) ? RegExp.$1 : '기준점 대비' });
  const wrap = el('div', 'coreband');
  wrap.innerHTML = tiles.map((t) =>
    `<div class="ct ct-${t.tone}"><div class="ct-big">${esc(t.big)}</div><div class="ct-lab">${esc(t.lab)}</div><div class="ct-sub">${esc(t.sub)}</div></div>`).join('');
  return wrap;
}

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
  const items = []; // {pri, cat, text, why, ins}
  const add = (pri, cat, text, why, ins) => items.push({ pri, cat, text, why: why || '', ins: ins || '' });
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
// 심층분석 등 비동기 결과 도착 시 체크리스트만 제자리 갱신(전체 재렌더 없이)
function refreshVisitChecklist(report) {
  const old = document.getElementById('visitChecklist');
  if (!old) return;
  const next = renderVisitChecklist(report);
  if (!next) return;
  next.id = 'visitChecklist';
  old.replaceWith(next);
}
function renderVisitChecklist(report) {
  const items = buildVisitChecklist(report);
  if (!items.length) return null;
  const box = el('div', 'vcbox');
  const hi = items.filter((i) => i.pri === 'high').length;
  let html = `<h4>✅ 방문 전 체크리스트 <span>웹 기반(기사·채용공고·기술/인증·판매제품)에서 자동 도출 · 현장 확인용${hi ? ` · 필수 ${hi}건` : ''}</span></h4>`;
  html += '<ul class="vc-list">';
  items.forEach((it, idx) => {
    html += `<li class="vc-${esc(it.pri)}">` +
      `<input type="checkbox" id="vc${idx}"><label for="vc${idx}">` +
      `<span class="vc-pri vc-pri-${esc(it.pri)}">${esc(PRI_LABEL[it.pri])}</span>` +
      `<span class="vc-cat">${esc(it.cat)}</span>` +
      `<span class="vc-txt">${esc(it.text)}</span>` +
      (it.why ? `<span class="vc-why">📎 ${esc(it.why)}</span>` : '') +
      (it.ins ? `<span class="vc-ins">💡 ${esc(it.ins)}</span>` : '') +
      `</label></li>`;
  });
  html += '</ul>';
  html += '<div class="vc-foot">📎 = 근거(웹 출처) · 💡 = 해석 인사이트 · 우선순위: <b>필수</b>/<b>권장</b>/<b>참고</b>. ' +
    '공식 API 대조 결과는 아래 <b>🏛 체크 필요사항 · 기준정보 기반</b>을 참고하세요. 인쇄해서 방문 시 체크하세요.</div>';
  box.innerHTML = html;
  return box;
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
    const mapBtn = el('button', 'act', '🗺 카카오맵에서 공장 위치');
    mapBtn.title = `카카오맵에서 「${visitAddr}」 위치를 로드맵으로 표시`;
    mapBtn.addEventListener('click', () => window.open(`https://map.kakao.com/?q=${encodeURIComponent(visitAddr)}`, '_blank', 'noopener'));
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

  // ★ 핵심 요약 — 검증에서 가장 중요한 사실을 최상단 타일로(핵심부터 파악)
  const coreBand = renderCoreBand(report);
  if (coreBand) root.appendChild(coreBand);

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
      const sp = el('div', 'srcstat');
      sp.appendChild(el('div', 'srchead', '📡 데이터 소스 상태 <span>✓조회성공 · ✗실패 · 체크박스=리포트 포함(해제 시 제외)</span>'));
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

  // 체크 필요사항 — ① 기준정보(공식 API 대조) ② 웹(뉴스·웹문서). 근거 패널 2개로 통합.
  const chkO = renderCheckOfficial(report);
  if (chkO) root.appendChild(chkO);
  if (!excl.has('news')) { const chkW = renderCheckWeb(report); if (chkW) root.appendChild(chkW); }

  const blocks = el('div', 'blocks');
  blocks.appendChild(block('기업 기본정보', '🏢', visible(report.basic)));
  blocks.appendChild(block('생산역량 · 인원', '🏭', visible(report.capacity)));
  if (!excl.has('finance')) blocks.appendChild(financeBlock(report));

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
      const hpUrl = url || (report._homepage && report._homepage.proposed ? report._homepage.proposed.url : '');
      siteDeepAnalyze(report.meta.vendor_name, hpUrl)
        .then((state) => {
          report._siteDeep = state;
          paintDeep(report._siteDeep);
          refreshVisitChecklist(report); // 인증·제형·설비 확인항목을 체크리스트에 반영
          saveLastReport(report);
        })
        .catch((e) => { report._siteDeep = { err: e && e.message ? e.message : String(e), base: hpUrl }; paintDeep(report._siteDeep); });
    };
    if (report._homepage !== undefined) {
      renderHomepageInto(hpBox, report._homepage);
    } else {
      hpBox.innerHTML = '<h4>🔎 홈페이지 추적 <span>검색 중…</span></h4>';
      const getV = (k) => { const f = report.basic.find((x) => x.key === k); return f && f.value; };
      findHomepage(report.meta.vendor_name, { rep: getV('대표자'), addr: getV('본점주소'), bzno: getV('사업자등록번호'), factoryHomepage: report.meta.factory_homepage })
        .then((hp) => { report._homepage = hp || null; renderHomepageInto(hpBox, report._homepage); saveLastReport(report); })
        .catch(() => { report._homepage = null; renderHomepageInto(hpBox, null); saveLastReport(report); });
    }
    // 🔬 홈페이지 심층분석 — 버튼 실행(비용/시간 소요). 결과 캐시.
    const sdBox = el('div', 'sdbox');
    blocks.appendChild(sdBox);
    if (report._siteDeep && (report._siteDeep.data || report._siteDeep.err)) {
      paintDeep(report._siteDeep);
    } else {
      sdBox.innerHTML = '<h4>🔬 홈페이지 심층분석 <span>사이트 유형(정적·JS·이미지) 무관 키워드 추출 · API키 불필요</span></h4>';
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

  // 조회 리포트 저장 — 새로고침/재방문 시 복원용 (새 조회 전까지 유지)
  saveLastReport(report);

  if (!opts.noScroll) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  try { const s = _ls(LAST_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
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
    root.innerHTML = `<div class="empty">금융위·식약처 실시간 조회 중… 「${esc(key)}${nm && bz ? ` · 사업자 ${bzDisp}` : ''}」</div>`;
    // 업체명 + 사업자번호 병기 → liveLookup이 사업자번호 일치 법인만 선별(교집합)
    const liveQuery = [nm, bz].filter(Boolean).join(' ');
    liveLookup(liveQuery)
      .then((res) => { if (res.candidates) renderCandidates(res.name, res.candidates, res.source); else render(res.report); })
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

  // 마지막 조회 리포트 복원 — 새로고침·탭 복귀·재방문 시 그대로 표시(새 업체 조회 시 교체)
  const last = loadLastReport();
  if (last && last.meta && last.meta.vendor_name) {
    $('#q').value = last.meta.vendor_name;
    render(last, { noScroll: true });
  }
});
