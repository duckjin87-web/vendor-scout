// proxy/worker.js — data.go.kr 프록시 (Cloudflare Worker)
//
// 왜 필요한가: 정적 사이트(브라우저)는 data.go.kr을 직접 못 부른다.
//   1) CORS 미허용   2) API 키가 클라이언트에 노출   3) 식약처가 http (mixed-content 차단)
// 이 워커가 키를 서버측 Secret으로 숨기고, CORS를 허용하며, https로 중계한다.
//
// 조회 흐름(사이트):
//   1) service=corp  &corpNm=<업체명>   → 금융위 기업기본정보(동명업체 후보 목록)
//   2) service=finance &crno=<법인번호>  → 금융위 재무정보
//   3) service=rpt   &entp_name=<업체명> → 식약처 기능성화장품 보고품목
//
// 배포/시크릿: proxy/README.md 참고 (Secret 이름: DATA_GO_KR_API_KEY)

// 화이트리스트 — 오픈 프록시 방지. 승인된 명세에 맞게 전체 URL 조정.
const SERVICES = {
  corp: 'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance: 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
  rpt: 'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService01/getRptPrdlstInq01',
  npsSearch: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getBassInfoSearch',
  npsDetail: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getDetailInfoSearch',
  maker: 'https://apis.data.go.kr/1471000/CsmtcsMnfctrInfoService01/getCsmtcsMnfctrInq01',
  // 승인 확인 후 추가: gmp(품질인증) 등
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    const url = new URL(request.url);
    const base = SERVICES[url.searchParams.get('service')];
    if (!base) return json({ error: 'unknown service' }, 400);
    if (!env.DATA_GO_KR_API_KEY) return json({ error: 'server missing DATA_GO_KR_API_KEY secret' }, 500);

    // service 외 파라미터는 그대로 상류로 전달 (corpNm / crno / entp_name / pageNo …)
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
  },
};
