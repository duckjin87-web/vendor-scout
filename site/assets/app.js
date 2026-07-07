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

function fieldRow(fld) {
  const row = el('div', 'field');
  row.appendChild(el('span', 'grade-tag g' + fld.grade, esc(fld.grade)));
  row.appendChild(el('div', 'k', esc(fld.key)));

  const cell = el('div');
  cell.style.flex = '1';
  const isGap = fld.data_gap || fld.value == null;
  const stale = fld.fresh === false ? ' <span class="stale">⚠ 기간초과</span>' : '';
  cell.appendChild(el('div', 'v' + (isGap ? ' gap' : ''), (isGap ? '데이터 없음 (gap)' : esc(fld.value)) + stale));
  const src = [fld.source, fld.as_of].filter(Boolean).join(' · ');
  const noteBits = [src, fld.note].filter(Boolean).join(' — ');
  if (noteBits) cell.appendChild(el('div', 'note', esc(noteBits)));

  row.appendChild(cell);
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

  const rf = renderRiskFlags(report.risk_flags);
  if (rf) root.appendChild(rf);

  const blocks = el('div', 'blocks');
  blocks.appendChild(block('기업 기본정보', '🏢', report.basic));
  blocks.appendChild(block('생산역량 · 인원', '🏭', report.capacity));
  blocks.appendChild(block('재무 (금융위)', '💰', report.finance));
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
  if (!report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML =
      `<div class="empty">「${esc(key)}」 데모 데이터가 없습니다.<br>` +
      `아래 예시 업체로 테스트하세요: <b>${Object.keys(db).join('</b>, <b>')}</b><br><br>` +
      `<span style="font-size:12.5px">실 서비스에서는 이 입력이 data.go.kr 공공 API로 실시간 조회됩니다.</span></div>`;
    root.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  render(report);
}

document.addEventListener('DOMContentLoaded', () => {
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
