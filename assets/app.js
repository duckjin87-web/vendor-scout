// app.js — vendor-scout 데모 프론트엔드
// src/report/schema.js의 스냅샷 리포트(JSON)를 화면에 렌더링. API 호출은 데모 모드에서 목데이터로 대체.

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const GRADE_LABEL = { A: '공식 API', B: '공공DB 간접', C: '추정/프록시', D: '데이터 공백' };

let currentReport = null;

// ── 식약처 실데이터(빌드타임): Actions가 GitHub Secret으로 구운 정적 JSON ──
let STATIC_INDEX = null;
async function loadStaticIndex() {
  try {
    const r = await fetch('data/mfds/index.json', { cache: 'no-store' });
    if (r.ok) STATIC_INDEX = await r.json();
  } catch { /* 아직 데이터 없음 → 데모 모드 */ }
}
function staticHit(key) {
  if (!STATIC_INDEX) return null;
  return STATIC_INDEX.find((e) => e.name === key || e.id === key)
    || STATIC_INDEX.find((e) => e.name.includes(key) || key.includes(e.name)) || null;
}

// ── 실데이터 연결 (선택적 실시간 모드) ──
// 두 방식 지원: (1) 식약처/공공데이터 인증키 직접 입력 → 브라우저가 data.go.kr 직접 호출
//              (2) 프록시(Worker) 주소 → CORS가 막힐 때 사용
// 입력값이 http로 시작하면 프록시, 아니면 인증키로 저장. 키는 이 브라우저에만 보관(남에게 노출 X).
const PROXY_KEY = 'vs_proxy';
const APIKEY_KEY = 'vs_apikey';
const _ls = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const _sls = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
const getProxy = () => _ls(PROXY_KEY);
const getApiKey = () => _ls(APIKEY_KEY);
const isConnected = () => !!(getProxy() || getApiKey());
function setProxy(v) { // 프록시 URL 또는 인증키를 판별해 저장
  v = (v || '').trim();
  if (!v) { _sls(PROXY_KEY, ''); _sls(APIKEY_KEY, ''); return; }
  if (/^https?:\/\//i.test(v)) { _sls(PROXY_KEY, v); _sls(APIKEY_KEY, ''); }
  else { _sls(APIKEY_KEY, v); _sls(PROXY_KEY, ''); }
}

// 서비스별 data.go.kr 직접 호출 URL (인증키 모드)
const DATA_GO = {
  corp: 'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2',
  finance: 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2/getSummFinaStat_V2',
  rpt: 'https://apis.data.go.kr/1471000/FtnltCosmRptPrdlstInfoService/getRptPrdlstInq',
  nps: 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireService/getBassInfoSearch',
};

// 공공데이터 조회 — 인증키 모드는 data.go 직접, 아니면 프록시 경유
async function proxyGet(params) {
  const key = getApiKey();
  let url;
  if (key) {
    const base = DATA_GO[params.service];
    if (!base) throw new Error(`알 수 없는 service: ${params.service}`);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (k !== 'service' && v != null) q.set(k, v);
    q.set('serviceKey', key); q.set('resultType', 'json'); q.set('type', 'json');
    if (!q.has('numOfRows')) q.set('numOfRows', '30');
    url = `${base}?${q}`;
  } else {
    url = `${getProxy().replace(/\/+$/, '')}/?${new URLSearchParams(params)}`;
  }
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error(key ? 'data.go 직접호출 실패(CORS 가능성) — 프록시 필요할 수 있음' : `프록시 연결 실패: ${e.message}`);
  }
  if (!res.ok) throw new Error(`${key ? 'data.go' : '프록시'} HTTP ${res.status}`);
  return res.json();
}

// 1단계: 기준정보(동명업체 후보) 조회 → {candidates} 또는 {report}
async function liveLookup(name) {
  let cands = [];
  try {
    const corpData = await proxyGet({ service: 'corp', corpNm: name });
    cands = window.mapCorpCandidates(corpData);
  } catch (e) { /* 기업기본정보 실패 → 식약처만으로 폴백 */ }

  if (!cands.length) {
    const rptData = await proxyGet({ service: 'rpt', entp_name: name });
    return { report: window.mapMfdsReport(name, rptData) };
  }
  if (cands.length === 1) return { report: await finishLive(name, cands[0]) };
  return { candidates: cands, name };
}

