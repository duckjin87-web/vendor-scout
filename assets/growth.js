// growth.js — 첫 화면 「급성장 신호」 패널
// GitHub Actions(growth.yml)가 달마다 만드는 data/growth/latest.json을 읽어, 국민연금 가입자 기준으로
// 최근 1·2·3개월 전과 작년 같은 달 대비 인원이 급증한 화장품 제조업체를 보여 준다.
//   시계열 s[0..12] = 기준월 12개월 전 ~ 기준월 가입자수(공공데이터포털 '과거 데이터'의 월별 파일)
//   증감 = s[12] − s[12 − n]   (n = 1, 2, 3, 작년 같은 달은 12)
// 리포트를 보고 있을 때는 숨기고, 머리줄 「대시보드」 버튼으로 돌아오면 다시 보인다.
// app.js의 $, esc, lookup, BUILD를 쓴다(이 파일은 app.js 뒤에 로드된다).

const GR = {
  PERIODS: [
    { id: '1', back: 1, label: '최근 1개월', rate: 0.10 },
    { id: '2', back: 2, label: '최근 2개월', rate: 0.15 },
    { id: '3', back: 3, label: '최근 3개월', rate: 0.20 },
    { id: 'y', back: 12, label: '작년 같은 달 대비', rate: 0.30 },
  ],
  MIN_NET: 3,          // 급증 — 증가 3명 이상이면서 기간별 증가율 이상
  BIG_NET: 20,         //        또는 증가 20명 이상(큰 사업장은 비율이 작아도 의미가 크다)
  SMALL_BASE: 5,       // 비교 시점 인원 5명 미만은 '소규모' — 한두 명으로 비율이 크게 튄다
  SHOW: 30,
};
const growthState = { data: null, period: '1', sort: 'net', onlyCos: false, hideTemp: true, open: null, err: null };

const grPer = (id) => GR.PERIODS.find((p) => p.id === id) || GR.PERIODS[0];
function grRows(st, per = grPer(st.period)) {
  const d = st.data; if (!d) return [];
  const L = d.months.length - 1, B = L - per.back;
  return d.rows
    .filter((r) => !(st.hideTemp && r.temp))
    .filter((r) => !st.onlyCos || r.cos)
    .map((r) => {
      const cur = r.s[L], base = B >= 0 ? r.s[B] : null;
      const net = cur != null && base != null ? cur - base : null;
      const amtB = B >= 0 ? r.a[B] : null;
      return { ...r, cur, base, net, rate: base > 0 && net != null ? net / base : null,
        payRate: amtB > 0 && r.a[L] != null ? r.a[L] / amtB - 1 : null };
    })
    .filter((r) => r.net != null && r.net >= GR.MIN_NET && ((r.rate != null && r.rate >= per.rate) || r.net >= GR.BIG_NET))
    // 증가율 순으로 볼 때 비교 시점 인원이 몇 명 안 되는 곳(1→4명 +300%)이 맨 위를 차지하지 않게 소규모는 뒤로
    .sort((a, c) => (st.sort === 'rate' ? ((a.base < GR.SMALL_BASE) - (c.base < GR.SMALL_BASE)) || (c.rate ?? 0) - (a.rate ?? 0) : 0) || c.net - a.net || (c.rate ?? 0) - (a.rate ?? 0));
}
const grPct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x >= 10 ? '999↑' : Math.round(x * 100)}%`);
const grWon = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`);
const GR_SIDO = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 경기도: '경기', 강원도: '강원', 제주도: '제주' };
const grRegion = (a) => String(a || '').replace(/특별자치시|특별자치도|광역시|특별시/g, '').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((t, i) => (i === 0 ? (GR_SIDO[t] || t) : t)).join(' ');
const grYm = (ym) => (ym ? ym.replace(/^(\d{4})-(\d{2})$/, '$1년 $2월') : '');
const grYmS = (ym) => (ym ? ym.replace(/^\d{2}(\d{2})-(\d{2})$/, '$1.$2') : '');

