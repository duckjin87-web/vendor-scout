// proxy/worker.js — 공공 API 프록시 (Cloudflare Worker)
//
// 왜 필요한가: 정적 사이트(브라우저)는 data.go.kr / 네이버를 직접 못 부른다.
//   1) CORS 미허용   2) API 키가 클라이언트에 노출   3) 식약처가 http (mixed-content 차단)
// 이 워커가 키를 서버측 Secret으로 숨기고, CORS를 허용하며, https로 중계한다.
//
// 조회 흐름(사이트):
//   1) service=corp  &corpNm=<업체명>   → 금융위 기업기본정보(동명업체 후보 목록)
//   2) service=finance &crno=<법인번호>  → 금융위 재무정보
//   3) service=rpt   &entp_name=<업체명> → 식약처 기능성화장품 보고품목
//   4) service=gmp   &bssh_nm=<업체명>   → 식약처 화장품 GMP 적합업소
//   5) service=customs &hsSgn=33 …      → 관세청 수출입실적(업종 참고)
//   6) service=naverNews &query=<업체명> → 네이버 뉴스검색
//
// 배포/시크릿: proxy/README.md 참고
//   DATA_GO_KR_API_KEY  — data.go.kr 인증키 (필수)
//   NAVER_CLIENT_ID      — 네이버 개발자 Client ID (선택)
//   NAVER_CLIENT_SECRET  — 네이버 개발자 Client Secret (선택)

// data.go.kr 서비스 — serviceKey 쿼리 파라미터 인증
const DATAGO_SERVICES = {
  corp: 'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance: 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
  rpt: 'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService/getRptPrdlstInq',
  npsSearch: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getBassInfoSearch',
  npsDetail: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getDetailInfoSearch',
  maker: 'https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService01/getCsmtcsMfcrtrInfoList01',
  customs: 'https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList',
  gmp: 'https://apis.data.go.kr/1471000/CsmtcsGmpStbltCompInfo/getCsmtcsGmpStbltCompInfo',
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

async function handleDataGo(url, service, env) {
  if (!env.DATA_GO_KR_API_KEY) return json({ error: 'server missing DATA_GO_KR_API_KEY secret' }, 500);
  const base = DATAGO_SERVICES[service];
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k !== 'service' && v) q.set(k, v);
  q.set('serviceKey', env.DATA_GO_KR_API_KEY);
  if (!q.has('resultType')) q.set('resultType', 'json');
  if (!q.has('type')) q.set('type', 'json');
  if (!q.has('numOfRows')) q.set('numOfRows', '30');

  let upstream;
  try {
    upstream = await fetch(`${base}?${q}`, { cf: { cacheTtl: 300, cacheEverything: true } });
  } catch (e) {
    return json({ error: 'upstream fetch failed', detail: String(e) }, 502);
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleNaverNews(url, env) {
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) return json({ error: 'server missing NAVER_CLIENT_ID / NAVER_CLIENT_SECRET secrets' }, 500);
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (k !== 'service' && v) q.set(k, v);
  if (!q.has('display')) q.set('display', '5');
  if (!q.has('sort')) q.set('sort', 'date');

  let upstream;
  try {
    upstream = await fetch(`https://openapi.naver.com/v1/search/news.json?${q}`, {
      headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
  } catch (e) {
    return json({ error: 'Naver upstream failed', detail: String(e) }, 502);
  }
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    const url = new URL(request.url);
    const service = url.searchParams.get('service');

    if (service === 'naverNews') return handleNaverNews(url, env);
    if (DATAGO_SERVICES[service]) return handleDataGo(url, service, env);

    return json({ error: 'unknown service' }, 400);
  },
};
