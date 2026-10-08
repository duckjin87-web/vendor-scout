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
const growthState = { data: null, period: '1', sort: 'net', onlyCos: false, hideTemp: true, open: null, err: null, req: null };
const GR_ACTIONS = 'https://github.com/duckjin87-web/vendor-scout/actions/workflows/growth.yml';
const grWhen = (iso) => { if (!iso) return ''; const t = new Date(iso); return `${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
// 조회 요청 줄 — 집계는 자동으로 돌지 않고 이 버튼(또는 GitHub Actions 화면)으로만 돈다
// meta: 버튼 아래 줄 — 기본은 국민연금 집계 시각, 명단 변동 패널은 자기 집계 시각을 넘긴다
function grReqHtml(st, meta) {
  const d = st.data || {}, q = st.req || {};
  const fd = d.fileDate ? d.fileDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : '';
  return `<div class="gr-req"><button type="button" class="nb-btn sm${q.busy ? '' : ' dark'}" data-gr-req${q.busy ? ' disabled' : ''}>${q.busy ? '집계 중…' : '최신 자료 조회 요청'}</button>`
    + `<small>${meta != null ? esc(meta) : `마지막 집계 ${esc(grWhen(d.builtAt) || '—')}${fd ? ` · 국민연금 파일 ${esc(fd)}` : ''} · 다음 공개 ${esc(d.nextUpdate || '미정')}`}</small>`
    + (q.msg ? `<p class="gr-reqmsg${q.err ? ' err' : ''}" role="status">${esc(q.msg)}${q.link ? ` <a href="${esc(q.link)}" target="_blank" rel="noopener">GitHub에서 직접 실행 ↗</a>` : ''}</p>` : '')
    + '</div>';
}

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
    + `<p class="gr-sub">기준월 <b>${esc(grYm(d.ym))}</b> (국민연금 최신 공개분) · 대상 ${d.counts.rows.toLocaleString()}개 사업장</p></div>${grReqHtml(st)}</div>`;
  // 기간 고르기 = 기간별 급증 사업장 수 타일
  h += '<div class="gr-tiles" role="tablist" aria-label="비교 기간">' + GR.PERIODS.map((p) => {
    const n = grRows(st, p).length;
    const cy = d.months[L - p.back];
    return `<button type="button" role="tab" class="gr-tile" data-gr-period="${p.id}" aria-selected="${st.period === p.id}">`
      + `<span>${esc(p.label)}</span><b>${n.toLocaleString()}곳</b><small>${esc(grYmS(cy))} → ${esc(grYmS(d.ym))} · +${Math.round(p.rate * 100)}%↑</small></button>`;
  }).join('') + grJobsTile(st) + '</div>';
  if (st.period === 'jobs') return h + grJobsHtml(st);
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

// ── 채용공고 급증(최근 30일) — data/growth/jobs.json(사람인·고용24 공식 API, 조회 요청 때 집계) ──
const GRJ = { MIN: 3, RATIO: 2, SHOW: 30 };
const grJobRows = (j) => ((j && j.rows) || []).filter((r) => r.cur >= GRJ.MIN && r.cur >= GRJ.RATIO * (r.prev || 0))
  .sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev) || b.cur - a.cur);
function grJobsTile(st) {
  const j = st.jobs;
  const ready = j && j.rows && Object.values(j.sources || {}).some((x) => x && x.ok);
  return `<button type="button" role="tab" class="gr-tile jobs" data-gr-period="jobs" aria-selected="${st.period === 'jobs'}">`
    + `<span>채용공고 급증 (최근 30일)</span><b>${ready ? `${grJobRows(j).length.toLocaleString()}곳` : '—'}</b>`
    + `<small>${ready ? `${esc(j.window.from.slice(5))} ~ ${esc(j.window.to.slice(5))} · 직전 30일의 ${GRJ.RATIO}배↑` : '사람인·고용24 API 키 등록 필요'}</small></button>`;
}
function grJobsHtml(st) {
  const j = st.jobs;
  const srcTxt = (k, nm) => { const x = j && j.sources && j.sources[k]; return x ? `${nm} ${x.ok ? `✓ ${x.cur ?? 0}건` : `✗ ${x.err}`}` : `${nm} —`; };
  if (!j || !Object.values(j.sources || {}).some((x) => x && x.ok)) {
    return '<div class="gr-empty"><b>채용공고 급증은 공식 API 키가 있어야 집계됩니다.</b><br>'
      + '구인 사이트 중 공식 API로 받을 수 있는 곳은 <b>사람인</b>(oapi.saramin.co.kr)과 <b>고용24</b>(work24.go.kr 오픈API)입니다. '
      + '두 곳 모두 무료로 신청할 수 있고, 받은 키를 GitHub 저장소 Settings → Secrets에 <code>SARAMIN_KEY</code> · <code>WORK24_KEY</code>로 넣은 뒤 '
      + '위 「최신 자료 조회 요청」을 누르면 함께 집계됩니다.<br>'
      + '잡코리아는 공개 API가 없고, 인크루트·링크드인은 사이트가 자동 수집을 막고 있어(robots.txt Disallow: /) 넣지 않았습니다.'
      + (j ? `<br><small>현재 상태: ${esc(srcTxt('saramin', '사람인'))} · ${esc(srcTxt('work24', '고용24'))}</small>` : '') + '</div>';
  }
  const rows = grJobRows(j);
  let h = `<div class="gr-tools"><span class="gr-crit">급증 기준: 최근 30일(${esc(j.window.from)}~${esc(j.window.to)}) 공고 ${GRJ.MIN}건 이상이면서 직전 30일의 ${GRJ.RATIO}배 이상 · `
    + `식약처 화장품 제조업 허가 업체만 · 출처 ${esc(srcTxt('saramin', '사람인'))} · ${esc(srcTxt('work24', '고용24'))}</span></div>`;
  if (!rows.length) return `${h}<div class="gr-empty">최근 30일 동안 기준을 넘은 화장품 제조업체가 없습니다.</div>`;
  h += `<p class="gr-count"><b>${rows.length}곳</b>의 채용공고가 최근 30일 동안 급증했습니다${rows.length > GRJ.SHOW ? ` — 상위 ${GRJ.SHOW}곳` : ''}.</p>`;
  h += '<div class="gr-tw"><table class="gr-tbl"><thead><tr><th>#</th><th>업체</th><th class="n">최근 30일</th><th class="n">직전 30일</th><th class="n">생산·품질 직무</th><th>최근 공고</th><th></th></tr></thead><tbody>';
  rows.slice(0, GRJ.SHOW).forEach((r, i) => {
    const posts = (r.posts || []).slice(0, 3).map((p) => `<a href="${esc(p.u || '#')}" target="_blank" rel="noopener">${esc(p.t)}</a><small>${esc([p.d, p.s].filter(Boolean).join(' · '))}</small>`).join('');
    h += `<tr><td class="n">${i + 1}</td><td><b>${esc(r.nm)}</b><div class="gr-bs">${Object.entries(r.src || {}).map(([k, v]) => `<span class="gr-b">${esc(k)} ${v}</span>`).join('')}</div></td>`
      + `<td class="n up">${r.cur}건<small>+${r.cur - (r.prev || 0)}</small></td><td class="n">${r.prev || 0}건</td><td class="n">${r.prod}건</td>`
      + `<td class="gr-posts">${posts}</td><td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.nm)}">사전검증</button></td></tr>`;
  });
  h += '</tbody></table></div>';
  h += `<p class="gr-foot">공고 수는 같은 공고를 한 번만 셉니다(검색어가 달라 겹친 것 제외). 직전 30일은 사람인 게시일 범위로 세고, 고용24는 최근 1개월만 주므로 지난 집계 때 값과 비교합니다. ${esc(j.note || '')} 공고 급증은 증원·신규 라인·이직 증가 어느 쪽일 수도 있어 방문 때 확인할 질문거리입니다.</p>`;
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
  growthState.repaint = () => { if (growthState.data) paint(); };
  let lastW = 0, rt = null;
  if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) < 24) return; lastW = box.clientWidth; clearTimeout(rt); rt = setTimeout(() => { if (growthState.data) paint(); }, 150); }).observe(box);
  box.addEventListener('click', (e) => {
    const p = e.target.closest('[data-gr-period]'); if (p) { growthState.period = p.dataset.grPeriod; growthState.open = null; paint(); return; }
    const s = e.target.closest('[data-gr-sort]'); if (s) { growthState.sort = s.dataset.grSort; paint(); return; }
    const g = e.target.closest('[data-gr-go]');
    if (g) { const q = $('#q'); if (q) q.value = g.dataset.grGo; const bno = $('#bno'); if (bno) bno.value = ''; lookup(g.dataset.grGo, ''); return; }
    if (e.target.closest('[data-gr-req]')) { grRequest(paint); return; }
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
  grLoad().then(paint).catch((e) => { growthState.err = /Failed to fetch|NetworkError|CORS/i.test(e.message) ? '이 화면(파일로 연 경우)에서는 읽을 수 없습니다' : e.message; paint(); });
}
const grLoad = (bust) => {
  const v = `${BUILD}-${bust || new Date().toISOString().slice(0, 10)}`;
  // 채용공고 집계는 없어도 된다(키 미등록 등) — 실패해도 국민연금 쪽은 그대로 그린다
  fetch(`data/growth/jobs.json?v=${v}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => { growthState.jobs = j; if (growthState.repaint) growthState.repaint(); }).catch(() => {});
  return fetch(`data/growth/latest.json?v=${v}`, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => { growthState.data = d; return d; });
};

// 「최신 자료 조회 요청」 — 프록시가 GitHub Actions 집계를 돌리고, 끝나면 새 집계를 다시 읽는다.
// 집계 작업은 포털의 최신 파일이 지난번과 같으면 내려받기·대조 없이 바로 끝난다.
async function grRequest(paint) {
  // 두 패널(급성장 신호·명단 변동)이 같은 요청 버튼을 쓴다 — 상태가 바뀌면 둘 다 다시 그린다
  const set = (o) => { growthState.req = { ...(growthState.req || {}), ...o }; paint(); if (typeof mkState !== 'undefined' && mkState.repaint) mkState.repaint(); };
  if (!getProxy()) { set({ msg: '실데이터 연결(프록시)이 있어야 요청할 수 있습니다 — 우측 상단 「실데이터 연결」을 먼저 해 주세요.', err: true, link: GR_ACTIONS }); return; }
  set({ busy: true, msg: '집계 요청 중…', err: false, link: null });
  let r;
  try { r = await proxyOnlyGet('growthRefresh', {}); } catch (e) {
    set({ busy: false, msg: e.message || '요청 실패', err: true, link: GR_ACTIONS }); return;
  }
  if (!r.started) { set({ msg: `${r.reason || '지금은 새로 돌리지 않았습니다'} — 끝나면 자동으로 새 자료를 불러옵니다.`, link: r.actionsUrl }); }
  else set({ msg: '집계를 시작했습니다. 새 달 자료가 있으면 내려받아 대조합니다(몇 분 + 사이트 반영 1~2분). 이 화면을 열어 두면 자동으로 바뀝니다.' });
  const before = growthState.data && growthState.data.builtAt;
  const t0 = Date.now();
  // 작업이 끝날 때까지 20초마다 확인(최대 25분) → 끝나면 사이트 반영을 기다리며 새 집계 파일을 다시 읽는다
  while (Date.now() - t0 < 25 * 60 * 1000) {
    await new Promise((res) => setTimeout(res, 20000));
    let st = null;
    try { st = await proxyOnlyGet('growthStatus', {}); } catch { continue; }
    const last = st && st.last;
    if (!last || last.status !== 'completed') continue;
    if (last.conclusion !== 'success') { set({ busy: false, msg: `집계 작업이 실패했습니다(${last.conclusion}).`, err: true, link: last.url }); return; }
    for (let k = 0; k < 9; k++) {
      mkLoad(Date.now()).then(() => mkState.repaint && mkState.repaint()).catch(() => {});
      try { const d = await grLoad(Date.now()); if (d.builtAt !== before) { set({ busy: false, msg: `새 자료로 바꿨습니다 — 기준월 ${grYm(d.ym)}.`, err: false, link: null }); return; } } catch { /* 반영 대기 */ }
      await new Promise((res) => setTimeout(res, 20000));
    }
    set({ busy: false, msg: '새로 공개된 국민연금 자료가 없어 지난 집계를 그대로 씁니다(포털 최신 파일이 지난번과 같음).', err: false, link: null });
    return;
  }
  set({ busy: false, msg: '아직 끝나지 않았습니다 — 잠시 뒤 새로고침해 주세요.', link: GR_ACTIONS });
}

// ═══ 화장품 제조업 명단 변동 — data/growth/makers.json(scripts/build-makers.mjs, 매주 + 조회 요청 때) ═══
// 식약처 제조업 명단을 누적 관리해, 지난 조회 이후 새로 들어온 업체와 빠진 업체를 보여 준다.
const mkState = { data: null, err: null, view: null, sido: null, npsOnly: false };
const MK_VIEWS = [{ id: 'add', label: '이번 조회 추가' }, { id: 'd30', label: '최근 30일 허가', days: 30 }, { id: 'd90', label: '최근 90일', days: 90 }];
const mkSido = (a) => grRegion(a).split(' ')[0] || '기타';
const mkDay = (iso) => (iso ? iso.slice(5) : '—');
function mkRows(st) {
  const d = st.data; if (!d) return [];
  const v = MK_VIEWS.find((x) => x.id === st.view) || MK_VIEWS[1];
  let rows = d.recent || [];
  if (v.id === 'add') rows = rows.filter((r) => r.add);
  else { const lim = new Date(Date.now() - v.days * 864e5).toISOString().slice(0, 10); rows = rows.filter((r) => r.p && r.p >= lim); }
  return rows;
}
function mkBars(monthly, w) {
  const H = 150, pad = 22, n = monthly.length, bw = (w - 8) / n;
  const max = Math.max(5, ...monthly.map((m) => m.n)) * 1.1;
  let s = `<svg class="mk-bars" viewBox="0 0 ${w} ${H}" width="${w}" height="${H}" role="img" aria-label="월별 신규 허가 막대 그래프">`;
  monthly.forEach((m, i) => {
    const h = Math.max(1, (H - pad - 16) * m.n / max), bwi = Math.min(36, bw * 0.64), x = 4 + i * bw + (bw - bwi) / 2, y = H - pad - h;
    const lbl = i === 0 || m.ym.endsWith('-01') ? `${m.ym.slice(2, 4)}.${m.ym.slice(5)}` : m.ym.slice(5);
    s += `<rect class="${i === n - 1 ? 'cur' : ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwi.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${esc(grYm(m.ym))}: ${m.n}곳</title></rect>`
      + `<text x="${(x + bwi / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="v">${m.n}</text>`
      + `<text x="${(x + bwi / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="m">${esc(lbl)}</text>`;
  });
  return s + '</svg>';
}
function mkBadges(r) {
  return [
    r.add ? '<span class="mk-b new">이번 조회 추가</span>' : '',
    r.on ? `<span class="mk-b warn" title="지난 조회 때 상호">상호 변경 · 이전 ${esc(r.on)}</span>` : '',
    r.nps != null ? `<span class="mk-b ok" title="국민연금 월간 파일(사업자번호 앞 6자리·상호 일치)">국민연금 ${r.nps.toLocaleString()}명</span>` : '<span class="mk-b dim" title="국민연금 월간 파일에 아직 없음(직원 3인 미만이거나 반영 전)">국민연금 미가입</span>',
    r.job ? `<span class="mk-b warn">채용공고 ${r.job}건</span>` : '',
    r.sale ? '<span class="mk-b dim" title="같은 사업자번호로 먼저 받은 책임판매업 허가가 있음">책임판매업 기존 보유</span>' : '',
    r.more ? '<span class="mk-b warn" title="같은 사업자번호로 먼저 받은 제조업 허가(다른 제조소)가 있음">기존 제조사 제조소 추가</span>' : '',
  ].join('');
}
function mkHtml(st) {
  const d = st.data;
  const head = (sub) => `<div class="gr-head"><div><h2>화장품 제조업 명단 변동 <small>식약처 제조업 허가 명단 누적 관리</small></h2>${sub || ''}</div>`
    + `${grReqHtml(growthState, `명단 마지막 갱신 ${(st.data && grWhen(st.data.builtAt)) || '—'}`)}</div>`;
  if (st.err) return head() + `<div class="gr-empty">명단 변동 자료를 불러오지 못했습니다 — ${esc(st.err)}</div>`;
  if (!d) return head() + '<div class="gr-empty">불러오는 중…</div>';
  if (!st.view) st.view = d.base || !d.counts.added ? 'd30' : 'add';
  const c = d.counts;
  let h = head(`<p class="gr-sub">${d.prevAt ? `지난 조회 <b>${esc(d.prevAt)}</b> → 이번 조회 <b>${esc(d.at)}</b>` : `첫 조회 <b>${esc(d.at)}</b> — 기준 명단을 저장했습니다`} · 매주 월요일 아침 자동 갱신</p>`);
  h += '<div class="gr-tiles mk-tiles">'
    + `<div class="gr-tile mk-t"><span>누적 관리 업체</span><b>${d.total.toLocaleString()}</b><small>현재 명단 기준</small></div>`
    + `<button type="button" class="gr-tile mk-t new" data-mk-view="add" aria-selected="${st.view === 'add'}"><span>이번 조회에 추가</span><b>${d.base ? '—' : `+${c.added}`}</b>`
    + `<small>${d.base ? '다음 조회부터 집계' : '지난 조회 이후 명단에 새로 생김'}</small></button>`
    + `<button type="button" class="gr-tile mk-t" data-mk-view="d30" aria-selected="${st.view === 'd30'}"><span>최근 30일 신규 허가</span><b>${c.d30}</b><small>90일 ${c.d90} · 1년 ${c.d365}</small></button>`
    + `<div class="gr-tile mk-t gone"><span>명단에서 빠짐</span><b>${d.base ? '—' : (c.removed ? `−${c.removed}` : '0')}</b><small>${c.renamed ? `상호 변경 ${c.renamed}곳 별도` : '폐업·취소 추정'}</small></div></div>`;
  h += `<div class="mk-sec">월별 신규 허가 <i>허가일 기준 · 최근 13개월 · 이번 달은 ${esc(d.at.slice(8))}일까지</i></div>`
    + `<div class="mk-chart">${mkBars(d.monthly || [], Math.max(280, growthState.cw || 640))}</div>`;
  // ── 새로 들어온 업체 ──
  const base = mkRows(st);
  const sidoN = {}; base.forEach((r) => { const k = mkSido(r.a); sidoN[k] = (sidoN[k] || 0) + 1; });
  const sidos = Object.entries(sidoN).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (st.sido && !sidoN[st.sido]) st.sido = null;
  let rows = base.filter((r) => (!st.sido || mkSido(r.a) === st.sido) && (!st.npsOnly || r.nps != null));
  h += '<div class="mk-sec">새로 들어온 업체</div><div class="mk-chips">'
    + MK_VIEWS.filter((v) => !(d.base && v.id === 'add')).map((v) => {
      const n = v.id === 'add' ? c.added : v.id === 'd30' ? c.d30 : c.d90;
      return `<button type="button" class="mk-chip${st.view === v.id ? ' on' : ''}" data-mk-view="${v.id}">${esc(v.label)} ${n}</button>`;
    }).join('')
    + '<span class="mk-sep"></span>'
    + sidos.map(([k, n]) => `<button type="button" class="mk-chip${st.sido === k ? ' on' : ''}" data-mk-sido="${esc(k)}">${esc(k)} ${n}</button>`).join('')
    + `<button type="button" class="mk-chip${st.npsOnly ? ' on' : ''}" data-mk-nps="1">국민연금 가입만</button></div>`;
  if (!rows.length) {
    h += `<div class="gr-empty">${st.view === 'add' ? '지난 조회 이후 명단에 새로 들어온 업체가 없습니다.' : '조건에 맞는 업체가 없습니다.'}</div>`;
  } else {
    h += '<table class="mk-tbl"><thead><tr><th>허가일</th><th>업체</th><th class="mk-addr">소재지</th><th>확인된 정보</th><th></th></tr></thead><tbody>'
      + rows.slice(0, 80).map((r) => `<tr><td class="mk-d">${esc(mkDay(r.p))}</td>`
        + `<td><b>${esc(r.n)}</b><small>${esc(grRegion(r.a) || r.a || '')}</small></td>`
        + `<td class="mk-addr">${esc(r.ad || r.a || '')}</td><td class="mk-bs">${mkBadges(r)}</td>`
        + `<td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.n)}">사전검증</button></td></tr>`).join('')
      + '</tbody></table>' + (rows.length > 80 ? `<p class="gr-foot">상위 80곳만 표시 — 전체 ${rows.length}곳</p>` : '');
  }
  // ── 명단에서 빠진 업체 · 상호 변경 ──
  const gone = d.removed || [], ren = d.renames || [];
  if (gone.length || ren.length) {
    h += `<details class="mk-gone"><summary>명단에서 빠진 업체 ${gone.length}곳${ren.length ? ` · 상호 변경 ${ren.length}곳` : ''} — 직전 조회(${esc(d.prevAt || '')})에는 있었음</summary><table class="mk-tbl"><tbody>`
      + gone.map((r) => `<tr><td class="mk-d">${esc(mkDay(r.p))}</td><td><b>${esc(r.n)}</b><small>${esc(grRegion(r.a))}</small></td>`
        + `<td class="mk-bs"><span class="mk-b gone">명단 제외</span>${r.nps != null ? `<span class="mk-b dim">국민연금 ${r.nps}명(${esc(grYmS(d.npsYm))})</span>` : ''}</td>`
        + `<td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.n)}">사전검증</button></td></tr>`).join('')
      + ren.map((r) => `<tr><td class="mk-d">—</td><td><b>${esc(r.from)} → ${esc(r.to)}</b><small>${esc(grRegion(r.a))}</small></td>`
        + `<td class="mk-bs"><span class="mk-b warn">상호 변경</span><span class="mk-b dim">사업자번호 동일</span></td>`
        + `<td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.to)}">사전검증</button></td></tr>`).join('')
      + '</tbody></table></details>';
  }
  h += `<p class="gr-foot">출처: ${esc(d.source)}. 「이번 조회 추가」는 직전 조회의 누적 명단에 없던 업체입니다(식약처 업체 일련번호 기준). `
    + '사업자번호가 같은 채 상호만 바뀐 업체는 신규·빠짐으로 세지 않고 「상호 변경」으로 따로 봅니다. 명단에 폐업 표시가 없어 「빠짐」은 폐업·허가 취소를 추정한 것입니다. '
    + `소재지는 공개 API가 시·군까지만 주어, 신규 업체는 의약품안전나라 목록의 번지 주소로 보강합니다. 국민연금 인원은 ${esc(grYm(d.npsYm) || '최근')} 월간 파일 기준이며, 허가 직후 업체는 대부분 미가입(직원 3인 미만 또는 반영 전)입니다.</p>`;
  return h;
}
function mountMakers() {
  const box = document.getElementById('makers');
  if (!box) return;
  const paint = () => { box.innerHTML = mkHtml(mkState); };
  mkState.repaint = paint;
  let lastW = 0, rt = null;
  if (window.ResizeObserver) new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) < 24) return; lastW = box.clientWidth; clearTimeout(rt); rt = setTimeout(() => { if (mkState.data) paint(); }, 150); }).observe(box);
  box.addEventListener('click', (e) => {
    const v = e.target.closest('[data-mk-view]'); if (v) { mkState.view = v.dataset.mkView; paint(); return; }
    const s = e.target.closest('[data-mk-sido]'); if (s) { mkState.sido = mkState.sido === s.dataset.mkSido ? null : s.dataset.mkSido; paint(); return; }
    if (e.target.closest('[data-mk-nps]')) { mkState.npsOnly = !mkState.npsOnly; paint(); return; }
    const g = e.target.closest('[data-gr-go]');
    if (g) { const q = $('#q'); if (q) q.value = g.dataset.grGo; const bno = $('#bno'); if (bno) bno.value = ''; lookup(g.dataset.grGo, ''); return; }
    if (e.target.closest('[data-gr-req]')) { grRequest(() => { if (growthState.repaint) growthState.repaint(); }); }
  });
  const rep = document.getElementById('report');
  const sync = () => { box.hidden = !!(rep && !rep.classList.contains('hidden')); };
  if (rep) new MutationObserver(sync).observe(rep, { attributes: true, attributeFilter: ['class'] });
  sync();
  paint();
  mkLoad().then(paint).catch((e) => { mkState.err = /Failed to fetch|NetworkError|CORS/i.test(e.message) ? '이 화면(파일로 연 경우)에서는 읽을 수 없습니다' : e.message; paint(); });
}
const mkLoad = (bust) => fetch(`data/growth/makers.json?v=${BUILD}-${bust || new Date().toISOString().slice(0, 10)}`, { cache: 'no-cache' })
  .then((r) => { if (r.status === 404) throw new Error('아직 첫 집계 전입니다 — 매주 월요일 아침 또는 「최신 자료 조회 요청」 때 만들어집니다'); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then((d) => { mkState.data = d; mkState.err = null; return d; });

const mountDash = () => { mountGrowth(); mountMakers(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountDash); else mountDash();
