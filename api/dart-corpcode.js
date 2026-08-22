// api/dart-corpcode.js — DART 고유번호(corp_code) 조회 · Node.js 런타임 전용
//
// 왜 별도 파일인가:
//   메인 프록시(api/proxy.js)는 Edge 런타임인데, Edge에서 corpCode.xml(ZIP)을
//   fetch하면 "internal error"로 실패한다. 그래서 이 조회만 Node 런타임으로 분리한다.
//
// 시간 예산이 이 파일의 핵심이다.
//   DART는 상호로 검색하는 API를 제공하지 않는다. 고유번호를 얻으려면 전체 목록
//   corpCode.xml(압축 1~2MB, 해제 약 20MB)을 통째로 받는 수밖에 없다. 한국 정부
//   서버라 미국 리전에서 받으면 수 초가 걸리고, 실행한도를 넘기면 플랫폼이 함수를
//   죽여 504가 난다 — 그러면 원인을 설명할 기회조차 없다.
//   그래서 (1) 리전을 서울로 옮기고(vercel.json) (2) 내려받기 제한시간을 실행한도보다
//   충분히 짧게 잡아 어떤 경우에도 우리가 먼저 응답하며 (3) 한 번 받은 목록은
//   인스턴스 메모리에 캐시해 이후 조회는 즉시 답한다.
//
// 필요 환경변수: DART_API_KEY (opendart.fss.or.kr 무료 발급)

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
  '012': '접근할 수 없는 IP입니다 — OpenDART에 등록한 IP 제한을 해제하세요',
  '013': '조회된 데이터가 없습니다',
  '014': '파일이 존재하지 않습니다',
  '020': '요청 제한을 초과했습니다(일 20,000건) — 내일 다시 시도하세요',
  '021': '조회 가능한 회사 개수를 초과했습니다',
  '100': '필드의 부적절한 값입니다',
  '101': '부적절한 접근입니다',
  '800': 'OpenDART 시스템 점검 중입니다',
  '900': 'OpenDART 정의되지 않은 오류',
  '901': '사용자 계정의 개인정보보호가 요청된 상태입니다',
};

function readDartError(buf) {
  const head = buf.subarray(0, 2048).toString('utf8');
  const st = (head.match(/<status>\s*([^<]+?)\s*<\/status>/) || head.match(/"status"\s*:\s*"([^"]+)"/) || [])[1];
  const msg = (head.match(/<message>\s*([^<]+?)\s*<\/message>/) || head.match(/"message"\s*:\s*"([^"]+)"/) || [])[1];
  if (!st && !msg) return null;
  return { status: st || null, message: msg || null, known: st ? DART_STATUS[st] || null : null };
}

// ── 워밍 캐시 ──
// 모듈 스코프 변수는 같은 인스턴스가 살아있는 동안 유지된다. 목록을 한 번 받아
// 상호→고유번호 Map으로 만들어두면(약 0.5초/110MB 남짓) 이후 조회는 사실상 즉시다.
// 콜드스타트에서는 다시 받아야 하므로, 근본 해법은 여전히 사전 인덱스다.
let CACHE = null;                       // { at:number, map:Map<string,Array>, count:number }
const CACHE_TTL = 6 * 60 * 60 * 1000;   // 고유번호는 자주 바뀌지 않는다

function buildMap(xml) {
  const pick = (b, t) => {
    const o = b.indexOf(`<${t}>`); if (o === -1) return '';
    const c = b.indexOf(`</${t}>`, o); if (c === -1) return '';
    return b.slice(o + t.length + 2, c).trim();
  };
  const map = new Map();
  let pos = 0, count = 0;
  for (;;) {
    const a = xml.indexOf('<list>', pos); if (a === -1) break;
    const b = xml.indexOf('</list>', a); if (b === -1) break;
    const blk = xml.slice(a + 6, b);
    const key = normName(pick(blk, 'corp_name'));
    if (key) {
      const stock = pick(blk, 'stock_code');
      const e = { code: pick(blk, 'corp_code'), corpName: pick(blk, 'corp_name'), stock: stock || null };
      const cur = map.get(key);
      if (cur) cur.push(e); else map.set(key, [e]);
      count++;
    }
    pos = b + 7;
  }
  return { map, count };
}

