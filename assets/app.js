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

// ── 실데이터 연결 (프록시 경유) ──
// data.go.kr·DART·네이버는 브라우저 직접 호출이 CORS로 막힌다. 프록시(Vercel /api/proxy 또는 Worker)
// 주소만 저장해 두고, 모든 조회를 프록시로 중계한다. API 키는 프록시 서버(환경변수)에만 있고 여기엔 없다.
const PROXY_KEY = 'vs_proxy';
const _ls = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const _sls = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
const getProxy = () => _ls(PROXY_KEY);
const isConnected = () => !!getProxy();
function setProxy(v) { _sls(PROXY_KEY, (v || '').trim()); }

// 프록시 주소 + 쿼리 → 최종 요청 URL. 루트 워커(경로 없음)엔 /를 붙이고, /api/proxy 같은 경로엔 그대로.
function buildProxyUrl(params) {
  const base = getProxy().replace(/\/+$/, '');
  const qs = new URLSearchParams(params).toString();
  // 경로가 있으면(/api/proxy) 그대로, 없으면(https://x.workers.dev) 루트 슬래시 추가
  const hasPath = /^https?:\/\//i.test(base) ? new URL(base).pathname.length > 1 : base.length > 0;
  return `${base}${hasPath ? '' : '/'}?${qs}`;
}

// 서비스별 파라미터 매핑(논리키 → 실제 data.go 파라미터명). 실제 엔드포인트 URL은
// 프록시(api/proxy.js·worker.js)에 단일 정의 — 화이트리스트로 오픈프록시 방지.
const PARAM_MAP = {
  corp:      { name: 'corpNm' },
  finance:   { crno: 'crno' },
  rpt:       { name: 'entp_name' },
  npsSearch: { name: 'wkpl_nm', bz6: 'bzowr_rgst_no' },
  npsDetail: { seq: 'seq', ym: 'data_crt_ym' },
  maker:     { name: 'bssh_nm' },
  customs:   { hs: 'hsSgn', from: 'strtYymm', to: 'endYymm' },
  gmp:       { rows: 'numOfRows' }, // 적합업체 현황(목록형) — 전체 받아 프론트에서 업체명 필터
};

// data.go 공통 에러 메시지 → 사용자 조치 안내
function friendlyDataGoErr(msg) {
  msg = String(msg || '').trim();
  if (/NOT_REGISTERED|UNREGISTERED/i.test(msg)) return `${msg} → 이 API의 data.go 활용신청(승인) 필요`;
  if (/LIMITED_NUMBER|EXCEEDS/i.test(msg)) return `${msg} → 일일 호출한도 초과`;
  if (/DEADLINE|EXPIRED/i.test(msg)) return `${msg} → 활용기간 만료(연장 필요)`;
  return msg;
}

// data.go 응답 해석 — HTTP 200이어도 본문(XML 또는 JSON 헤더)에 에러가 실려 온다
async function parseDataGo(res) {
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* XML일 수 있음 */ }
  if (data) {
    const h = (data.response && data.response.header) || data.header || {};
    const code = h.resultCode != null ? String(h.resultCode).trim() : null;
    if (code && code !== '00' && code !== '0') throw new Error(friendlyDataGoErr(h.resultMsg || `API 오류(code ${code})`));
    return data;
  }
  // XML 응답 = OpenAPI 공통 에러(미승인 키·한도초과 등)일 확률이 높다
  const m = text.match(/<returnAuthMsg>([^<]*)<|<resultMsg>([^<]*)<|<errMsg>([^<]*)</);
  throw new Error(friendlyDataGoErr(m ? (m[1] || m[2] || m[3]) : `JSON 아님(XML/HTML 응답): ${text.slice(0, 80)}`));
}

// 논리 파라미터 → 실제 파라미터로 매핑
function mapParams(logical, map) {
  const out = {};
  for (const [lk, v] of Object.entries(logical)) if (v != null && v !== '' && map[lk]) out[map[lk]] = v;
  return out;
}

// 프록시 비정상응답(res.ok=false) 본문에서 사람이 읽을 오류 메시지 추출
// (프록시가 { error, detail, upstreamStatus } 형태로 실어보냄. error가 객체여도 문자열화)
async function proxyErrMsg(res) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    const err = typeof j.error === 'object' ? JSON.stringify(j.error) : (j.error || '');
    const parts = [err, j.detail].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  } catch { /* JSON 아님 */ }
  return body ? body.slice(0, 200) : `프록시 HTTP ${res.status}`;
}

