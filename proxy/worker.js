// proxy/worker.js — 식약처(data.go.kr) 프록시 (Cloudflare Worker)
//
// 왜 필요한가: 정적 사이트(브라우저)는 data.go.kr을 직접 못 부른다.
//   1) CORS 미허용   2) API 키가 클라이언트에 노출   3) 식약처가 http (mixed-content 차단)
// 이 워커가 키를 서버측 Secret으로 숨기고, CORS를 허용하며, https로 중계한다.
//
// 배포: proxy/README.md 참고. 키는 Secret 이름 DATA_GO_KR_API_KEY 로 등록.
// 호출: GET https://<worker>/?service=rpt&name=<업체명>

const MFDS_BASE = 'https://apis.data.go.kr/1471000';

// 화이트리스트 — 오픈 프록시 방지. 승인된 data.go.kr 명세에 맞게 path/param 조정.
const SERVICES = {
  // 기능성화장품 보고품목 (업체명으로 조회) — 데이터ID 15070851 계열
  rpt: { path: 'FtnltCosmRptPrdlstInfoService/getRptPrdlstInq', param: 'entp_name' },
  // 필요 시 추가 (승인된 엔드포인트/파라미터명 확인 후):
  // maker: { path: 'CsmtcsInfoService/getMakerList', param: 'entpName' },
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
    const svc = SERVICES[url.searchParams.get('service') || 'rpt'];
    const name = (url.searchParams.get('name') || '').trim();

    if (!svc) return json({ error: 'unknown service' }, 400);
    if (!name) return json({ error: 'name (업체명) required' }, 400);
    if (!env.DATA_GO_KR_API_KEY) return json({ error: 'server missing DATA_GO_KR_API_KEY secret' }, 500);

    const q = new URLSearchParams({
      serviceKey: env.DATA_GO_KR_API_KEY,
      type: 'json',
      numOfRows: '100',
      [svc.param]: name,
    });
    const target = `${MFDS_BASE}/${svc.path}?${q}`;

    let upstream;
    try {
      upstream = await fetch(target, { cf: { cacheTtl: 300, cacheEverything: true } });
    } catch (e) {
      return json({ error: 'upstream fetch failed', detail: String(e) }, 502);
    }
    const body = await upstream.text();
    // 식약처가 에러 시 XML을 주기도 함 — 상태코드/본문 그대로 전달, CORS만 부착
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