// 정확히 일치하는 항목이 없을 때 보여줄 부분일치 후보 — 표기 차이·계열사 판별용
function nearMatches(map, want, limit = 8) {
  const out = [];
  for (const [k, arr] of map) {
    if (k !== want && (k.includes(want) || want.includes(k))) {
      for (const e of arr) { out.push(e); if (out.length >= limit) return out; }
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const started = Date.now();
  const fail = (code, body) => {
    res.setHeader('Cache-Control', 'no-store');   // 실패는 절대 캐시하지 않는다
    res.status(code).json({ ...body, ms: Date.now() - started });
  };

  const KEY = process.env.DART_API_KEY;
  if (!KEY) {
    fail(501, { error: 'DART_API_KEY 미설정', detail: 'opendart.fss.or.kr에서 무료 발급 후 Vercel 환경변수에 추가하세요' });
    return;
  }
  const rawName = (req.query && req.query.name) || '';
  const want = normName(rawName);
  if (want.length < 2) { fail(400, { error: '상호 2자 이상 필요' }); return; }

  // ── 시간 예산 ──
  // 실행한도(vercel.json maxDuration)보다 짧게 잡아 플랫폼이 우리를 죽이기 전에
  // 반드시 우리가 먼저 응답한다. 504는 원인을 설명할 기회조차 주지 않는다.
  const LIMIT = Number(process.env.DART_TIME_LIMIT_MS || 9000);
  const RESERVE = 2500;                          // 압축해제+파싱+응답에 남겨둘 시간
  const fetchBudget = Math.max(2000, LIMIT - RESERVE);

  const timing = {};
  let entry = CACHE && (Date.now() - CACHE.at) < CACHE_TTL ? CACHE : null;

  if (!entry) {
    // ── 1) 내려받기 ──
    let buf;
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), fetchBudget);
      const up = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(KEY)}`, {
        signal: ctrl.signal, redirect: 'follow',
        headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'Mozilla/5.0 (vendor-scout)' },
      });
      clearTimeout(timer);
      if (!up.ok) { fail(502, { error: `DART 상류 HTTP ${up.status}`, detail: (await up.text().catch(() => '')).slice(0, 300) || null }); return; }
      buf = Buffer.from(await up.arrayBuffer());
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // 여기서 504로 죽지 않고 우리가 설명한다 — 무엇이 느린지 알아야 손을 쓸 수 있다.
        fail(504, {
          error: `DART 고유번호 파일을 ${(fetchBudget / 1000).toFixed(1)}초 안에 받지 못했습니다`,
          detail: 'DART는 상호 검색 API가 없어 전체 목록(약 2MB)을 받아야 합니다. 서버 리전이 한국(icn1)인지 확인하거나, GitHub Actions의 "Build DART corp_code index"를 1회 실행해 사전 인덱스를 만드세요',
          hint: '잠시 후 다시 시도하면 성공할 수 있습니다',
        });
        return;
      }
      fail(502, { error: 'DART 고유번호 파일 호출 실패', detail: String((e && e.message) || e) });
      return;
    }
    timing.download = Date.now() - t0;
    if (!buf.length) { fail(502, { error: 'DART 응답이 비어 있습니다' }); return; }

    // ── 2) ZIP인지 확인 ── 키 미승인·IP 미등록·한도초과는 ZIP 대신 오류 XML이 HTTP 200으로 온다.
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

    // 남은 시간이 없으면 압축해제를 시작하지 않는다 — 시작했다가 한도를 넘기면 504다.
    if (Date.now() - started > LIMIT - 800) {
      fail(504, { error: 'DART 파일은 받았지만 처리할 시간이 부족했습니다', detail: `내려받기에만 ${timing.download}ms 소요`, hint: '다시 시도하면 캐시로 빨라질 수 있습니다' });
      return;
    }

    // ── 3) 압축 해제 후 상호→고유번호 Map 구축 ──
    const t1 = Date.now();
    try {
      const method = buf.readUInt16LE(8);
      const headerLen = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
      const payload = buf.subarray(headerLen);
      let xml;
      if (method === 0) xml = payload.toString('utf8');
      else if (method === 8) xml = zlib.inflateRawSync(payload, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8');
      else { fail(502, { error: `지원하지 않는 ZIP 압축방식(method=${method})` }); return; }

      const built = buildMap(xml);
      if (!built.count) {
        // 파일은 받았는데 항목을 하나도 못 읽었다면 해석 실패다. 미등록이라고 단정하지 않는다.
        fail(502, {
          error: 'corpCode.xml에서 <list> 항목을 하나도 읽지 못했습니다 — 파일 형식이 예상과 다릅니다',
          detail: xml.slice(0, 200).replace(/\s+/g, ' ').trim(),
        });
        return;
      }
      entry = { at: Date.now(), map: built.map, count: built.count };
      CACHE = entry;
    } catch (e) {
      fail(502, { error: 'DART ZIP 압축 해제 실패', detail: String((e && e.message) || e) });
      return;
    }
    timing.parse = Date.now() - t1;
  } else {
    timing.cached = true;
  }

  // ── 4) 조회 ──
  const arr = entry.map.get(want) || [];
  const hit = arr.find((e) => e.stock) || arr[0] || null;   // 동명이면 상장사 우선
  const ms = Date.now() - started;

  res.setHeader('Cache-Control', hit
    ? 'public, s-maxage=604800, stale-while-revalidate=86400'
    : 'public, s-maxage=86400');
  if (hit) { res.status(200).json({ found: true, ...hit, scannedCount: entry.count, timing, ms }); return; }

  const near = nearMatches(entry.map, want);
  res.status(200).json({
    found: false,
    reason: near.length
      ? `"${rawName}"와 정확히 일치하는 상호가 DART에 없습니다 — 유사 상호 ${near.length}건 확인 필요`
      : 'DART 공시대상 아님(고유번호 미등록) — 외부감사·상장 대상이 아닐 수 있음',
    candidates: near,
    scannedCount: entry.count, timing, ms,
  });
}