// ── 선 그래프 (한 계열 · 한 축) ──
// 비교 시점(cmp)과 기준월을 점으로 짚고 둘 사이를 옅게 칠한다. 빈 달은 선을 끊는다.
// 마우스를 올리면 그 달 값과 전달 대비 증감을 보여 준다(data-gr-chart 위에서 grBindHover).
function grLine(vals, months, { w = growthState.cw || 640, h = 180, cmp = null, unit = '명', title = '' } = {}) {
  // 실제 칸 너비로 그린다 — 늘려 맞추면 좁은 화면에서 글자가 찌그러진다
  if (w < 520) h = 150;
  const P = { l: 44, r: 14, t: 16, b: 26 };
  const xs = (i) => P.l + (i * (w - P.l - P.r)) / Math.max(1, vals.length - 1);
  const have = vals.filter((v) => v != null);
  if (!have.length) return '<div class="gr-nochart">시계열이 없습니다</div>';
  let lo = Math.min(...have), hi = Math.max(...have);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
  const ys = (v) => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const L = vals.length - 1;
  let path = '', pen = false;
  vals.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`; pen = true; });
  const ticks = [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));
  const grid = ticks.map((t) => `<line class="gr-grid" x1="${P.l}" x2="${w - P.r}" y1="${ys(t).toFixed(1)}" y2="${ys(t).toFixed(1)}"/>`
    + `<text class="gr-ax" x="${P.l - 6}" y="${(ys(t) + 4).toFixed(1)}" text-anchor="end">${t.toLocaleString()}</text>`).join('');
  const step = w < 520 ? 6 : 3;
  const xl = months.map((m, i) => ((i % step === 0 || i === L) ? `<text class="gr-ax" x="${xs(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">${grYmS(m)}</text>` : '')).join('');
  const band = cmp != null && cmp >= 0 ? `<rect class="gr-band" x="${xs(cmp).toFixed(1)}" y="${P.t}" width="${(xs(L) - xs(cmp)).toFixed(1)}" height="${h - P.t - P.b}"/>` : '';
  const dot = (i, cls) => (vals[i] == null ? '' : `<circle class="${cls}" cx="${xs(i).toFixed(1)}" cy="${ys(vals[i]).toFixed(1)}" r="4.5"/>`);
  const lbl = (i, anchor, below) => (vals[i] == null ? '' : `<text class="gr-pl" x="${xs(i).toFixed(1)}" y="${(ys(vals[i]) + (below ? 17 : -9)).toFixed(1)}" text-anchor="${anchor}">${vals[i].toLocaleString()}${unit}</text>`);
  // 비교 시점이 기준월 바로 옆이면(1·2개월) 두 이름표가 겹친다 — 비교 시점 값은 점 아래·왼쪽으로
  const near = cmp != null && L - cmp <= 2;
  return `<svg class="gr-svg" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${esc(title)}" data-gr-chart='${esc(JSON.stringify({ v: vals, m: months, l: P.l, r: P.r, w, unit }))}'>`
    + grid + band + `<path class="gr-line" d="${path}"/>` + xl
    + (cmp != null && cmp >= 0 ? dot(cmp, 'gr-dot cmp') + (near && w < 900 ? '' : lbl(cmp, near ? 'end' : (cmp < 2 ? 'start' : 'middle'), near && vals[cmp] <= vals[L])) : '')
    + dot(L, 'gr-dot') + lbl(L, 'end')
    + `<line class="gr-cross" x1="0" x2="0" y1="${P.t}" y2="${h - P.b}" visibility="hidden"/></svg>`;
}
// 표 안의 작은 추이(13개월) — 축 없이 모양만. 비교 시점과 기준월만 점으로.
function grSpark(vals, cmp) {
  const w = 96, h = 26, have = vals.filter((v) => v != null);
  if (have.length < 2) return '';
  let lo = Math.min(...have), hi = Math.max(...have); if (lo === hi) { lo -= 1; hi += 1; }
  const xs = (i) => 3 + (i * (w - 6)) / (vals.length - 1), ys = (v) => 3 + (h - 6) * (1 - (v - lo) / (hi - lo));
  let d = '', pen = false;
  vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`; pen = true; });
  const L = vals.length - 1;
  return `<svg class="gr-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/>`
    + (vals[cmp] != null ? `<circle class="cmp" cx="${xs(cmp).toFixed(1)}" cy="${ys(vals[cmp]).toFixed(1)}" r="2.6"/>` : '')
    + (vals[L] != null ? `<circle cx="${xs(L).toFixed(1)}" cy="${ys(vals[L]).toFixed(1)}" r="2.6"/>` : '') + '</svg>';
}

