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

// ── 실데이터 프록시 설정 (식약처 data.go.kr) — 선택적 실시간 모드 ──
const PROXY_KEY = 'vs_proxy';
const getProxy = () => { try { return localStorage.getItem(PROXY_KEY) || ''; } catch { return ''; } };
const setProxy = (u) => { try { u ? localStorage.setItem(PROXY_KEY, u) : localStorage.removeItem(PROXY_KEY); } catch {} };

async function proxyGet(params) {
  const base = getProxy().replace(/\/+$/, '');
  const res = await fetch(`${base}/?${new URLSearchParams(params)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`프록시 HTTP ${res.status}`);
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

// 2단계: 선택된 업체의 재무·식약처 병렬 조회 → 리포트 조립
async function finishLive(name, corp) {
  const [fin, rpt] = await Promise.allSettled([
    corp.crno ? proxyGet({ service: 'finance', crno: corp.crno }) : Promise.resolve(null),
    proxyGet({ service: 'rpt', entp_name: corp.corpNm || name }),
  ]);
  return window.assembleLiveReport(
    corp.corpNm || name, corp,
    fin.status === 'fulfilled' ? fin.value : null,
    rpt.status === 'fulfilled' ? rpt.value : null
  );
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
  const on = !!getProxy();
  btn.textContent = on ? '🟢 실데이터 연결됨' : '🔌 실데이터 연결';
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

// 재무 3개년 지표 — 소형 막대 하나 (small multiple). 음수(적자)는 기준선 아래로.
function miniChart(title, unit, pts, threshold) {
  const W = 150, H = 118, padX = 8, padT = 24, padB = 22;
  const plotH = H - padT - padB, plotW = W - padX * 2;
  const vals = pts.map((p) => p.v).filter((v) => v != null);
  const maxV = Math.max(0, ...vals, threshold || 0);
  const minV = Math.min(0, ...vals);
  const span = (maxV - minV) || 1;
  const y = (v) => padT + plotH - ((v - minV) / span) * plotH;
  const y0 = y(0);
  const n = pts.length, bandW = plotW / n, barW = Math.min(30, bandW * 0.52);

  let s = `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img" aria-label="${esc(title)} 추이">`;
  s += `<text x="${W / 2}" y="12" class="mini-t" text-anchor="middle">${esc(title)} <tspan class="mini-u">(${esc(unit)})</tspan></text>`;
  if (threshold && threshold <= maxV) {
    const yt = y(threshold);
    s += `<line x1="${padX}" y1="${yt.toFixed(1)}" x2="${W - padX}" y2="${yt.toFixed(1)}" class="fin-thresh"/>`;
    s += `<text x="${W - padX}" y="${(yt - 3).toFixed(1)}" class="fin-thresh-lbl" text-anchor="end">${threshold}</text>`;
  }
  s += `<line x1="${padX}" y1="${y0.toFixed(1)}" x2="${W - padX}" y2="${y0.toFixed(1)}" class="mini-base"/>`;
  pts.forEach((p, i) => {
    const cx = padX + bandW * (i + 0.5);
    if (p.v == null) { s += `<text x="${cx.toFixed(1)}" y="${y0 - 4}" class="mini-x" text-anchor="middle">—</text>`; }
    else {
      const yv = y(p.v), top = Math.min(yv, y0), h = Math.max(Math.abs(yv - y0), 1);
      const last = i === pts.length - 1, neg = p.v < 0;
      const cls = neg ? 'neg' : (threshold && p.v >= threshold ? 'hi' : (last ? 'hi' : 'lo'));
      s += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="3" class="fin-bar ${cls}"><title>${p.year}: ${p.v}${unit}</title></rect>`;
      s += `<text x="${cx.toFixed(1)}" y="${(neg ? y0 + h + 9 : top - 4).toFixed(1)}" class="mini-v" text-anchor="middle">${p.v}</text>`;
    }
    s += `<text x="${cx.toFixed(1)}" y="${H - 6}" class="mini-x" text-anchor="middle">${String(pts[i].year).slice(2)}</text>`;
  });
  s += `</svg>`;
  return s;
}

const FIN_METRICS = [
  { key: '매출액', unit: '억', g: (d) => d.revenue, threshold: 100 },
  { key: '영업이익', unit: '억', g: (d) => d.operatingProfit },
  { key: '총자산', unit: '억', g: (d) => d.assets },
  { key: '총부채', unit: '억', g: (d) => d.debt },
  { key: '영업이익률', unit: '%', g: (d) => (d.revenue ? +(d.operatingProfit / d.revenue * 100).toFixed(1) : null) },
  { key: '부채비율', unit: '%', g: (d) => { const eq = (d.assets || 0) - (d.debt || 0); return eq > 0 ? +(d.debt / eq * 100).toFixed(0) : null; } },
];

// 재무 블록(전폭) = 3개년 전지표 통합 그래프 + 최신연도 압축 행
function financeBlock(report) {
  const fields = report.finance;
  const hist = report.finance_history || [];
  const b = el('div', 'block full');
  const gapCount = fields.filter((f) => f.data_gap).length;
  b.appendChild(el('h3', null, `<span class="ic">💰</span>재무 (금융위)<span class="cnt">${fields.length}개 필드${gapCount ? ' · 공백 ' + gapCount : ''}</span>`));

  if (hist.length) {
    const latest = hist[hist.length - 1].year;
    const w = el('div', 'finwrap');
    w.appendChild(el('div', 'finhead', `<span>재무 지표 3개년 추이 (${hist[0].year}~${latest}, 최신연도 기준)</span><span class="finnote">매출 100억 기준선 · 최신연도 강조</span>`));
    const grid = el('div', 'minigrid');
    FIN_METRICS.forEach((mtr) => {
      const pts = hist.map((d) => ({ year: d.year, v: mtr.g(d) }));
      grid.insertAdjacentHTML('beforeend', miniChart(mtr.key, mtr.unit, pts, mtr.threshold));
    });
    w.appendChild(grid);
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
      '🟢 <b>식약처 실데이터</b> — data.go.kr 공공 API 조회 결과입니다 (키는 GitHub Actions 안에만 보관). ' +
      '값이 없는 항목은 <code>data_gap</code>으로 명시합니다.'));
  } else if (m.generated) {
    root.appendChild(el('div', 'gennote',
      '⚙️ <b>자동 생성 데모 데이터</b> — 예시 업체(리니어코스메틱·샘플뷰티랩) 외 입력은 UI 검증용으로 이름 기반 합성됩니다. ' +
      '실데이터를 보려면 우측 상단 <b>🔌 실데이터 연결</b>로 프록시를 연결하세요.'));
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

  // (선택) 실시간 프록시 모드: 기준정보 → (동명업체 선택) → 나머지 카테고리
  if (getProxy() && !report) {
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
      const cur = getProxy();
      const next = window.prompt(
        '식약처 실데이터 프록시(Cloudflare Worker) 주소를 입력하세요.\n예: https://vendor-scout-proxy.계정.workers.dev\n\n비우고 확인하면 데모 모드로 돌아갑니다.',
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
