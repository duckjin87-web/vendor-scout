// api/dart-corpcode.js — DART 고유번호(corp_code) 조회 · Node.js 런타임 전용
//
// 왜 별도 파일인가:
//   메인 프록시(api/proxy.js)는 Edge 런타임인데, Edge에서 corpCode.xml(ZIP)을
//   fetch하면 "internal error"로 실패한다. 그래서 이 조회만 Node 런타임으로 분리한다.
//   Node에는 zlib이 내장돼 있고 큰 응답 제약도 없다.
//
// 동작: 상호를 받아 corpCode.xml(ZIP)을 내려받아 풀고 일치 항목 1건만 반환.
//       응답은 CDN에 캐시되어 같은 상호 재조회는 즉시 응답한다.
// 필요 환경변수: DART_API_KEY (opendart.fss.or.kr 무료 발급)
//
// 설계 원칙: 실패를 삼키지 않는다.
//   이전 버전은 어떤 실패든 결과적으로 found:false가 되어 "공시대상 아님"으로 표시됐다.
//   키 미승인·IP 미등록·한도초과처럼 명백한 설정 오류까지 "이 회사는 공시대상이
//   아니다"라는 사실 주장으로 둔갑했다. 이제 실패 원인은 원인대로 반환한다.

import zlib from 'node:zlib';

// 상호 정규화 — 법인 접두/접미어·공백·괄호 제거. 프런트(app.js dartNormName)와 동일해야 한다.
function normName(s) {
  return String(s || '')
    .replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[\s()[\]{}.,·・\-_/]/g, '')
    .toLowerCase();
}

// OpenDART 표준 상태코드 — 정상(000)이 아니면 ZIP 대신 이 XML/JSON이 HTTP 200으로 온다.
const DART_STATUS = {
  '010': '등록되지 않은 API 키입니다 — Vercel 환경변수 DART_API_KEY 값을 확인하세요',
  '011': '사용할 수 없는 API 키입니다 — 발급 후 이메일 인증(승인)이 끝나야 사용할 수 있습니다',
  '012': '접근할 수 없는 IP입니다 — OpenDART에 등록한 IP 제한을 해제하거나 서버 IP를 등록하세요',
  '013': '조회된 데이터가 없습니다',
  '014': '파일이 존재하지 않습니다',
  '020': '요청 제한을 초과했습니다(일 20,000건) — 내일 다시 시도하거나 인덱스를 사용하세요',
  '021': '조회 가능한 회사 개수를 초과했습니다',
  '100': '필드의 부적절한 값입니다',
  '101': '부적절한 접근입니다',
  '800': 'OpenDART 시스템 점검 중입니다',
  '900': 'OpenDART 정의되지 않은 오류',
  '901': '사용자 계정의 개인정보보호가 요청된 상태입니다',
};

