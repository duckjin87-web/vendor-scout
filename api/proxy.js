// api/proxy.js — Vercel Serverless Function (공공 API 프록시)
//
// Vercel 환경변수(Settings → Environment Variables):
//   DATA_GO_KR_API_KEY   — data.go.kr 인증키 (필수)
//   NAVER_CLIENT_ID       — 네이버 개발자 Client ID (선택, 뉴스)
//   NAVER_CLIENT_SECRET   — 네이버 개발자 Client Secret (선택, 뉴스)

const DATAGO = {
  corp:      'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance:   'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
  // 같은 서비스의 다른 오퍼레이션 — 요약재무에 없는 연도를 계정과목 단위로 보완
  financeBs: 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getBs_V2',       // 재무상태표
  financeIs: 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getIncoStat_V2', // 손익계산서
  rpt:       'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService/getRptPrdlstInq',
  npsSearch: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getBassInfoSearchV2',
  npsDetail: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getDetailInfoSearchV2',
  maker:     'https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService01/getCsmtcsMfcrtrInfoList01',
  gmp:       'https://apis.data.go.kr/1471000/CsmtcsGmpStbltCompInfo/getCsmtcsGmpStbltCompInfo',
  factory:   'https://apis.data.go.kr/B550624/fctryRegistInfo/getFctryPrdctnService_v2', // 산단공 공장등록 생산정보 v2 — cmpnyNm 검색
  recall:    'https://apis.data.go.kr/1471000/CsmtcsRtrvlSleStpgeInfo/getCsmtcsRtrvlSleStpgeInfo', // 식약처 화장품 회수·판매중지 정보
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_HDR = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HDR });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 상류가 5xx인데 HTML 점검/오류페이지를 주면 지저분한 원문 대신 사람이 읽을 문구로 정규화
function cleanUpstreamDetail(body, status) {
  const b = String(body || '');
  if (/<!DOCTYPE|<html/i.test(b)) {
    if (status === 503) return '상대(공공데이터) 서버 점검·과부하(503) — 일시적 오류. 잠시 후 자동 정상화됩니다';
    if (status === 502 || status === 504) return `상대 서버 응답 지연(${status}) — 일시적`;
    return `상대 서버 오류(HTTP ${status})`;
  }
  return b.slice(0, 250);
}

// 상류 호출 공통 — 타임아웃·네트워크오류·비정상응답을 항상 CORS JSON으로 정규화(플랫폼 500 크래시 방지).
// 느린 공공 API에는 넉넉한 타임아웃(첫 시도 우선), 빠르게 실패하는 5xx·네트워크오류만 재시도.
// 타임아웃(느린 응답)은 재시도해도 예산만 소모하므로 재시도하지 않는다.
async function relay(target, label, init) {
  const TRANSIENT = new Set([502, 503, 504, 429]);
  const ATTEMPTS = 3, PER_MS = 19000; // 시도당 최대 19초 — data.go 느린 응답(GMP 500건 등) 수용
  const DEADLINE = Date.now() + 23000; // Edge 실행한도(≈25초) 안에서 총예산 23초
  let lastStatus = 0, lastBody = '', lastErr = '';
  for (let i = 0; i < ATTEMPTS; i++) {
    const remaining = DEADLINE - Date.now();
    if (remaining < 2000) break; // 남은 예산 부족 → 중단
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(PER_MS, remaining));
    let upstream;
    try {
      upstream = await fetch(target, { ...init, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e && e.name === 'AbortError';
      lastStatus = aborted ? 504 : 0;
      lastErr = aborted ? '타임아웃(응답 지연)' : String(e && e.message || e);
      // 네트워크 오류(즉시 실패)만 재시도. 타임아웃은 예산 크게 소모하므로 즉시 반환.
      if (!aborted && Date.now() + 1500 < DEADLINE) { await sleep(500); continue; }
      return jsonRes({ error: `${label} 상류 호출 실패`, detail: lastErr }, aborted ? 504 : 502);
    }
    clearTimeout(timer);
    const body = await upstream.text().catch(() => '');
    if (upstream.ok) return new Response(body, { status: 200, headers: JSON_HDR });
    lastStatus = upstream.status; lastBody = body;
    // 빠르게 실패하는 일시적 5xx·429만 백오프 후 재시도(점검/과부하 blip), 그 외(4xx 등)는 즉시 반환
    if (TRANSIENT.has(upstream.status) && Date.now() + 1500 < DEADLINE) { await sleep(700); continue; }
    break;
  }
  return jsonRes({ error: `${label} 상류 HTTP ${lastStatus || ''}`.trim(), upstreamStatus: lastStatus, detail: cleanUpstreamDetail(lastBody, lastStatus) }, 502);
}

// json 지정에 `type` 파라미터를 쓰는 서비스(식약처 1471000 · 산단공 공장등록 v2).
const NEEDS_TYPE = new Set(['rpt', 'maker', 'gmp', 'factory', 'recall']);
// 국민연금은 V2(camelCase) 엔드포인트 사용 — V1(getBassInfoSearch)은 폐기되어 500.
// V2는 json 지정에 `dataType` 파라미터를 쓴다(resultType/type 아님).
const NPS = new Set(['npsSearch', 'npsDetail']);

function handleDataGo(url, service, env) {
  if (!env.DATA_GO_KR_API_KEY) return jsonRes({ error: 'DATA_GO_KR_API_KEY 미설정' }, 500);
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k !== 'service' && v) q.set(k, v);
  q.set('serviceKey', env.DATA_GO_KR_API_KEY);
  if (NPS.has(service)) {
    if (!q.has('dataType'))  q.set('dataType', 'json');
    if (!q.has('pageNo'))    q.set('pageNo', '1');
    if (!q.has('numOfRows')) q.set('numOfRows', '100');
  } else {
    if (!q.has('resultType')) q.set('resultType', 'json');
    if (NEEDS_TYPE.has(service) && !q.has('type')) q.set('type', 'json');
    if (!q.has('pageNo'))     q.set('pageNo', '1');
    if (!q.has('numOfRows'))  q.set('numOfRows', '30');
  }
  return relay(`${DATAGO[service]}?${q}`, `data.go(${service})`);
}

