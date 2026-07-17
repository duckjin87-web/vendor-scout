// api/proxy.js — Vercel Serverless Function (공공 API 프록시)
//
// Vercel 환경변수(Settings → Environment Variables):
//   DATA_GO_KR_API_KEY   — data.go.kr 인증키 (필수)
//   NAVER_CLIENT_ID       — 네이버 개발자 Client ID (선택, 뉴스)
//   NAVER_CLIENT_SECRET   — 네이버 개발자 Client Secret (선택, 뉴스)

const DATAGO = {
  corp:      'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance:   'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
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

// 상류 호출 공통 — 타임아웃·네트워크오류·비정상응답을 항상 CORS JSON으로 정규화(플랫폼 500 크래시 방지)
async function relay(target, label, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000); // data.go가 느려도 20초에 깔끔히 종료
  let upstream;
  try {
    upstream = await fetch(target, { ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && e.name === 'AbortError';
    return jsonRes({ error: `${label} 상류 호출 실패`, detail: aborted ? '타임아웃(20초 초과)' : String(e && e.message || e) }, aborted ? 504 : 502);
  }
  clearTimeout(timer);

  const body = await upstream.text().catch(() => '');
  // 상류가 2xx가 아니면, 상태·본문 일부를 실어 원인이 화면에 보이게 한다
  if (!upstream.ok) {
    return jsonRes({ error: `${label} 상류 HTTP ${upstream.status}`, upstreamStatus: upstream.status, detail: body.slice(0, 300) }, 502);
  }
  return new Response(body, { status: 200, headers: JSON_HDR });
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

// 임의 페이지 텍스트 취득 — 홈페이지 대조용(대표자·주소 매칭). http(s)만, 200KB 상한.
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
  const text = buf ? new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 200000) : '';
  return jsonRes({ status: up.status, url: up.url, text });
}

// 국세청 사업자상태 — odcloud POST(JSON body). data.go 키 그대로 사용.
// odcloud는 간헐적으로 500 "EOF"를 반환 → 고정길이 바이트 전송 + 최대 3회 재시도.
async function handleNtsStatus(url, env) {
  if (!env.DATA_GO_KR_API_KEY) return jsonRes({ error: 'DATA_GO_KR_API_KEY 미설정' }, 500);
  const bno = (url.searchParams.get('b_no') || '').replace(/\D/g, '');
  if (bno.length !== 10) return jsonRes({ error: '사업자번호 10자리 필요' }, 400);
  const q = new URLSearchParams({ serviceKey: env.DATA_GO_KR_API_KEY });
  const target = `https://api.odcloud.kr/api/nts-businessman/v1/status?${q}`;
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ b_no: [bno] }));
  let lastStatus = 0, lastBody = '';
  // 최대 2회, 각 7초 — Edge 함수 실행 한도(504) 초과 방지
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    let up;
    try {
      up = await fetch(target, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': String(bodyBytes.length) },
        body: bodyBytes,
      });
    } catch (e) {
      clearTimeout(timer);
      lastStatus = 0; lastBody = String(e && e.message || e);
      continue; // 네트워크 오류 → 재시도
    }
    clearTimeout(timer);
    const body = await up.text().catch(() => '');
    if (up.ok) return new Response(body, { status: 200, headers: JSON_HDR });
    lastStatus = up.status; lastBody = body;
    if (up.status !== 500) break; // 500(EOF)만 재시도, 그 외는 즉시 반환
  }
  return jsonRes({ error: lastStatus ? `국세청 상류 HTTP ${lastStatus}` : '국세청 상태조회 실패', detail: (lastBody || '').slice(0, 300) }, 502);
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
