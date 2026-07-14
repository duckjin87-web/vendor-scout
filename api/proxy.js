// api/proxy.js — Vercel Serverless Function (공공 API 프록시)
//
// Vercel 환경변수(Settings → Environment Variables):
//   DATA_GO_KR_API_KEY   — data.go.kr 인증키 (필수)
//   DART_API_KEY          — DART 전자공시 인증키 (선택)
//   NAVER_CLIENT_ID       — 네이버 개발자 Client ID (선택)
//   NAVER_CLIENT_SECRET   — 네이버 개발자 Client Secret (선택)

const DATAGO = {
  corp:      'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance:   'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
  rpt:       'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService01/getRptPrdlstInq01',
  npsSearch: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getBassInfoSearch',
  npsDetail: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getDetailInfoSearch',
  maker:     'https://apis.data.go.kr/1471000/CsmtcsMfcrtrInfoService01/getCsmtcsMfcrtrInfoList01',
  customs:   'https://apis.data.go.kr/1220000/prodstclnprtscnt/getProdstclnprtscntList',
  gmp:       'https://apis.data.go.kr/1471000/CsmtcsGmpInfoService01/getCsmtcsGmpList01',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleDataGo(params, service) {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) return jsonRes({ error: 'DATA_GO_KR_API_KEY 미설정' }, 500);

  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== 'service' && v) q.set(k, v);
  q.set('serviceKey', key);
  if (!q.has('resultType')) q.set('resultType', 'json');
  if (!q.has('type'))       q.set('type', 'json');
  if (!q.has('numOfRows'))  q.set('numOfRows', '30');

  const res = await fetch(`${DATAGO[service]}?${q}`);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleDart(params) {
  const key = process.env.DART_API_KEY;
  if (!key) return jsonRes({ error: 'DART_API_KEY 미설정' }, 500);

  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== 'service' && v) q.set(k, v);
  q.set('crtfc_key', key);

  const res = await fetch(`https://opendart.fss.or.kr/api/list.json?${q}`);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleNaverNews(params) {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return jsonRes({ error: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정' }, 500);

  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== 'service' && v) q.set(k, v);
  if (!q.has('display')) q.set('display', '5');
  if (!q.has('sort'))    q.set('sort', 'date');

  const res = await fetch(`https://openapi.naver.com/v1/search/news.json?${q}`, {
    headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return jsonRes({ error: 'method not allowed' }, 405);

  const url = new URL(req.url);
  const service = url.searchParams.get('service');

  if (service === 'dart')      return handleDart(url.searchParams);
  if (service === 'naverNews') return handleNaverNews(url.searchParams);
  if (DATAGO[service])         return handleDataGo(url.searchParams, service);

  return jsonRes({ error: `unknown service: ${service}` }, 400);
}

export const config = { runtime: 'edge' };
