// api/dart-corpcode.js — DART 고유번호(corp_code) 조회 · Node.js 런타임 전용
//
// 왜 별도 파일인가:
//   메인 프록시(api/proxy.js)는 Edge 런타임인데, Edge에서 corpCode.xml(ZIP 1.5MB)을
//   fetch하면 "internal error"로 실패한다(스트리밍으로 바꿔도 동일). 그래서 이 조회만
//   Node 런타임으로 분리한다. Node에는 zlib이 내장돼 있고 큰 응답 제약도 없다.
//
// 동작: 상호를 받아 corpCode.xml을 내려받아 압축을 풀고 일치 항목 1건만 반환.
//       응답은 CDN에 1주일 캐시되어 같은 상호 재조회는 즉시 응답한다.
// 필요 환경변수: DART_API_KEY (opendart.fss.or.kr 무료 발급)

import zlib from 'node:zlib';

// 상호 정규화 — 법인 접두/접미어·공백·괄호 제거. 프런트(app.js dartNormName)와 동일해야 한다.
function normName(s) {
  return String(s || '')
    .replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[\s()[\]{}.,·・\-_/]/g, '')
    .toLowerCase();
}

// ZIP(단일 엔트리)에서 첫 파일의 압축 데이터를 꺼내 inflateRaw — 외부 의존성 없이 처리
function unzipSingle(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 시그니처 아님');
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  let compSize = buf.readUInt32LE(18);
  // 스트리밍 저장(크기 0)이면 중앙 디렉터리 시작 전까지를 압축 데이터로 본다
  if (!compSize) {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), start);
    compSize = (cd > start ? cd : buf.length) - start;
  }
  const body = buf.subarray(start, start + compSize);
  return method === 0 ? body : zlib.inflateRawSync(body);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const KEY = process.env.DART_API_KEY;
  if (!KEY) {
    res.status(501).json({ error: 'DART_API_KEY 미설정', detail: 'opendart.fss.or.kr에서 무료 발급 후 Vercel 환경변수에 추가하세요' });
    return;
  }
  const want = normName((req.query && req.query.name) || '');
  if (want.length < 2) { res.status(400).json({ error: '상호 2자 이상 필요' }); return; }

  const target = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(KEY)}`;
  let buf;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const up = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (vendor-scout)' },
    });
    clearTimeout(timer);
    if (!up.ok) { res.status(502).json({ error: `DART 상류 HTTP ${up.status}` }); return; }
    buf = Buffer.from(await up.arrayBuffer());
  } catch (e) {
    res.status(502).json({
      error: 'DART 고유번호 파일 호출 실패',
      detail: (e && e.name === 'AbortError') ? '타임아웃(25초)' : String((e && e.message) || e),
    });
    return;
  }

  // 키가 잘못되면 ZIP 대신 XML 오류문이 온다
  if (buf.length < 30 || !(buf[0] === 0x50 && buf[1] === 0x4b)) {
    res.status(502).json({
      error: 'DART 응답이 ZIP이 아님(키 오류 가능)',
      detail: buf.subarray(0, 200).toString('utf8'),
    });
    return;
  }

  let xml;
  try { xml = unzipSingle(buf).toString('utf8'); }
  catch (e) { res.status(502).json({ error: 'DART ZIP 해제 실패', detail: String((e && e.message) || e) }); return; }

  // <list> 블록을 순회하며 정규화 상호가 일치하는 첫 건을 찾는다(상장사 우선)
  const re = /<list>([\s\S]*?)<\/list>/g;
  const pick = (b, t) => { const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? m[1].trim() : ''; };
  let m, hit = null, scanned = 0;
  while ((m = re.exec(xml))) {
    scanned++;
    const b = m[1];
    if (normName(pick(b, 'corp_name')) !== want) continue;
    const stock = pick(b, 'stock_code');
    const cand = { code: pick(b, 'corp_code'), corpName: pick(b, 'corp_name'), stock: stock || null };
    if (stock) { hit = cand; break; }        // 상장사면 확정
    if (!hit) hit = cand;                     // 비상장이면 첫 건 보관 후 계속(상장사 있으면 교체)
  }

  // 고유번호는 자주 바뀌지 않으므로 CDN에 길게 캐시 — 같은 상호 재조회는 즉시
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
  res.status(200).json(hit
    ? { found: true, ...hit, scannedCount: scanned }
    : { found: false, reason: 'DART 공시대상 아님(고유번호 미등록) — 외부감사·상장 대상이 아닐 수 있음', scannedCount: scanned });
}
