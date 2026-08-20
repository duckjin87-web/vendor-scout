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
import { Readable, Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

// 상호 정규화 — 법인 접두/접미어·공백·괄호 제거. 프런트(app.js dartNormName)와 동일해야 한다.
function normName(s) {
  return String(s || '')
    .replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[\s()[\]{}.,·・\-_/]/g, '')
    .toLowerCase();
}

// ZIP 로컬 헤더(가변 길이)만 앞에서 떼어내는 Transform — 뒤는 그대로 흘려보낸다.
// 20MB를 통째로 메모리에 풀면 함수 실행시간을 초과(504)하므로 전 구간 스트리밍으로 처리한다.
function zipHeaderStripper(onMethod) {
  let head = Buffer.alloc(0), done = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (done) { cb(null, chunk); return; }
      head = Buffer.concat([head, chunk]);
      if (head.length < 30) { cb(); return; }
      if (head.readUInt32LE(0) !== 0x04034b50) { cb(new Error('ZIP 시그니처 아님')); return; }
      const headerLen = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      if (head.length < headerLen) { cb(); return; }
      if (onMethod) onMethod(head.readUInt16LE(8));
      done = true;
      cb(null, head.subarray(headerLen));
    },
  });
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
  const started = Date.now();
  const BUDGET = 8500;                      // 함수 실행한도(10초) 안에서 안전 여유
  let up;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BUDGET);
    up = await fetch(target, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': 'Mozilla/5.0 (vendor-scout)' },
    });
    clearTimeout(timer);
  } catch (e) {
    res.status(502).json({
      error: 'DART 고유번호 파일 호출 실패',
      detail: (e && e.name === 'AbortError') ? `타임아웃(${BUDGET / 1000}초)` : String((e && e.message) || e),
    });
    return;
  }
  if (!up.ok) { res.status(502).json({ error: `DART 상류 HTTP ${up.status}` }); return; }
  if (!up.body) { res.status(502).json({ error: 'DART 응답 본문 없음' }); return; }

  // ── 스트리밍 처리: 헤더 제거 → inflate → 청크 단위 스캔 → 찾으면 즉시 중단 ──
  // 정규식으로 20MB를 훑으면 느리므로 indexOf 기반으로 <list> 블록만 잘라 본다.
  const pick = (b, t) => {
    const o = b.indexOf(`<${t}>`); if (o === -1) return '';
    const c = b.indexOf(`</${t}>`, o); if (c === -1) return '';
    return b.slice(o + t.length + 2, c).trim();
  };
  // 청크 경계에서 UTF-8 한글이 잘리면 상호가 깨져 매칭에 실패한다 → StringDecoder로 경계 처리
  const decoder = new StringDecoder('utf8');
  let hit = null, scanned = 0, carry = '', truncated = false;
  try {
    const inflated = Readable.fromWeb(up.body)
      .pipe(zipHeaderStripper())
      .pipe(zlib.createInflateRaw());
    for await (const chunk of inflated) {
      carry += decoder.write(chunk);
      let idx;
      while ((idx = carry.indexOf('</list>')) !== -1) {
        const s = carry.lastIndexOf('<list>', idx);
        if (s !== -1) {
          scanned++;
          const block = carry.slice(s + 6, idx);
          if (normName(pick(block, 'corp_name')) === want) {
            const stock = pick(block, 'stock_code');
            const cand = { code: pick(block, 'corp_code'), corpName: pick(block, 'corp_name'), stock: stock || null };
            if (stock) { hit = cand; break; }   // 상장사면 확정
            if (!hit) hit = cand;                // 비상장이면 보관하고 상장 동명이 있는지 계속
          }
        }
        carry = carry.slice(idx + 7);
      }
      if (hit && hit.stock) break;               // 상장사 확정 시에만 조기 종료
      if (carry.length > 65536) carry = carry.slice(-4096);
      if (Date.now() - started > BUDGET) { truncated = true; break; }
    }
    inflated.destroy();
  } catch (e) {
    res.status(502).json({ error: 'DART ZIP 해제/스캔 실패', detail: String((e && e.message) || e) });
    return;
  }

  // 고유번호는 자주 바뀌지 않으므로 CDN에 길게 캐시 — 같은 상호 재조회는 즉시
  // 찾았을 때만 길게 캐시 — 시간초과로 못 찾은 결과를 일주일 캐시하면 계속 실패한다
  res.setHeader('Cache-Control', hit
    ? 'public, s-maxage=604800, stale-while-revalidate=86400'
    : (truncated ? 'no-store' : 'public, s-maxage=86400'));
  res.status(200).json(hit
    ? { found: true, ...hit, scannedCount: scanned, ms: Date.now() - started }
    : {
      found: false,
      reason: truncated
        ? `시간 내 전체 탐색 미완료(${scanned}건까지) — 다시 시도하거나 GitHub Actions의 "Build DART corp_code index"로 인덱스를 만들면 즉시 조회됩니다`
        : 'DART 공시대상 아님(고유번호 미등록) — 외부감사·상장 대상이 아닐 수 있음',
      scannedCount: scanned, ms: Date.now() - started,
    });
}