// 공공데이터 조회 — 프록시 경유. logical: { name?, crno?, bz6?, seq?, ym?, hs?, from?, to? }
async function proxyGet(service, logical) {
  const map = PARAM_MAP[service];
  if (!map) throw new Error(`알 수 없는 service: ${service}`);
  if (!getProxy()) throw new Error('프록시 미설정 — 우측 상단 실데이터 연결에 프록시 주소(/api/proxy)를 입력하세요');
  const url = buildProxyUrl({ service, ...mapParams(logical, map) });
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return parseDataGo(res);
}

// DART 공시 / 네이버 뉴스 — 프록시 전용 (CORS 차단 → 브라우저 직접 호출 불가)
async function proxyOnlyGet(service, params) {
  const proxy = getProxy();
  if (!proxy) throw new Error('프록시 미설정 — DART/네이버는 프록시(Worker) 경유 전용');
  let res;
  try { res = await fetch(buildProxyUrl({ service, ...params }), { headers: { Accept: 'application/json' } }); }
  catch (e) { throw new Error(`프록시 연결 실패: ${e.message}`); }
  if (!res.ok) throw new Error(await proxyErrMsg(res));
  return res.json();
}

// 응답에서 아이템 배열 추출 (공통 중첩 경로들 시도)
function itemsOf(data) {
  const paths = [
    (d) => d && d.response && d.response.body && d.response.body.items && d.response.body.items.item,
    (d) => d && d.body && d.body.items,
    (d) => d && d.items,
  ];
  for (const p of paths) {
    const v = p(data);
    if (v != null) return Array.isArray(v) ? v : [v].filter(Boolean);
  }
  return [];
}

// 1단계: 기준정보(동명업체 후보) 조회 → {candidates} 또는 {report}
async function liveLookup(name) {
  let cands = [];
  try {
    const corpData = await proxyGet('corp', { name });
    cands = window.mapCorpCandidates(corpData);
  } catch (e) { /* 기업기본정보 실패 → 식약처만으로 폴백 */ }

  if (!cands.length) {
    const rptData = await proxyGet('rpt', { name });
    return { report: window.mapMfdsReport(name, rptData) };
  }
  if (cands.length === 1) return { report: await finishLive(name, cands[0]) };
  return { candidates: cands, name };
}

// 법인 접두/접미어 제거 — 식약처/국민연금은 순수 상호로 조회해야 매칭됨
function stripCorp(s) {
  return String(s || '').replace(/\(주\)|\(유\)|\(재\)|\(사\)|㈜|주식회사|유한회사/g, '').trim();
}

// 국민연금 2단계: 사업장 검색 → 첫 건 seq로 상세조회(가입자수는 상세에만 있음)
async function npsLookup(nm, bz6) {
  const search = await proxyGet('npsSearch', { name: nm, bz6 });
  let items = itemsOf(search);
  // 사업자번호 필터로 0건이면 상호만으로 재시도
  if (!items.length && bz6) items = itemsOf(await proxyGet('npsSearch', { name: nm }));
  const hit = items[0];
  let detail = null;
  if (hit && hit.seq != null) {
    try { detail = await proxyGet('npsDetail', { seq: hit.seq, ym: hit.dataCrtYm }); }
    catch { /* 상세 실패해도 검색 결과는 사용 */ }
  }
  return { search: hit || null, detail: detail ? (itemsOf(detail)[0] || (detail.response && detail.response.body && detail.response.body.item) || null) : null, count: items.length };
}

// 2단계: 선택된 업체의 재무·식약처·국민연금·제조업 병렬 조회 → 진단 포함 조립
async function finishLive(name, corp) {
  const nm = stripCorp(corp.corpNm || name);
  const bz6 = corp.bzno ? String(corp.bzno).replace(/\D/g, '').slice(0, 6) : null;
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  // 관세청: 완료된 지난달까지(미래월은 data.go가 거부) 최근 24개월
  const custEnd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const custStart = new Date(now.getFullYear(), now.getMonth() - 24, 1);
  // DART: 최근 1년(YYYYMMDD)
  const dartFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10).replace(/-/g, '');
  const dartTo = now.toISOString().slice(0, 10).replace(/-/g, '');
  const calls = {
    finance: corp.crno ? proxyGet('finance', { crno: corp.crno }) : Promise.reject(new Error('법인등록번호 없음')),
    rpt: proxyGet('rpt', { name: nm }),
    nps: npsLookup(nm, bz6),
    maker: proxyGet('maker', { name: nm }),
    customs: proxyGet('customs', { hs: '33', from: ym(custStart), to: ym(custEnd) }),
    gmp: proxyGet('gmp', { rows: '500' }),
    dart: proxyOnlyGet('dart', { corp_name: nm, bgn_de: dartFrom, end_de: dartTo, page_count: '10', sort: 'date', sort_mth: 'desc' }),
    naverNews: proxyOnlyGet('naverNews', { query: `${nm} 화장품`, display: '5' }),
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
  btn.textContent = on ? '🟢 프록시 연결됨' : '🔌 실데이터 연결';
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
  { name: '총부채', unit: '억', grp: 'amt', color: '#f59e0b', invert: true, g: (d) => d.debt },
  { name: '영업이익률', unit: '%', grp: 'rat', color: '#a855f7', g: (d) => (d.revenue ? +(d.operatingProfit / d.revenue * 100).toFixed(1) : null) },
  { name: '부채비율', unit: '%', grp: 'rat', color: '#94a3b8', invert: true, g: (d) => { const eq = (d.assets || 0) - (d.debt || 0); return eq > 0 ? +(d.debt / eq * 100).toFixed(0) : null; } },
];

