// ═══ 한눈에 보기 보강 ═══
// 이미 모은 자료를 판정·첫 화면으로 끌어올린다 — 이슈 줄 · 한 문장 요약 · 역량 요약(제형·설비·인증·CAPA·재무) ·
// 제조 실재성 근거 · 같은 시·군 업체. 새 조회는 하지 않고 리포트에 있는 값만 쓴다(저장된 리포트도 그대로 동작).

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
    if (typeof CERT_PATTERNS !== 'undefined') CERT_PATTERNS.forEach((c) => { if (c.re.test(s.t)) add('cert', c.label, s); });
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

// ── 이슈 줄 ── 위험·불일치만. 자료 공백은 이슈가 아니다
function bfIssues(report, Q) {
  const out = [];
  const add = (sev, k, t, src, link) => { if (!out.some((x) => x.k === k)) out.push({ sev, k, t, src: src || '', link: link || '' }); };
  (Q.checks || []).forEach((c) => {
    if (c.kind !== 'risk' && c.kind !== 'gate') return;
    if (c.ok === false) add('bad', c.k, c.t, '공식 자료');
  });
  const fr = bfFinRisk(report);
  if (fr) add(fr.n >= 2 ? 'bad' : 'warn', '재무', `재무위험 보도 ${fr.n}건 — 「${fr.title.slice(0, 46)}${fr.title.length > 46 ? '…' : ''}」`, `기사${fr.date ? ` ${fr.date}` : ''}`, fr.link);
  (report.web_risk || []).filter((w) => w.sev === 'high').forEach((w) => add('bad', w.kind, `「${w.kw}」 — ${w.src} 문구, 공식 확인 필요`, w.src, w.link));
  (Q.checks || []).forEach((c) => { if (c.kind === 'risk' && c.ok === null && c.k !== '웹 위험 신호' && c.k !== '재무위험 보도') add('warn', c.k, c.t, '공식 자료'); });
  ((report.cross_diag || {}).items || []).filter((c) => c.status === 'warn').forEach((c) => add(c.severe ? 'bad' : 'warn', c.label.replace(/\s*정합성$/, ''), String(c.detail || '').split(' — ')[0], '교차 대조'));
  const W = report.meta && report.meta.workforce;
  if (W && W.noMfg) add('warn', '제조 인력', '보험상 화장품 제조 사업장이 없음 — 직접 제조하는지 확인', '고용·산재보험');
  else if (W && W.indOdd) {
    const s = (W.sites || []).find((x) => x.atSite) || {};
    const ind = (s.gy && s.gy.ind) || (s.sj && s.sj.ind) || '';
    add('warn', '보험 업종', `제조소 주소의 보험 업종이 「${ind || '화장품 제조 아님'}」 — 제조 인력인지 확인`, '고용·산재보험');
  }
  (report.risk_flags || []).filter((r) => !r.web).forEach((r) => add('warn', r.type, String(r.detail || '').split('. ')[0].slice(0, 90), '기준정보'));
  out.sort((a, b) => (a.sev === 'bad' ? 0 : 1) - (b.sev === 'bad' ? 0 : 1));
  return out;
}
function bfIssuesHtml(report, Q) {
  const all = bfIssues(report, Q);
  if (!all.length) return '<div class="bf-noissue"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>수집한 자료에서 위험·불일치 신호를 찾지 못했습니다</div>';
  const top = all.slice(0, 3);
  return `<div class="bf-issues">${top.map((x) => `<div class="bf-issue ${x.sev}"><b>${esc(x.k)}</b><span>${esc(x.t)}</span>`
    + (x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.src || '근거')}</a>` : `<em>${esc(x.src)}</em>`) + '</div>').join('')}`
    + (all.length > 3 ? `<button type="button" class="bf-more" data-act="todo-all">이슈 ${all.length - 3}건 더 — 확인사항에서 보기 ↓</button>` : '') + '</div>';
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

// ── 제조 실재성 근거 ── 흩어진 6개 근거를 한 줄씩
function bfChain(report) {
  const m = report.meta || {}, B = report.basic || [];
  const v = (k) => { const x = B.find((y) => y.key === k); return x && x.value ? String(x.value) : ''; };
  const st = (m.src_status || []);
  const src = (k) => st.find((x) => x.key === k);
  const rows = [];
  const add = (s, t, by, extra) => rows.push({ s, t, by, extra: extra || '' });
  add(v('제조업 등록') ? 'ok' : 'bad', v('제조업 등록') ? '화장품 제조업 허가' : '화장품 제조업 허가 미확인', '식약처');
  const fc = src('factory');
  add(fc && fc.ok && !fc.warn ? 'ok' : 'na', fc && fc.ok && !fc.warn ? `공장등록${/화장품/.test(fc.detail || '') ? ' · 생산품 화장품' : ''}` : '공장등록 없음 (소규모는 의무 아님)', '산단공');
  const bld = m.bld && m.bld.arch ? m.bld : null;
  if (!bld) add('na', '건축물대장 미확인', '국토부');
  else if (bld.unit) add('warn', '오피스형 건물의 호실 입주 — 생산 공간 확인', '국토부');
  else if (bld.factoryCount) add('ok', `건축물대장 공장 용도 ${bld.factoryCount}동`, '국토부');
  else add('warn', `공장 용도 건물 없음${(bld.purposes || []).length ? ` (${bld.purposes.slice(0, 2).join('·')})` : ''}`, '국토부');
  const uses = m.geo && m.geo.site && m.geo.site.uses;
  if (uses && typeof sgZone === 'function') {
    const Z = sgZone(uses);
    add(Z.level === 'ok' ? 'ok' : Z.level === 'unk' ? 'na' : Z.level === 'bad' ? 'bad' : 'warn', `${Z.zone || '용도지역 미확인'}${Z.park ? ` · ${Z.park}` : ''}`, '토지이용계획');
  } else add('na', '용도지역 조회 전', '토지이용계획');
  const W = m.workforce;
  if (!W) add('na', '보험 사업장 미확인', '고용·산재보험');
  else if (W.noMfg) add('warn', '보험상 화장품 제조 사업장 없음', '고용·산재보험');
  else if (W.indOdd) add('warn', `제조소 주소에 ${W.mfg}명 · 보험 업종은 제조업 아님`, '고용·산재보험');
  else add('ok', `제조소 보험 사업장 ${W.mfg}명`, '고용·산재보험');
  const A = m.air, as = src('air');
  if (!A) add('na', as && as.ok === false ? '대기 배출 신고 조회 실패' : '대기 배출 신고 미조회', '행정안전부', as && as.ok === false && m.live ? '<button type="button" class="bf-retry" data-act="air-retry">다시 조회</button>' : '');
  else {
    const at = (A.rows || []).filter((r) => r.atSite);
    if (at.some((r) => !r.isClosed)) { const r = at.find((x) => !x.isClosed); add('ok', `대기 배출시설 신고 · 영업${r.product ? ` · ${r.product}` : ''}`, '행정안전부'); }
    else if (at.length) add('warn', '제조소 주소의 대기 배출시설이 폐업·휴업', '행정안전부');
    else add('na', '대기 배출 신고 없음 (소규모는 대상 아님)', '행정안전부');
  }
  return rows;
}
function bfChainHtml(report) {
  const rows = bfChain(report);
  const ok = rows.filter((r) => r.s === 'ok').length, warn = rows.filter((r) => r.s === 'warn' || r.s === 'bad').length;
  return `<div class="bf-box"><h4>제조 실재성 근거 <small>${rows.length}개 중 ${ok}개 확인${warn ? ` · 주의 ${warn}` : ''}</small></h4>`
    + `<div class="bf-meter" aria-hidden="true">${rows.map((r) => `<i class="${r.s}"></i>`).join('')}</div>`
    + `<ul class="bf-chain">${rows.map((r) => `<li class="${r.s}"><span>${esc(r.t)}${r.extra}</span><em>${esc(r.by)}</em></li>`).join('')}</ul></div>`;
}

// ── 역량 요약 ── 제형 · 설비 · 인증 · CAPA · 재무를 한 카드에. 값마다 어디서 나온 것인지 붙인다
const BF_SRC = { of: '공식', hp: '홈페이지', img: '이미지', nw: '기사', ext: '외부 사이트', est: '추정' };
const bfChip = (text, src, link) => {
  const inner = `${esc(text)}<i>${BF_SRC[src] || ''}</i>`;
  return link ? `<a class="bf-chip s-${src}" href="${esc(link)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="bf-chip s-${src}">${inner}</span>`;
};
function bfCapabilityHtml(report) {
  const m = report.meta || {}, C = report.capacity || [];
  const deep = (report._siteDeep && report._siteDeep.data) || null, tabs = (deep && deep.tabs) || {};
  const F = bfFacts(report);
  const row = (k, chips, empty) => `<div class="bf-row"><span class="bf-k">${k}</span><div class="bf-v">${chips.length ? chips.join('') : `<span class="bf-none">${empty}</span>`}</div></div>`;
  // 제형
  const PL = typeof productLines === 'function' ? productLines(report) : null;
  const form = PL && PL.list ? PL.list.slice(0, 8).map((c) => bfChip(c.name, c.tier === 'guess' ? 'est' : 'of')) : [];
  // 설비
  const eq = [];
  (tabs.equipTerms || []).forEach((g) => g.terms.slice(0, 5).forEach((t) => eq.push(bfChip(t.replace(/\s*\(이미지\)$/, ''), /\(이미지\)$/.test(t) ? 'img' : 'hp'))));
  F.equip.slice(0, 6).forEach((x) => eq.push(bfChip(x.v, 'nw', x.link)));
  // 인증
  const cert = [];
  const cg = C.find((x) => x.key === 'CGMP 적합업소' && x.value);
  if (cg) cert.push(bfChip('CGMP 적합', 'of'));
  const seenC = new Set(cg ? ['CGMP (우수화장품제조)'] : []);
  (tabs.cert || []).filter((c) => c.level === 'own' || !c.level).forEach((c) => { if (!seenC.has(c.label)) { seenC.add(c.label); cert.push(bfChip(c.label.replace(/\s*\(.*\)$/, ''), c.ocr ? 'img' : 'hp')); } });
  F.cert.forEach((x) => { if (!seenC.has(x.v)) { seenC.add(x.v); cert.push(bfChip(x.v.replace(/\s*\(.*\)$/, ''), 'nw', x.link)); } });
  // CAPA
  const capa = [];
  ((m.air && m.air.rows) || []).filter((r) => r.atSite && r.product).forEach((r) => { const q = (String(r.product).match(/\(([^)]*\d[^)]*)\)/) || [])[1]; if (q) capa.push(bfChip(`연 ${q} (${String(r.product).replace(/\(.*$/, '').trim()})`, 'of')); });
  (tabs.capa || []).filter((c) => /생산능력/.test(c.kind)).slice(0, 3).forEach((c) => capa.push(bfChip(`${c.kind.replace(' 생산능력', '')} ${c.value}`, c.ocr ? 'img' : 'hp')));
  F.capa.slice(0, 3).forEach((x) => capa.push(bfChip(x.v, 'nw', x.link)));
  F.area.slice(0, 1).forEach((x) => capa.push(bfChip(x.v, 'nw', x.link)));
  // 재무
  const fin = [];
  const rev = bfRevenue(report), lab = bfLabor(report);
  if (rev) fin.push(bfChip(`매출 ${rev.v}억 (${rev.year})`, rev.ext ? 'ext' : 'of'));
  const fh = report.finance_health;
  if (fh && fh.debtRatio != null) fin.push(bfChip(fh.equity != null && fh.equity <= 0 ? '자본잠식' : `부채비율 ${fh.debtRatio}%`, 'of'));
  if (lab) fin.push(bfChip(`연 인건비 약 ${bfEok(lab.year)}억 이상`, 'est'));
  const fr = bfFinRisk(report);
  if (fr) fin.push(bfChip(`재무위험 보도 ${fr.n}건`, 'nw', fr.link));
  let finNote = '';
  if (lab) {
    const revWon = rev ? rev.v * 1e8 : null;
    finNote = `인건비는 국민연금 고지액(${esc(String(lab.ym).replace('-', '.'))}, ${lab.n}명) ÷ 9% × 12로 낸 하한입니다.`
      + (revWon && lab.year > revWon * 0.6 ? ` 매출(${rev.year}) 대비 ${Math.round((lab.year / revWon) * 100)}% — 매출이 그 뒤 늘었거나 적자 구조일 수 있습니다.` : '');
  }
  const needDeep = !deep && m.live;
  return '<div class="bf-box bf-cap"><h4>역량 요약 <small>제형 · 설비 · 인증 · 생산능력 · 재무</small></h4>'
    + row('가능 제형', form, '공개 자료에 단서 없음')
    + row('보유 설비', eq, needDeep ? '홈페이지 분석 중이거나 단서 없음' : '공개 자료에 단서 없음')
    + row('인증', cert, '확인된 인증 없음')
    + row('생산능력', capa, '공개 수치 없음 — 방문 때 월 생산량 확인')
    + row('재무', fin, '공시·외부 자료 없음 — 표준재무제표증명 요청')
    + (finNote ? `<p class="bf-note">${finNote}</p>` : '')
    + '<p class="bf-legend">' + ['of', 'hp', 'img', 'nw', 'ext', 'est'].map((k) => `<span class="bf-chip s-${k} mini"><i>${BF_SRC[k]}</i></span>`).join('')
    + ' 값 옆 표시는 출처입니다. 기사·홈페이지 값은 방문 때 원본으로 확인하세요.</p></div>';
}