// 네이버 검색(news/webkr/local) — kind로 엔드포인트 선택
function handleNaver(url, env, kind) {
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) return jsonRes({ error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정' }, 500);
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k !== 'service' && v) q.set(k, v);
  if (kind === 'news' && !q.has('sort')) q.set('sort', 'date');
  if (!q.has('display')) q.set('display', kind === 'news' ? '5' : '10');
  const path = kind === 'webkr' ? 'webkr' : kind === 'local' ? 'local' : 'news';
  return relay(`https://openapi.naver.com/v1/search/${path}.json?${q}`, `네이버 ${kind}`, {
    headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
  });
}

// 임의 페이지 텍스트 취득 — 홈페이지 대조·심층분석용. http(s)만, 400KB 상한(SPA 임베드 JSON 수용).
async function handleFetchPage(url) {
  const target = url.searchParams.get('url');
  if (!target || !/^https?:\/\//i.test(target)) return jsonRes({ error: 'url 파라미터(http/https) 필요' }, 400);
  // SSRF 최소 방어 — 내부/사설 호스트 차단
  let host = '';
  try { host = new URL(target).hostname; } catch { return jsonRes({ error: '잘못된 url' }, 400); }
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|::1$)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return jsonRes({ error: '내부 호스트 접근 불가' }, 400);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let up;
  try {
    up = await fetch(target, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (vendor-scout)' } });
  } catch (e) {
    clearTimeout(timer);
    return jsonRes({ error: '페이지 호출 실패', detail: String(e && e.message || e) }, 502);
  }
  clearTimeout(timer);
  const buf = await up.arrayBuffer().catch(() => null);
  const text = buf ? new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 400000) : '';
  return jsonRes({ status: up.status, url: up.url, text });
}