// 지표별 스파크 카드 — 각자 자기 스케일이라 수치 크기가 달라도 추이가 전부 보인다
function sparkCard(se, years) {
  const vals = se.vals;
  const idxs = vals.map((v, i) => (v != null ? i : null)).filter((i) => i != null);
  if (!idxs.length) {
    return `<div class="spark" style="border-top-color:${se.color}"><div class="sphead">${esc(se.name)} <span class="u">(${se.unit})</span></div><div class="spmiss">데이터 없음</div></div>`;
  }
  const first = vals[idxs[0]], last = vals[idxs[idxs.length - 1]];
  // 증감 배지: 금액은 %(첫해 대비), 비율(%)은 %p 차이
  let chg = '—', dir = 0;
  if (se.unit === '%') { const d = +(last - first).toFixed(1); chg = `${d > 0 ? '+' : ''}${d}%p`; dir = Math.sign(d); }
  else if (first) { const p = Math.round(((last - first) / Math.abs(first)) * 100); chg = `${p > 0 ? '+' : ''}${p}%`; dir = Math.sign(p); }
  const bad = se.invert ? dir > 0 : dir < 0;   // 부채류는 증가가 경고
  const good = se.invert ? dir < 0 : dir > 0;

  // 표시 포맷: %는 그대로, 억은 1만억 이상이면 '조' 단위로
  const fmt = (n) => se.unit === '%' ? `${n}%`
    : Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}조`
    : `${n}억`;
  const lbl = (n) => se.unit === '%' ? `${n}` : (Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')}조` : `${n}`);

  const W = 250, H = 100, px = 12, pt = 18, pb = 18;
  const nums = vals.filter((v) => v != null);
  const maxV = Math.max(...nums, 0), minV = Math.min(...nums, 0), span = (maxV - minV) || 1;
  const x = (i) => px + (W - 2 * px) * (vals.length > 1 ? i / (vals.length - 1) : 0.5);
  const y = (v) => pt + (H - pt - pb) * (1 - (v - minV) / span);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="spsvg">`;
  if (minV < 0 && maxV > 0) svg += `<line x1="${px}" y1="${y(0).toFixed(1)}" x2="${W - px}" y2="${y(0).toFixed(1)}" class="mini-base"/>`;
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  svg += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="2"/>`;
  vals.forEach((v, i) => {
    const xi = x(i).toFixed(1);
    if (v != null) {
      const yi = y(v);
      svg += `<circle cx="${xi}" cy="${yi.toFixed(1)}" r="2.8" fill="${se.color}"/>`;
      svg += `<text x="${xi}" y="${(yi - 5).toFixed(1)}" class="spptv" text-anchor="middle" fill="${se.color}">${lbl(v)}</text>`;
    }
    svg += `<text x="${xi}" y="${H - 5}" class="spptx" text-anchor="middle">${String(years[i]).slice(2)}</text>`;
  });
  svg += `</svg>`;

  return `<div class="spark" style="border-top-color:${se.color}">
    <div class="sphead">${esc(se.name)} <span class="u">(${se.unit})</span></div>
    <div class="spval">${fmt(last)}<span class="spchg ${bad ? 'bad' : good ? 'good' : ''}">${chg}</span></div>
    ${svg}
  </div>`;
}

