// ═══ 한눈에 보기 보강 ═══
// 이미 모은 자료를 판정·생산역량 칸으로 끌어올린다 — 한 문장 요약 · 역량 요약(제형·설비·인증·CAPA·재무).
// 새 조회는 하지 않고 리포트에 있는 값만 쓴다(저장된 리포트도 그대로 동작).
// 값마다 출처를 붙이고, 누르면 그 값이 나온 페이지(기사·홈페이지 하위 페이지)로 간다.

const bfClean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const bfPy = (m2) => Math.round(m2 / 3.305785).toLocaleString();
const bfEok = (won) => { const v = won / 1e8; return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1); };

// 재무위험 보도 — 기사 타임라인에 이미 '재무위험'으로 분류된 것(적자·자본잠식·법정관리 등)
function bfFinRisk(report) {
  const tl = ((report.insights || {}).timeline || []).filter((t) => t.tag === '재무위험');
  const wr = (report.web_risk || []).filter((w) => w.kind === '재무 악화');
  const n = tl.length || wr.length;
  if (!n) return null;
  const top = tl[0] || wr[0];
  return { n, title: bfClean(top.title), link: top.link || '', date: top.date || '' };
}

// 기사·웹 언급 본문 — 이 업체 이름이 든 것만(남의 회사 수치를 이 업체 것으로 적지 않게)
function bfTexts(report) {
  const key = stripCorp((report.meta && report.meta.vendor_name) || '').replace(/\s/g, '');
  const out = [], seen = new Set();
  const push = (title, desc, link) => {
    const t = bfClean(`${title || ''} ${desc || ''}`);
    if (!t || seen.has(t)) return; seen.add(t);
    if (key.length >= 2 && !t.replace(/\s/g, '').includes(key)) return;
    out.push({ t, link: link || '', title: bfClean(title) });
  };
  (report.oem_trace || []).forEach((x) => push(x.title, x.desc, x.link));
  (report.news || []).forEach((x) => push(x.title, x.description || x.desc, x.originallink || x.link));
  ((report.insights || {}).timeline || []).forEach((x) => push(x.title, x.desc, x.link));
  return out;
}
// 기사에서 생산능력·설비·인증·규모를 뽑는다
function bfFacts(report) {
  const F = { capa: [], equip: [], cert: [], area: [] };
  const add = (k, v, src) => { if (v && !F[k].some((x) => x.v === v)) F[k].push({ v, link: src.link, title: src.title }); };
  bfTexts(report).forEach((s) => {
    let m;
    const reY = /(연간?|연)\s*(?:최대\s*)?생산\s*(?:능력|량|규모)[은는이가]?\s*(?:약\s*)?([\d,.]+\s*(?:억|천만|백만|만)?\s*(?:개|톤))/g;
    while ((m = reY.exec(s.t))) add('capa', `연 ${m[2].replace(/\s+/g, '')}`, s);
    const reM = /월\s*(?:간|평균|최대)?\s*생산\s*(?:능력|량)[은는이가]?\s*(?:약\s*)?([\d,.]+\s*(?:억|천만|백만|만)?\s*(?:개|톤))/g;
    while ((m = reM.exec(s.t))) add('capa', `월 ${m[1].replace(/\s+/g, '')}`, s);
    const reA = /(?:약\s*)?([\d,]{3,})\s*평\s*규모/g;
    while ((m = reA.exec(s.t))) add('area', `약 ${m[1]}평 규모`, s);
    const reE = /((?:분석|시험|충전|제조|포장|생산)\s*(?:장비|설비|라인)\s*\d+\s*(?:종|대|기|개|라인))/g;
    while ((m = reE.exec(s.t))) add('equip', m[1].replace(/\s+/g, ' '), s);
    if (typeof extractLexicon === 'function') extractLexicon(s.t, EQUIP_LEX).forEach((g) => g.terms.slice(0, 6).forEach((t) => add('equip', t, s)));
    // CGMP는 식약처 명단만 근거로 쓴다 — 기사 속 CGMP는 해외 법인(무석 등)·계열사 얘기일 수 있다
    if (typeof CERT_PATTERNS !== 'undefined') CERT_PATTERNS.forEach((c) => { if (!/CGMP|우수화장품/.test(c.label) && c.re.test(s.t)) add('cert', c.label, s); });
  });
  return F;
}

