// src/index.js — 사용법: node src/index.js "업체명" [법인등록번호]
// 파이프라인: 기업기본(crno확보) → 재무 / 식약처 3종 / 국민연금 병렬 → 스냅샷
import fs from 'fs';
import path from 'path';
import { emptyReport, overallGrade } from './report/schema.js';
import { buildMarkdown } from './report/build.js';
import { collectCorpBasic } from './collectors/fsc_corp.js';
import { collectFinance } from './collectors/fsc_finance.js';
import { collectMfdsBiz } from './collectors/mfds_biz.js';
import { collectGmp } from './collectors/mfds_gmp.js';
import { collectMfds } from './collectors/mfds.js';
import { collectNps } from './collectors/nps.js';

const [vendorName, crnoArg] = process.argv.slice(2);
if (!vendorName) { console.error('사용법: node src/index.js "업체명" [법인등록번호]'); process.exit(1); }
if (!process.env.DATA_GO_KR_API_KEY) { console.error('DATA_GO_KR_API_KEY 미설정 (.env 또는 GitHub Secrets)'); process.exit(1); }

const report = emptyReport(vendorName);
const push = (block, r) => { report[block].push(...r.fields); report.risk_flags.push(...r.flags); };

// ── 1단계: 기업기본정보 (crno 확보가 재무조회의 열쇠) ──
const corp = await collectCorpBasic(vendorName);
push('basic', corp);
const crno = crnoArg || corp.crno;
const bzno = corp.fields.find(f => f.key === '사업자등록번호')?.value;

// ── 2단계: 나머지 병렬 수집 — 하나가 죽어도 전체는 진행 (무누락) ──
const [fin, biz, gmp, fn, nps] = await Promise.allSettled([
  collectFinance(crno),
  collectMfdsBiz(vendorName),
  collectGmp(vendorName),
  collectMfds(vendorName),      // 기능성 보고품목 → 제형 분포
  collectNps(vendorName, bzno),
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

// ── 3단계: 주소 3중 대조 (본점 vs 제조소 vs 연금사업장) — 상충 자동 플래그 ──
const addrs = [
  ['본점주소', report.basic.find(f => f.key === '본점주소')?.value],
  ['제조소 소재지', report.basic.find(f => f.key === '제조소 소재지')?.value],
  ['사업장 주소 (연금기준)', report.capacity.find(f => f.key === '사업장 주소 (연금기준)')?.value],
].filter(([, v]) => v);
if (addrs.length >= 2) {
  const uniq = new Set(addrs.map(([, v]) => v.replace(/\s/g, '').slice(0, 10)));
  if (uniq.size > 1) {
    report.risk_flags.push({
      type: 'address_conflict',
      detail: addrs.map(([k, v]) => `${k}: ${v}`).join(' | '),
    });
  }
}

// ── 4단계: 크로스체크 시트 자동 생성 (gap / C등급 / 기간초과 / 상충) ──
const all = [...report.basic, ...report.capacity, ...report.finance];
report.crosscheck = all
  .filter(f => f.data_gap || f.grade === 'C' || f.fresh === false)
  .map(f => ({ key: f.key, expected: f.value, verified: null, match: null, src_type: f.source }));
// 주소 상충도 크로스체크 대상으로
if (report.risk_flags.some(f => f.type === 'address_conflict')) {
  report.crosscheck.unshift({ key: '실제 공장 소재지', expected: '3개 출처 상충 — 플래그 참조', verified: null, match: null, src_type: '3중대조' });
}

report.meta.overall_grade = overallGrade(all);
report.meta.sources_used = [...new Set(all.map(f => f.source))];

// ── 5단계: 불변 스냅샷 저장 + 직전 버전 diff ──
const dir = 'data/snapshots';
fs.mkdirSync(dir, { recursive: true });
const safe = vendorName.replace(/[^\w가-힣]/g, '_');
const prev = fs.readdirSync(dir).filter(f => f.startsWith(safe + '_v')).sort();
report.meta.version = prev.length + 1;

if (prev.length) {
  const last = JSON.parse(fs.readFileSync(path.join(dir, prev[prev.length - 1]), 'utf8'));
  const lastAll = [...(last.basic || []), ...(last.capacity || []), ...(last.finance || [])];
  report.diff_from_prev = all
    .map(f => {
      const old = lastAll.find(o => o.key === f.key);
      return old && old.value !== f.value ? { key: f.key, before: old.value, after: f.value } : null;
    })
    .filter(Boolean);
}

const file = path.join(dir, `${safe}_v${report.meta.version}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));

// 방문 전 읽기용 Markdown 리포트도 같은 버전으로 저장 (인쇄/공유용)
const mdFile = path.join(dir, `${safe}_v${report.meta.version}.md`);
fs.writeFileSync(mdFile, buildMarkdown(report));

console.log(`✔ 스냅샷 저장: ${file}`);
console.log(`✔ 방문 리포트: ${mdFile}`);
console.log(`  전체신뢰도: ${report.meta.overall_grade}`);
console.log(`  크로스체크 대상: ${report.crosscheck.length}건 / 리스크 플래그: ${report.risk_flags.length}건`);
if (report.diff_from_prev?.length) console.log(`  직전 버전 대비 변경: ${report.diff_from_prev.length}건`);