// 재무 블록(전폭) = 지표별 스파크 카드 6개(각자 스케일) + 자본금 행
function financeBlock(report) {
  const fields = report.finance;
  const hist = report.finance_history || [];
  const b = el('div', 'block full');
  const chartN = hist.length ? '그래프 6지표 · 표 자본금' : `${fields.length}개 필드`;
  b.appendChild(el('h3', null, `<span class="ic">💰</span>재무 (금융위)<span class="cnt">${chartN}</span>`));

  if (hist.length) {
    const years = hist.map((d) => d.year);
    const w = el('div', 'finwrap');
    w.appendChild(el('div', 'finhead', `<span>재무 지표 ${years.length}개년 추이 (${years[0]}~${years[years.length - 1]}, 최신연도 기준)</span><span class="finnote">지표별 자기 스케일 — 추이 비교용</span>`));
    const grid = el('div', 'sparkgrid');
    FIN_SERIES.forEach((s) => {
      grid.insertAdjacentHTML('beforeend', sparkCard({ name: s.name, unit: s.unit, color: s.color, invert: s.invert, vals: hist.map(s.g) }, years));
    });
    w.appendChild(grid);
    b.appendChild(w);
  } else {
    b.appendChild(el('div', 'finmiss', '공식 재무 미제출 법인 — 추이 그래프 생략'));
  }
  const rows = el('div', 'finrows');
  const capRow = fields.find((f) => f.key === '자본금');
  if (capRow) rows.appendChild(fieldRow(capRow));
  else fields.forEach((f) => rows.appendChild(fieldRow(f)));
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

function renderNews(news) {
  if (!news || !news.length) return null;
  const b = el('div', 'newsbox');
  b.innerHTML = `<h4>📰 최신 관련기사 <span>(최근 1년 · ${news.length}건)</span></h4>`;
  const list = el('ul', 'newslist');
  news.forEach((n) => {
    const li = el('li');
    const title = String(n.title || '').replace(/<\/?b>/g, '');
    const desc = String(n.description || '').replace(/<\/?b>/g, '');
    const date = n.pubDate ? new Date(n.pubDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const src = n.source || '';
    li.innerHTML =
      `<a href="${esc(n.link || '#')}" target="_blank" rel="noopener" class="ntitle">${esc(title)}</a>` +
      `<div class="ndesc">${esc(desc.slice(0, 120))}${desc.length > 120 ? '…' : ''}</div>` +
      `<div class="nmeta">${date}${src ? ' · ' + esc(src) : ''}</div>`;
    list.appendChild(li);
  });
  b.appendChild(list);
  return b;
}

function renderDartDisclosures(disclosures) {
  if (!disclosures || !disclosures.length) return null;
  const b = el('div', 'dartbox');
  b.innerHTML = `<h4>📋 DART 공시 <span>(최근 1년 · ${disclosures.length}건)</span></h4>`;
  const list = el('ul', 'dartlist');
  disclosures.slice(0, 8).forEach((d) => {
    const li = el('li');
    const date = d.rcept_dt ? `${d.rcept_dt.slice(0, 4)}-${d.rcept_dt.slice(4, 6)}-${d.rcept_dt.slice(6, 8)}` : '';
    li.innerHTML =
      `<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${esc(d.rcept_no || '')}" target="_blank" rel="noopener" class="dtitle">${esc(d.report_nm || '(제목 없음)')}</a>` +
      `<div class="dmeta">${esc(date)}${d.flr_nm ? ' · ' + esc(d.flr_nm) : ''}</div>`;
    list.appendChild(li);
  });
  b.appendChild(list);
  return b;
}

function renderTradeRef(tradeRef) {
  if (!tradeRef) return null;
  const fmtUsd = (v) => {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
    return `$${v.toLocaleString()}`;
  };
  const b = el('div', 'traderef');
  b.innerHTML =
    `<h4>🌐 화장품 업종 수출입 참고 <span>(관세청 HS33 · ${tradeRef.itemCount}건)</span></h4>` +
    `<div class="tr-row"><b>수출 총액:</b> ${fmtUsd(tradeRef.totalExportUsd)}</div>` +
    (tradeRef.topCountries.length ? `<div class="tr-row"><b>주요 수출국:</b> ${esc(tradeRef.topCountries.join(', '))}</div>` : '') +
    `<div class="tr-note">※ ${esc(tradeRef.note)}</div>`;
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
    // 📡 소스별 조회 상태 — 무엇이 왜 비었는지 즉시 확인
    if (Array.isArray(m.src_status) && m.src_status.length) {
      const sp = el('div', 'srcstat');
      sp.innerHTML = '<b>📡 데이터 소스 상태</b>' + m.src_status.map((s) =>
        `<span class="ss ${s.ok ? 'ok' : 'no'}"><em>${s.ok ? '✓' : '✗'}</em>${esc(s.name)}<i>${esc(s.detail || '')}</i></span>`).join('');
      root.appendChild(sp);
    }
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
  const trb = renderTradeRef(report.trade_ref);
  if (trb) blocks.appendChild(trb);
  const dartB = renderDartDisclosures(report.dart_disclosures);
  if (dartB) blocks.appendChild(dartB);
  const newsB = renderNews(report.news);
  if (newsB) blocks.appendChild(newsB);
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
      const cur = getProxy();
      const next = window.prompt(
        '실데이터 연결 — 프록시 주소 입력:\n' +
        '같은 도메인이면  /api/proxy\n' +
        '다른 도메인이면  https://…/api/proxy\n\n' +
        '※ API 키는 프록시 서버(환경변수)에만 두세요. 여기엔 넣지 않습니다.\n' +
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
});
