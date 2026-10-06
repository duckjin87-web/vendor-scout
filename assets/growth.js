// growth.js — 첫 화면 「급성장 신호」 패널
// GitHub Actions(growth.yml)가 달마다 만드는 data/growth/latest.json을 읽어, 국민연금 가입자 기준으로
// 최근 1개월·2개월 사이 인원이 급증한 화장품 제조업체를 보여 준다.
//   1개월 = 그 달 신규취득 − 상실 (국민연금 파일에 그대로 실린 값)
//   2개월 = 이번 달 + 직전 달 순증. 포털이 이전 달 파일을 남기지 않아 집계 작업이 쌓은 스냅숏이 두 달치 이상일 때만 나온다.
// 리포트를 보고 있을 때는 숨기고, 검색창을 비워 첫 화면으로 돌아오면 다시 보인다.
// app.js의 $, el, esc, lookup, BUILD를 쓴다(이 파일은 app.js 뒤에 로드된다).

const GR = {
  MIN_NET: 3,          // 급증 — 순증 3명 이상이면서
  MIN_RATE: 0.10,      //        증가율 10% 이상
  BIG_NET: 20,         //        또는 순증 20명 이상(큰 사업장은 비율이 작아도 의미가 크다)
  SMALL_BASE: 5,       // 직전 인원 5명 미만은 '소규모' — 한두 명으로 비율이 크게 튄다
  SHOW: 30,
};
const growthState = { data: null, period: 1, sort: 'net', onlyCos: false, hideTemp: true, err: null };