function grHtml(st) {
  const d = st.data;
  if (st.err) return `<div class="gr-head"><h2>급성장 신호</h2></div><div class="gr-empty">급성장 집계를 불러오지 못했습니다 — ${esc(st.err)}</div>`;
  if (!d) return '<div class="gr-head"><h2>급성장 신호</h2></div><div class="gr-empty">불러오는 중…</div>';
  if (!Array.isArray(d.months)) return '<div class="gr-head"><h2>급성장 신호</h2></div><div class="gr-empty">집계 형식이 바뀌어 다시 만드는 중입니다. 잠시 뒤 새로고침해 주세요.</div>';
  const per = grPer(st.period);
  const L = d.months.length - 1, B = L - per.back;
  const cmpYm = d.months[B];
  let h = `<div class="gr-head"><div><h2>급성장 신호 <small>화장품 제조업 · 국민연금 가입자 기준</small></h2>`
    + `<p class="gr-sub">기준월 <b>${esc(grYm(d.ym))}</b> (국민연금 최신 공개분) · 다음 갱신 ${esc(d.nextUpdate || '매월 말')} · 대상 ${d.counts.rows.toLocaleString()}개 사업장</p></div></div>`;
  // 기간 고르기 = 기간별 급증 사업장 수 타일
  h += '<div class="gr-tiles" role="tablist" aria-label="비교 기간">' + GR.PERIODS.map((p) => {
    const n = grRows(st, p).length;
    const cy = d.months[L - p.back];
    return `<button type="button" role="tab" class="gr-tile" data-gr-period="${p.id}" aria-selected="${st.period === p.id}">`
      + `<span>${esc(p.label)}</span><b>${n.toLocaleString()}곳</b><small>${esc(grYmS(cy))} → ${esc(grYmS(d.ym))} · +${Math.round(p.rate * 100)}%↑</small></button>`;
  }).join('') + '</div>';
  // 업종 전체 추이 — 13개월이 모두 잡힌 사업장만 합한 가입자수
  if (d.industry && d.industry.total) {
    const T = d.industry.total, net = T[L] - T[B];
    h += `<div class="gr-ind"><div class="gr-ind-h"><b>업종 전체 가입자 추이</b> <small>13개월이 모두 잡힌 ${d.industry.firms.toLocaleString()}개 사업장 합계 · `
      + `${esc(grYm(cmpYm))} 대비 ${net >= 0 ? '+' : ''}${net.toLocaleString()}명 (${grPct(T[B] ? net / T[B] : null)})</small></div>`
      + grLine(T, d.months, { cmp: B, title: '업종 전체 가입자 추이' }) + '</div>';
  }
  const rows = grRows(st);
  h += `<div class="gr-tools"><span class="gr-crit">급증 기준(${esc(per.label)}): ${esc(grYm(cmpYm))}보다 ${GR.MIN_NET}명 이상 늘고 증가율 ${Math.round(per.rate * 100)}% 이상 — 또는 ${GR.BIG_NET}명 이상 증가</span>`
    + `<label><input type="checkbox" data-gr-opt="onlyCos"${st.onlyCos ? ' checked' : ''}> 국민연금 업종 「화장품 제조업」만</label>`
    + `<label><input type="checkbox" data-gr-opt="hideTemp"${st.hideTemp ? ' checked' : ''}> 비정규·일용 사업장 빼기</label>`
    + `<span class="gr-sort">정렬 <button type="button" data-gr-sort="net" aria-pressed="${st.sort === 'net'}">증가 인원</button>`
    + `<button type="button" data-gr-sort="rate" aria-pressed="${st.sort === 'rate'}">증가율</button></span></div>`;
  if (!rows.length) return `${h}<div class="gr-empty">${esc(grYm(cmpYm))} 대비 급증 기준을 넘은 사업장이 없습니다${(d.have || []).includes(cmpYm) ? '' : ` — ${esc(grYm(cmpYm))} 자료가 아직 없습니다`}.</div>`;
  h += `<p class="gr-count"><b>${rows.length}곳</b>이 ${esc(grYm(cmpYm))} → ${esc(grYm(d.ym))} 사이 급증 기준을 넘었습니다${rows.length > GR.SHOW ? ` — 상위 ${GR.SHOW}곳` : ''}. 줄을 누르면 13개월 추이가 열립니다.</p>`;
  h += '<div class="gr-tw"><table class="gr-tbl"><thead><tr><th>#</th><th>사업장</th><th>지역</th><th>13개월 추이</th>'
    + `<th class="n">인원 (${esc(grYmS(cmpYm))} → ${esc(grYmS(d.ym))})</th><th class="n">증감</th><th class="n">월 인건비(추정)</th><th></th></tr></thead><tbody>`;
  rows.slice(0, GR.SHOW).forEach((r, i) => {
    const key = `${r.bz6}|${r.nm}`;
    const badges = [
      r.mfds ? '<span class="gr-b ok" title="식약처 화장품 제조업 허가 업체와 사업자번호 앞 6자리·상호 일치">식약처 제조업</span>' : '',
      !r.cos ? `<span class="gr-b" title="국민연금에 등록된 업종">${esc(r.codeNm || '기타 업종')}</span>` : '',
      r.base < GR.SMALL_BASE ? '<span class="gr-b warn" title="비교 시점 인원이 적어 한두 명으로 비율이 크게 움직입니다">소규모</span>' : '',
      r.temp ? '<span class="gr-b warn">비정규·일용</span>' : '',
    ].join('');
    const pay = `${grWon(r.a[L] / 0.09)}${r.payRate != null ? `<small>${grPct(r.payRate)}</small>` : ''}`;
    const open = st.open === key;
    h += `<tr class="gr-row${open ? ' open' : ''}" data-gr-row="${esc(key)}" tabindex="0" aria-expanded="${open}"><td class="n">${i + 1}</td><td><b>${esc(r.nm)}</b>${badges ? `<div class="gr-bs">${badges}</div>` : ''}</td>`
      + `<td>${esc(grRegion(r.addr))}</td><td>${grSpark(r.s, B)}</td><td class="n">${r.base.toLocaleString()} → <b>${r.cur.toLocaleString()}</b></td>`
      + `<td class="n up">+${r.net.toLocaleString()}<small>${grPct(r.rate)}</small></td><td class="n">${pay}</td>`
      + `<td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.mfdsName || r.nm)}">사전검증</button></td></tr>`;
    if (open) {
      const mons = r.s.map((v, k) => (v == null ? null : { m: d.months[k], v }));
      const firstHalf = mons.filter(Boolean);
      h += `<tr class="gr-detail"><td colspan="8"><div class="gr-dbox"><div class="gr-ind-h"><b>${esc(r.nm)}</b> <small>국민연금 가입자수 13개월 · 기준월 입사 ${r.nw}명 / 퇴사 ${r.ls}명`
        + `${firstHalf.length < d.months.length ? ` · 빈 달 ${d.months.length - firstHalf.length}개(그 달 파일에 이 사업장이 없거나 이름·주소가 바뀜)` : ''}</small></div>`
        + grLine(r.s, d.months, { cmp: B, title: `${r.nm} 가입자 추이` })
        + '<div class="gr-vals">' + GR.PERIODS.map((p) => {
          const b = r.s[L - p.back];
          return `<span>${esc(p.label)} <b>${b == null ? '—' : `${r.s[L] - b >= 0 ? '+' : ''}${(r.s[L] - b).toLocaleString()}명 (${grPct(b > 0 ? (r.s[L] - b) / b : null)})`}</b></span>`;
        }).join('') + '</div></div></td></tr>';
    }
  });
  h += '</tbody></table></div>';
  h += `<p class="gr-foot">출처: ${esc(d.source)}. 범위: ${esc(d.scope)}. `
    + '국민연금 자료는 다음 달 하순에 공개돼 기준월이 조회 시점보다 1~2개월 늦습니다. '
    + '사업장 단위라 같은 회사의 공장·본사가 따로 잡히고, 상호·주소가 바뀐 달은 이어지지 않을 수 있습니다. 월 입퇴사에는 계약직·단기 인력이 섞입니다. '
    + '월 인건비는 국민연금 고지금액 ÷ 9%로 낸 하한 추정치이고, 괄호 안은 같은 비교 시점 대비 변화입니다. '
    + '급증은 거래 판단의 근거가 아니라 <b>먼저 살펴볼 후보</b>를 고르는 신호입니다.</p>';
  return h;
}