// 국민연금 고지액으로 낸 연 인건비 하한(고지액 ÷ 9% × 12) — 급성장 신호와 같은 집계에서 이 업체 줄을 찾는다
function bfGrowthRow(report) {
  const d = typeof growthState !== 'undefined' && growthState.data;
  if (!d || !Array.isArray(d.rows)) return null;
  const bz = String(((report.basic || []).find((x) => x.key === '사업자등록번호') || {}).value || '').replace(/\D/g, '');
  if (bz.length !== 10) return null;
  const nk = (v) => stripCorp(v || '').replace(/\s/g, ''), me = nk(report.meta.vendor_name);
  const r = d.rows.find((x) => x.bz6 === bz.slice(0, 6) && (nk(x.nm) === me || nk(x.mfdsName) === me));
  return r ? { r, d } : null;
}
function bfLabor(report) {
  const G = bfGrowthRow(report);
  if (!G || !Array.isArray(G.r.a) || !G.r.a.length) return null;
  const a = G.r.a[G.r.a.length - 1];
  if (!a) return null;
  return { year: (a / 0.09) * 12, ym: G.d.ym, n: G.r.s[G.r.s.length - 1] };
}
// 최신 매출(억)과 출처 — finance_history의 마지막 해
function bfRevenue(report) {
  const h = (report.finance_history || []).filter((x) => x && x.revenue != null).sort((a, b) => a.year - b.year);
  if (!h.length) return null;
  const last = h[h.length - 1];
  return { v: last.revenue, year: last.year, ext: last.src === 'ext' || (last.srcOf && last.srcOf.revenue === 'ext'), host: last.host || '', hist: h };
}

// ── 한 문장 요약 ──
function bfOneLine(report, Q) {
  const m = report.meta || {}, B = report.basic || [], C = report.capacity || [];
  const v = (arr, k) => { const x = arr.find((y) => y.key === k); return x && x.value ? String(x.value) : ''; };
  const bits = [];
  const lic = (v(B, '제조업 등록').match(/(20\d{2}|19\d{2})-\d{2}-\d{2}\s*허가/) || [])[1];
  if (lic) bits.push(`${lic}년 허가`);
  bits.push(v(C, 'CGMP 적합업소') ? 'CGMP 적합' : 'CGMP 미등재');
  const addr = v(C, '실제 공장 소재지 (선정)') || v(B, '본점주소');
  const reg = (addr.match(/^[가-힣]+\s+([가-힣]+(?:시|군))/) || [])[1] || '';
  const bld = m.bld && m.bld.arch && !m.bld.unit ? m.bld : null;
  if (bld) {
    const fl = Math.max(0, ...(bld.bldgs || []).map((b) => b.floors || 0));
    bits.push(`${reg ? `${reg} ` : ''}${fl > 1 ? `${fl}층 ` : ''}공장(건평 ${bfPy(bld.arch)}평)`);
  } else if (reg) bits.push(`${reg} 소재`);
  const emp = (v(C, '제조소 추정 근무 인원').match(/^\s*([\d,]+)/) || [])[1];
  if (emp) bits.push(`${emp}명`);
  let tail = '';
  const fr = bfFinRisk(report), rev = bfRevenue(report);
  if (Q.grade === 'C' || Q.grade === 'D') tail = `${Q.why}.`;
  else if (fr) tail = `재무위험 보도가 ${fr.n}건 있어 재무 확인이 먼저입니다.`;
  else if (rev && rev.hist.length >= 2) {
    const a = rev.hist[rev.hist.length - 2], b = rev.hist[rev.hist.length - 1];
    tail = `매출 ${a.revenue}억(${a.year}) → ${b.revenue}억(${b.year}).`;
  }
  return `${bits.join(', ')}.${tail ? ` ${tail}` : ''}`;
}

