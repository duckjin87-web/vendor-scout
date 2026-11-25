// api/dart.js — OpenDART(금융감독원 전자공시) 중계 · Node.js 서버 함수
//
// 왜 proxy.js(Edge)와 따로 두나: Edge 런타임에서 opendart.fss.or.kr 호출이 http·https 모두
// 즉시 'internal error'로 끊겼다(2026-11 진단 — 같은 시각 GitHub 서버에서는 정상 응답).
// 일반 Node.js 함수로 부르면 붙는다. 클라이언트는 그대로 /api/proxy?service=dart를 부르고,
// proxy.js가 이 함수로 넘긴다.
//
// Vercel 환경변수: DART_API_KEY (값은 응답에 싣지 않는다)
const OPS = {
  company: 'company.json',                     // 기업개황(corp_code)
  list: 'list.json',                           // 공시검색(corp_code·기간·종류)
  acnt: 'fnlttSinglAcnt.json',                 // 단일회사 주요계정(corp_code·bsns_year·reprt_code)
  acntAll: 'fnlttSinglAcntAll.json',           // 단일회사 전체 재무제표(+fs_div)
  invest: 'otrCprInvstmntSttus.json',          // 타법인 출자현황 — 비상장 자회사 재무
  emp: 'empSttus.json',                        // 직원 현황
};
const PARAMS = ['corp_code', 'bgn_de', 'end_de', 'last_reprt_at', 'pblntf_ty', 'pblntf_detail_ty', 'corp_cls', 'sort', 'sort_mth', 'page_no', 'page_count', 'bsns_year', 'reprt_code', 'fs_div'];

function keyOf(env) {
  const name = ['DART_API_KEY', 'DART_KEY', 'OPENDART_API_KEY', 'OPENDART_KEY'].find((k) => env[k])
    || Object.keys(env).find((k) => /^(OPEN)?DART.*KEY$/i.test(k) && env[k]);
  return name ? { name, key: String(env[name]).trim() } : null;
}
const send = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
};

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const k = keyOf(process.env);
    if (!k) return send(res, 500, { error: 'DART 키 환경변수 없음(DART_API_KEY)' });
    const op = url.searchParams.get('op') || 'company';
    if (op === 'status') {
      // 키가 살아 있는지만 본다 — 삼성전자(00126380) 기업개황. 키 값은 돌려주지 않는다.
      const t0 = Date.now();
      try {
        const r = await fetch(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(k.key)}&corp_code=00126380`, { signal: AbortSignal.timeout(15000) });
        const j = await r.json().catch(() => null);
        return send(res, 200, { runtime: 'nodejs', env: k.name, keyLen: k.key.length, ms: Date.now() - t0, ok: !!(j && j.status === '000'), status: j && j.status, message: j && j.message, sample: j && j.corp_name });
      } catch (e) {
        return send(res, 200, { runtime: 'nodejs', env: k.name, keyLen: k.key.length, ok: false, err: String(e && e.message || e), cause: String((e && e.cause && (e.cause.code || e.cause.message)) || '') });
      }
    }
    const file = OPS[op];
    if (!file) return send(res, 400, { error: `지원하지 않는 DART 조회: ${op}` });
    const q = new URLSearchParams({ crtfc_key: k.key });
    for (const p of PARAMS) { const v = url.searchParams.get(p); if (v) q.set(p, v); }
    let last = null;
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(`https://opendart.fss.or.kr/api/${file}?${q}`, { signal: AbortSignal.timeout(20000) });
        const t = await r.text();
        if (r.ok) return send(res, 200, t);
        last = `HTTP ${r.status} ${t.slice(0, 160)}`;
      } catch (e) { last = String(e && e.message || e); }
    }
    return send(res, 502, { error: `DART(${op}) 호출 실패`, detail: last });
  } catch (e) {
    return send(res, 500, { error: 'DART 중계 내부 오류', detail: String(e && e.message || e) });
  }
}
