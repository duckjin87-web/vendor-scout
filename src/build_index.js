// src/build_index.js — 여러 업체를 공공 API로 조회해 사이트가 읽는 정적 JSON으로 굽는다.
// 사용: node src/build_index.js "코스맥스,한국콜마"
// GitHub Actions에서 DATA_GO_KR_API_KEY 시크릿으로 실행 → data/mfds/*.json 커밋 → Pages가 서빙.
// (키는 Actions 안에만 있고 브라우저엔 결과 JSON만 나간다 — 프록시 불필요)
import fs from 'fs';
import path from 'path';
import { emptyReport, overallGrade } from './report/schema.js';
import { collectCorpBasic } from './collectors/fsc_corp.js';
import { collectFinance } from './collectors/fsc_finance.js';
import { collectMfdsBiz } from './collectors/mfds_biz.js';
import { collectGmp } from './collectors/mfds_gmp.js';
import { collectMfds } from './collectors/mfds.js';
import { collectNps } from './collectors/nps.js';

const names = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!names.length) { console.error('사용법: node src/build_index.js "업체1,업체2"'); process.exit(1); }
if (!process.env.DATA_GO_KR_API_KEY) { console.error('DATA_GO_KR_API_KEY 미설정 (GitHub Secrets)'); process.exit(1); }

const dir = 'data/mfds';
fs.mkdirSync(dir, { recursive: true });
const idxPath = path.join(dir, 'index.json');
let index = [];
try { index = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch {}

for (const name of names) {
  const report = emptyReport(name);
  const push = (block, r) => { report[block].push(...r.fields); report.risk_flags.push(...r.flags); };

  const corp = await collectCorpBasic(name);
  push('basic', corp);
  const crno = corp.crno;
  const bzno = corp.fields.find((f) => f.key === '사업자등록번호')?.value;

  const [fin, biz, gmp, fn, nps] = await Promise.allSettled([
    collectFinance(crno),
    collectMfdsBiz(name),
    collectGmp(name),
    collectMfds(name),
    collectNps(name, bzno),
  ]);
  const settled = (r, block) => {
    if (r.status === 'fulfilled') push(block, r.value);
    else report.risk_flags.push({ type: 'collector_crash', detail: String(r.reason) });
  };
  settled(fin, 'finance');
  settled(biz, 'basic');
  settled(gmp, 'capacity');
  settled(fn, 'capacity');
  settled(nps, 'capacity');

  const all = [...report.basic, ...report.capacity, ...report.finance];
  report.meta.overall_grade = overallGrade(all);
  report.meta.sources_used = [...new Set(all.filter((f) => !f.data_gap).map((f) => f.source))];
  report.meta.live = true;                 // 사이트에서 "식약처 실데이터" 배지
  const id = name.replace(/[^\w가-힣]/g, '_');
  report.meta.vendor_id = id;

  // 크로스체크 자동 생성 (gap / C등급 / 기간초과)
  report.crosscheck = all
    .filter((f) => f.data_gap || f.grade === 'C' || f.fresh === false)
    .map((f) => ({ key: f.key, expected: f.value, verified: null, match: null, src_type: f.source }));

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(report, null, 2));
  index = index.filter((e) => e.id !== id);
  index.push({ name, id, grade: report.meta.overall_grade, at: new Date().toISOString().slice(0, 10) });
  console.log('✔', name, '→', `${id}.json`, `(등급 ${report.meta.overall_grade}, 공백 ${all.filter((f) => f.data_gap).length})`);
}

index.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
console.log(`인덱스: ${index.length}건 → ${idxPath}`);