// 국세청 odcloud POST 공통 — 상태조회(status)·진위확인(validate)이 같은 서비스·같은 키를 쓴다.
// odcloud는 간헐적으로 500 "EOF"/503을 반환 → 고정길이 바이트 전송 + 지수 백오프 재시도.
async function odcloudPost(env, op, payload) {
  if (!env.DATA_GO_KR_API_KEY) return jsonRes({ error: 'DATA_GO_KR_API_KEY 미설정' }, 500);
  const q = new URLSearchParams({ serviceKey: env.DATA_GO_KR_API_KEY });
  const target = `https://api.odcloud.kr/api/nts-businessman/v1/${op}?${q}`;
  const bodyBytes = new TextEncoder().encode(JSON.stringify(payload));
  let lastStatus = 0, lastBody = '', lastErr = '';
  // 최대 4회, 각 5초 + 지수 백오프(0.6→1.2→2.4s). 500(EOF)·503·네트워크오류·타임아웃 모두 재시도.
  // 지수 백오프로 회복 중인 상류(odcloud 간헐 503)를 더 잘 포착. 총예산 Edge 한도(~25초) 내.
  const ATTEMPTS = 4, DEADLINE = Date.now() + 23000;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (DEADLINE - Date.now() < 2000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(5000, DEADLINE - Date.now()));
    let up;
    try {
      up = await fetch(target, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': String(bodyBytes.length) },
        body: bodyBytes,
      });
    } catch (e) {
      clearTimeout(timer);
      lastStatus = 0; lastErr = (e && e.name === 'AbortError') ? '타임아웃(5초)' : String(e && e.message || e);
      if (attempt < ATTEMPTS - 1 && DEADLINE - Date.now() > 2000) { await sleep(600 * (attempt + 1)); continue; }
      break;
    }
    clearTimeout(timer);
    const body = await up.text().catch(() => '');
    if (up.ok) return new Response(body, { status: 200, headers: JSON_HDR });
    lastStatus = up.status; lastBody = body;
    if ((up.status >= 500 || up.status === 429) && attempt < ATTEMPTS - 1 && DEADLINE - Date.now() > 2000) { await sleep(600 * (attempt + 1)); continue; }
    break; // 4xx 등은 즉시 종료
  }
  return jsonRes({ error: lastStatus ? `국세청 상류 HTTP ${lastStatus}` : `국세청 호출 실패(${lastErr || '알수없음'})`, detail: (lastBody || lastErr || '').slice(0, 300) }, 502);
}

// 사업자 상태조회 — 계속사업자/휴업/폐업
function handleNtsStatus(url, env) {
  const bno = (url.searchParams.get('b_no') || '').replace(/\D/g, '');
  if (bno.length !== 10) return jsonRes({ error: '사업자번호 10자리 필요' }, 400);
  return odcloudPost(env, 'status', { b_no: [bno] });
}

// 사업자등록 진위확인 — 사업자번호 + 개업일 + 대표자명이 국세청 등록증과 일치하는지 검증.
// 상태조회와 동일 서비스(국세청_사업자등록정보 진위확인 및 상태조회)라 추가 활용신청이 대개 불필요.
function handleNtsValidate(url, env) {
  const bno = (url.searchParams.get('b_no') || '').replace(/\D/g, '');
  const startDt = (url.searchParams.get('start_dt') || '').replace(/\D/g, '').slice(0, 8);
  const pNm = (url.searchParams.get('p_nm') || '').trim();
  if (bno.length !== 10) return jsonRes({ error: '사업자번호 10자리 필요' }, 400);
  if (startDt.length !== 8 || !pNm) return jsonRes({ error: '개업일(YYYYMMDD)·대표자명 필요' }, 400);
  return odcloudPost(env, 'validate', { businesses: [{ b_no: bno, start_dt: startDt, p_nm: pNm }] });
}