// 법인 접두/접미어 제거 — 식약처/국민연금은 순수 상호로 조회해야 매칭됨
function stripCorp(s) {
  return String(s || '').replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사/g, '').trim();
}

// 2단계: 선택된 업체의 재무·식약처·국민연금 병렬 조회 → 진단 포함 조립
async function finishLive(name, corp) {
  const nm = stripCorp(corp.corpNm || name);
  const bz6 = corp.bzno ? String(corp.bzno).replace(/\D/g, '').slice(0, 6) : null;
  const calls = {
    finance: corp.crno ? proxyGet({ service: 'finance', crno: corp.crno }) : Promise.reject(new Error('법인등록번호 없음')),
    rpt: proxyGet({ service: 'rpt', entp_name: nm }),
    nps: proxyGet({ service: 'nps', wkpl_nm: nm, ...(bz6 ? { bzowr_rgst_no: bz6 } : {}) }),
  };
  const keys = Object.keys(calls);
  const settled = await Promise.allSettled(keys.map((k) => calls[k]));
  const res = {};
  keys.forEach((k, i) => {
    res[k] = settled[i].status === 'fulfilled'
      ? { ok: true, data: settled[i].value }
      : { ok: false, err: String(settled[i].reason && settled[i].reason.message || settled[i].reason) };
  });
  return window.assembleLiveReport(corp.corpNm || name, corp, res);
}