// ── 역량 요약 ── 제형 · 설비 · 인증 · CAPA · 재무를 한 카드에. 값마다 어디서 나온 것인지 붙인다
const BF_SRC = { of: '공식', hp: '홈페이지', img: '홈페이지 이미지', nw: '기사', ext: '외부 사이트', est: '추정' };
const bfHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const bfPath = (u) => { try { const x = new URL(u); return (x.pathname + x.search).replace(/\/$/, '') || '/'; } catch { return ''; } };
// srcText — 출처를 사람이 읽을 수 있게(기관명 · 사이트 · 페이지). 링크가 있으면 칩을 눌러 원문을 연다
const bfChip = (text, src, link, srcText) => {
  const where = srcText || (link ? (src === 'hp' || src === 'img' ? `${bfHost(link)}${bfPath(link) !== '/' ? ` ${bfPath(link).slice(0, 28)}` : ''}` : bfHost(link)) : '');
  const inner = `${esc(text)}<i>${BF_SRC[src] || ''}${where ? ` · ${esc(where)}` : ''}</i>`;
  return link ? `<a class="bf-chip s-${src}" href="${esc(link)}" target="_blank" rel="noopener" title="${esc(link)}">${inner}</a>` : `<span class="bf-chip s-${src}">${inner}</span>`;
};
function bfCapabilityHtml(report) {
  const m = report.meta || {}, C = report.capacity || [];
  const deep = (report._siteDeep && report._siteDeep.data) || null, tabs = (deep && deep.tabs) || {};
  const F = bfFacts(report);
  const row = (k, chips, empty) => `<div class="bf-row"><span class="bf-k">${k}</span><div class="bf-v">${chips.length ? chips.join('') : `<span class="bf-none">${empty}</span>`}</div></div>`;
  // 제형
  const PL = typeof productLines === 'function' ? productLines(report) : null;
  const form = PL && PL.list ? PL.list.slice(0, 8).map((c) => { const src = Object.keys(c.ev || {})[0] || ''; return bfChip(c.name, c.tier === 'guess' ? 'est' : 'of', null, src.replace(/\(.*\)/, '').trim()); }) : [];
  // 설비
  const eq = [];
  const pg = (deep && deep.termPages) || {}, base = (report._siteDeep && report._siteDeep.base) || null;
  const pageOf = (t) => pg[String(t).replace(/\s*\(이미지\)$/, '').toLowerCase().replace(/\s/g, '')] || base;
  (tabs.equipTerms || []).forEach((g) => g.terms.slice(0, 5).forEach((t) => eq.push(bfChip(t.replace(/\s*\(이미지\)$/, ''), /\(이미지\)$/.test(t) ? 'img' : 'hp', pageOf(t)))));
  F.equip.slice(0, 6).forEach((x) => eq.push(bfChip(x.v, 'nw', x.link)));
  // 인증
  const cert = [];
  const cg = C.find((x) => x.key === 'CGMP 적합업소' && x.value);
  if (cg) cert.push(bfChip('CGMP 적합', 'of', null, '식약처 적합업소 명단'));
  const seenC = new Set(cg ? ['CGMP (우수화장품제조)'] : []);
  (tabs.cert || []).filter((c) => c.level === 'own' || !c.level).forEach((c) => { if (!seenC.has(c.label)) { seenC.add(c.label); cert.push(bfChip(c.label.replace(/\s*\(.*\)$/, ''), c.ocr ? 'img' : 'hp', c.page || base)); } });
  F.cert.forEach((x) => { if (!seenC.has(x.v)) { seenC.add(x.v); cert.push(bfChip(x.v.replace(/\s*\(.*\)$/, ''), 'nw', x.link)); } });
  // CAPA
  const capa = [];
  ((m.air && m.air.rows) || []).filter((r) => r.atSite && r.product).forEach((r) => { const q = (String(r.product).match(/\(([^)]*\d[^)]*)\)/) || [])[1]; if (q) capa.push(bfChip(`연 ${q} (${String(r.product).replace(/\(.*$/, '').trim()})`, 'of', null, '대기 배출시설 신고 주생산품')); });
  (tabs.capa || []).filter((c) => /생산능력/.test(c.kind)).slice(0, 3).forEach((c) => capa.push(bfChip(`${c.kind.replace(' 생산능력', '')} ${c.value}`, c.ocr ? 'img' : 'hp', c.page || base)));
  F.capa.slice(0, 3).forEach((x) => capa.push(bfChip(x.v, 'nw', x.link)));
  F.area.slice(0, 1).forEach((x) => capa.push(bfChip(x.v, 'nw', x.link)));
  // 재무
  const fin = [];
  const rev = bfRevenue(report), lab = bfLabor(report);
  if (rev) fin.push(bfChip(`매출 ${rev.v}억 (${rev.year})`, rev.ext ? 'ext' : 'of', null, rev.ext ? rev.host : '금융위 재무'));
  const fh = report.finance_health;
  if (fh && fh.debtRatio != null) fin.push(bfChip(fh.equity != null && fh.equity <= 0 ? '자본잠식' : `부채비율 ${fh.debtRatio}%`, 'of', null, `금융위 재무${fh.year ? ` ${fh.year}` : ''}`));
  if (lab) fin.push(bfChip(`연 인건비 약 ${bfEok(lab.year)}억 이상`, 'est', null, '국민연금 고지액'));
  const fr = bfFinRisk(report);
  if (fr) fin.push(bfChip(`재무위험 보도 ${fr.n}건`, 'nw', fr.link));
  let finNote = '';
  if (lab) {
    const revWon = rev ? rev.v * 1e8 : null;
    finNote = `인건비는 국민연금 고지액(${esc(String(lab.ym).replace('-', '.'))}, ${lab.n}명) ÷ 9% × 12로 낸 하한입니다.`
      + (revWon && lab.year > revWon * 0.6 ? ` 매출(${rev.year}) 대비 ${Math.round((lab.year / revWon) * 100)}% — 매출이 그 뒤 늘었거나 적자 구조일 수 있습니다.` : '');
  }
  const needDeep = !deep && m.live;
  return '<div class="bf-cap" id="capSum"><h4>역량 요약 <small>제형 · 설비 · 인증 · 생산능력 · 재무 — 값을 누르면 출처 원문</small></h4>'
    + row('가능 제형', form, '공개 자료에 단서 없음')
    + row('보유 설비', eq, needDeep ? '홈페이지 분석 중이거나 단서 없음' : '공개 자료에 단서 없음')
    + row('인증', cert, '확인된 인증 없음')
    + row('생산능력', capa, '공개 수치 없음 — 방문 때 월 생산량 확인')
    + row('재무', fin, '공시·외부 자료 없음 — 표준재무제표증명 요청')
    + (finNote ? `<p class="bf-note">${finNote}</p>` : '')
    + '<p class="bf-legend">' + ['of', 'hp', 'img', 'nw', 'ext', 'est'].map((k) => `<span class="bf-chip s-${k} mini"><i>${BF_SRC[k]}</i></span>`).join('')
    + ' 값 옆 표시는 출처입니다. 기사·홈페이지 값은 회사가 쓴 문구라 방문 때 원본으로 확인하세요.</p></div>';
}
// 생산역량 · 인원 칸 맨 아래에 붙는다. 홈페이지 분석이 끝나면 이 부분만 다시 그린다
function capSumEl(report) {
  if (!report.meta || !report.meta.live) return null;
  const w = document.createElement('div');
  w.innerHTML = bfCapabilityHtml(report);
  return w.firstElementChild;
}
function refreshBrief(report) {
  if (typeof currentReport !== 'undefined' && currentReport !== report) return;
  const old = document.getElementById('capSum');
  const nb = capSumEl(report);
  if (old && nb) old.replaceWith(nb);
}