// 선 그래프 위 마우스 — 가장 가까운 달의 값과 전달 대비 증감
function grBindHover(box) {
  let tip = box.querySelector('.gr-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'gr-tip'; tip.hidden = true; box.appendChild(tip); }
  box.addEventListener('pointermove', (e) => {
    const svg = e.target.closest && e.target.closest('svg[data-gr-chart]');
    box.querySelectorAll('.gr-cross').forEach((c) => { if (!svg || !svg.contains(c)) c.setAttribute('visibility', 'hidden'); });
    if (!svg) { tip.hidden = true; return; }
    const cfg = JSON.parse(svg.dataset.grChart);
    const rc = svg.getBoundingClientRect();
    const x = ((e.clientX - rc.left) / rc.width) * cfg.w;
    const n = cfg.v.length - 1;
    const i = Math.max(0, Math.min(n, Math.round(((x - cfg.l) / (cfg.w - cfg.l - cfg.r)) * n)));
    const v = cfg.v[i], pv = i > 0 ? cfg.v[i - 1] : null;
    const cx = cfg.l + (i * (cfg.w - cfg.l - cfg.r)) / n;
    const cross = svg.querySelector('.gr-cross');
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(grYm(cfg.m[i]))}</b><br>${v == null ? '자료 없음' : `${v.toLocaleString()}${cfg.unit}`}`
      + (v != null && pv != null ? `<br><small>전달 대비 ${v - pv >= 0 ? '+' : ''}${(v - pv).toLocaleString()}${cfg.unit}</small>` : '');
    tip.hidden = false;
    const br = box.getBoundingClientRect();
    tip.style.left = `${Math.min(br.width - 150, Math.max(0, rc.left - br.left + (cx / cfg.w) * rc.width + 12))}px`;
    tip.style.top = `${rc.top - br.top + 8}px`;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; box.querySelectorAll('.gr-cross').forEach((c) => c.setAttribute('visibility', 'hidden')); });
}

function mountGrowth() {
  const box = document.getElementById('growth');
  if (!box) return;
  const paint = () => {
    // 그래프 칸 너비 = 패널 안쪽 너비 − 그래프 상자 여백
    growthState.cw = Math.max(280, Math.round(box.clientWidth - 64));
    const tip = box.querySelector('.gr-tip'); box.innerHTML = grHtml(growthState); if (tip) box.appendChild(tip);
  };
  let lastW = 0, rt = null;
  if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) < 24) return; lastW = box.clientWidth; clearTimeout(rt); rt = setTimeout(() => { if (growthState.data) paint(); }, 150); }).observe(box);
  box.addEventListener('click', (e) => {
    const p = e.target.closest('[data-gr-period]'); if (p) { growthState.period = p.dataset.grPeriod; growthState.open = null; paint(); return; }
    const s = e.target.closest('[data-gr-sort]'); if (s) { growthState.sort = s.dataset.grSort; paint(); return; }
    const g = e.target.closest('[data-gr-go]');
    if (g) { const q = $('#q'); if (q) q.value = g.dataset.grGo; const bno = $('#bno'); if (bno) bno.value = ''; lookup(g.dataset.grGo, ''); return; }
    const row = e.target.closest('[data-gr-row]');
    if (row) { growthState.open = growthState.open === row.dataset.grRow ? null : row.dataset.grRow; paint(); }
  });
  box.addEventListener('keydown', (e) => {
    const row = e.target.closest && e.target.closest('[data-gr-row]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
  });
  box.addEventListener('change', (e) => {
    const o = e.target.closest('[data-gr-opt]'); if (o) { growthState[o.dataset.grOpt] = o.checked; paint(); }
  });
  grBindHover(box);
  // 리포트가 열려 있으면 숨긴다 — 첫 화면(대시보드)에서만 보이는 패널이다
  const rep = document.getElementById('report');
  const sync = () => { box.hidden = !!(rep && !rep.classList.contains('hidden')); };
  if (rep) new MutationObserver(sync).observe(rep, { attributes: true, attributeFilter: ['class'] });
  sync();
  paint();
  fetch(`data/growth/latest.json?v=${BUILD}-${new Date().toISOString().slice(0, 10)}`, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => { growthState.data = d; paint(); })
    .catch((e) => { growthState.err = /Failed to fetch|NetworkError|CORS/i.test(e.message) ? '이 화면(파일로 연 경우)에서는 읽을 수 없습니다' : e.message; paint(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountGrowth); else mountGrowth();