// 동명업체 선택 UI
function renderCandidates(name, cands) {
  const root = $('#report');
  root.classList.remove('hidden');
  root.innerHTML = '';
  const box = el('div', 'candbox');
  box.appendChild(el('div', 'candhead', `「${esc(name)}」 동명·유사 업체 <b>${cands.length}건</b> — 조회할 업체를 선택하세요`));
  cands.forEach((c) => {
    const card = el('button', 'cand');
    const meta = [c.rep ? '대표 ' + esc(c.rep) : '', c.bzno ? '사업자 ' + esc(c.bzno) : '', c.addr ? esc(c.addr) : ''].filter(Boolean).join(' · ');
    card.innerHTML = `<div class="cn">${esc(c.corpNm || '(상호미상)')}</div><div class="cm">${meta || '추가정보 없음'}</div>`;
    card.addEventListener('click', async () => {
      root.innerHTML = `<div class="empty">「${esc(c.corpNm || name)}」 나머지 카테고리 조회 중…</div>`;
      try { render(await finishLive(name, c)); }
      catch (e) { root.innerHTML = `<div class="empty">조회 실패: ${esc(e.message)}</div>`; }
    });
    box.appendChild(card);
  });
  root.appendChild(box);
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setProxyUI() {
  const btn = $('#proxyBtn');
  if (!btn) return;
  const on = isConnected();
  btn.textContent = on ? (getApiKey() ? '🟢 키 연결됨' : '🟢 프록시 연결됨') : '🔌 실데이터 연결';
  btn.classList.toggle('on', on);
}

function downloadJSON() {
  if (!currentReport) return;
  const m = currentReport.meta;
  const safe = (m.vendor_id || m.vendor_name).replace(/[^\w가-힣-]/g, '_');
  const blob = new Blob([JSON.stringify(currentReport, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}_v${m.version}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// CGMP 적합업소 여부 → 해당 행 음영 (품질인증 체크리스트에 CGMP 보유 시)
function isCgmpField(fld) {
  if (Array.isArray(fld.checklist)) return fld.checklist.some((c) => /cgmp/i.test(c.label) && c.ok);
  const v = String(fld.value || '');
  return /cgmp/i.test(v) && /(적합|유효|인증)/.test(v);
}

// 체크리스트 값 렌더 (품질인증 / PLT 거래여부) — ☑/☐ 칩
function checklistHtml(list) {
  return '<span class="cklist">' + list.map((c) =>
    `<span class="ck ${c.ok ? 'on' : 'off'}">${c.ok ? '☑' : '☐'} ${esc(c.label)}</span>`).join('') + '</span>';
}

// 3열 압축 행: [등급+항목] | [값] | [출처(우측 소형)]
function fieldRow(fld) {
  const isGap = fld.data_gap || fld.value == null;
  const row = el('div', 'field' + (isCgmpField(fld) ? ' cgmp' : ''));
  if (fld.note) row.title = fld.note;

  const k = el('div', 'k');
  k.appendChild(el('span', 'gdot g' + fld.grade, esc(fld.grade)));
  k.appendChild(el('span', 'ktxt', esc(fld.key)));
  row.appendChild(k);

  const stale = fld.fresh === false ? ' <span class="stale">⚠기간초과</span>' : '';
  const info = fld.note ? ` <span class="ninfo" title="${esc(fld.note)}">ⓘ</span>` : '';
  const valHtml = Array.isArray(fld.checklist)
    ? checklistHtml(fld.checklist) + info
    : (isGap ? '데이터 없음' : esc(fld.value)) + stale + info;
  row.appendChild(el('div', 'v' + (isGap && !fld.checklist ? ' gap' : ''), valHtml));

  const src = el('div', 'src');
  src.innerHTML = esc(fld.source || '—') + (fld.as_of ? `<br><span class="asof">${esc(fld.as_of)}</span>` : '');
  row.appendChild(src);
  return row;
}

function block(title, icon, fields) {
  const b = el('div', 'block');
  const gapCount = fields.filter((f) => f.data_gap).length;
  const h = el('h3', null, `<span class="ic">${icon}</span>${esc(title)}<span class="cnt">${fields.length}개 필드${gapCount ? ' · 공백 ' + gapCount : ''}</span>`);
  b.appendChild(h);
  fields.forEach((f) => b.appendChild(fieldRow(f)));
  return b;
}

// 재무 지표 정의 (금액 4종 + 비율 2종), 색상 구분
const FIN_SERIES = [
  { name: '매출액', unit: '억', grp: 'amt', color: '#3b82f6', g: (d) => d.revenue },
  { name: '영업이익', unit: '억', grp: 'amt', color: '#ef4444', g: (d) => d.operatingProfit },
  { name: '총자산', unit: '억', grp: 'amt', color: '#10b981', g: (d) => d.assets },
  { name: '총부채', unit: '억', grp: 'amt', color: '#f59e0b', g: (d) => d.debt },
  { name: '영업이익률', unit: '%', grp: 'rat', color: '#a855f7', g: (d) => (d.revenue ? +(d.operatingProfit / d.revenue * 100).toFixed(1) : null) },
  { name: '부채비율', unit: '%', grp: 'rat', color: '#94a3b8', g: (d) => { const eq = (d.assets || 0) - (d.debt || 0); return eq > 0 ? +(d.debt / eq * 100).toFixed(0) : null; } },
];

// 연도별 그룹 막대 (여러 지표, 같은 단위) — 음수(적자)는 기준선 아래로
function groupedBars(series, years, opts) {
  const threshold = opts && opts.threshold;
  const W = 680, H = (opts && opts.H) || 196, padL = 12, padR = 12, padT = 16, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const all = series.flatMap((s) => s.vals.filter((v) => v != null));
  const maxV = Math.max(0, ...all, threshold != null ? threshold : -Infinity);
  const minV = Math.min(0, ...all);
  const span = (maxV - minV) || 1;
  const y = (v) => padT + plotH - ((v - minV) / span) * plotH;
  const y0 = y(0);
  const nG = years.length, gW = plotW / nG, nB = series.length, bW = Math.min(30, (gW * 0.74) / nB);

  let s = `<svg viewBox="0 0 ${W} ${H}" class="gchart" preserveAspectRatio="xMidYMid meet">`;
  if (threshold != null && threshold <= maxV && threshold >= minV) {
    const yt = y(threshold);
    s += `<line x1="${padL}" y1="${yt.toFixed(1)}" x2="${W - padR}" y2="${yt.toFixed(1)}" class="fin-thresh"/>`;
    s += `<text x="${W - padR}" y="${(yt - 3).toFixed(1)}" class="fin-thresh-lbl" text-anchor="end">${threshold}</text>`;
  }
  s += `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${W - padR}" y2="${y0.toFixed(1)}" class="mini-base"/>`;
  years.forEach((yr, gi) => {
    const gx = padL + gW * gi + (gW - bW * nB) / 2;
    series.forEach((se, bi) => {
      const v = se.vals[gi], x = gx + bi * bW;
      if (v == null) { s += `<text x="${(x + bW / 2).toFixed(1)}" y="${(y0 - 3).toFixed(1)}" class="mini-x" text-anchor="middle">—</text>`; return; }
      const yv = y(v), top = Math.min(yv, y0), h = Math.max(Math.abs(yv - y0), 1);
      s += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${se.color}"><title>${esc(se.name)} ${yr}: ${v}${se.unit}</title></rect>`;
      s += `<text x="${(x + (bW - 2) / 2).toFixed(1)}" y="${(v >= 0 ? top - 3 : top + h + 8).toFixed(1)}" class="gval" text-anchor="middle">${v}</text>`;
    });
    s += `<text x="${(padL + gW * gi + gW / 2).toFixed(1)}" y="${H - 7}" class="mini-x" text-anchor="middle">${yr}</text>`;
  });
  return s + `</svg>`;
}

// 재무 블록(전폭) = 6지표 3개년 통합 그래프(금액/비율 2단) + 최신연도 압축 행
function financeBlock(report) {
  const fields = report.finance;
  const hist = report.finance_history || [];
  const b = el('div', 'block full');
  const gapCount = fields.filter((f) => f.data_gap).length;
  b.appendChild(el('h3', null, `<span class="ic">💰</span>재무 (금융위)<span class="cnt">${fields.length}개 필드${gapCount ? ' · 공백 ' + gapCount : ''}</span>`));

  if (hist.length) {
    const years = hist.map((d) => d.year);
    const mk = (grp) => FIN_SERIES.filter((s) => s.grp === grp).map((s) => ({ name: s.name, unit: s.unit, color: s.color, vals: hist.map(s.g) }));
    const w = el('div', 'finwrap');
    w.appendChild(el('div', 'finhead', `<span>재무 지표 3개년 (${years[0]}~${years[years.length - 1]})</span><span class="finnote">금액(억)·비율(%) · 매출 100억 기준선</span>`));
    w.appendChild(el('div', 'glegend', FIN_SERIES.map((s) => `<span class="lg"><span class="sw" style="background:${s.color}"></span>${esc(s.name)} <span class="u">(${s.unit})</span></span>`).join('')));
    w.insertAdjacentHTML('beforeend', groupedBars(mk('amt'), years, { threshold: 100 }));
    w.appendChild(el('div', 'gsub', '└ 비율 (%)'));
    w.insertAdjacentHTML('beforeend', groupedBars(mk('rat'), years, { H: 150 }));
    b.appendChild(w);
  } else {
    b.appendChild(el('div', 'finmiss', '공식 재무 미제출 법인 — 3개년 추이 그래프 생략'));
  }
  const rows = el('div', 'finrows');
  fields.forEach((f) => rows.appendChild(fieldRow(f)));
  b.appendChild(rows);
  return b;
}

function renderRiskFlags(flags) {
  if (!flags || !flags.length) return null;
  const box = el('div', 'riskbox');
  box.appendChild(el('h3', null, `⚠ 리스크 플래그 ${flags.length}건 — 방문 전 반드시 확인`));
  const ul = el('ul');
  flags.forEach((fl) => {
    const li = el('li');
    li.appendChild(el('span', 't', esc(fl.type)));
    li.appendChild(el('span', null, esc(fl.detail || '')));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  return box;
}

function renderCrosscheck(rows) {
  const b = el('div', 'block full');
  b.appendChild(el('h3', null, `<span class="ic">🔍</span>방문 크로스체크 시트<span class="cnt">${rows.length}건 검증 대기</span>`));
  if (!rows.length) {
    b.appendChild(el('div', 'empty', '크로스체크 대상 없음 — 모든 필드가 A/B 등급이며 상충 없음'));
    return b;
  }
  const table = el('table', 'xtable');
  table.innerHTML = `<thead><tr>
    <th style="width:26%">검증 항목</th><th style="width:34%">조회값 (expected)</th>
    <th style="width:22%">방문 확인</th><th style="width:18%">출처유형</th></tr></thead>`;
  const tb = el('tbody');
  rows.forEach((r) => {
    const tr = el('tr');
    const isGap = r.expected == null;
    tr.innerHTML =
      `<td>${esc(r.key)}</td>` +
      `<td class="exp${isGap ? ' gap' : ''}">${isGap ? '데이터 없음 → 현장 확보 필요' : esc(r.expected)}</td>` +
      `<td><span class="pending">☐ 미검증</span></td>` +
      `<td><span class="srcpill">${esc(r.src_type)}</span></td>`;
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  b.appendChild(table);
  return b;
}

function render(report) {
  currentReport = report;
  const root = $('#report');
  root.innerHTML = '';
  root.classList.remove('hidden');

  const m = report.meta;

  // 방문 리포트 저장/인쇄 툴바
  const actions = el('div', 'actions');
  const dlBtn = el('button', 'act', '⬇ JSON 다운로드');
  dlBtn.addEventListener('click', downloadJSON);
  const printBtn = el('button', 'act primary', '🖨 인쇄 / PDF로 저장');
  printBtn.addEventListener('click', () => window.print());
  actions.appendChild(el('span', 'act-hint', '방문 전 리포트로 저장 →'));
  actions.appendChild(dlBtn);
  actions.appendChild(printBtn);
  root.appendChild(actions);
  const allFields = [...report.basic, ...report.capacity, ...report.finance];
  const gapTotal = allFields.filter((f) => f.data_gap).length;

  // Summary
  const sm = el('div', 'summary');
  sm.appendChild(el('div', 'grade-badge badge-' + m.overall_grade, esc(m.overall_grade)));
  const vinfo = el('div', 'vinfo');
  const qDate = new Date(m.query_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  vinfo.innerHTML =
    `<h2>${esc(m.vendor_name)}</h2>` +
    `<div class="meta-line">조회시점 <b>${esc(qDate)}</b> · 스냅샷 <b>v${m.version}</b> · ` +
    `최신성 기준 <b>${m.max_age_years}년</b> · 사용 출처 <b>${m.sources_used.length}종</b></div>`;
  sm.appendChild(vinfo);
  const stats = el('div', 'stats');
  stats.innerHTML =
    `<div class="s"><div class="n">${allFields.length}</div><div class="k">수집 필드</div></div>` +
    `<div class="s"><div class="n ${gapTotal ? 'warn' : ''}">${gapTotal}</div><div class="k">데이터 공백</div></div>` +
    `<div class="s"><div class="n ${report.risk_flags.length ? 'warn' : ''}">${report.risk_flags.length}</div><div class="k">리스크</div></div>`;
  sm.appendChild(stats);
  root.appendChild(sm);

  // 데이터 출처 배너
  if (m.live) {
    root.appendChild(el('div', 'livenote',
      '🟢 <b>실데이터</b> — data.go.kr 공공 API 조회 결과입니다. ' +
      '값이 없는 항목은 <code>data_gap</code>으로 명시합니다.'));
  } else if (m.generated) {
    root.appendChild(el('div', 'gennote',
      '⚙️ <b>자동 생성 데모 데이터</b> — 예시 업체(리니어코스메틱·샘플뷰티랩) 외 입력은 UI 검증용으로 이름 기반 합성됩니다. ' +
      '실데이터는 우측 상단 <b>🔌 실데이터 연결</b>에 <b>인증키</b> 또는 프록시를 넣으면 됩니다.'));
  }

  const rf = renderRiskFlags(report.risk_flags);
  if (rf) root.appendChild(rf);

  const blocks = el('div', 'blocks');
  blocks.appendChild(block('기업 기본정보', '🏢', report.basic));
  blocks.appendChild(block('생산역량 · 인원', '🏭', report.capacity));
  blocks.appendChild(financeBlock(report));
  const diffBlock = renderDiff(report.diff_from_prev);
  if (diffBlock) blocks.appendChild(diffBlock);
  blocks.appendChild(renderCrosscheck(report.crosscheck));
  root.appendChild(blocks);

  // Legend
  const lg = el('div', 'legend');
  lg.innerHTML =
    '<span class="item"><b>신뢰도</b></span>' +
    ['A', 'B', 'C', 'D'].map((g) => `<span class="item"><span class="dot badge-${g}"></span>${g} · ${GRADE_LABEL[g]}</span>`).join('');
  root.appendChild(lg);

  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDiff(diff) {
  if (!diff || !diff.length) return null;
  const b = el('div', 'block');
  b.appendChild(el('h3', null, `<span class="ic">📈</span>직전 버전 대비 변경<span class="cnt">${diff.length}건</span>`));
  diff.forEach((d) => {
    const row = el('div', 'field');
    row.appendChild(el('div', 'k', esc(d.key)));
    const cell = el('div');
    cell.style.flex = '1';
    cell.appendChild(el('div', 'v', `${esc(d.before)} <span style="color:var(--faint)">→</span> <b>${esc(d.after)}</b>`));
    row.appendChild(cell);
    b.appendChild(row);
  });
  return b;
}

function lookup(name) {
  const key = (name || '').trim();
  if (!key) return;
  const db = window.VENDOR_SAMPLES || {};
  let report = db[key];
  if (!report) {
    // 부분 일치 시도
    const hit = Object.keys(db).find((k) => k.includes(key) || key.includes(k));
    report = hit ? db[hit] : null;
  }
  // 식약처 실데이터(빌드타임): Actions가 시크릿으로 구운 정적 JSON에 있으면 실데이터 렌더
  if (!report) {
    const hit = staticHit(key);
    if (hit) {
      const root = $('#report');
      root.classList.remove('hidden');
      root.innerHTML = `<div class="empty">식약처 실데이터 불러오는 중… 「${esc(hit.name)}」</div>`;
      fetch(`data/mfds/${hit.id}.json`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((rep) => render(rep))
        .catch((e) => { root.innerHTML = `<div class="empty">불러오기 실패: ${esc(e.message)}</div>`; });
      return;
    }
  }

  // (선택) 실시간 모드: 기준정보 → (동명업체 선택) → 나머지 카테고리 (키 직접 또는 프록시)
  if (isConnected() && !report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">금융위·식약처 실시간 조회 중… 「${esc(key)}」</div>`;
    liveLookup(key)
      .then((res) => { if (res.candidates) renderCandidates(res.name, res.candidates); else render(res.report); })
      .catch((e) => {
        root.innerHTML =
          `<div class="empty">실데이터 조회 실패: ${esc(e.message)}<br>` +
          `<span style="font-size:12.5px">프록시 주소·키·API 승인을 확인하세요. 데모 데이터로 대체하려면 아래를 누르세요.</span><br><br>` +
          `<button class="act" id="fallbackBtn">데모 리포트 보기</button></div>`;
        const fb = $('#fallbackBtn');
        if (fb) fb.addEventListener('click', () => render(window.generateReport(key)));
      });
    return;
  }
  // 범용성: 미등록 업체명은 이름 기반으로 데모 리포트 자동 생성
  if (!report && window.generateReport) report = window.generateReport(key);
  if (!report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">업체명을 입력하세요.</div>`;
    return;
  }
  render(report);
}

document.addEventListener('DOMContentLoaded', () => {
  loadStaticIndex(); // 식약처 실데이터 인덱스 미리 로드 (있으면)

  // ?proxy= 로 들어오면 저장 (프록시 자동 연결)
  const pParam = new URLSearchParams(location.search).get('proxy');
  if (pParam !== null) { setProxy(pParam.trim()); }

  const proxyBtn = $('#proxyBtn');
  if (proxyBtn) {
    proxyBtn.addEventListener('click', () => {
      const cur = getApiKey() || getProxy();
      const next = window.prompt(
        '실데이터 연결 — 둘 중 하나 입력:\n' +
        '① 공공데이터(data.go.kr) 인증키 → 브라우저가 직접 조회 (서버 불필요)\n' +
        '② 프록시(Worker) 주소(https://…) → CORS가 막힐 때\n\n' +
        '비우고 확인하면 데모 모드로 돌아갑니다.',
        cur
      );
      if (next === null) return; // 취소
      setProxy(next.trim());
      setProxyUI();
      const q = $('#q').value.trim();
      if (q) lookup(q);
    });
    setProxyUI();
  }

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup($('#q').value);
  });
  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      $('#q').value = c.dataset.name;
      lookup(c.dataset.name);
    })
  );
  // 첫 진입 시 대표 샘플 자동 표시
  const first = (window.VENDOR_SAMPLE_LIST || [])[0];
  if (first) {
    $('#q').value = first.meta.vendor_name;
    render(first);
  }
});