// ═══ 인쇄 / PDF — 한 장 요약 ═══
// 화면을 그대로 찍지 않고, 판정 · 카테고리별 핵심 · 방문 확인사항만 A4 한 장에 담는다.
function printSheetHtml(report) {
  const m = report.meta || {}, B = report.basic || [], C = report.capacity || [];
  const v = (arr, k) => { const x = arr.find((y) => y.key === k); return x && x.value != null && x.value !== '' ? String(x.value) : ''; };
  const Q = typeof qualityGrade === 'function' ? qualityGrade(report) : { grade: '-', why: '' };
  const V = (typeof VERDICT !== 'undefined' && VERDICT[Q.grade]) || { label: '' };
  const at = m.query_at ? new Date(m.query_at) : null;
  const ymd = at && !isNaN(at) ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}` : '';
  const row = (k, val, sub) => (val ? `<tr><th>${esc(k)}</th><td>${esc(val)}${sub ? `<small>${esc(sub)}</small>` : ''}</td></tr>` : '');
  const box = (t, rows) => (rows.join('') ? `<section><h3>${esc(t)}</h3><table>${rows.join('')}</table></section>` : '');
  const rev = bfRevenue(report), fh = report.finance_health, fr = bfFinRisk(report), lab = bfLabor(report);
  const trend = (m.manpower && m.manpower.trend) || [];
  const emp = v(C, '제조소 추정 근무 인원').split('·')[0].trim();
  const bld = m.bld && m.bld.arch && !m.bld.unit ? m.bld : null;
  const fl = bld ? Math.max(0, ...(bld.bldgs || []).map((b) => b.floors || 0)) : 0;
  const deep = (report._siteDeep && report._siteDeep.data) || null, tabs = (deep && deep.tabs) || {};
  const F = bfFacts(report);
  const PL = typeof productLines === 'function' ? productLines(report) : null;
  const equip = [...new Set([...(tabs.equipTerms || []).flatMap((g) => g.terms.map((t) => t.replace(/\s*\(이미지\)$/, ''))), ...F.equip.map((x) => x.v)])].slice(0, 8);
  const cgOk = !!v(C, 'CGMP 적합업소');
  const certs = [...new Set([cgOk ? 'CGMP 적합(식약처)' : '', ...F.cert.map((x) => x.v.replace(/\s*\(.*\)$/, '')), ...(tabs.cert || []).filter((c) => c.level === 'own').map((c) => c.label.replace(/\s*\(.*\)$/, ''))].filter((x) => x && !(cgOk && x === 'CGMP')))].slice(0, 6);
  const airQ = ((m.air && m.air.rows) || []).filter((r) => r.atSite && r.product).map((r) => r.product)[0] || '';
  const capa = [airQ ? `${airQ} (대기 신고)` : '', ...F.capa.map((x) => `${x.v} (기사)`), ...(tabs.capa || []).filter((c) => /생산능력/.test(c.kind)).map((c) => `${c.kind.replace(' 생산능력', '')} ${c.value} (홈페이지)`)].filter(Boolean).slice(0, 3);
  const Z = m.geo && m.geo.site && m.geo.site.uses && typeof sgZone === 'function' ? sgZone(m.geo.site.uses) : null;
  const MA = m.admin, MC = m.court;
  const warns = ((report.cross_diag || {}).items || []).filter((c) => c.status === 'warn').map((c) => `${c.label}: ${String(c.detail || '').split(' — ')[0]}`);
  const its = typeof buildVisitChecklist === 'function' ? buildVisitChecklist(report) : [];
  const PR = { high: 0, mid: 1, low: 2 };
  const todo = [...its].sort((a, b) => (PR[a.pri] ?? 3) - (PR[b.pri] ?? 3)).slice(0, 7);
  return `<div class="ps">`
    + `<header><div class="ps-g g-${esc(Q.grade)}">${Q.grade === 'D' ? '불가' : esc(Q.grade)}</div><div class="ps-h"><h1>${esc(m.vendor_name || '')}</h1>`
    + `<p class="ps-v"><b>${esc(V.label)}</b> — ${esc(Q.why)}</p><p class="ps-one">${esc(bfOneLine(report, Q))}</p></div>`
    + `<div class="ps-meta">사전검증 리포트<br>조회 ${esc(ymd)}<br>사업자 ${esc(v(B, '사업자등록번호') || '—')}</div></header>`
    + `<div class="ps-grid">`
    + box('기업 · 재무', [row('대표자', v(B, '대표자')), row('설립', v(B, '설립일 / 등록일')), row('사업자 상태', v(B, '사업자 상태')),
      row('본점', v(B, '본점주소')),
      row('매출', rev ? `${rev.v}억 원 (${rev.year})` : '', rev && rev.ext ? `외부 사이트 ${rev.host}` : rev ? '공시' : ''),
      row('부채비율', fh && fh.debtRatio != null ? (fh.equity <= 0 ? '자본잠식' : `${fh.debtRatio}%`) : '', fh && fh.year ? `${fh.year}년` : ''),
      row('연 인건비', lab ? `약 ${bfEok(lab.year)}억 원 이상` : '', '국민연금 고지액 기반 추정'),
      row('재무위험 보도', fr ? `${fr.n}건` : '', fr ? fr.title.slice(0, 40) : '')])
    + box('생산 · 역량', [row('제조업 허가', v(B, '제조업 등록')), row('CGMP', v(C, 'CGMP 적합업소') ? '적합' : '미등재'),
      row('인원', emp, trend.length >= 6 ? `${trend[0].ym.slice(0, 4)}.${trend[0].ym.slice(4)} ${trend[0].cnt}명 → ${trend[trend.length - 1].cnt}명` : ''),
      row('공장', bld ? `건평 약 ${bfPy(bld.arch)}평 · 연면적 약 ${bfPy(bld.tot || 0)}평` : '', bld ? [fl > 1 ? `지상 ${fl}층` : '', bld.firstApr ? `${String(bld.firstApr).slice(0, 4)} 사용승인` : ''].filter(Boolean).join(' · ') : ''),
      row('제형', PL && PL.list ? PL.list.slice(0, 6).map((c) => c.name).join(', ') : ''),
      row('설비', equip.join(', ')), row('인증', certs.join(', ')), row('생산능력', capa.join(' · '))])
    + box('입지 · 이동', [row('공장 주소', v(C, '실제 공장 소재지 (선정)') || v(B, '공장/제조소 소재지')),
      row('용도지역', Z ? `${Z.zone || ''}${Z.park ? ` · ${Z.park}` : ''}` : ''), row('방문 거리', v(C, '방문 이동거리')),
      row('연락처', v(C, '공장 연락처'))])
    + box('위험 · 대조', [row('회수·판매중지', `${(report.recalls || []).length}건`),
      row('식약처 행정처분', MA ? (MA.n ? `공개 중 ${MA.n}건` : '없음') : ''), row('회생·파산 공고', MC ? (MC.hits && MC.hits.length ? `${MC.hits.length}건` : '없음') : ''),
      ...warns.slice(0, 3).map((w, i) => row(i ? '' : '교차 대조 주의', w))])
    + `</div>`
    + (todo.length ? `<section class="ps-todo"><h3>방문 때 확인할 것</h3><ol>${todo.map((t) => `<li><b>${esc(t.cat || '확인')}</b> ${esc(String(t.text || '').slice(0, 130))}</li>`).join('')}</ol></section>` : '')
    + `<footer>공공데이터(식약처·금융위·국민연금·국세청·산업단지공단·국토부·근로복지공단·행정안전부)와 웹 자료를 모아 자동으로 작성했습니다. 기사·홈페이지·외부 사이트 값은 방문 때 원본으로 확인하세요. · vendor-scout</footer>`
    + `</div>`;
}
window.addEventListener('beforeprint', () => {
  const r = typeof currentReport !== 'undefined' ? currentReport : null;
  if (!r || !r.meta) return;
  let el2 = document.getElementById('printSheet');
  if (!el2) { el2 = document.createElement('div'); el2.id = 'printSheet'; document.body.appendChild(el2); }
  try { el2.innerHTML = printSheetHtml(r); document.body.classList.add('print-sum'); } catch (e) { document.body.classList.remove('print-sum'); }
});
window.addEventListener('afterprint', () => { document.body.classList.remove('print-sum'); const x = document.getElementById('printSheet'); if (x) x.innerHTML = ''; });