function grRows(st) {
  const d = st.data; if (!d) return [];
  const k = st.period === 2 ? 'd2' : 'd1', b = st.period === 2 ? 'b2' : 'b1';
  return d.rows
    .filter((r) => r[k] != null && r[b] != null)
    .filter((r) => !(st.hideTemp && r.temp))
    .filter((r) => !st.onlyCos || r.cos)
    .map((r) => ({ ...r, net: r[k], base: r[b], rate: r[b] > 0 ? r[k] / r[b] : null }))
    .filter((r) => r.net >= GR.MIN_NET && ((r.rate != null && r.rate >= GR.MIN_RATE) || r.net >= GR.BIG_NET))
    // 증가율 순으로 볼 때 직전 인원이 몇 명 안 되는 곳(1→4명 +300%)이 맨 위를 차지하지 않게 소규모는 뒤로
    .sort((a, c) => (st.sort === 'rate' ? ((a.base < GR.SMALL_BASE) - (c.base < GR.SMALL_BASE)) || (c.rate ?? 0) - (a.rate ?? 0) : 0) || c.net - a.net || (c.rate ?? 0) - (a.rate ?? 0));
}
const grPct = (x) => (x == null ? '—' : `${x >= 10 ? '+999%↑' : `+${Math.round(x * 100)}%`}`);
const grWon = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString()}만`);
const GR_SIDO = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 경기도: '경기', 강원도: '강원', 제주도: '제주' };
const grRegion = (a) => String(a || '').replace(/특별자치시|특별자치도|광역시|특별시/g, '').split(/\s+/).filter(Boolean).slice(0, 2)
  .map((t, i) => (i === 0 ? (GR_SIDO[t] || t) : t)).join(' ');
const grYm = (ym) => (ym ? ym.replace(/^(\d{4})-(\d{2})$/, '$1년 $2월') : '');

function grHtml(st) {
  const d = st.data;
  if (st.err) return `<div class="gr-head"><h2>급성장 신호</h2></div><div class="gr-empty">급성장 집계를 불러오지 못했습니다 — ${esc(st.err)}</div>`;
  if (!d) return '<div class="gr-head"><h2>급성장 신호</h2></div><div class="gr-empty">불러오는 중…</div>';
  const two = !!d.prevYm;
  const rows = st.period === 2 && !two ? [] : grRows(st);
  const span = st.period === 1 ? `${grYm(d.ym)} 한 달` : (two ? `${grYm(d.prevYm)}~${grYm(d.ym)} 두 달` : '');
  let h = `<div class="gr-head"><div><h2>급성장 신호 <small>화장품 제조업 · 국민연금 가입자 기준</small></h2>`
    + `<p class="gr-sub">기준월 <b>${esc(grYm(d.ym))}</b> 자료 · 다음 갱신 ${esc(d.nextUpdate || '매월 말')} · 대상 ${d.counts.rows.toLocaleString()}개 사업장</p></div>`
    + `<div class="gr-seg" role="tablist" aria-label="기간">`
    + `<button type="button" role="tab" data-gr-period="1" aria-selected="${st.period === 1}">최근 1개월</button>`
    + `<button type="button" role="tab" data-gr-period="2" aria-selected="${st.period === 2}">최근 2개월</button></div></div>`;
  h += `<div class="gr-tools"><span class="gr-crit">급증 기준: 순증 ${GR.MIN_NET}명 이상 + 증가율 ${GR.MIN_RATE * 100}% 이상(또는 순증 ${GR.BIG_NET}명 이상)</span>`
    + `<label><input type="checkbox" data-gr-opt="onlyCos"${st.onlyCos ? ' checked' : ''}> 국민연금 업종 「화장품 제조업」만</label>`
    + `<label><input type="checkbox" data-gr-opt="hideTemp"${st.hideTemp ? ' checked' : ''}> 비정규·일용 사업장 빼기</label>`
    + `<span class="gr-sort">정렬 <button type="button" data-gr-sort="net" aria-pressed="${st.sort === 'net'}">증가 인원</button>`
    + `<button type="button" data-gr-sort="rate" aria-pressed="${st.sort === 'rate'}">증가율</button></span></div>`;
  if (st.period === 2 && !two) {
    h += `<div class="gr-empty"><b>2개월 비교는 다음 달 자료가 들어오면 열립니다.</b><br>`
      + `공공데이터포털은 국민연금 사업장 파일을 최신 한 달치만 남깁니다(이전 달 파일 없음). 이 화면은 달마다 받은 자료를 쌓아 두고 비교하므로, `
      + `${esc(d.nextUpdate || '다음 달')} 등록되는 자료부터 ${esc(grYm(d.ym))}과 합쳐 두 달 순증을 보여 드립니다.</div>`;
    return h;
  }
  if (!rows.length) return `${h}<div class="gr-empty">${esc(span)} 동안 급증 기준을 넘은 사업장이 없습니다.</div>`;
  h += `<p class="gr-count"><b>${rows.length}곳</b>이 ${esc(span)} 동안 급증 기준을 넘었습니다${rows.length > GR.SHOW ? ` — 상위 ${GR.SHOW}곳` : ''}</p>`;
  h += '<div class="gr-tw"><table class="gr-tbl"><thead><tr><th>#</th><th>사업장</th><th>지역</th><th class="n">인원</th><th class="n">증감</th><th class="n">입사 / 퇴사</th><th class="n">월 인건비(추정)</th><th></th></tr></thead><tbody>';
  rows.slice(0, GR.SHOW).forEach((r, i) => {
    const badges = [
      r.mfds ? '<span class="gr-b ok" title="식약처 화장품 제조업 허가 업체와 사업자번호 앞 6자리·상호 일치">식약처 제조업</span>' : '',
      !r.cos ? `<span class="gr-b" title="국민연금에 등록된 업종">${esc(r.codeNm || '기타 업종')}</span>` : '',
      r.base < GR.SMALL_BASE ? '<span class="gr-b warn" title="직전 인원이 적어 한두 명으로 비율이 크게 움직입니다">소규모</span>' : '',
      r.temp ? '<span class="gr-b warn">비정규·일용</span>' : '',
    ].join('');
    const inOut = st.period === 1 ? `+${r.nw} / −${r.ls}` : '—';
    const pay = st.period === 2 && r.amtPrev != null && r.amtPrev > 0
      ? `${grWon(r.amt / 0.09)} <small>${r.amt >= r.amtPrev ? '+' : ''}${Math.round((r.amt / r.amtPrev - 1) * 100)}%</small>`
      : grWon(r.amt / 0.09);
    h += `<tr><td class="n">${i + 1}</td><td><b>${esc(r.nm)}</b>${badges ? `<div class="gr-bs">${badges}</div>` : ''}</td>`
      + `<td>${esc(grRegion(r.addr))}</td><td class="n">${r.base.toLocaleString()} → <b>${r.cnt.toLocaleString()}</b></td>`
      + `<td class="n up">+${r.net.toLocaleString()}<small>${grPct(r.rate)}</small></td><td class="n">${inOut}</td><td class="n">${pay}</td>`
      + `<td><button type="button" class="nb-btn sm" data-gr-go="${esc(r.mfdsName || r.nm)}">사전검증</button></td></tr>`;
  });
  h += '</tbody></table></div>';
  h += `<p class="gr-foot">출처: ${esc(d.source)}. 범위: ${esc(d.scope)}. `
    + '사업장 단위라 같은 회사의 공장·본사가 따로 잡힐 수 있고, 월 입퇴사에는 계약직·단기 인력이 섞일 수 있습니다. '
    + '월 인건비는 국민연금 고지금액 ÷ 9%로 낸 하한 추정치입니다. 급증은 거래 판단의 근거가 아니라 <b>먼저 살펴볼 후보</b>를 고르는 신호입니다.</p>';
  return h;
}

function mountGrowth() {
  const box = document.getElementById('growth');
  if (!box) return;
  const paint = () => { box.innerHTML = grHtml(growthState); };
  box.addEventListener('click', (e) => {
    const p = e.target.closest('[data-gr-period]'); if (p) { growthState.period = Number(p.dataset.grPeriod); paint(); return; }
    const s = e.target.closest('[data-gr-sort]'); if (s) { growthState.sort = s.dataset.grSort; paint(); return; }
    const g = e.target.closest('[data-gr-go]');
    if (g) { const q = $('#q'); if (q) q.value = g.dataset.grGo; const bno = $('#bno'); if (bno) bno.value = ''; lookup(g.dataset.grGo, ''); }
  });
  box.addEventListener('change', (e) => {
    const o = e.target.closest('[data-gr-opt]'); if (o) { growthState[o.dataset.grOpt] = o.checked; paint(); }
  });
  // 리포트가 열려 있으면 숨긴다 — 첫 화면에서만 보이는 패널이다
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