// ── 같은 시·군 화장품 제조업체 ── 국민연금 집계(식약처 허가 사업장)에서 같은 시·군만. 지도·반경은 「근처 업체」 탭
function bfPeersHtml(report) {
  const G = bfGrowthRow(report);
  const d = typeof growthState !== 'undefined' && growthState.data;
  if (!d || !Array.isArray(d.rows)) return '';
  const B = report.basic || [], C = report.capacity || [];
  const addr = (G && G.r.addr) || String(((C.find((x) => x.key === '실제 공장 소재지 (선정)') || {}).value) || ((B.find((x) => x.key === '본점주소') || {}).value) || '');
  const sgg = (String(addr).match(/^([가-힣]+)\s+([가-힣]+(?:시|군|구))/) || []);
  if (!sgg[2]) return '';
  const sido = sgg[1].slice(0, 2), last = (r) => (r.s && r.s[r.s.length - 1]) || 0;
  const peers = d.rows.filter((r) => r.mfds && (!G || r !== G.r) && String(r.addr || '').slice(0, 2) === sido && String(r.addr || '').includes(sgg[2])).sort((a, b) => last(b) - last(a));
  if (!peers.length) return '';
  const top = peers.slice(0, 3);
  return `<div class="bf-box bf-peers"><h4>같은 시·군 화장품 제조업체 <small>${esc(sgg[2])} · 식약처 허가 ${peers.length}곳 (국민연금 ${esc(String(d.ym).replace('-', '.'))} 기준)</small></h4>`
    + `<ul>${top.map((r) => `<li><b>${esc(r.mfdsName || r.nm)}</b><span>${last(r).toLocaleString()}명</span><button type="button" class="vd-alt" data-alt="${esc(r.mfdsName || r.nm)}">사전검증</button></li>`).join('')}</ul>`
    + '<button type="button" class="bf-more" data-act="go-nearby">근처 업체 탭에서 지도·거리 보기 →</button></div>';
}

// 판정 카드 아래에 한 묶음으로 넣는다
function briefBlock(report) {
  if (!report.meta || !report.meta.live) return null;
  const box = el('div', 'bf');
  box.id = 'briefBlock';
  box.innerHTML = `<div class="bf-grid">${bfCapabilityHtml(report)}<div class="bf-col">${bfChainHtml(report)}${bfPeersHtml(report)}</div></div>`;
  box.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-act="go-nearby"]');
    if (nb) { const t = document.getElementById('rtab-nearby'); if (t) t.click(); return; }
    const rt = e.target.closest('[data-act="air-retry"]');
    if (rt && typeof airRetry === 'function') { rt.disabled = true; rt.textContent = '조회 중…'; airRetry(report).finally(() => refreshBrief(report)); }
  });
  return box;
}
// 홈페이지 분석·대기 재조회처럼 늦게 온 자료로 이 묶음만 다시 그린다
function refreshBrief(report) {
  if (typeof currentReport !== 'undefined' && currentReport !== report) return;
  const old = document.getElementById('briefBlock');
  if (!old) return;
  const nb = briefBlock(report);
  if (nb) old.replaceWith(nb);
}
