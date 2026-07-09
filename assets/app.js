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

// ── 실데이터 프록시 설정 (식약처 data.go.kr) ──
const PROXY_KEY = 'vs_proxy';
const getProxy = () => { try { return localStorage.getItem(PROXY_KEY) || ''; } catch { return ''; } };
const setProxy = (u) => { try { u ? localStorage.setItem(PROXY_KEY, u) : localStorage.removeItem(PROXY_KEY); } catch {} };

async function liveLookup(name) {
  const base = getProxy().replace(/\/+$/, '');
  const url = `${base}/?service=rpt&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`프록시 HTTP ${res.status}`);
  const data = await res.json();
  return window.mapMfdsReport(name, data);
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

// CGMP 적합업소 여부 — GMP 인증 필드가 CGMP 유효/적합이면 해당 행 음영
function isCgmpField(fld) {
  const v = String(fld.value || '');
  return /cgmp/i.test(v) && /(적합|유효|인증)/.test(v);
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
  row.appendChild(el('div', 'v' + (isGap ? ' gap' : ''), (isGap ? '데이터 없음' : esc(fld.value)) + stale + info));

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

// 재무 3개년 매출 추이 SVG (단일 시리즈) — 100억 이상 구간·막대 음영
function financeChart(history) {
  const W = 340, H = 172, padL = 10, padR = 10, padT = 26, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const threshold = 100;
  const maxV = Math.max(threshold, ...history.map((d) => d.revenue)) * 1.2;
  const y = (v) => padT + plotH - (v / maxV) * plotH;
  const n = history.length, bandW = plotW / n, barW = Math.min(46, bandW * 0.5);
  const yT = y(threshold);

  let s = `<svg viewBox="0 0 ${W} ${H}" class="finchart" role="img" aria-label="매출액 ${n}개년 추이">`;
  s += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${(yT - padT).toFixed(1)}" class="fin-band"/>`;
  s += `<line x1="${padL}" y1="${yT.toFixed(1)}" x2="${padL + plotW}" y2="${yT.toFixed(1)}" class="fin-thresh"/>`;
  s += `<text x="${padL + plotW}" y="${(yT - 4).toFixed(1)}" class="fin-thresh-lbl" text-anchor="end">100억</text>`;
  history.forEach((d, i) => {
    const cx = padL + bandW * (i + 0.5);
    const yy = y(d.revenue), h = padT + plotH - yy;
    const hi = d.revenue >= threshold;
    s += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${barW}" height="${Math.max(h, 1).toFixed(1)}" rx="4" class="fin-bar ${hi ? 'hi' : 'lo'}"><title>${d.year}년 · 매출 ${d.revenue}억 · 영업이익 ${d.operatingProfit}억</title></rect>`;
    s += `<text x="${cx.toFixed(1)}" y="${(yy - 6).toFixed(1)}" class="fin-val" text-anchor="middle">${d.revenue}억</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${H - 7}" class="fin-x" text-anchor="middle">${d.year}</text>`;
  });
  s += `</svg>`;
  return s;
}

// 재무 블록 = 3개년 매출 추이 그래프 + 최신연도 압축 행
function financeBlock(report) {
  const fields = report.finance;
  const hist = report.finance_history || [];
  const b = el('div', 'block');
  const gapCount = fields.filter((f) => f.data_gap).length;
  b.appendChild(el('h3', null, `<span class="ic">💰</span>재무 (금융위)<span class="cnt">${fields.length}개 필드${gapCount ? ' · 공백 ' + gapCount : ''}</span>`));

  if (hist.length) {
    const latest = hist[hist.length - 1].year;
    const w = el('div', 'finwrap');
    w.appendChild(el('div', 'finhead', `<span>매출액 추이 (${hist[0].year}~${latest})</span><span class="finnote">100억 이상 음영</span>`));
    w.insertAdjacentHTML('beforeend', financeChart(hist));
    b.appendChild(w);
  } else {
    b.appendChild(el('div', 'finmiss', '공식 재무 미제출 법인 — 3개년 추이 그래프 생략'));
  }
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

  // 데이터 출처 배너
  if (m.live) {
    root.appendChild(el('div', 'livenote',
      '🟢 <b>식약처 실데이터</b> — data.go.kr 기능성화장품 보고품목 API 실시간 조회 결과입니다. ' +
      '재무·법인 등 식약처 범위 밖 항목은 <code>data_gap</code>(금융위/관세청 연동 필요)으로 표기됩니다.'));
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
  // 실데이터 모드: 프록시가 연결돼 있으면 식약처 API 실시간 조회 (예시 2곳은 큐레이트 유지)
  if (getProxy() && !report) {
    const root = $('#report');
    root.classList.remove('hidden');
    root.innerHTML = `<div class="empty">식약처 실시간 조회 중… 「${esc(key)}」</div>`;
    liveLookup(key)
      .then((r) => render(r))
      .catch((e) => {
        root.innerHTML =
          `<div class="empty">식약처 실데이터 조회 실패: ${esc(e.message)}<br>` +
          `<span style="font-size:12.5px">프록시 주소·키를 확인하세요. 데모 데이터로 대체하려면 아래를 누르세요.</span><br><br>` +
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
