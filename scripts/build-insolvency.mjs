// 법원 회생·파산 공고 수집 — 대법원 「회생·파산 공고」 화면(ssgo.scourt.go.kr)이 쓰는 공개 목록을 전국 회생 관할 법원별로
// 법인회생·법인파산 두 업무만 받아 data/court/insolvency.json에 모은다. 화면은 업체명으로 맞춰 본다.
// (채무자명 검색은 익명 요청에 늘 0건을 돌려줘서, 목록 전체를 받아 이름으로 대조한다.)
import fs from 'node:fs';

const URL = 'https://ssgo.scourt.go.kr/ssgo/ssgo930/selectRhblBnkpPbancLst.on';
const REF = 'https://ssgo.scourt.go.kr/ssgo/ssgo930/rhblBnkp.on';
// 회생·파산 화면의 법원 목록(SSGO931M01.xml) — 회생법원과 회생 사건을 맡는 지방법원·지원
const COURTS = {
  '000221': '서울회생법원', '000214': '의정부지법', '000240': '인천지법', '000249': '수원회생법원', '000260': '춘천지법', '000261': '강릉지원',
  '000291': '대전회생법원', '000270': '청주지법', '000321': '대구회생법원', '000443': '부산회생법원', '000411': '울산지법', '000420': '창원지법',
  '000543': '광주회생법원', '000520': '전주지법', '000530': '제주지법',
};
const TASKS = { 4: '법인회생', 5: '법인파산' };
const PAGE = 1000;

async function page(task, cort, no) {
  const body = JSON.stringify({ dma_search: { taskDvs: String(task), srchType: 'pstgBgng', cortCd: cort, pstgDvs: '999' }, dma_pageInfo: { pageNo: no, pageSize: PAGE, totalYn: 'Y' } });
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(URL, { method: 'POST', body, headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json', Referer: REF, 'User-Agent': 'Mozilla/5.0 (vendor-scout public notice collector)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return { list: (j.data && j.data.dlt_pbancLst) || [], total: Number(j.data && j.data.dma_pageInfo && j.data.dma_pageInfo.totalCnt) || 0 };
    } catch (e) { if (k === 2) throw e; await new Promise((s) => setTimeout(s, 2000 * (k + 1))); }
  }
}

const ymd = (v) => (/^\d{8}$/.test(String(v || '')) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);
const cases = new Map();   // 사건 하나 = 한 줄. 공고가 여러 번 나도 가장 최근 공고와 첫 공고만 남긴다
const fails = [];
for (const [cort, cnm] of Object.entries(COURTS)) {
  for (const [task, tnm] of Object.entries(TASKS)) {
    try {
      let no = 1, got = 0, total = 0;
      do {
        const p = await page(task, cort, no);
        total = p.total;
        for (const x of p.list) {
          const key = `${cort}|${x.csNo}`;
          const d = ymd(x.pbancBgngYmd);
          const c = cases.get(key) || { n: String(x.btprtNm || '').trim(), c: cnm, t: tnm, cs: x.csNoNm || x.csNo, first: d, last: d, lastT: x.pbancTitlNm || '', k: 0 };
          if (d && (!c.first || d < c.first)) c.first = d;
          if (d && (!c.last || d >= c.last)) { c.last = d; c.lastT = x.pbancTitlNm || c.lastT; }
          c.k++;
          cases.set(key, c);
        }
        got += p.list.length; no++;
        await new Promise((s) => setTimeout(s, 400));
      } while (got < total && no <= 20);
      console.log(`${cnm} ${tnm}: ${total}건 공고`);
    } catch (e) { fails.push(`${cnm} ${tnm}: ${e.message}`); console.log(`실패 ${cnm} ${tnm} ${e.message}`); }
  }
}
const rows = [...cases.values()].filter((c) => c.n).sort((a, b) => String(b.last).localeCompare(String(a.last)));
const out = { at: new Date().toISOString(), source: '대법원 회생·파산 공고(ssgo.scourt.go.kr) — 법인회생·법인파산, 전국 회생 관할 법원', courts: Object.keys(COURTS).length, cases: rows.length, fails, rows };
fs.mkdirSync('data/court', { recursive: true });
// 수집이 통째로 실패하면(법원 화면 변경 등) 지난 파일을 덮지 않는다
if (!rows.length) { console.log('수집 0건 — 기존 파일 유지'); process.exit(fails.length ? 1 : 0); }
fs.writeFileSync('data/court/insolvency.json', JSON.stringify(out));
console.log(`사건 ${rows.length}건 저장 · 실패 ${fails.length}`);