// 카카오 — 주소검색(좌표) / 길찾기(실측 거리·시간). 둘 다 REST 키 헤더 인증.
function handleKakao(url, env, kind) {
  if (!env.KAKAO_REST_KEY) return jsonRes({ error: 'KAKAO_REST_KEY 미설정' }, 500);
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k !== 'service' && v) q.set(k, v);
  const base = kind === 'geocode'
    ? 'https://dapi.kakao.com/v2/local/search/address.json'
    : 'https://apis-navi.kakaomobility.com/v1/directions';
  return relay(`${base}?${q}`, kind === 'geocode' ? '카카오 주소검색' : '카카오 길찾기', {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` },
  });
}

// 홈페이지 심층분석 — 회사 홈페이지를 웹검색·조사해 '실제 생산 CAPA·인증'을 구조화 추출.
// LLM(Anthropic)을 프록시(서버)에서 호출 → API 키는 서버 환경변수에만(브라우저 비노출).
// 공식 data.go.kr 자료와 별개의 '홈페이지 게재 정보(참고)'. 근거 없으면 null(추측 금지).
const SITE_SCHEMA = `{"company_name":null,"business_type":null,"product_categories":null,"production_items":null,"quality_certifications":null,"production_sites":null,"equipment":null,"rnd_centers":null,"export_markets":null,"hq_address":null,"phone":null,"notable":null}`;
async function handleSiteExtract(url, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY 미설정 — Vercel 환경변수에 추가하세요(홈페이지 심층분석용)' }, 501);
  const name = (url.searchParams.get('name') || '').slice(0, 80);
  const site = (url.searchParams.get('url') || '').slice(0, 300);
  if (!name && !site) return jsonRes({ error: 'name 또는 url 필요' }, 400);
  const target = site ? `회사 홈페이지: ${site} (회사명: ${name || '미상'})` : `회사명: ${name}`;
  const prompt =
`너는 화장품 OEM/ODM 제조사 정보 추출기다. 다음 대상을 웹 검색으로 조사해라. ${target}
회사소개·사업(생산)·설비·R&D·품질경영·인증 페이지를 우선 확인한다. 화장품 제조 역량 파악이 목적이다.
- business_type: ["ODM","OEM","OBM"] 중 해당하는 것들의 배열.
- product_categories: 취급 제형 카테고리(스킨케어, 색조, 마스크팩, 선케어 등) 배열.
- production_items: 대표 생산품·출시/수상 사례 등 구체 품목 배열.
- quality_certifications: CGMP, ISO22716, ISO9001, 비건, 할랄, 특허 등 인증 배열(가장 중요).
- production_sites: 생산 사업장/공장 위치·규모 배열.
- equipment: 생산설비·라인 종류/수량 배열.
- rnd_centers: R&D 연구소/기업부설연구소 배열.
- export_markets: 수출국 배열.
- hq_address, phone: 문자열.
- notable: 특이사항(대형 브랜드 납품 등) 배열.
아래 JSON 스키마 필드만 채운다. 근거 없는 필드는 반드시 null(배열도 없으면 null). 추측 금지, 확인된 사실만.
JSON만 출력. 설명·마크다운·코드펜스 금지.
${SITE_SCHEMA}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  let up;
  try {
    up = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    return jsonRes({ error: '심층분석 호출 실패', detail: (e && e.name === 'AbortError') ? '시간 초과(55초)' : String(e && e.message || e) }, 502);
  }
  clearTimeout(timer);
  const body = await up.text().catch(() => '');
  if (!up.ok) return jsonRes({ error: `심층분석 상류 HTTP ${up.status}`, detail: cleanUpstreamDetail(body, up.status) }, 502);
  let text = '';
  try {
    const j = JSON.parse(body);
    text = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  } catch { return jsonRes({ error: '심층분석 응답 파싱 실패' }, 502); }
  const mm = text.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
  if (!mm) return jsonRes({ error: '심층분석 결과에 JSON 없음', detail: text.slice(0, 200) }, 502);
  let obj;
  try { obj = JSON.parse(mm[0]); } catch { return jsonRes({ error: '심층분석 JSON 파싱 실패' }, 502); }
  return jsonRes({ ok: true, data: obj });
}

export default async function handler(req) {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405);

    const url = new URL(req.url);
    const service = url.searchParams.get('service');
    const env = process.env;

    if (service === 'naverNews')       return handleNaver(url, env, 'news');
    if (service === 'naverWeb')        return handleNaver(url, env, 'webkr');
    if (service === 'naverLocal')      return handleNaver(url, env, 'local');
    if (service === 'fetchPage')       return handleFetchPage(url);
    if (service === 'ntsStatus')       return handleNtsStatus(url, env);
    if (service === 'ntsValidate')     return handleNtsValidate(url, env);
    if (service === 'siteExtract')     return handleSiteExtract(url, env);
    if (service === 'kakaoGeocode')    return handleKakao(url, env, 'geocode');
    if (service === 'kakaoDirections') return handleKakao(url, env, 'directions');
    if (DATAGO[service])               return handleDataGo(url, service, env);

    return jsonRes({ error: `unknown service: ${service}` }, 400);
  } catch (e) {
    // 어떤 경우에도 플랫폼 크래시(FUNCTION_INVOCATION_FAILED) 대신 읽을 수 있는 JSON을 돌려준다
    return jsonRes({ error: '프록시 내부 오류', detail: String(e && e.message || e) }, 500);
  }
}

export const config = { runtime: 'edge' };