// ZIP이 아닌 응답에서 status/message를 뽑아낸다(XML·JSON 양쪽 모두 대응).
function readDartError(buf) {
  const head = buf.subarray(0, 2048).toString('utf8');
  const st = (head.match(/<status>\s*([^<]+?)\s*<\/status>/) || head.match(/"status"\s*:\s*"([^"]+)"/) || [])[1];
  const msg = (head.match(/<message>\s*([^<]+?)\s*<\/message>/) || head.match(/"message"\s*:\s*"([^"]+)"/) || [])[1];
  if (!st && !msg) return null;
  return { status: st || null, message: msg || null, known: st ? DART_STATUS[st] || null : null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const fail = (code, body) => {
    res.setHeader('Cache-Control', 'no-store');   // 실패는 절대 캐시하지 않는다
    res.status(code).json(body);
  };

  const KEY = process.env.DART_API_KEY;
  if (!KEY) {
    fail(501, { error: 'DART_API_KEY 미설정', detail: 'opendart.fss.or.kr에서 무료 발급 후 Vercel 환경변수에 추가하세요' });
    return;
  }
  const rawName = (req.query && req.query.name) || '';
  const want = normName(rawName);
  if (want.length < 2) { fail(400, { error: '상호 2자 이상 필요' }); return; }

  const started = Date.now();
  const BUDGET = 8500;                      // 함수 실행한도(10초) 안에서 안전 여유
  const target = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(KEY)}`;

  // ── 1) 내려받기 ── 압축 파일이 1~2MB라 통째로 받는다.
  //    스트리밍 파이프라인은 pipe()가 에러를 전파하지 않아, 상류가 ZIP이 아닐 때
  //    처리되지 않은 error 이벤트로 함수가 그대로 죽었다. 버퍼링이 단순하고 안전하다.
  let buf;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BUDGET);
    const up = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (vendor-scout)' },
    });
    clearTimeout(timer);
    if (!up.ok) { fail(502, { error: `DART 상류 HTTP ${up.status}`, detail: (await up.text().catch(() => '')).slice(0, 300) || null }); return; }
    buf = Buffer.from(await up.arrayBuffer());
  } catch (e) {
    fail(502, {
      error: 'DART 고유번호 파일 호출 실패',
      detail: (e && e.name === 'AbortError') ? `타임아웃(${BUDGET / 1000}초)` : String((e && e.message) || e),
    });
    return;
  }
  if (!buf.length) { fail(502, { error: 'DART 응답이 비어 있습니다' }); return; }

  // ── 2) ZIP인지 확인 ── 키 미승인·IP 미등록·한도초과 등은 ZIP 대신 오류 XML이 HTTP 200으로 온다.
  //    예전에는 이 응답이 조용히 "공시대상 아님"으로 표시돼 원인을 알 수 없었다.
  if (buf.readUInt32LE(0) !== 0x04034b50) {
    const de = readDartError(buf);
    fail(502, {
      error: de && de.known ? de.known : 'DART가 ZIP이 아닌 응답을 반환했습니다',
      dartStatus: de ? de.status : null,
      dartMessage: de ? de.message : null,
      detail: de ? null : buf.subarray(0, 200).toString('utf8').replace(/\s+/g, ' ').trim(),
    });
    return;
  }

  // ── 3) ZIP 로컬 헤더(가변 길이)를 떼고 압축 해제 ──
  let xml;
  try {
    const method = buf.readUInt16LE(8);
    const headerLen = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
    const payload = buf.subarray(headerLen);
    if (method === 0) xml = payload.toString('utf8');              // 무압축 저장
    else if (method === 8) xml = zlib.inflateRawSync(payload, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8');
    else { fail(502, { error: `지원하지 않는 ZIP 압축방식(method=${method})` }); return; }
  } catch (e) {
    fail(502, { error: 'DART ZIP 압축 해제 실패', detail: String((e && e.message) || e) });
    return;
  }

  // ── 4) <list> 블록 스캔 ── 20MB를 정규식으로 훑으면 느리므로 indexOf로 잘라 본다.
  const pick = (b, t) => {
    const o = b.indexOf(`<${t}>`); if (o === -1) return '';
    const c = b.indexOf(`</${t}>`, o); if (c === -1) return '';
    return b.slice(o + t.length + 2, c).trim();
  };
  let hit = null, scanned = 0, pos = 0;
  const near = [];                                   // 부분일치 후보 — 오타·약칭·계열사 구분용
  for (;;) {
    const s = xml.indexOf('<list>', pos); if (s === -1) break;
    const e = xml.indexOf('</list>', s); if (e === -1) break;
    scanned++;
    const block = xml.slice(s + 6, e);
    const nm = normName(pick(block, 'corp_name'));
    if (nm) {
      if (nm === want) {
        const stock = pick(block, 'stock_code');
        const cand = { code: pick(block, 'corp_code'), corpName: pick(block, 'corp_name'), stock: stock || null };
        if (stock) { hit = cand; break; }             // 상장사면 확정 — 더 볼 필요 없다
        if (!hit) hit = cand;                         // 비상장이면 동명 상장사가 있는지 계속 확인
      } else if (near.length < 8 && (nm.includes(want) || want.includes(nm))) {
        const stock = pick(block, 'stock_code');
        near.push({ code: pick(block, 'corp_code'), corpName: pick(block, 'corp_name'), stock: stock || null });
      }
    }
    pos = e + 7;
  }

  const ms = Date.now() - started;

  // ── 5) 스캔이 0건이면 '공시대상 아님'이라고 말할 근거가 없다 ──
  //    파일은 받았는데 항목을 하나도 못 읽었다면 그건 이쪽 해석 실패다. 사실처럼 말하지 않는다.
  if (!hit && scanned === 0) {
    fail(502, {
      error: 'corpCode.xml에서 <list> 항목을 하나도 읽지 못했습니다 — 파일 형식이 예상과 다릅니다',
      xmlBytes: Buffer.byteLength(xml), xmlHead: xml.slice(0, 200).replace(/\s+/g, ' ').trim(), ms,
    });
    return;
  }

  // 고유번호는 자주 바뀌지 않으므로 CDN에 길게 캐시 — 같은 상호 재조회는 즉시
  res.setHeader('Cache-Control', hit
    ? 'public, s-maxage=604800, stale-while-revalidate=86400'
    : 'public, s-maxage=86400');
  res.status(200).json(hit
    ? { found: true, ...hit, scannedCount: scanned, ms }
    : {
      found: false,
      reason: near.length
        ? `"${rawName}"와 정확히 일치하는 상호가 DART에 없습니다 — 유사 상호 ${near.length}건 확인 필요`
        : 'DART 공시대상 아님(고유번호 미등록) — 외부감사·상장 대상이 아닐 수 있음',
      candidates: near,
      scannedCount: scanned, ms,
    });
}
