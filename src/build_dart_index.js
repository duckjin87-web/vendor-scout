// src/build_dart_index.js — DART 고유번호(corp_code) 인덱스 빌드
//
// Open DART의 corpCode.xml(ZIP, 약 11만 건)을 받아 "정규화 상호 → corp_code" 인덱스를 만든다.
// 브라우저가 20MB XML을 통째로 받을 수 없으므로 32개 샤드로 쪼개 data/dart/NN.json 으로 저장하고,
// 프런트는 상호 해시로 필요한 샤드 1개(수백 KB)만 지연 로드한다.
//
// 실행: DART_API_KEY=xxxx node src/build_dart_index.js
// 키 발급: https://opendart.fss.or.kr (무료, 즉시 발급)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY = process.env.DART_API_KEY;
const OUT_DIR = path.join(__dirname, '..', 'data', 'dart');
const SHARDS = 32;

// 상호 정규화 — 법인 접두/접미어·공백·괄호 제거 후 소문자화. 프런트(app.js)와 반드시 동일해야 한다.
function normName(s) {
  return String(s || '')
    .replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사|유한책임회사/g, '')
    .replace(/[\s()[\]{}.,·・\-_/]/g, '')
    .toLowerCase();
}
// djb2 해시 → 샤드 번호. 프런트와 동일 구현 필요.
function shardOf(norm) {
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return h % SHARDS;
}

// ZIP(단일 엔트리)에서 첫 파일의 압축 데이터를 꺼내 inflateRaw — 외부 의존성 없이 처리
function unzipSingle(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 시그니처 아님');
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  let compSize = buf.readUInt32LE(18);
  // 스트리밍 저장(크기 0)인 경우 중앙 디렉터리 시작 전까지를 압축 데이터로 본다
  if (!compSize) {
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), start);
    compSize = (cd > start ? cd : buf.length) - start;
  }
  const body = buf.subarray(start, start + compSize);
  return method === 0 ? body : zlib.inflateRawSync(body);
}

async function main() {
  if (!KEY) { console.error('DART_API_KEY 환경변수가 필요합니다 (https://opendart.fss.or.kr 무료 발급)'); process.exit(1); }
  const url = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(KEY)}`;
  console.log('corpCode.xml 다운로드 중…');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 키가 잘못되면 ZIP 대신 XML 오류 메시지가 온다
  if (buf.subarray(0, 5).toString('utf8').includes('<')) {
    throw new Error(`ZIP이 아닌 응답(키 오류 가능): ${buf.subarray(0, 300).toString('utf8')}`);
  }
  const xml = unzipSingle(buf).toString('utf8');
  console.log(`XML ${(xml.length / 1e6).toFixed(1)}MB 해제 완료`);

  const shards = Array.from({ length: SHARDS }, () => ({}));
  let total = 0, listed = 0;
  const re = /<list>([\s\S]*?)<\/list>/g;
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : '';
  };
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const code = pick(b, 'corp_code');
    const name = pick(b, 'corp_name');
    const stock = pick(b, 'stock_code');
    if (!code || !name) continue;
    const norm = normName(name);
    if (norm.length < 2) continue;
    total++;
    if (stock) listed++;
    const s = shards[shardOf(norm)];
    // 동명 법인이 있을 수 있어 배열로 보관(상장사를 앞에 두어 우선 매칭)
    const entry = { c: code, n: name, ...(stock ? { s: stock } : {}) };
    if (!s[norm]) s[norm] = [entry];
    else if (stock) s[norm].unshift(entry);
    else s[norm].push(entry);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  shards.forEach((obj, i) => {
    const file = path.join(OUT_DIR, `${String(i).padStart(2, '0')}.json`);
    const json = JSON.stringify(obj);
    fs.writeFileSync(file, json);
    bytes += json.length;
  });
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify({
    builtAt: new Date().toISOString(), total, listed, shards: SHARDS,
  }, null, 2));
  console.log(`완료: ${total}건(상장 ${listed}) → ${SHARDS}개 샤드, 평균 ${(bytes / SHARDS / 1024).toFixed(0)}KB`);
}

// 직접 실행할 때만 동작 — 테스트에서 import 해도 다운로드가 시작되지 않도록
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}

export { normName, shardOf, unzipSingle };
