// samples.js — 데모용 스냅샷 샘플
// 실제 src/report/schema.js의 4블록 구조(meta/basic/capacity/finance/crosscheck/risk_flags)와 필드 형태를 그대로 따름.
// API 키 없이 브라우저에서 vendor-scout UI를 검증할 수 있도록 하는 정적 목데이터.

const GRADE = { OFFICIAL: 'A', PUBLIC: 'B', PROXY: 'C', GAP: 'D' };

function f(key, value, grade, source, asOf, note, fresh) {
  return {
    key,
    value: value ?? null,
    grade: value == null ? GRADE.GAP : grade,
    source: source || '—',
    as_of: asOf || null,
    fresh: fresh ?? (asOf ? true : null),
    data_gap: value == null,
    note: note || null,
  };
}

// 체크리스트 필드 (품질인증 / PLT거래여부 등) — checklist:[{label, ok}]
function fc(key, checklist, grade, source, asOf, note) {
  const anyOk = checklist.some((c) => c.ok);
  return {
    key,
    value: checklist.filter((c) => c.ok).map((c) => c.label).join(', ') || '해당 없음',
    checklist,
    grade: anyOk ? grade : GRADE.GAP,
    source: source || '—',
    as_of: asOf || null,
    fresh: asOf ? true : null,
    data_gap: false,
    note: note || null,
  };
}
const CERTS = ['CGMP', 'ISO 22716', 'ISO 14001', '할랄(HALAL)', '비건(Vegan)'];
function certList(oks) { return CERTS.map((label, i) => ({ label, ok: !!oks[i] })); }

// 재무 건전성 평가(최신연도) — 근거: 부채비율 200% 이하 양호(한국은행 기업경영분석 제조업 통상 기준),
// 400% 초과 위험, 자본총계 ≤ 0 = 자본잠식(부실), 영업손실=주의. 참고지표이며 최종판단은 신용조회 권장.
function assessFinance(hist) {
  if (!hist || !hist.length) return null;
  const L = hist[hist.length - 1];
  const equity = (L.assets != null && L.debt != null) ? L.assets - L.debt : null; // 자본총계 ≈ 자산-부채(억)
  const debtRatio = (equity && equity > 0) ? Math.round((L.debt / equity) * 100) : null;
  const reasons = [];
  let level = '양호';
  if (equity != null && equity <= 0) { level = '위험'; reasons.push('자본잠식 (자본총계 ≤ 0)'); }
  else if (debtRatio != null && debtRatio > 400) { level = '위험'; reasons.push(`부채비율 ${debtRatio}% (400% 초과)`); }
  else if (debtRatio != null && debtRatio > 200) { level = '주의'; reasons.push(`부채비율 ${debtRatio}% (200% 초과)`); }
  if (L.operatingProfit != null && L.operatingProfit < 0) { if (level === '양호') level = '주의'; reasons.push('영업손실(적자)'); }
  if (!reasons.length) reasons.push(`부채비율 ${debtRatio != null ? debtRatio + '%' : '—'} · 영업흑자`);
  return { level, debtRatio, equity, year: L.year, reasons };
}

// 교차검증 자동진단 — 서로 다른 출처의 같은 항목(인력·주소)을 대조해 정합/불일치를 자동 판정.
// status: match(일치) / warn(불일치·주의) / na(대조 불가). level: ok / mid / high / na.
// ── 대표자 교차 확인 ──
// [출처, 값, 부가설명] 목록을 받아 첫 출처를 기준으로 나머지를 대조한다. 값이 2곳 이상 있어야 판정한다.
// 공동대표('김A/박B')는 이름 묶음으로, 가림 표기('오*웅', '김○○')는 가린 글자를 아무 글자로 본다.
function repCross(list) {
  const names = (v) => String(v || '').split(/[,/·]|\s+및\s+/).map((x) => x.replace(/\s|\(.*?\)|대표(이사)?/g, '')).filter((x) => x.length >= 2);
  const same = (a, b) => a.length === b.length && [...a].every((c, i) => c === b[i] || /[*○◯●xX＊]/.test(c) || /[*○◯●xX＊]/.test(b[i]));
  const rows = list.filter(([, v]) => names(v).length).map(([src, v, sub]) => ({ src, val: names(v).join(' / '), n: names(v), sub: sub || null }));
  if (rows.length < 2) return rows.length ? { verdict: 'one', rows: rows.map(({ n, ...r }) => r) } : null;
  const base = rows[0];
  rows.forEach((r, i) => {
    if (!i) { r.st = 'base'; return; }
    const hit = r.n.filter((x) => base.n.some((y) => same(x, y))).length;
    r.st = hit && hit === r.n.length && hit === base.n.length ? 'ok' : hit ? 'part' : 'diff';
  });
  const diff = rows.filter((r) => r.st === 'diff'), part = rows.filter((r) => r.st === 'part');
  const verdict = diff.length ? 'diff' : part.length ? 'part' : 'ok';
  const msg = verdict === 'ok'
    ? `공개 자료 ${rows.length}곳의 대표자가 모두 같습니다. 등기상 현재 대표는 사업자등록증으로 확인하세요.`
    : verdict === 'part'
      ? `${part.map((r) => r.src).join('·')}에는 ${part.map((r) => r.val).join(', ')}로 올라 있어 공동·각자대표일 수 있습니다. 방문 때 법인등기부로 대표 구성을 확인하세요.`
      : `${base.src} ${base.val} ↔ ${diff.map((r) => `${r.src} ${r.val}${r.sub ? `(${r.sub})` : ''}`).join(', ')} — 대표가 바뀌었는데 일부 자료가 갱신되지 않았거나, 동명 타법인일 수 있습니다. `
        + '대표가 바뀌었다면 공장등록 변경 신고 여부와 경영권 변동 사유를 방문 때 물어보세요.';
  return { verdict, rows: rows.map(({ n, ...r }) => r), base: base.src, msg };
}

function crossVerify(ctx) {
  const { empNps, empFct, addrHq, addrNps, addrFct, addrWork, repHq, repPublic, repPublicSrc, repPublicLink, repCheck } = ctx;
  const items = [];
  // 주소 정규화 — 행정구역 접미/괄호/공백 제거 후 앞부분만 비교(번지·상세주소 차이 무시)
  const normA = (s) => String(s || '').replace(/특별자치시|특별자치도|특별시|광역시/g, '').replace(/\s|[()]/g, '');
  const shortA = (s) => normA(s).replace(/(\d+번?[길로])?\d[-\d]*(번지|호|층)?.*$/, '').slice(0, 9);

  // 1) 인력 정합성 — 국민연금 재직자수(월 갱신·현재) ↔ 공장등록 종업원수(등록시점 스냅샷)
  const n1 = Number(empNps), n2 = Number(empFct);
  if (isFinite(n1) && n1 > 0 && isFinite(n2) && n2 > 0) {
    const ratio = Math.max(n1, n2) / Math.min(n1, n2);
    if (ratio <= 1.5) items.push({ label: '인력 정합성', status: 'match', detail: `국민연금 ${n1}명 ≈ 공장등록 ${n2}명 — 신고 인력 정합` });
    else {
      const grow = n1 > n2;
      items.push({ label: '인력 정합성', status: 'warn', severe: ratio >= 3,
        detail: `국민연금 ${n1}명 ↔ 공장등록 ${n2}명 (약 ${ratio.toFixed(1)}배 차이) — ${grow
          ? '현재(연금) 인력이 더 많음: 공장등록 이후 증원 추정'
          : '공장등록 신고값이 더 큼: 인력 축소·라인 이전 또는 과다신고 가능'}. 실제 가동 인력 방문 확인 권장` });
    }
  } else {
    const miss = [(!isFinite(n1) || !n1) ? '국민연금 재직자수' : null, (!isFinite(n2) || !n2) ? '공장등록 종업원수' : null].filter(Boolean);
    items.push({ label: '인력 정합성', status: 'na', detail: `대조 불가 — ${miss.join(' · ')} 미확보` });
  }

  // 2) 주소 정합성 — 본점(등기) ↔ 연금 사업장(실근무) ↔ 공장 소재지(실생산)
  // 채용공고의 근무지주소는 '사람이 실제로 출근하는 곳'이라 등기·신고 주소와 성격이 다르다.
  // 네 번째 출처로 함께 대조한다 — 공고는 회사가 직접 올린 것이라 최신인 경우가 많다.
  const addrs = [['본점(등기)', addrHq], ['연금 사업장', addrNps], ['공장 소재지', addrFct],
    ['채용공고 근무지', addrWork]].filter(([, v]) => v);
  if (addrs.length >= 2) {
    const uniq = [...new Set(addrs.map(([, v]) => shortA(v)))];
    if (uniq.length === 1) items.push({ label: '주소 정합성', status: 'match', detail: `${addrs.map(([l]) => l).join(' · ')} 동일 권역 — 등기·근무·생산지 일치` });
    else items.push({ label: '주소 정합성', status: 'warn', detail: `${addrs.map(([l, v]) => `${l} ${v}`).join(' / ')} — 소재지 상이. 실제 생산현장(공장/연금 사업장) 기준으로 방문` });
  } else {
    items.push({ label: '주소 정합성', status: 'na', detail: '대조할 주소 2건 미만 (일부 출처 미확보)' });
  }

  // 3) 대표자 정합성 — 등기 대표자 ↔ 지자체 공장정보 게재 대표자
  // 다르면 명의변경·각자대표·자료 노후 중 하나인데, 어느 쪽이든 실체 확인에서 먼저 짚어야 한다.
  if (repCheck && repCheck.rows.length >= 2) {
    const vs = repCheck.rows.map((r) => `${r.src} ${r.val}`).join(' · ');
    items.push(repCheck.verdict === 'ok'
      ? { label: '대표자 정합성', status: 'match', detail: `${vs} — ${repCheck.rows.length}곳 일치` }
      : { label: '대표자 정합성', status: 'warn', severe: false,
          detail: `${repCheck.verdict === 'diff' ? '대표 변경 가능성' : '공동대표 가능성'} — ${repCheck.msg}${repPublicLink ? ` (근거: ${repPublicLink})` : ''}` });
  } else if (repHq && repPublic) {
    const same = String(repHq).replace(/\s/g, '') === String(repPublic).replace(/\s/g, '');
    items.push(same
      ? { label: '대표자 정합성', status: 'match', detail: `등기(금융위)·${repPublicSrc || '공장정보'} 모두 ${repHq} — 일치` }
      : { label: '대표자 정합성', status: 'warn', severe: false,
          detail: `등기(금융위) ${repHq} ↔ ${repPublicSrc || '공장정보'} ${repPublic} — 대표자 표기 상이. `
            + '명의변경 후 공장등록 미갱신, 각자대표, 또는 동명 타법인일 수 있습니다. '
            + '방문 시 사업자등록증·법인등기부로 현재 대표자를 확인하세요.'
            + (repPublicLink ? ` (근거: ${repPublicLink})` : '') });
  }

  const warnCount = items.filter((x) => x.status === 'warn').length;
  const naAll = items.every((x) => x.status === 'na');
  const level = naAll ? 'na' : (warnCount === 0 ? 'ok' : (warnCount >= 2 ? 'high' : 'mid'));
  return { items, level, warnCount };
}

// ── 재무 계열 단절 진단 ──
// 금융위 재무 API는 외부감사·공시 대상분만 수록한다. 그래서 어느 해에서 자료가 뚝 끊기는데,
// 화면에 '끊겼다'만 뜨면 폐업·부실로 오해하기 쉽다. 실제로는 규모가 줄어 외부감사 대상에서
// 빠진 경우가 대부분이다 — 자료가 사라진 것이지 회사가 사라진 게 아니다.
// 그래서 끊긴 시점의 수치로 사유를 추정해 함께 적는다.
//
// 외부감사 대상 기준 (주식회사 등의 외부감사에 관한 법률 시행령 제5조)
//   단독 요건: 자산 500억 이상 또는 매출 500억 이상
//   복합 요건: 자산 120억·부채 70억·매출 100억·종업원 100명 중 2개 이상
const EXT_AUDIT = { asset: 120, debt: 70, sale: 100, emp: 100, solo: 500 };
function auditFit(row, emp) {
  const hit = [];
  if (row.assets != null && row.assets >= EXT_AUDIT.asset) hit.push(`자산 ${row.assets}억`);
  if (row.debt != null && row.debt >= EXT_AUDIT.debt) hit.push(`부채 ${row.debt}억`);
  if (row.revenue != null && row.revenue >= EXT_AUDIT.sale) hit.push(`매출 ${row.revenue}억`);
  const n = Number(emp);
  if (isFinite(n) && n >= EXT_AUDIT.emp) hit.push(`종업원 ${n}명`);
  const solo = (row.assets != null && row.assets >= EXT_AUDIT.solo) || (row.revenue != null && row.revenue >= EXT_AUDIT.solo);
  return { hit, solo, met: solo || hit.length >= 2 };
}
// history: [{year, revenue, assets, debt, ...}] 오름차순 · emp: 재직자수 · bizStt: 국세청 사업자상태
// 반환: 재무 코멘트에 덧붙일 문장(없으면 '')
function financeBreakNote(history, curYear, emp, bizStt) {
  if (!history || !history.length) return '';
  const years = history.map((h) => h.year);
  const last = years[years.length - 1];
  const lag = curYear - last;
  const parts = [];

  // ① 계열이 최근까지 이어지지 않고 끝난 경우 — 사유 추정까지 붙인다
  if (lag >= 3) {
    const L = history[history.length - 1];
    const fit = auditFit(L, emp);
    parts.push(`⚠ 재무 계열이 ${last}년에서 끊겼습니다 — 이후 ${lag}년치가 이 API에 없습니다.`);
    if (fit.met) {
      const why = fit.solo ? `${L.assets != null && L.assets >= EXT_AUDIT.solo ? `자산 ${L.assets}억` : `매출 ${L.revenue}억`}(단독 요건)` : fit.hit.join(' · ');
      parts.push(`${last}년 기준 ${why}으로 외부감사 대상 요건을 충족했으나, 이후 요건 미달로 대상에서 제외돼 제출 의무가 사라진 것으로 추정됩니다`
        + `(기준: 자산 120억·부채 70억·매출 100억·종업원 100명 중 2개 이상, 또는 자산·매출 500억 단독).`);
    } else {
      parts.push(`${last}년 시점에도 외부감사 요건을 충족하지 않아, 이후 제출 의무가 없어 자료가 이어지지 않는 것으로 추정됩니다.`);
    }
    // 국세청 상태가 정상이 아니면 안심시키는 문장을 붙여선 안 된다 — 정반대로 읽힌다.
    const ceased = /폐업|휴업/.test(String(bizStt || ''));
    if (ceased) {
      parts.push(`국세청 사업자상태가 '${bizStt}'입니다 — 자료 중단을 규모 축소로만 보지 마시고, 실제 영업 중단 여부를 우선 확인하세요.`);
    } else {
      parts.push(`자료 중단 자체는 폐업·부실 신호가 아닙니다`
        + (bizStt ? ` — 국세청 사업자상태는 '${bizStt}'입니다.` : '(국세청 사업자상태를 함께 확인하세요).')
        + ` 다만 이 API로는 현재 규모를 알 수 없으므로, 아래 수치를 현재 상태로 해석하지 마시고 최근 결산서를 직접 요청하거나 신용조회로 확인하세요.`);
    }
  }

  // ② 수록 연도 사이에 빠진 해가 있는 경우 — 증감 해석을 왜곡하므로 별도로 알린다
  const missing = [];
  for (let y = years[0] + 1; y < last; y++) if (!years.includes(y)) missing.push(y);
  if (missing.length) {
    parts.push(`※ 수록 연도 사이에 결측이 있습니다(${missing.join('·')}) — 미제출이 아니라 API 미수록일 수 있어, 연도 간 증감을 연속 추세로 읽지 마세요.`);
  }
  return parts.join(' ');
}

// 레코드에서 사업자등록번호 추출 — 사업자번호 힌트 키 우선, 없으면 ###-##-##### 패턴 스캔.
// (금융위 법인 미확보 시 식약처/공장 레코드에서 사업자번호를 건지면 국세청·국민연금 재조회 가능)
// 위와 같은 이유로 app.js의 findBznoIn 하나만 남긴다.
const findBzno = (rec) => findBznoIn(rec);

// 목록 응답에서 상호가 포함된 레코드 찾기(필드명이 API마다 달라 전체 값 스캔). stripCorp는 런타임(app.js) 전역.
// app.js의 matchByNameApp과 바이트 단위로 같은 구현이 여기 따로 있었다. 같은 규칙이 두 곳에
// 있으면 한쪽만 고쳐져 조용히 갈라진다 — 실제로 상호 대조 규칙은 여러 번 손봤다.
// 구현은 app.js 하나로 두고 여기서는 그걸 부른다(둘 다 로드된 뒤에만 호출된다).
const matchByName = (name, list) => matchByNameApp(name, list);
// 이 리포트의 회사 사업자번호로 걸러 대조 — 상호가 같아도 번호가 다르면 남의 회사
let _matchBz = null;
const matchMine = (name, list) => (typeof matchFirm === 'function' ? matchFirm(name, _matchBz, list) : matchByName(name, list));


// ── 방문 이동거리 추정 (한국콜마 세종 기준점) ──
const REF_POINT = { name: '한국콜마', addr: '세종특별자치시 전의면 산단길 22-17', lat: 36.6988177, lng: 127.2153174 };
const COORDS = [
  ['향남읍',37.096,126.905],['오송',36.622,127.109],['진량읍',35.858,128.802],
  ['통진읍',37.645,126.634],['청북읍',36.973,127.076],['전의면',36.631,127.046],
  ['화성시',37.199,126.831],['안산시',37.322,126.831],['김포시',37.615,126.715],
  ['평택시',36.992,127.112],['용인시',37.241,127.177],['청주시',36.642,127.489],
  ['천안시',36.815,127.114],['경산시',35.825,128.802],['남동구',37.449,126.731],
  ['단원구',37.318,126.797],['서북구',36.820,127.156],['흥덕구',36.639,127.430],
  ['유성구',36.362,127.356],['처인구',37.234,127.202],
  ['서울',37.566,126.978],['인천',37.456,126.705],['대전',36.351,127.385],
  ['세종',36.480,127.261],['대구',35.872,128.602],['부산',35.180,129.076],
  ['광주',35.160,126.851],['울산',35.539,129.311],
  ['경기도',37.400,127.000],['충청북도',36.635,127.490],['충청남도',36.659,126.673],
  ['경상북도',36.576,128.506],['경상남도',35.238,128.692],
  ['전라북도',35.820,127.108],['전라남도',34.816,126.463],['강원',37.885,127.730],['제주',33.489,126.498],
];
function haversineKm(la1,lo1,la2,lo2){const R=6371,r=Math.PI/180,dL=(la2-la1)*r,dO=(lo2-lo1)*r,a=Math.sin(dL/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dO/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
function estimateTravel(addr){
  if(!addr)return null;
  for(const[key,lat,lng]of COORDS){if(addr.includes(key)){
    const s=haversineKm(REF_POINT.lat,REF_POINT.lng,lat,lng);
    if(s<2)return{km:0,min:0,same:true};
    const d=Math.round(s*1.35),m=Math.round(d/65*60);
    return{km:d,min:m};
  }}
  return null;
}
function travelText(est){
  if(!est)return null;
  if(est.same)return '한국콜마 인근 (동일 권역)';
  const h=Math.floor(est.min/60),m=est.min%60;
  // 통행료는 카카오가 주는데 여태 버렸다. 왕복 통행료는 방문 품의에 바로 쓰이는 숫자다.
  const toll = est.toll ? ` · 통행료 편도 ${est.toll.toLocaleString()}원` : '';
  return `약 ${est.km}km · 차량 ${h?h+'시간 ':''}${m}분${toll}`;
}

// ── 샘플 1: 리니어코스메틱 — 대체로 양호(A), 단 주소 3중 상충 1건 ──
const linear = {
  meta: {
    vendor_name: '리니어코스메틱',
    vendor_id: 'linear-cosmetic',
    query_at: '2026-07-07T02:14:00.000Z',
    version: 3,
    overall_grade: 'A',
    sources_used: ['금융위 기업기본정보', '금융위 재무정보 API', '식약처 보고품목 API', '식약처 GMP', '국민연금 사업장'],
    max_age_years: 5,
  },
  basic: [
    f('법인등록번호', '110111-3948271', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('사업자등록번호', '214-88-01923', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('대표자', '김선우', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('설립일', '2009-04-13', 'A', '금융위 기업기본정보', '2009-04-13'),
    f('본점주소', '경기도 화성시 향남읍 제약공단로 45', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('제조소 소재지', '경기도 화성시 향남읍 제약공단로 45', 'B', '식약처 제조업 등록', '2026-07-07'),
    f('사업자상태', '계속사업자', 'A', '국세청 사업자상태', '2026-07-07'),
    f('제조업 등록', '화장품제조업 (등록 제2011-1428호)', 'A', '식약처 제조업 등록', '2011-06-02'),
  ],
  capacity: [
    f('재직자수 (국민연금 가입자)', '87명', 'B', '국민연금 사업장 API', '2026-05-31', '4대보험 가입 재직자 — 파견·일용·프리랜서 미포함. 방문 시 실인원 대조'),
    f('사업장 주소 (연금기준)', '경기도 화성시 향남읍 제약공단로 51', 'C', '국민연금 사업장 정보', '2026-05-31', '본점/제조소와 번지 상이 — 실사 확인 필요'),
    f('방문 이동거리', travelText(estimateTravel('경기도 화성시 향남읍 제약공단로 45')), 'C', `기준: ${REF_POINT.name} (${REF_POINT.addr})`, '2026-07-07', '직선거리 기반 추정 — 네이버/카카오 지도에서 정확한 경로 확인'),
    f('기능성 보고품목 수 (5년내)', 42, 'A', '식약처 보고품목 API', '2026-07-07'),
    f('신고 제형 분포', '크림, 로션, 앰플/세럼, 마스크팩, 젤', 'C', '식약처 보고품목 API', '2026-07-07', 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    fc('품질인증', certList([1, 1, 1, 0, 1]), 'A', '식약처 GMP·인증기관', '2024-11-20', 'CGMP 적합업소(유효) + 국제 품질/윤리 인증'),
  ],
  finance: [
    f('매출액', '218억 원', 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
    f('영업이익', '19.4억 원', 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
    f('총자산', '164억 원', 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
    f('총부채', '71억 원', 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
    f('자본금', '10억 원', 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
  ],
  // 최신연도(2024) 기준 과거 5개년 전지표 — 통합 추이 그래프용 (금액 단위: 억 원)
  finance_history: [
    { year: 2020, revenue: 61, operatingProfit: 2.1, assets: 84, debt: 47, capital: 10 },
    { year: 2021, revenue: 78, operatingProfit: 3.6, assets: 96, debt: 52, capital: 10 },
    { year: 2022, revenue: 92, operatingProfit: 4.2, assets: 108, debt: 58, capital: 10 },
    { year: 2023, revenue: 151, operatingProfit: 12.6, assets: 139, debt: 65, capital: 10 },
    { year: 2024, revenue: 218, operatingProfit: 19.4, assets: 164, debt: 71, capital: 10 },
  ],
  crosscheck: [
    { key: '실제 공장 소재지', expected: '3개 출처 상충 — 플래그 참조', verified: null, match: null, src_type: '3중대조' },
    { key: '사업장 주소 (연금기준)', expected: '경기도 화성시 향남읍 제약공단로 51', verified: null, match: null, src_type: '국민연금 사업장 정보' },
    { key: '신고 제형 분포', expected: '크림, 로션, 앰플/세럼, 마스크팩, 젤', verified: null, match: null, src_type: '식약처 보고품목 API' },
    { key: '재직자수 (국민연금 가입자)', expected: '87명', verified: null, match: null, src_type: '국민연금 사업장 API' },
  ],
  risk_flags: [
    { type: 'address_conflict', detail: '본점주소: 제약공단로 45 | 제조소 소재지: 제약공단로 45 | 사업장 주소 (연금기준): 제약공단로 51' },
  ],
  diff_from_prev: [
    { key: '재직자수 (국민연금 가입자)', before: '81명', after: '87명' },
    { key: '기능성 보고품목 수 (5년내)', before: 39, after: 42 },
  ],
  news: [
    { title: '리니어코스메틱, 베트남 법인 설립…동남아 시장 본격 진출', link: '#', pubDate: '2026-06-20', description: '경기도 화성 소재 화장품 제조업체 리니어코스메틱이 베트남 호치민에 현지법인을 설립하고 동남아 시장 공략에 나선다고 밝혔다.' },
    { title: '화장품 OEM 업계 "올해 수출 20% 성장 기대"', link: '#', pubDate: '2026-04-11', description: '국내 주요 화장품 OEM·ODM 업체들이 K-뷰티 수요 증가에 힘입어 올해 수출 실적 20% 이상 성장을 전망하고 있다.' },
    { title: '리니어코스메틱, CGMP 재인증 획득…품질관리 역량 입증', link: '#', pubDate: '2025-11-28', description: '리니어코스메틱이 식약처 우수화장품 제조·품질관리기준(CGMP) 재인증 심사를 통과했다고 밝혔다.' },
  ],
};

// ── 샘플 2: 샘플뷰티랩 — 데이터 공백 다수(B/D), 재무 미제출 ──
const beautylab = {
  meta: {
    vendor_name: '샘플뷰티랩',
    vendor_id: 'sample-beautylab',
    query_at: '2026-07-07T02:20:00.000Z',
    version: 1,
    overall_grade: 'C',
    sources_used: ['금융위 기업기본정보', '식약처 보고품목 API', '국민연금 사업장'],
    max_age_years: 5,
  },
  basic: [
    f('법인등록번호', '134511-0092817', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('사업자등록번호', '507-81-77210', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('대표자', '박정민', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('설립일', '2021-09-01', 'A', '금융위 기업기본정보', '2021-09-01'),
    f('본점주소', '충청북도 청주시 흥덕구 오송생명로 12', 'A', '금융위 기업기본정보', '2026-07-07'),
    f('제조소 소재지', null, 'D', '식약처 제조업 등록', null, '제조업 등록 미확인 — 위탁제조(OEM) 가능성'),
    f('사업자상태', '계속사업자', 'A', '국세청 사업자상태', '2026-07-07'),
    f('제조업 등록', null, 'D', '식약처 제조업 등록', null, '조회 결과 없음 — 책임판매업만 등록 추정'),
  ],
  capacity: [
    f('재직자수 (국민연금 가입자)', '11명', 'B', '국민연금 사업장 API', '2026-05-31', '4대보험 가입 재직자 — 파견·일용·프리랜서 미포함. 방문 시 실인원 대조'),
    f('사업장 주소 (연금기준)', '충청북도 청주시 흥덕구 오송생명로 12', 'C', '국민연금 사업장 정보', '2026-05-31'),
    f('방문 이동거리', travelText(estimateTravel('충청북도 청주시 흥덕구 오송생명로 12')), 'C', `기준: ${REF_POINT.name} (${REF_POINT.addr})`, '2026-07-07', '직선거리 기반 추정 — 네이버/카카오 지도에서 정확한 경로 확인'),
    f('기능성 보고품목 수 (5년내)', 3, 'A', '식약처 보고품목 API', '2026-07-07'),
    f('신고 제형 분포', '앰플/세럼', 'C', '식약처 보고품목 API', '2026-07-07', '단일 제형 — 소품목 소량 추정'),
    fc('품질인증', certList([0, 0, 0, 0, 0]), 'B', '식약처 GMP·인증기관', '2026-07-07', 'CGMP 적합업소 목록 미포함 — 인증 미확인'),
  ],
  finance: [
    f('매출액', null, 'D', '금융위 재무정보 API', null, '데이터 미제출 법인 — 외감 비대상 (등기부/자체제출 폴백)'),
    f('영업이익', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
    f('총자산', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
    f('총부채', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
    f('자본금', '3억 원', 'B', '등기부 (수동 확인)', '2024-12-31'),
  ],
  // 공식 재무 미제출 → 3개년 추이 그래프 생략
  finance_history: [],
  crosscheck: [
    { key: '제조소 소재지', expected: null, verified: null, match: null, src_type: '식약처 제조업 등록' },
    { key: '제조업 등록', expected: null, verified: null, match: null, src_type: '식약처 제조업 등록' },
    { key: 'GMP 인증', expected: null, verified: null, match: null, src_type: '식약처 GMP' },
    { key: '매출액', expected: null, verified: null, match: null, src_type: '금융위 재무정보 API' },
  ],
  risk_flags: [
    { type: 'data_gap', source: 'fsc', detail: '재무 데이터 없음 (외감 비대상 추정)' },
    { type: 'data_gap', source: 'mfds', detail: '제조업 등록 미확인 — 자사 제조 여부 실사 필수' },
  ],
  diff_from_prev: [],
  news: [
    { title: '중소 뷰티 브랜드 OEM 위탁 증가세…"자사 제조보다 비용 효율적"', link: '#', pubDate: '2026-03-15', description: '최근 중소 화장품 브랜드 사이에서 OEM 위탁제조 수요가 빠르게 증가하고 있다. 자체 공장 투자 부담 없이 품질관리가 가능하다는 점이 부각됐다.' },
  ],
};

// ── 범용성: 미등록 업체명 입력 시 이름 기반 결정론적 데모 리포트 자동 생성 ──
// (정적 데모라 실제 API 호출 불가 → 동일 이름은 항상 동일 결과. "자동 생성 데모"로 표기)
function seedFrom(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const G_SURNAME = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '홍', '류'];
const G_GIVEN = ['민준', '서연', '도윤', '하은', '지호', '수아', '예준', '지우', '현우', '서준', '지훈', '은서', '건우', '채원', '성민', '다은', '정우', '소율', '태현', '유진'];
const G_REGION = ['경기도 화성시 향남읍', '충청북도 청주시 흥덕구', '인천광역시 남동구', '경기도 안산시 단원구', '충청남도 천안시 서북구', '경기도 김포시 통진읍', '경상북도 경산시 진량읍', '경기도 평택시 청북읍', '대전광역시 유성구', '경기도 용인시 처인구'];
const G_STREET = ['제약공단로', '생명로', '테크노밸리로', '바이오로', '산단로', '과학산업로', '뷰티로', '일반산업로'];
const G_FORMS = ['크림', '로션', '스킨/토너', '앰플/세럼', '에센스', '마스크팩', '젤', '선크림', '클렌징폼', '밤', '미스트', '아이크림'];

function generateReport(rawName) {
  const name = String(rawName).trim();
  const rand = mulberry32(seedFrom(name));
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const chance = (p) => rand() < p;
  const pad = (n, l) => String(n).padStart(l, '0');
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const today = '2026-07-07';

  const region = pick(G_REGION);
  const hqAddr = `${region} ${pick(G_STREET)} ${ri(1, 99)}`;
  const estYear = ri(2003, 2022);
  const isMaker = chance(0.75);
  const manuAddr = isMaker ? (chance(0.7) ? hqAddr : `${region} ${pick(G_STREET)} ${ri(1, 99)}`) : null;

  const basic = [
    f('법인등록번호', `${pad(ri(110000, 139999), 6)}-${pad(ri(1000000, 9999999), 7)}`, 'A', '금융위 기업기본정보', today),
    f('사업자등록번호', `${pad(ri(100, 699), 3)}-${pad(ri(10, 99), 2)}-${pad(ri(10000, 99999), 5)}`, 'A', '금융위 기업기본정보', today),
    f('대표자', pick(G_SURNAME) + pick(G_GIVEN), 'A', '금융위 기업기본정보', today),
    f('설립일', `${estYear}-${pad(ri(1, 12), 2)}-${pad(ri(1, 28), 2)}`, 'A', '금융위 기업기본정보', `${estYear}-01-01`),
    f('본점주소', hqAddr, 'A', '금융위 기업기본정보', today),
    f('제조소 소재지', manuAddr, isMaker ? 'B' : 'D', '식약처 제조업 등록', manuAddr ? today : null, isMaker ? null : '제조업 등록 미확인 — 위탁제조(OEM) 가능성'),
    f('사업자상태', '계속사업자', 'A', '국세청 사업자상태', today),
    f('제조업 등록', isMaker ? `화장품제조업 (등록 제${estYear}-${ri(1000, 9999)}호)` : null, isMaker ? 'A' : 'D', '식약처 제조업 등록', isMaker ? `${estYear}-06-02` : null, isMaker ? null : '조회 결과 없음 — 책임판매업만 등록 추정'),
  ];

  const emp = ri(6, 340);
  const funcCount = ri(0, 76);
  const hasGmp = isMaker && chance(0.6);
  const pensionAddr = chance(0.7) ? hqAddr : `${region} ${pick(G_STREET)} ${ri(1, 99)}`;
  const capacity = [
    f('재직자수 (국민연금 가입자)', `${emp}명`, 'B', '국민연금 사업장 API', '2026-05-31', '4대보험 가입 재직자 — 파견·일용·프리랜서 미포함. 방문 시 실인원 대조'),
    f('사업장 주소 (연금기준)', pensionAddr, 'C', '국민연금 사업장 정보', '2026-05-31'),
    f('방문 이동거리', travelText(estimateTravel(hqAddr)), 'C', `기준: ${REF_POINT.name} (${REF_POINT.addr})`, today, '직선거리 기반 추정 — 실데이터 연결 시 카카오내비 실측'),
    f('기능성 보고품목 수 (5년내)', funcCount || null, funcCount ? 'A' : 'D', '식약처 보고품목 API', today, funcCount ? null : '보고 이력 없음 — 기능성 미취급 또는 공백'),
    f('신고 제형 분포', funcCount ? shuffle(G_FORMS).slice(0, ri(1, 5)).join(', ') : null, 'C', '식약처 보고품목 API', today, 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    f('CGMP 적합업소', hasGmp ? '적합 (식약처 GMP 등재)' : null, hasGmp ? 'A' : 'D', '식약처 GMP API', hasGmp ? today : null, hasGmp ? 'CGMP 적합업소 — ISO/할랄/비건은 공개 API 없어 방문 시 인증서 확인' : 'CGMP 미등재 — 그 외 인증은 공개 API 없음(방문 확인)'),
  ];

  const hasFin = chance(0.7);
  let finance, finance_history = [];
  if (hasFin) {
    const cap = pick([3, 5, 10, 20, 30, 50]);
    const yr = (year, rev) => {
      const op = +(rev * (rand() * 0.15 - 0.02)).toFixed(1);
      const assets = Math.round(rev * (0.6 + rand() * 0.5));
      const debt = Math.round(assets * (0.25 + rand() * 0.4));
      return { year, revenue: rev, operatingProfit: op, assets, debt, capital: cap };
    };
    // 최신연도(2024) 기준 과거 5개년
    const revs = [ri(18, 420)];
    for (let k = 0; k < 4; k++) revs.unshift(Math.max(4, Math.round(revs[0] * (0.68 + rand() * 0.26))));
    finance_history = [2020, 2021, 2022, 2023, 2024].map((y, i) => yr(y, revs[i]));
    const L = finance_history[finance_history.length - 1];
    finance = [
      f('매출액', `${L.revenue}억 원`, 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
      f('영업이익', `${L.operatingProfit}억 원`, 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
      f('총자산', `${L.assets}억 원`, 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
      f('총부채', `${L.debt}억 원`, 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
      f('자본금', `${L.capital}억 원`, 'A', '금융위 재무정보 API (2024년)', '2024-12-31'),
    ];
  } else {
    finance = [
      f('매출액', null, 'D', '금융위 재무정보 API', null, '데이터 미제출 법인 — 외감 비대상 (등기부/자체제출 폴백)'),
      f('영업이익', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
      f('총자산', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
      f('총부채', null, 'D', '금융위 재무정보 API', null, '데이터 미제출'),
      f('자본금', `${pick([1, 3, 5])}억 원`, 'B', '등기부 (수동 확인)', '2024-12-31'),
    ];
  }

  const all = [...basic, ...capacity, ...finance];
  const order = { A: 0, B: 1, C: 2, D: 3 };
  const gs = all.filter((x) => !x.data_gap).map((x) => order[x.grade]).sort((a, b) => a - b);
  const overall = gs.length ? ['A', 'B', 'C', 'D'][gs[Math.floor(gs.length / 2)]] : 'D';

  const risk_flags = [];
  const norm = (v) => (v || '').replace(/\s/g, '').slice(0, 10);
  const addrs = [['본점주소', hqAddr], ['제조소 소재지', manuAddr], ['사업장 주소 (연금기준)', pensionAddr]].filter(([, v]) => v);
  if (new Set(addrs.map(([, v]) => norm(v))).size > 1) {
    risk_flags.push({ type: 'address_conflict', detail: addrs.map(([k, v]) => `${k}: ${v}`).join(' | ') });
  }
  if (!hasFin) risk_flags.push({ type: 'data_gap', source: 'fsc', detail: '재무 데이터 없음 (외감 비대상 추정)' });
  if (!isMaker) risk_flags.push({ type: 'data_gap', source: 'mfds', detail: '제조업 등록 미확인 — 자사 제조 여부 실사 필수' });

  const crosscheck = all
    .filter((x) => x.data_gap || x.grade === 'C' || x.fresh === false)
    .map((x) => ({ key: x.key, expected: x.value, verified: null, match: null, src_type: x.source }));
  if (risk_flags.some((x) => x.type === 'address_conflict')) {
    crosscheck.unshift({ key: '실제 공장 소재지', expected: '3개 출처 상충 — 플래그 참조', verified: null, match: null, src_type: '3중대조' });
  }

  return {
    meta: {
      vendor_name: name,
      vendor_id: name.replace(/[^\w가-힣]/g, '_'),
      query_at: new Date().toISOString(),
      version: 1,
      overall_grade: overall,
      sources_used: [...new Set(all.filter((x) => !x.data_gap).map((x) => x.source))],
      max_age_years: 5,
      generated: true,
    },
    basic, capacity, finance, finance_history, finance_health: assessFinance(finance_history),
    crosscheck, risk_flags,
    diff_from_prev: [],
    news: [
      { title: `${name}, ${pick(['신규 라인 가동', 'CGMP 인증 획득', '해외 수출 확대', '신규 거래처 확보', '품질관리 강화'])} 소식`, link: '#', pubDate: `2026-${pad(ri(1,6),2)}-${pad(ri(1,28),2)}`, description: `화장품 제조업체 ${name}이(가) 최근 ${pick(['생산 역량 강화', '수출 시장 개척', '품질 인증 확대', 'OEM 수주 확대'])}에 나서고 있다.` },
      { title: `K-뷰티 OEM 업계, ${pick(['동남아', '북미', '유럽', '일본'])} 시장 공략 가속화`, link: '#', pubDate: `2025-${pad(ri(7,12),2)}-${pad(ri(1,28),2)}`, description: '국내 화장품 OEM 업체들이 해외 시장 다변화에 적극 나서면서 수출 실적이 증가세를 보이고 있다.' },
    ],
  };
}

// ── 실데이터 모드: 식약처(data.go.kr) 기능성화장품 보고품목 응답 → 리포트 매핑 ──
// 프록시(Cloudflare Worker)가 반환한 식약처 JSON을 4블록 스키마로 변환.
function isFresh5(dateStr) {
  if (!dateStr) return false;
  const s = String(dateStr).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const d = new Date(s);
  if (isNaN(d)) return false;
  const c = new Date(); c.setFullYear(c.getFullYear() - 5);
  return d >= c;
}
function mapMfdsReport(name, data) {
  const raw = (data && data.body && data.body.items)
    || (data && data.response && data.response.body && data.response.body.items && data.response.body.items.item)
    || [];
  const list = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  const fresh = list.filter((i) => isFresh5(i.REPORT_DAY || i.report_day || i.PRDLST_REPORT_DE));
  const forms = [...new Set(fresh.map((i) => i.DOSAGE_FORM || i.dosage_form || i.PRDLST_TYPE).filter(Boolean))];
  const days = list.map((i) => String(i.REPORT_DAY || i.report_day || i.PRDLST_REPORT_DE || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')).filter(Boolean).sort();
  const lastDay = days.length ? days[days.length - 1] : null;
  const today = '2026-07-07';
  const exists = list.length > 0;

  const basic = [
    f('업체명', name, 'A', '식약처 보고품목 API', today),
    f('식약처 화장품 보고 이력', exists ? `보고품목 ${list.length}건 (기능성화장품 신고 이력 존재)` : null, exists ? 'A' : 'D', '식약처 보고품목 API', today, exists ? '기능성화장품 책임판매/제조 신고 이력' : '식약처 기능성 보고 이력 없음 — 업체명 표기 상이 또는 미취급'),
    f('최근 보고일', lastDay, exists ? 'A' : 'D', '식약처 보고품목 API', lastDay),
    f('법인등록번호', null, 'D', '금융위 기업기본정보', null, '식약처 API 범위 밖 — 금융위 기업기본정보 연동 필요'),
    f('대표자', null, 'D', '금융위 기업기본정보', null, '식약처 API 범위 밖 — 금융위 연동 필요'),
    f('본점주소', null, 'D', '금융위 기업기본정보', null, '식약처 API 범위 밖 — 금융위 연동 필요'),
  ];
  const capacity = [
    f('기능성 보고품목 수 (5년내)', fresh.length || null, fresh.length ? 'A' : 'D', '식약처 보고품목 API', today, fresh.length ? null : '최근 5년 보고 이력 없음'),
    f('기능성 보고품목 수 (전체)', list.length || null, exists ? 'A' : 'D', '식약처 보고품목 API', today),
    f('신고 제형 분포', forms.length ? forms.join(', ') : null, 'C', '식약처 보고품목 API', today, 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    fc('품질인증', certList([false, false, false, false, false]), 'A', '식약처 GMP·인증기관', null, 'GMP/ISO/할랄/비건 인증 API 연동 필요'),
  ];
  const finance = ['매출액', '영업이익', '총자산', '총부채', '자본금'].map((k) =>
    f(k, null, 'D', '금융위 재무정보 API', null, '식약처 API 범위 밖 — 금융위 재무 API 연동 필요'));

  const all = [...basic, ...capacity, ...finance];
  const order = { A: 0, B: 1, C: 2, D: 3 };
  const gs = all.filter((x) => !x.data_gap).map((x) => order[x.grade]).sort((a, b) => a - b);
  const overall = gs.length ? ['A', 'B', 'C', 'D'][gs[Math.floor(gs.length / 2)]] : 'D';
  const risk_flags = [];
  if (!exists) risk_flags.push({ type: 'data_gap', source: 'mfds', detail: '식약처 기능성 보고 이력 없음 — 업체명 정확도/취급 여부 확인 필요' });
  const crosscheck = all
    .filter((x) => x.data_gap || x.grade === 'C')
    .map((x) => ({ key: x.key, expected: x.value, verified: null, match: null, src_type: x.source }));

  return {
    meta: {
      vendor_name: name,
      vendor_id: name.replace(/[^\w가-힣]/g, '_'),
      query_at: new Date().toISOString(),
      version: 1,
      overall_grade: overall,
      sources_used: ['식약처 보고품목 API'],
      max_age_years: 5,
      live: true, // 식약처 실데이터
    },
    basic, capacity, finance, finance_history: [], crosscheck, risk_flags, diff_from_prev: [],
  };
}

// ── 실시간 흐름: 금융위 기업기본정보 → 동명업체 후보 목록 ──
function fmtDate(s) { return s ? String(s).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : null; }
function won2eok(v) { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) && n !== 0 ? Math.round(n / 1e8) : (n === 0 ? 0 : null); }
function mapCorpCandidates(data) {
  const raw = (data && data.response && data.response.body && data.response.body.items && data.response.body.items.item)
    || (data && data.body && data.body.items) || [];
  const list = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  const mapped = list.map((c) => ({
    corpNm: c.corpNm || c.enpNm || c.corp_nm || '',
    crno: c.crno || null,
    bzno: c.bzno || null,
    rep: c.enpRprFnm || null,
    addr: c.enpBsadr || null,
    estbDt: c.enpEstbDt || null,
    raw: c,
  })).filter((c) => c.corpNm || c.crno);
  // 중복 제거 — 같은 법인(crno) 또는 같은 사업자(bzno)는 1건만.
  // 둘 다 없으면 상호+대표+주소 조합으로 판별. (동일 업체가 대표/표기 차이로 수십 건 중복되는 현상 방지)
  const seen = new Set();
  return mapped.filter((c) => {
    const sig = c.crno ? `c:${c.crno}` : c.bzno ? `b:${c.bzno}` : `k:${c.corpNm}|${c.rep || ''}|${c.addr || ''}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// 중첩 응답에서 배열 추출 (여러 경로 시도)
function listOf(data, paths) {
  for (const p of paths) {
    let cur = data, ok = true;
    for (const seg of p.split('.')) { if (cur && typeof cur === 'object' && seg in cur) cur = cur[seg]; else { ok = false; break; } }
    if (ok && cur != null) return Array.isArray(cur) ? cur : [cur].filter(Boolean);
  }
  return [];
}

// ── 지자체 공장정보 페이지 발췌 ──
// 웹 언급으로 걸린 지자체 공장정보(bizok.incheon.go.kr 등)에는 대표자·연락처·종업원수가
// 그대로 실려 있는데, 여태 제목·링크만 쓰고 본문은 버렸다. 이 셋은 공짜로 얻는 대조 자료다.
//   대표자 — 금융위 등기 대표자와 다르면 명의변경·각자대표·자료 노후 중 하나. 실체 확인의 단서.
//   연락처 — 방문 약속을 잡을 유일한 공개 번호.
//   종업원 — 연금·공장등록과 함께 3중 대조.
function publicBizFacts(oemTrace) {
  const out = { rep: null, tel: null, fctryTel: null, empl: null, link: null };
  (oemTrace || []).forEach((o) => {
    const t = `${o.title || ''} ${o.desc || ''}`.replace(/\s+/g, ' ');
    if (!/대표자|연락처|공장전화/.test(t)) return;
    const pick = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
    out.rep = out.rep || pick(/대표자\s*[:：]\s*([가-힣]{2,5})(?![가-힣])/);
    out.tel = out.tel || pick(/연락처\s*[:：]\s*(0\d{1,2}-\d{3,4}-\d{4})/);
    out.fctryTel = out.fctryTel || pick(/공장전화번호\s*[:：]\s*(0\d{1,2}-\d{3,4}-\d{4})/);
    const e = pick(/종업원\s*수?\s*[:：]\s*([\d,]{1,6})\s*명/);
    if (e && out.empl == null) out.empl = Number(e.replace(/,/g, ''));
    if ((out.rep || out.tel || out.empl != null) && !out.link) out.link = o.link || null;
  });
  return out;
}

// ── 공장 면적 ──
// 산단공 공장등록 레코드에는 면적 항목이 들어 있는데 여태 읽지도 않고 버렸다. 건평을 알면
// 방문 전에 물류 동선을 가늠할 수 있다 — 5톤차가 들어갈 자리가 있는지, 자재를 쌓아 둘 데가
// 있는지는 소규모 업체일수록 실제 발주 가능량을 좌우한다.
// 필드명이 API마다 달라 주소와 같은 방식으로 값 스캔한다(명시 후보 없이 키 이름으로 분류).
const PYEONG = 3.305785;                       // 1평 = 3.3058㎡
function factoryAreas(rec) {
  if (!rec || typeof rec !== 'object') return [];
  const found = new Map();
  Object.entries(rec).forEach(([k, v]) => {
    if (!/(^|[_a-z])(ar|area)$|area|면적|_ar_|plottage|extent/i.test(k)) return;
    // 값에 단위가 붙어 오면(1,234.5㎡ / 1234 m2 / 373평) Number()가 NaN이 된다.
    // 숫자만 남기고 읽되, '평'으로 온 값은 ㎡로 되돌린다.
    const raw = String(v == null ? '' : v).trim();
    const isPy = /평\s*$/.test(raw);
    const n0 = Number(raw.replace(/,/g, '').replace(/(㎡|m2|m²|제곱미터|평)\s*$/i, '').trim());
    const n = isFinite(n0) && isPy ? n0 * PYEONG : n0;
    if (!isFinite(n) || n <= 0 || n > 5e6) return;        // ㎡ 기준 상식 범위 밖은 버린다
    let label = '기타 면적';
    if (/(build|bild|bldg|bldng|建|건축|건물)/i.test(k)) label = '건축면적';
    else if (/(manu|mnfct|manfact|제조|생산)/i.test(k)) label = '제조시설면적';
    else if (/(adit|addi|부대)/i.test(k)) label = '부대시설면적';
    else if (/(land|lot|blot|use|site|용지|부지|대지)/i.test(k)) label = '부지면적';
    else if (/(tot|전체|합계|연면적)/i.test(k)) label = '연면적';
    const prev = found.get(label);
    if (!prev || n > prev.m2) found.set(label, { label, key: k, m2: n, py: Math.round(n / PYEONG) });
  });
  return [...found.values()];
}
// 건평으로 볼 값 — 건축면적이 가장 가깝고, 없으면 제조시설·연면적 순으로 대신한다
function factoryFloorArea(areas) {
  for (const want of ['건축면적', '제조시설면적', '연면적']) {
    const hit = areas.find((a) => a.label === want);
    if (hit) return hit;
  }
  return null;
}
// 규모에 따라 방문 시 확인할 물류 사항이 달라진다. 숫자만 주면 판단이 안 되므로 함께 적는다.
function floorAreaNote(py) {
  if (py == null) return null;
  if (py < 100) {
    return `약 ${py}평 — 소규모입니다. 자재·완제품을 둘 공간이 빠듯해 외부 창고를 쓰거나 `
      + `재고 회전이 촉박할 수 있습니다. 한 번에 받을 수 있는 입고 물량, 완제품 보관 가능량, `
      + `상하차 방식(도크 유무·지게차·수작업)을 반드시 확인하세요. 대형 화물차 진입·회차가 `
      + `어려우면 소형차 분할 배송으로 물류비가 올라갑니다.`;
  }
  if (py < 300) {
    return `약 ${py}평 — 중소 규모입니다. 5톤 이상 화물차 진입·회차 공간과 상하차 도크 유무, `
      + `자재 보관 구역이 생산 구역과 분리돼 있는지 확인하세요.`;
  }
  return `약 ${py}평 — 상하차 도크와 자재·완제품 보관 구역을 방문 시 함께 확인하세요.`;
}

// ── 공장 건축면적 칸 ──
// 산단공 공장등록은 우리가 받을 수 있는 응답에 면적이 없어, 국토부 건축물대장에서 가져온다.
// 화면에서 주소를 고쳐 다시 찾을 때(app.js)도 이 함수로 칸을 다시 만든다.
const SITE_STATE = { pick: '선정', alt: '같은 지역', partial: '시·군까지만', out: '공장 지역 밖 — 제외' };
function siteField(site, bld, today) {
  const S = site && site.ok ? site.data : null;
  if (!S) return f('실제 공장 소재지 (선정)', null, 'D', '주소 대조', null, '공장 소재지로 쓸 주소를 어느 기록에서도 찾지 못했습니다');
  const pick = S.cands.find((c) => c.state === 'pick') || {};
  const grade = !pick.full ? 'C' : (S.src === 'factory' || S.src === 'maker') ? 'A' : 'B';
  const B = bld && bld.ok ? bld.data : null;
  const link = B && B.arch
    ? ` 건축물대장 연결: 법정동·지번 ${B.jibun}${B.matchedBy === 'road' ? ` (도로명 대표지번 ${B.keyJibun}엔 대장이 없어 같은 본번에서 새주소가 맞는 필지로 연결)`
      : B.matchedBy === 'name' ? ` (대표지번 ${B.keyJibun}엔 대장이 없어 같은 본번에서 건물명이 상호와 같은 필지로 연결)` : ''}.`
    : '';
  return f('실제 공장 소재지 (선정)', S.addr, grade, S.label, today,
    `★ ${S.why || '번지까지 확인된 주소'} — 방문 이동거리와 공장 면적을 이 주소 기준으로 조회했습니다.${link}`
      + ` 후보: ${S.cands.map((c) => `${c.label} ${c.addr} [${SITE_STATE[c.state] || c.state}]`).join(' / ')}`);
}
// 오피스형 건물(지식산업센터 등) 입주 여부 — 주소에 호수가 적혀 있거나 대장 용도가 지식산업센터면
// 건축물대장 면적은 건물 전체라 업체 크기로 읽으면 안 된다. 주소 글들에서 호수·층·건물명을 뽑는다.
function unitTenantOf(texts, B) {
  const t = (texts || []).filter(Boolean).map(String).join(' | ');
  const units = [];
  for (const m of t.matchAll(/((?:\d{2,5}\s*호?\s*[,·~]\s*)*\d{2,5})\s*호/g)) {
    m[1].split(/[^\d]+/).filter((u) => u.length >= 2).forEach((u) => { if (!units.includes(u)) units.push(u); });
  }
  const bl = (B && B.bldgs) || [];
  const kic = /지식산업센터|아파트형\s*공장/.test(t) || bl.some((b) => /지식산업센터|아파트형/.test(`${b.purpose || ''} ${b.etc || ''}`));
  if (!units.length && !kic && !(B && B.collective)) return null;
  const floor = (t.match(/(?:^|[^하])\s(\d{1,2})\s*층/) || [])[1] || null;
  const bname = ((bl[0] && String(bl[0].name || '').trim()) || (t.match(/\([^)]*?(?:동|가|리)\s*,\s*([^)]+)\)/) || [])[1] || '').trim();
  const floors = bl.length ? Math.max(0, ...bl.map((b) => b.floors || 0)) || null : null;
  return { units: units.slice(0, 8), floor, bname, kic, floors };
}
function areaFieldFromBld(bld, fctFloor, fctRegDe, today) {
  const B = bld && bld.ok ? bld.data : null;
  if (B && B.arch && B.unit) {
    // 입주 사업장 — 건물 전체 면적을 업체 크기로 내세우지 않는다. 호실 전유면적을 찾았으면 그것을 값으로
    const py = (m2) => Math.round(m2 / PYEONG);
    const U = B.unit, A = U.area;
    const where = `${U.bname ? `「${U.bname}」 ` : ''}${U.kic ? '(지식산업센터) ' : ''}${U.units.length ? `${U.units.join('·')}호` : '일부 호실'}`;
    const whole = `건물 전체는 건축면적 약 ${py(B.arch).toLocaleString()}평 · 연면적 약 ${py(B.tot || 0).toLocaleString()}평${U.floors ? ` · 지상 ${U.floors}층` : ''}`;
    if (A && A.excl) {
      return f('공장 건축면적 (건평)', `호실 전용 약 ${py(A.excl).toLocaleString()}평 (${Math.round(A.excl).toLocaleString()}㎡)${A.common ? ` · 공용 포함 약 ${py(A.excl + A.common).toLocaleString()}평` : ''}`,
        A.missing && A.missing.length ? 'B' : 'A', '국토부 건축물대장 (전유부)', today,
        `⚠ ${where} 입주 사업장입니다 — 건물 전체가 아니라 주소에 적힌 호실의 전유부 면적을 더했습니다`
          + ` (${A.rows.map((r) => `${r.ho} ${Math.round(r.excl)}㎡`).join(', ')}${A.missing && A.missing.length ? ` · 대장에서 못 찾은 호실 ${A.missing.join('·')}호` : ''}).`
          + ` 참고로 ${whole}입니다 — 크기를 건물 전체로 오해하지 마세요. 실제로 쓰는 공간(창고 임차·추가 호실)은 방문 때 확인하세요.`);
    }
    return f('공장 건축면적 (건평)', `확인 필요 — 입주 호실 면적 미확인 (건물 전체 약 ${py(B.arch).toLocaleString()}평)`, 'C', '국토부 건축물대장', today,
      `⚠ ${where} 입주 사업장으로 보입니다 — 건축물대장 면적은 건물 전체 값이라 업체가 쓰는 면적이 아닙니다. ${whole}.`
        + ` 호실 전용면적은 건축물대장 전유부(호별)나 임대차계약서로 확인하세요${A && A.err ? ` (전유부 자동 조회 실패: ${A.err})` : ''}.`);
  }
  if (B && B.arch) {
    const py = (m2) => Math.round(m2 / PYEONG);
    const facNote = B.factoryCount
      ? `건물 ${B.bldgCount}동 중 공장 용도 ${B.factoryCount}동(공장 건축면적 약 ${py(B.factoryArch).toLocaleString()}평)`
      : `건물 ${B.bldgCount}동 · 용도 ${B.purposes.join('·') || '미상'} — 대장상 '공장' 용도가 아닙니다. 창고·근린생활시설 등을 공장으로 쓰는지 방문 시 확인하세요`;
    return f('공장 건축면적 (건평)',
      `건축면적 약 ${py(B.arch).toLocaleString()}평 (${Math.round(B.arch).toLocaleString()}㎡)`
        + (B.tot ? ` · 연면적 약 ${py(B.tot).toLocaleString()}평` : ''),
      'A', '국토부 건축물대장', today,
      `★ ${B.jibun} 지번의 건축물대장(${B.src}) 값입니다${B.queried ? ` (조회 주소: ${B.queried})` : ''}`
        + `${B.matchedBy && B.matchedBy !== 'lot' ? ` — 대표지번 ${B.keyJibun}엔 대장이 없어 같은 본번에서 ${B.matchedBy === 'road' ? '새주소(도로명)가' : '건물명이'} 맞는 건물로 연결했습니다` : ''}. ${facNote}.`
        + (B.plat ? ` 대지면적 약 ${py(B.plat).toLocaleString()}평.` : '')
        + (B.firstApr ? ` 사용승인 ${B.firstApr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}.` : '')
        + (B.collective ? ' ⚠ 지식산업센터 등 집합건물입니다 — 이 면적은 건물 전체이고 업체가 쓰는 호실 면적은 훨씬 작습니다. 전용면적을 따로 물어보세요.' : '')
        + ` ${floorAreaNote(py(B.arch))}`
        + (B.parts && B.parts.length > 1 ? ` ${B.parts.length}개 필지 합산값입니다.` : ' 같은 공장이 여러 필지에 걸쳐 있으면 이 지번 몫만 잡힙니다 — 「공장 면적」 탭에서 필지를 추가해 합산하세요.')
        + (B.edited ? ' (「공장 면적」 탭에서 고친 주소 기준)' : ''));
  }
  if (fctFloor) {
    return f('공장 건축면적 (건평)', `약 ${fctFloor.py.toLocaleString()}평 (${fctFloor.m2.toLocaleString()}㎡)`, 'A', '산업단지공단 공장등록', fctRegDe || today,
      `★ 공장등록 신고값의 ${fctFloor.label}입니다. ${floorAreaNote(fctFloor.py)}`);
  }
  // 못 찾았을 때 '없다'로만 끝내면 API가 안 주는 건지 우리가 못 읽는 건지 모른다 — 사유를 적는다
  const why2 = bld && !bld.ok ? bld.err : '공장 주소가 없어 건축물대장을 조회하지 못했습니다';
  return f('공장 건축면적 (건평)', null, 'D', '국토부 건축물대장', null,
    `${why2}${bld && bld.queried ? ` (조회 주소: ${bld.queried})` : ''}`
      + (/활용신청|NOT_REGISTERED/i.test(String(why2)) ? ' — data.go.kr에서 「국토교통부_건축HUB_건축물대장정보 서비스」를 활용신청해 주세요(기존 인증키 그대로 사용).' : '')
      + ' 「공장 면적」 탭의 주소 수정으로 실제 공장 지번을 넣어 다시 조회할 수 있습니다.');
}

// ── 보고품목 심화 분석 ──
// 여태 기능성 보고품목에서 읽은 건 보고일과 제형 둘뿐이었다. 같은 응답 안에 제품명과
// 기능성 종류가 함께 들어 있고, 거기서 '이 회사가 실제로 무엇을 만들어 왔는가'가 나온다.
// 업체가 말로 하는 실적과 공식 신고를 맞대 볼 수 있는 거의 유일한 공개 자료다.

// 제품명에 붙는 일반어 — 이걸 브랜드로 착각하면 아무 의미 없는 목록이 된다
const PRD_COMMON = new Set([
  '크림', '로션', '스킨', '토너', '에센스', '세럼', '앰플', '마스크', '마스크팩', '팩', '젤', '밤',
  '미스트', '쿠션', '파운데이션', '비비', '씨씨', '선', '선크림', '선블록', '클렌징', '폼', '오일',
  '아이크림', '핸드크림', '바디로션', '샴푸', '트리트먼트', '컨디셔너', '에멀젼', '수분크림',
  '미백', '주름', '개선', '기능성', '화장품', '수분', '보습', '영양', '탄력', '재생', '진정',
  '화이트닝', '안티', '에이징', '리페어', '인텐시브', '프리미엄', '스페셜', '데일리', '모이스처',
  '콜라겐', '히알루론산', '펩타이드', '나이아신아마이드', '레티놀', '비타민', '세라마이드',
  '주식회사', '유한회사', '수출용', '국내용', '리뉴얼', '호', '형', '타입', 'spf', 'pa',
]);
// 숫자로 시작하거나 용량·규격인 토큰은 브랜드가 아니다(100ml, 50g, 3매, 2호 …)
const PRD_NOISE_RE = /^[0-9a-z]{1,2}$|^\d|^(no|ver|type)\d*$|^\d+(ml|g|kg|mg|매|호|개|ea|p)$/i;

// 제품명 앞머리에서 브랜드 후보를 뽑는다. 국내 기능성 보고명은 대개
// "<브랜드> <제품 설명>" 꼴이다 (예: "○○○ 슈퍼바이탈 크림").
// 한 번만 나온 표기는 버린다 — 반복해서 나오는 것만이 '거래 관계'의 근거가 된다.
function brandGuess(names, ownName) {
  const own = stripCorp(String(ownName || '')).replace(/\s/g, '');
  const cnt = new Map();
  (names || []).forEach((raw) => {
    const s = String(raw || '')
      .replace(/[\[\(【（][^\]\)】）]*[\]\)】）]/g, ' ')   // [수출용] (2호) 같은 부가표기 제거
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return;
    const tok = s.split(' ').filter(Boolean);
    // 앞 두 토큰까지만 본다 — 브랜드는 거의 항상 맨 앞에 온다
    for (const t of tok.slice(0, 2)) {
      const low = t.toLowerCase();
      if (t.length < 2 || PRD_COMMON.has(low) || PRD_NOISE_RE.test(low)) continue;
      if (own && (own.includes(t) || t.includes(own))) continue;   // 제조사 자기 이름은 브랜드가 아니다
      cnt.set(t, (cnt.get(t) || 0) + 1);
      break;                                    // 한 제품에서 후보 하나만
    }
  });
  return [...cnt.entries()]
    .filter(([, n]) => n >= 2)                  // 반복 등장만 채택
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([nm, n]) => ({ name: nm, count: n }));
}

// 연도별 보고 건수 → 활동성 추이. 재무제표보다 먼저 움직이는 지표다.
function rptByYear(dates, thisYear) {
  const by = new Map();
  (dates || []).forEach((d) => {
    const y = (String(d || '').match(/(19|20)\d{2}/) || [])[0];
    if (y) by.set(y, (by.get(y) || 0) + 1);
  });
  const years = [];
  for (let y = thisYear - 5; y <= thisYear; y++) years.push({ year: y, n: by.get(String(y)) || 0 });
  // 최근 2년 합과 그 앞 2년 합을 견준다 — 한 해 출렁임에 휘둘리지 않게
  const late = years.slice(-2).reduce((s, x) => s + x.n, 0);
  const early = years.slice(-4, -2).reduce((s, x) => s + x.n, 0);
  // '끊겼다'는 판단은 바로 앞 2년이 아니라 기간 전체를 봐야 한다. 앞 2년으로만 재면
  // 4년 전에 멈춘 업체는 그 구간도 0이라 '변동 없음'으로 나와 버린다.
  const total = years.reduce((s, x) => s + x.n, 0);
  let trend = 'flat';
  if (late === 0 && total > 0) trend = 'stopped';
  else if (early > 0 && late < early * 0.5) trend = 'down';
  else if (late > early * 1.5 && late >= 3) trend = 'up';
  return { years, trend, late, early };
}

// 기능성 종류 — 자외선차단은 SPF 실측 시험이 붙어 난이도가 한 단 위다
const FUNC_KINDS = ['미백', '주름개선', '자외선차단', '탈모', '여드름', '아토피', '튼살', '염모', '제모'];
function rptFunctions(recs) {
  const hit = new Set();
  (recs || []).forEach((r) => {
    const blob = Object.values(r || {}).map((v) => String(v == null ? '' : v)).join(' ');
    FUNC_KINDS.forEach((k) => { if (blob.includes(k)) hit.add(k); });
    if (/자외선\s*차단|SPF/i.test(blob)) hit.add('자외선차단');
  });
  return FUNC_KINDS.filter((k) => hit.has(k));   // 표시 순서를 고정한다
}

// 선택된 업체 기준정보 + 재무/식약처/국민연금 응답 → 전체 리포트 조립 (실데이터 + 진단)
// res = { finance:{ok,data|err}, rpt:{ok,...}, nps:{ok,...} }
// 실시간 조회가 늦거나 실패해 저장본(최대 7일)을 썼으면 언제 것인지 밝힌다(app.js liveFirstList)
const savedNote = (d) => {
  if (!d || !d.__savedAt) return '';
  const t = new Date(d.__savedAt);
  return ` · 실시간 조회가 늦거나 실패해 ${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} 저장본 사용`;
};
function assembleLiveReport(name, corp, res) {
  _matchBz = corp && corp.bzno ? String(corp.bzno).replace(/\D/g, '') : null;
  const today = '2026-07-07';
  const R = res || {};
  // 장황한 상류 오류를 짧은 사유로 정규화 — "조회불가"/"자료 미제출" 등 간략 표기(사용자 요청)
  const briefErr = (msg) => {
    const m = String(msg || '');
    if (/불러오는 중/.test(m)) return '불러오는 중…';   // 먼저 그린 리포트 — 도착하면 자동으로 채운다
    if (/미제출|없음|0건|미검색|미등록|미수록/.test(m) && !/HTTP|50\d|타임아웃|서버|실패|오류/.test(m)) return '자료 미제출/미등록';
    if (/50\d|서버 오류|API 서버|점검|과부하|일시적/.test(m)) return '조회불가 (제공기관 서버 오류)';
    if (/타임아웃|지연|deadline|abort/i.test(m)) return '조회불가 (응답 지연)';
    if (/사업자번호 없음|법인등록번호 없음/.test(m)) return '자료 미제출/미등록';
    if (/프록시|키|승인|미설정/.test(m)) return '조회불가 (연결 설정 확인)';
    return '조회불가';
  };
  // 왜 비었는지 진단 문구: 미호출 / 조회실패(에러) / 빈결과 — 모두 짧은 사유로
  const why = (part, emptyMsg) => {
    const r = R[part];
    if (!r) return '자료 미제출/미등록';
    if (!r.ok) return briefErr(r.err);
    return emptyMsg;
  };

  // 식약처 제조업 등록 (maker) — 상호가 실제로 일치하는 건만 채택.
  // ★ mkList[0] 폴백 금지: maker API가 상호 필터링을 안 해 첫 레코드가 '남의 회사'일 수 있음(할루시네이션 방지)
  const mkList = R.maker && R.maker.ok ? listOf(R.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const mk = matchMine(name, mkList);
  const mkReg = R.maker && R.maker.ok && R.maker.data ? R.maker.data.register : null;   // 명단 전체 재검색 여부
  // 의약품안전나라 업체정보 — 번지까지 있는 제조소 주소(곳별)·업허가번호. 공개 API는 시·군까지만 준다.
  const ned = R.nedrug && R.nedrug.ok && R.nedrug.data && R.nedrug.data.found ? R.nedrug.data : null;
  const nedSites = ned ? ned.sites : [];
  const mkNo = (ned && ned.permitNo) || (mk ? (mk.LCNS_NO ?? mk.lcnsNo ?? mk.MAKER_REG_NO ?? mk.PRMISN_NO ?? mk.prmisnNo ?? null) : null);
  // 허가일자 — 설립일과 크게 벌어져 있으면 업종을 바꿔 들어온 것이다. 반드시 물어야 할 사항.
  // 공개 API의 허가일 항목은 ENTP_PERMIT_DATE — 예전 정규식이 PERMIT을 몰라 허가일이 늘 비었다
  const mkDateRaw = (mk ? pickByKey(mk, /PRMISN.*(DE|DT|DAY)|PERMIT.*(DATE|DT|DE)|허가일|등록일|LCNS.*(DE|DT)|PRMS.*DE/i) : null) || (ned && ned.permitDate) || null;
  const mkDate = mkDateRaw && /(19|20)\d{6}|(19|20)\d{2}[-.\/]/.test(String(mkDateRaw)) ? fmtDate(String(mkDateRaw).replace(/\D/g, '')) : null;

  // 국세청 사업자상태 (odcloud: {data:[{b_stt, tax_type, ...}]})
  const ntsItem = R.nts && R.nts.ok && R.nts.data && Array.isArray(R.nts.data.data) ? R.nts.data.data[0] : null;
  const bStt = ntsItem ? (ntsItem.b_stt || null) : null;            // 계속사업자 / 휴업자 / 폐업자
  const bSttCd = ntsItem ? (ntsItem.b_stt_cd || null) : null;       // 01 계속 / 02 휴업 / 03 폐업
  const bTax = ntsItem ? (ntsItem.tax_type || null) : null;
  // 국세청이 상태를 확인해준 사업자번호 = 실제 활성 번호(대표값으로 우선)
  const ntsBno = (ntsItem && bStt && ntsItem.b_no) ? String(ntsItem.b_no).replace(/\D/g, '') : null;

  // 산단공 공장등록(생산)정보 — 회사명 검색 결과에서 상호 일치 건
  // factoryWithDetail 이 { prod, detail, manageNo } 로 준다(옛 모양도 받아넘긴다)
  const fctRaw = R.factory && R.factory.ok ? R.factory.data : null;
  const fctProd = fctRaw && fctRaw.prod ? fctRaw.prod : fctRaw;
  const fctList = fctProd ? listOf(fctProd, ['response.body.items.item', 'body.items', 'items']) : [];
  // ★ fctList[0] 폴백 금지: 산단공 공장 API도 상호 필터링이 불완전 → 첫 레코드가 '남의 공장'일 수 있음.
  //   단건이면 그대로(회사명 검색이 1건만 준 경우), 여러 건이면 상호 일치 건만 채택.
  // 공장등록 — 예전엔 결과가 한 건이면 상호가 달라도 썼다(화인글로벌 → 화인글로벌랩 공장 96명). 같은 회사만
  const fctHit = matchMine(name, fctList);
  // 주소 필드명이 API마다 달라 명시 후보 → 실패 시 값 스캔(한글 주소 패턴)
  const looksAddr = (v) => /[가-힣]{2,}(시|군|구|읍|면)\s|[가-힣]+(로|길)\s?\d/.test(String(v || ''));
  const fctAddr = fctHit ? (
    fctHit.rnAdres ?? fctHit.lnmAdres ?? fctHit.lotNoAddr ?? fctHit.roadNmAddr ?? fctHit.adres ?? fctHit.ADRES ?? fctHit.fctryAddr ?? fctHit.lctnAddr ?? fctHit.addr ??
    Object.values(fctHit).find(looksAddr) ?? null) : null;
  const fctProduct = fctHit ? (fctHit.mainProductCn ?? fctHit.prdlstNm ?? fctHit.prductNm ?? fctHit.MAIN_PRDLST ?? null) : null;
  const fctInduty = fctHit ? (fctHit.indutyNm ?? null) : null;
  const fctEmpl = fctHit ? (fctHit.allEmplyCo ?? fctHit.emplyCo ?? null) : null; // 공장등록 종업원수
  // 실제 응답에 rprsntvNm·cmpnyTelno·cmpnyFxnum·irsttNm 이 들어 있는데 여태 읽지 않았다.
  // 대표자와 전화번호를 웹페이지에서 긁어 오고 있었는데, 같은 값이 공공 API에 A등급으로 있었다.
  const fctRep = fctHit ? (fctHit.rprsntvNm ?? null) : null;
  const fctTel = fctHit ? (fctHit.cmpnyTelno ?? null) : null;
  const fctFax = fctHit ? (fctHit.cmpnyFxnum ?? null) : null;
  const fctOrg = fctHit ? (fctHit.irsttNm ?? fctHit.cvplChrgOrgnztNm ?? null) : null;
  // 홈페이지는 여러 공장 레코드 중 등재된 것을 채택(첫 매칭에 없을 수 있음)
  // 같은 회사 레코드에서만(다른 회사 공장의 홈페이지를 붙이지 않게)
  const fctHmpadr = (fctList.filter((it) => it === fctHit || matchMine(name, [it])).find((it) => /^https?:\/\//i.test(String(it.hmpadr || ''))) || {}).hmpadr || null;
  const fctRegDe = fctHit ? fmtDate(fctHit.frstFctryRegistDe) : null;
  // 생산정보에 면적이 없으므로 용지·시설·기본 오퍼레이션 응답에서 같은 업체 레코드를 찾아 합친다
  const fctDetail = (fctRaw && Array.isArray(fctRaw.detail) ? fctRaw.detail : []) || [];
  let fctDetailUsed = null;
  const fctMerged = { ...(fctHit || {}) };
  fctDetail.forEach((g) => {
    const hit = matchByName(name, g.items) || (g.items.length === 1 ? g.items[0] : null);
    if (!hit) return;
    if (factoryAreas(hit).length && !fctDetailUsed) fctDetailUsed = g.op;
    Object.entries(hit).forEach(([k, v]) => { if (fctMerged[k] == null || fctMerged[k] === '') fctMerged[k] = v; });
  });
  const fctAreas = factoryAreas(fctHit ? fctMerged : null);
  const fctFloor = factoryFloorArea(fctAreas);        // 건평으로 볼 값
  const fctLand = fctAreas.find((a) => a.label === '부지면적') || null;
  const fctNote = fctAddr ? ['★ 실제 공장 주소', fctProduct ? `생산: ${fctProduct}` : null, fctInduty || null, fctRegDe ? `등록 ${fctRegDe}` : null].filter(Boolean).join(' · ')
    : why('factory', '공장등록 조회 결과 없음 — 미등록 공장(임대/소규모) 또는 상호 불일치');

  // 식약처 제조업 허가 레코드에서 대표자·소재지 추출 — 금융위 법인 미확보 시 이 값으로 보강
  const mkRep = mk ? (mk.PRSNL_NM ?? mk.RPRSNTV ?? mk.prsdntNm ?? mk.reprsntvNm ?? mk.repNm ??
    ((Object.entries(mk).find(([k, v]) => /대표|PRSNL|RPRSNTV|PRSDNT|REPRE/i.test(k) && v) || [])[1]) ?? null) : null;
  // 주소가 기본·상세 칸으로 나뉘어 오면 이어 붙인다(첫 칸만 쓰면 '세종특별자치시' 한 단어가 된다)
  const mkAddr = mk ? (joinAddrFields(mk) ?? mk.ADDR ?? mk.SITE_ADDR ?? mk.LOCP_ADDR ?? mk.locplc ?? mk.소재지 ??
    Object.values(mk).find(looksAddr) ?? null) : null;
  // 식약처 제조업 등록(허가)일 — 법인 설립일 대용(등록일은 설립과 다를 수 있음).
  // 안전장치: 등록/허가 힌트 키를 최우선, 없으면 레코드 내 '가장 이른' 날짜(등록일에 근접, 갱신일/유효기간 오채택 방지).
  const dateish = (v) => /^\s*(\d{4})[-.\/]?(\d{2})[-.\/]?(\d{2})\s*$/.test(String(v || '').trim());
  const y4 = (v) => { const m = String(v).match(/(\d{4})/); return m ? +m[1] : 9999; };
  const mkKeyDt = mk ? (mk.PRMS_DT ?? mk.PRMISN_DE ?? mk.LCNS_DE ?? mk.PERMIT_DT ?? mk.허가일자 ?? mk.등록일자 ??
    ((Object.entries(mk).find(([k, v]) => /(PRMS|PRMISN|LCNS|PERMIT|REG|허가|등록).*(DT|DE|DATE|YMD|일)/i.test(k) && dateish(v)) || [])[1]) ?? null) : null;
  const mkEarliest = mk ? (Object.values(mk).filter(dateish).sort((a, b) => y4(a) - y4(b) || String(a).localeCompare(String(b)))[0] || null) : null;
  const mkRegDt = (mkKeyDt && y4(mkKeyDt) >= 1980 && y4(mkKeyDt) <= 2026) ? mkKeyDt
    : ((mkEarliest && y4(mkEarliest) >= 1980 && y4(mkEarliest) <= 2026) ? mkEarliest : null);

  // 금융위 법인 미확보 시 보강: 국세청 → 식약처/공장 레코드 순
  const recBzno = corp?.bzno ? null : (findBzno(mk) || findBzno(fctHit));
  // 우선순위: 금융위 > 국세청 확인번호(활성) > 식약처/공장 추출 > 집계
  const bznoVal = corp?.bzno || ntsBno || recBzno || null;
  const bznoSrc = corp?.bzno ? '금융위 기업기본정보' : (ntsBno ? '국세청 확인' : (recBzno ? '식약처/공장등록' : '금융위 기업기본정보'));
  const bznoNote = corp?.bzno ? null : (ntsBno ? '국세청 사업자상태로 확인된 활성 사업자번호' : (recBzno ? '식약처/공장 레코드 추출' : '법인 미검색으로 미확보'));
  // 금융위 기업정보에 없는 신생·소규모 법인(큐브캡 등)은 산단공 공장등록 대표자로 채운다
  const repVal = corp?.rep || mkRep || fctRep || null;
  const repSrc = corp?.rep ? '금융위 기업기본정보' : mkRep ? '식약처 화장품제조업 API' : fctRep ? '산업단지공단 공장등록' : '식약처 화장품제조업 API';
  const repNote = corp?.rep ? null : mkRep ? '식약처 제조업 허가상 대표자 (금융위 법인 미확보 보강)'
    : fctRep ? '공장등록 신고 대표자 — 금융위 기업정보에 이 법인이 없어 대신 씁니다'
    : why('maker', '대표자 정보 없음 — 금융위·식약처·공장등록 어디에도 없음');
  const mkRegDate = mkRegDt ? fmtDate(mkRegDt) : null;
  const estbVal = fmtDate(corp?.estbDt) || mkRegDate || null;
  const estbSrc = corp?.estbDt ? '금융위 기업기본정보' : (mkRegDate ? '식약처 화장품제조업 API' : '금융위 기업기본정보');
  const estbNote = corp?.estbDt ? null : (mkRegDate ? '★ 식약처 제조업 등록(허가)일 — 법인 설립일과 다를 수 있음' : null);
  const bSttVal = bStt || null;

  const basic = [
    f('법인등록번호', corp?.crno || null, 'A', '금융위 기업기본정보', today),
    f('사업자등록번호', bznoVal, bznoVal ? (corp?.bzno ? 'A' : 'B') : 'D', bznoSrc, bznoVal ? today : null, bznoNote),
    f('사업자 상태', bSttVal, bSttVal ? (bStt ? 'A' : 'C') : 'D', '국세청 사업자상태', bSttVal ? today : null,
      bStt ? (bTax || null) : why('nts', '국세청 상태 조회 실패 — 사업자번호/승인 확인')),
    f('대표자', repVal, repVal ? (corp?.rep ? 'A' : 'B') : 'D', repSrc, repVal ? today : null, repNote),
    f('설립일 / 등록일', estbVal, estbVal ? (corp?.estbDt ? 'A' : 'C') : 'D', estbSrc, estbVal || null, estbNote),
    f('본점주소', corp?.addr || null, 'A', '금융위 기업기본정보', today),
    f('제조업 등록', (mk || ned) ? `등록${mkNo ? ` (업허가 ${mkNo})` : ''}${mkDate ? ` · ${mkDate} 허가` : ''}` : null, (mk || ned) ? 'A' : 'D',
      ned ? (mk ? '식약처 화장품제조업 API · 의약품안전나라' : '의약품안전나라 업체정보') : '식약처 화장품제조업 API', (mk || ned) ? today : null,
      (mk || ned) ? ([mkRep ? `대표 ${mkRep}` : null,
        nedSites.length ? `제조소 ${nedSites.length}곳` : (mkAddr ? `소재지 ${mkAddr}` : null),
        !mk && ned ? '공개 API 명단에는 아직 없음(의약품안전나라에서 확인)' : null,
        // 허가일이 있으면 '화장품을 몇 년 했는가'가 나온다 — 회사 업력과는 다른 숫자다
        mkDate ? ((y) => (y < 1 ? '화장품 업력 1년 미만 — 신규 허가 업체' : `화장품 업력 약 ${y}년`))(Math.max(0, new Date().getFullYear() - Number(String(mkDate).slice(0, 4)))) : null,
      ].filter(Boolean).join(' · ') || '화장품 제조업 등록 확인') : (mkReg && mkReg.searched
        // 명단 전체를 훑고도 없으면 '책임판매업 추정'이라고 단정하지 않는다 — 공개 API는 의약품안전나라보다
        // 늦게 갱신돼서, 최근 허가 업체는 빠져 있는 일이 있다
        ? `식약처 공개 API 명단 전체(${(mkReg.total || mkReg.size || 0).toLocaleString()}곳${mkReg.full ? '' : ' 중 일부만 수신'})에 이 상호가 없습니다. `
          + '최근 허가 업체는 공개 API 반영이 늦어 빠져 있을 수 있습니다 — 의약품안전나라(nedrug.mfds.go.kr) 업체 검색에서 허가 여부를 확인하세요. 거기에도 없으면 책임판매업만 등록(OEM 위탁)일 수 있습니다'
        : why('maker', '제조업 등록 결과 없음 — 책임판매업만 등록(OEM 위탁) 가능성'))),
    // 제조소가 여러 곳이면 모두 적는다(코스맥스: 화성 향남 2곳 · 평택 청북 2곳). 공개 API는 시·군까지만 주므로
    // 번지까지 있는 의약품안전나라 주소를 앞세우고, 없을 때만 API의 시·군을 적는다.
    (() => {
      // 제조소가 여럿이면(1공장·2공장…) 한 줄에 하나씩 번호를 붙여 모두 적는다.
      // 상세(동·층·(가좌동))에 괄호가 이미 있으면 다시 싸지 않는다 — '((가좌동))'처럼 겹쳐 보였다.
      const detailTxt = (d) => { const t = String(d || '').trim(); return t ? (/^\(.*\)$/.test(t) ? ` ${t}` : ` (${t})`) : ''; };
      const nedTxt = nedSites.length > 1
        ? nedSites.map((x, i) => `제조소 ${i + 1} · ${x.addr}${detailTxt(x.detail)}`).join('\n')
        : nedSites.map((x) => `${x.addr}${detailTxt(x.detail)}`).join('');
      const nedNote = nedSites.length ? `의약품안전나라 업체정보 등록 제조소 ${nedSites.length}곳${mkNo ? ` · 업허가 ${mkNo}` : ''}` : '';
      // 화장품 제조업 허가에 적힌 제조소를 앞세운다(공장 소재지 선정과 같은 원칙). 공장등록은 다른 업종 공장일 수 있다.
      if (nedSites.length) return f('공장/제조소 소재지', nedTxt, 'A', '의약품안전나라 업체정보', today,
        `${nedNote} — 식약처 화장품 제조업 허가상 제조소`
        + (fctAddr ? ` · 산단공 공장등록 주소: ${fctAddr}${fctNote ? ` (${fctNote.replace(/^★\s*/, '')})` : ''}` : ' · 산단공 공장등록 없음'));
      if (fctAddr) return f('공장/제조소 소재지', fctAddr, 'A', '산업단지공단 공장등록', today, fctNote);
      return f('공장/제조소 소재지', mkAddr || null, mkAddr ? 'A' : 'D',
        mkAddr ? '식약처 화장품제조업 API' : '산업단지공단 공장등록', mkAddr ? today : null,
        mkAddr ? '식약처 제조업 허가상 제조소 소재지 — 공개 API는 시·군까지만 줍니다(의약품안전나라 조회 실패 시)' : fctNote);
    })(),
  ];
  // 국세청 사업자등록 진위확인 — 사업자번호+대표자+개업일 3요소 대조.
  //  일치(01)는 강한 실체 근거. 불일치(02)는 '가짜'가 아니라 '확인 불가'로만 해석해야 한다
  //  (우리가 개업일 대신 법인 설립일을 넣기 때문에 정상 업체도 02가 나올 수 있음).
  //  ★ 일치할 때만 항목으로 올린다. 불일치(02)는 우리가 개업일 대신 설립일을 넣어서 생기는
  //    구조적 한계라 '확인 불가' 행을 만들면 문제 있는 업체처럼 보인다 → 소스 상태에만 남긴다.
  const nv = R.ntsVal && R.ntsVal.ok ? R.ntsVal.data : null;
  if (nv && nv.ok && nv.valid) {
    basic.push(f('사업자등록 진위확인', '일치 (국세청 원부 확인)', 'A', '국세청 진위확인 API', today,
      '★ 사업자번호·대표자명·개업일 3요소가 국세청 등록 원부와 일치 — 실체 확인의 가장 강한 근거'));
  }

  // 책임판매업 허가 — 같은 식약처 명단에 '화장품책임판매'로 따로 올라온다. 제조사가 자체 브랜드(책임판매)도
  // 가졌는지는 거래 판단에 쓸모 있다(고객사와 경쟁할 수 있고, 반대로 자체 유통 경험이 있다는 뜻이기도 하다).
  // 상호가 같거나, 사업자번호가 같은 기록만 인정한다.
  const saleRaw = R.maker && R.maker.ok && R.maker.data && Array.isArray(R.maker.data.sale) ? R.maker.data.sale : [];
  const bzKey = String(bznoVal || '').replace(/\D/g, '');
  const nmKey = stripCorp(name).replace(/\s/g, '');
  const saleHit = saleRaw.filter((r) => {
    const rb = String(r.BIZRNO || '').replace(/\D/g, '');
    const rn = stripCorp(String(r.ENTP_NAME || '')).replace(/\s/g, '');
    return (bzKey.length === 10 && rb === bzKey) || (nmKey.length >= 2 && rn === nmKey);
  });
  if (R.maker && R.maker.ok) {
    const sd = saleHit.map((r) => String(r.ENTP_PERMIT_DATE || '').replace(/\D/g, '').slice(0, 8)).filter((d) => d.length === 8).sort()[0];
    basic.push(f('책임판매업 등록', saleHit.length ? `등록${sd ? ` · ${fmtDate(sd)} 허가` : ''}${saleHit.length > 1 ? ` (${saleHit.length}건)` : ''}` : '미등록',
      saleHit.length ? 'A' : 'B', '식약처 화장품제조업·책임판매업 API', today,
      saleHit.length ? '자체 브랜드(책임판매) 허가도 보유 — 고객사 제품과 경쟁 품목이 있는지, 자체 유통 경험은 어떤지 확인'
        : '식약처 명단에서 같은 상호·사업자번호의 책임판매업 기록을 찾지 못함(제조 전문)'));
  }

  // 업종은 식약처 등록 사실 기준으로 정확히(집계 페이지 자유텍스트 오추출 방지). 연락처는 집계 참고.
  if (mk) basic.push(f('업종', '화장품 제조업', 'A', '식약처 화장품제조업 API', today, '식약처 화장품제조업 등록 기준'));

  // 식약처 기능성 보고품목 (rpt)
  // ★ 상호 일치 필터 필수: rpt API가 업체명 필터를 안 걸고 첫 페이지(기본 30건)를 그대로 주는 경우가 있어
  //   raw 목록을 그냥 세면 '남의 회사' 보고품목을 이 업체 것으로 오표기(할루시네이션). 업체명 포함 레코드만 카운트.
  const rlAll = R.rpt && R.rpt.ok ? listOf(R.rpt.data, ['body.items', 'response.body.items.item']) : [];
  const rptKey = stripCorp(name).replace(/\s/g, '');
  const rl = rptKey.length >= 2
    ? rlAll.filter((i) => Object.values(i).some((v) => {
        const gv = stripCorp(String(v == null ? '' : v)).replace(/\s/g, '');
        return gv.length >= rptKey.length && gv.includes(rptKey);
      }))
    : rlAll;
  const fresh = rl.filter((i) => isFresh5(i.REPORT_DAY || i.report_day || i.PRDLST_REPORT_DE));
  const forms = [...new Set(fresh.map((i) => i.DOSAGE_FORM || i.dosage_form).filter(Boolean))];
  const allForms = [...new Set(rl.map((i) => i.DOSAGE_FORM || i.dosage_form || i.PRDLST_TYPE).filter(Boolean))];
  const rptEmpty = '기능성 보고 이력 없음 — 기능성 미취급 또는 업체명 불일치';
  // ── 보고품목에서 더 읽어낸다 (제품명·연도·기능성 종류) ──
  // 필드명이 응답마다 흔들려 키를 훑는다. 어떤 키를 실제로 받았는지도 남겨 둔다 —
  // 나중에 비어 있을 때 '자료가 없는 것'인지 '키 이름이 다른 것'인지 가려야 한다.
  const rptNames = rl.map((r) => pickByKey(r, /ITEM_?NAME|PRDLST_?NM|PRDUCT_?NM|PRODUCT|품목명|제품명/i)).filter(Boolean);
  const rptDates = rl.map((r) => r.REPORT_DAY || r.report_day || r.PRDLST_REPORT_DE
    || pickByKey(r, /REPORT.*(DAY|DE|DT)|보고일/i)).filter(Boolean);
  const brands = brandGuess(rptNames, name);
  const yearStat = rptByYear(rptDates, new Date().getFullYear());
  const funcKinds = rptFunctions(rl);
  const rptKeys = rl.length ? Object.keys(rl[0]) : [];    // 응답 필드 목록(진단용)
  const TREND_TEXT = {
    up: '최근 신고가 늘고 있습니다 — 수주가 늘었거나 신규 라인 가동 가능성',
    down: '최근 신고가 눈에 띄게 줄었습니다 — 수주 감소·라인 축소 여부를 확인하세요',
    stopped: '최근 2년간 신고가 없습니다 — 기능성 생산이 멈췄을 수 있습니다. 현재 가동 여부를 반드시 확인하세요',
    flat: null,
  };

  // 국민연금 (nps) — npsLookup이 상호·사업자번호 앞 6자리로 거르고 월별 중복을 없앤 사업장 목록.
  // 앞 6자리는 수백 개 회사가 같이 쓰고 상호는 동명 회사가 있어, 여기서 '이 회사 사업장'임을 주소·적용일로 확인한다.
  //  · 주소: 국민연금 주소는 번지가 없다('…조마루로385번길') → 도로명이 본점·제조소·보험 사업장 주소와 같은지
  //  · 적용일: 국민연금 적용일 = 고용·산재보험 성립일이면 같은 사업장(인코스 부천: 2016-09-19 양쪽 동일)
  const npsData = R.nps && R.nps.ok ? R.nps.data : null;
  const roadNm = (a) => (String(a || '').match(/([가-힣A-Za-z0-9]+(?:로|길))(?=\s|\d|$)/) || [])[1] || '';
  const sidoOf = (a) => String(a || '').trim().slice(0, 2);
  const insSites0 = R.insure && R.insure.ok && R.insure.data ? (R.insure.data.sites || []) : [];
  const knownAddrs = [
    ['본점', corp?.addr], ...nedSites.map((x, i) => [`제조소 ${i + 1}`, x.addr]),
    ...insSites0.map((x) => [`보험 사업장(${x.name})`, x.addr]),
  ].filter(([, v]) => roadNm(v));
  const insEst = new Set(insSites0.flatMap((x) => [x.gy && x.gy.est, x.sj && x.sj.est]).filter(Boolean).map((d) => String(d).slice(0, 10)));
  const npsAll = npsData && Array.isArray(npsData.sites) ? npsData.sites.map((x) => {
    const hit = knownAddrs.find(([, v]) => roadNm(v) === roadNm(x.addr) && sidoOf(v) === sidoOf(x.addr));
    const adptHit = !!(x.adpt && insEst.has(x.adpt));
    return { ...x, addrHit: hit ? hit[0] : null, adptHit };
  }) : [];
  // 같은 주소의 국민연금 기록이 둘 이상 오면(상호 표기만 다른 같은 사업장·옛 기록) 한 곳으로 본다 —
  // 그대로 더하면 11명 사업장이 22명이 됐다(그린비코스메틱). 최신 달 → 인원 많은 쪽을 남긴다.
  const npsDedup = (arr) => { const m = new Map(); arr.forEach((x) => { const k = `${sidoOf(x.addr)}|${roadNm(x.addr) || x.addr}`; const o = m.get(k);
    if (!o || String(x.ym || '') > String(o.ym || '') || (String(x.ym || '') === String(o.ym || '') && (x.cnt || 0) > (o.cnt || 0))) m.set(k, x); }); return [...m.values()]; };
  const npsConf = npsDedup(npsAll.filter((x) => x.addrHit || x.adptHit));
  // 확인된 사업장만 합산. 확인 못 했으면 한 곳일 때만 쓰고(약한 근거), 여러 곳이면 가장 큰 곳 + '특정 불가' 표시
  const npsUse = npsConf.length ? npsConf : (npsAll.length ? [npsAll.reduce((a, b) => ((b.cnt || 0) > (a.cnt || 0) ? b : a))] : []);
  const npsBasis = !npsAll.length ? null : npsConf.length ? 'confirmed' : npsAll.length === 1 ? 'weak' : 'ambiguous';
  const npsSites = npsUse.length;
  const empVal = npsUse.some((x) => x.cnt != null) ? npsUse.reduce((a, x) => a + (x.cnt || 0), 0) : null;
  const npsMain = npsUse.length ? npsUse.reduce((a, b) => ((b.cnt || 0) > (a.cnt || 0) ? b : a)) : null;
  const npsAddr = npsMain ? npsMain.addr || null : null;
  const npsYmRaw = npsMain ? npsMain.ym : null;
  const npsYm = npsYmRaw ? String(npsYmRaw).replace(/^(\d{4})(\d{2}).*$/, '$1.$2') : null;
  const npsWhy = npsBasis === 'confirmed'
    ? npsUse.map((x) => `${x.name}(${x.addrHit ? `주소 = ${x.addrHit}` : ''}${x.addrHit && x.adptHit ? ', ' : ''}${x.adptHit ? `적용일 ${x.adpt} = 보험 성립일` : ''})`).join(' · ')
    : npsBasis === 'weak' ? '상호·사업자번호 앞 6자리만 일치 — 주소·적용일로는 확인 못 함'
      : npsBasis === 'ambiguous' ? `같은 상호·앞 6자리 사업장 ${npsAll.length}곳 중 이 회사를 특정하지 못해 가장 큰 곳만 표시 (${npsAll.map((x) => `${x.addr} ${x.cnt ?? '—'}명`).join(' / ')})` : '';

  // ── 고용·산재보험 — 사업장별 상시인원과 역할(제조·본사·물류·다른 업종) ──
  // 국민연금은 회사 전체(또는 본점 일괄) 가입자 수라 공장 인원을 알 수 없다. 보험은 사업장 단위로 오고
  // 업종도 함께 와서 '실제로 화장품을 만드는 곳에 몇 명이 있는지'를 가를 수 있다.
  const rk = typeof roadKeyOf === 'function' ? roadKeyOf : () => '';
  const siteKeys = new Set([...nedSites.map((x) => rk(x.addr)), rk(R.site && R.site.ok && R.site.data ? R.site.data.addr : '')].filter(Boolean));
  const COSM_IND = /화장품.*제조|화장품 및 향료/;
  const insD = R.insure && R.insure.ok ? R.insure.data : null;
  const workforce = insD && insD.sites && insD.sites.length ? (() => {
    const sites = insD.sites.map((x) => {
      const inds = [x.gy && x.gy.ind, x.sj && x.sj.ind].filter(Boolean);
      const cosm = inds.some((i) => COSM_IND.test(i));
      const atSite = siteKeys.has(rk(x.addr));
      const logi = /물류|창고/.test(x.name) || inds.some((i) => /운송|창고|물류/.test(i));
      const office = /본사|사무소|연구소|영업소/.test(x.name) || inds.some((i) => /도매|소매|도\.소매|사무|서비스업|연구개발/.test(i));
      // 공장 인원은 산재보험 쪽이 정확하다 — 고용보험은 본사에 몰아 신고하는 회사가 많다(코스맥스)
      const cnt = x.sj ? x.sj.cnt : (x.gy ? x.gy.cnt : 0);
      const role = atSite ? (cosm || !inds.length ? 'mfg' : 'mfg-odd') : logi ? 'logi' : office ? 'office' : (inds.length && !cosm) ? 'other' : 'cosm';
      // 같은 사업장의 국민연금 가입자(정규·상용) — 보험 상시인원과 나란히 놓아야 비정규 비중이 보인다.
      // 국민연금 주소에는 번지가 없어('…조마루로385번길') 도로명과 시·도로만 맞춘다.
      const np = npsAll.find((q) => roadNm(q.addr) && roadNm(q.addr) === roadNm(x.addr) && sidoOf(q.addr) === sidoOf(x.addr));
      const npsCnt = np ? np.cnt : null;
      // 연금 가입자가 그 사업장 상시인원보다 많으면 본점에 전사를 몰아 신고한 것 — 이 사업장 몫으로 쓸 수 없다
      const npsUnsplit = npsCnt != null && cnt > 0 && npsCnt > cnt;
      return { ...x, cnt, cosm, atSite, role, npsCnt, npsUnsplit, est: (x.sj && x.sj.est) || (x.gy && x.gy.est) || null };
    }).sort((a, b) => (b.atSite - a.atSite) || (b.cnt - a.cnt));
    const total = Math.max(insD.gyTotal || 0, insD.sjTotal || 0);
    const atS = sites.filter((x) => x.atSite);
    // 제조 인원 — 제조소 주소의 사업장. 주소가 안 맞으면 화장품 업종 사업장(본사·물류 제외)
    const mfgSites = atS.length ? atS : sites.filter((x) => x.role === 'cosm');
    const mfg = mfgSites.reduce((a, x) => a + x.cnt, 0);
    // 사업장별로 쪼개진 연금 가입자만 더한다(본점 일괄 신고분은 제외)
    const mfgNps = mfgSites.some((x) => x.npsCnt != null && !x.npsUnsplit)
      ? mfgSites.reduce((a, x) => a + (x.npsUnsplit ? 0 : (x.npsCnt || 0)), 0) : null;
    const other = sites.filter((x) => x.role === 'other');
    // ★ 추정 근무 인원은 하나의 숫자가 아니라 폭이다.
    //   산재 상시(일용·단시간 포함, 대표·임원 제외)와 국민연금 가입자(월 60시간 이상, 대표·임원 포함)는
    //   세는 사람이 달라 어느 한쪽이 더 클 수 있다. 둘 중 작은 쪽~큰 쪽을 실제 근무 규모로 본다.
    const npsAll2 = empVal != null && npsBasis === 'confirmed' ? Number(empVal) : null;
    const rng = (a, b) => (b == null ? { lo: a, hi: a, one: true } : { lo: Math.min(a, b), hi: Math.max(a, b), one: Math.min(a, b) === Math.max(a, b) });
    const mfgR = rng(mfg, mfgNps);
    const allR = rng(total, npsAll2);
    const short = (x) => { const m = String(x.addr).match(/([가-힣]+(?:구|군|시))\s+(?:[가-힣]+(?:읍|면|동)\s+)?([가-힣A-Za-z0-9]+(?:로|길)\s*\d+(?:-\d+)?)/); return m ? `${m[1]} ${m[2]}` : x.name; };
    return { sites, total, gyTotal: insD.gyTotal, sjTotal: insD.sjTotal, mfg, mfgR, allR, npsSplit: sites.some((x) => x.npsCnt != null && !x.npsUnsplit), mfgNames: mfgSites.map((x) => x.name), mfgSites: mfgSites.map((x) => ({ name: x.name, short: short(x), cnt: x.cnt, npsCnt: x.npsUnsplit ? null : x.npsCnt })), mfgNps, mfgSiteN: mfgSites.length, matched: atS.length > 0,
      other: other.reduce((a, x) => a + x.cnt, 0), otherInd: other.map((x) => (x.gy && x.gy.ind) || (x.sj && x.sj.ind)).filter(Boolean)[0] || null,
      // 제조소 주소에 보험 사업장이 있으면 업종 이름이 '화학제품'이어도 그곳이 공장이다(에이텍: 112명인데
      // 업종명만 보고 '제조 인력 없음'으로 A→B 강등됐다). 인력이 없다는 건 제조 사업장 자체가 없을 때뿐.
      noMfg: !mfgSites.length, indOdd: mfgSites.length > 0 && mfgSites.every((x) => !x.cosm), nps: empVal != null ? Number(empVal) : null, npsAddr: npsAddr || null, npsBasis };
  })() : null;

  // ── 대기오염물질 배출시설 신고 — 공장이 실제로 설비를 돌리고 있다는 근거 ──
  const airD = R.air && R.air.ok ? R.air.data : null;
  const airInfo = airD ? (() => {
    const ymd = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null; };
    const rows = (airD.rows || []).map((r) => {
      const atSite = siteKeys.has(rk(r.addr)) || siteKeys.has(rk(r.lot));
      const closed = /폐업|휴업|취소/.test(r.status || '');
      const cosm = atSite || /화장품|마스크|크림|로션|에센스|샴푸|세안/.test(`${r.biz || ''} ${r.product || ''}`);
      const tag = atSite ? (closed ? 'cur-closed' : 'cur') : !cosm && r.biz ? 'other' : closed ? 'old' : 'etc';
      return { ...r, permit: ymd(r.permit), closed: ymd(r.closed), atSite, isClosed: closed, tag };
    }).sort((a, b) => (b.atSite - a.atSite) || (a.isClosed - b.isClosed));
    const cur = rows.filter((r) => r.atSite);
    return { rows, cur: cur.length, curActive: cur.filter((r) => !r.isClosed).length, curClosed: cur.filter((r) => r.isClosed).length,
      old: rows.filter((r) => r.tag === 'old').length, siteKnown: siteKeys.size > 0 };
  })() : null;

  // 식약처 GMP 적합업소 (CGMP 등록여부) — 적합업체 전체목록에서 상호로 필터
  // 업체명 필드 키가 API마다 달라(BSSH_NM/CMPNY_NM/…) 모든 필드값을 훑어 상호 포함 여부로 매칭
  const gmpList = R.gmp && R.gmp.ok ? listOf(R.gmp.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const gmpHit = matchMine(name, gmpList);
  const hasCgmp = !!gmpHit;

  // 카카오 이동거리 {km, min, method} — navi=모빌리티 실측 / coord=카카오맵 좌표추정
  const kkTravel = R.kakao && R.kakao.ok ? R.kakao.data : null;
  const kkNavi = kkTravel && kkTravel.method === 'navi';

  // ── 뉴스·웹 언급 관련성 검증 ──
  // 예전에는 제목·요약에 상호 글자가 들어 있기만 하면 채택했다. '미스킨'을 조회하면 코미스킨·
  // 아이미스킨랩 기사, 화장품과 무관한 '미스킨' 기사가 그대로 '관련기사'로 나왔다. 이제 상호가
  // 다른 상호의 일부가 아닌 자리에 나오고, 소재 시·군·대표자·사업자번호·홈페이지 같은 근거가
  // 붙은 자료만 관련으로 보이고, 나머지는 제외 사유와 함께 접어 둔다(relevanceOf, app.js).
  const relCtx = relCtxOf(name, {
    addrs: [corp?.addr, fctAddr, npsAddr, mkAddr, ...nedSites.map((x) => x && x.addr),
      ...((R.hiring && R.hiring.ok && R.hiring.data && R.hiring.data.workAddrs) || [])],
    rep: corp?.rep || null, bzno: bznoVal, hosts: [fctHmpadr].filter(Boolean),
    tels: ((R.hiring && R.hiring.ok && R.hiring.data && R.hiring.data.contacts && R.hiring.data.contacts.tels) || []).map((t) => t.v),
  });
  const parsePubDate = (v) => { const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
  const relText = (n) => `${n.title || ''} ${n.description || ''} ${n.originallink || ''} ${n.link || ''}`;
  const rel_excluded = [];
  const judge = (kind) => (n) => {
    const r = relevanceOf(relText(n), relCtx);
    if (r.level === 'rel') { n._rel = r.why; return true; }
    rel_excluded.push({ kind, level: r.level, why: r.why, title: String(n.title || '').replace(/<\/?b>/g, ''),
      link: n.originallink || n.link || '', date: n.pubDate ? parsePubDate(n.pubDate) : null });
    return false;
  };
  const newsRaw = R.naverNews && R.naverNews.ok ? R.naverNews.data : null;
  const newsItems = newsRaw && newsRaw.items ? newsRaw.items : [];
  const relevantNews = newsItems.filter(judge('뉴스'));
  const news = relevantNews.length ? relevantNews.slice(0, 5) : null;

  // 📰 뉴스·웹 인사이트 — 업체명 포함 기사에서 '시점 있는 신호'를 분류·타임라인화(성장/거래/리스크).
  //   재무·API의 정형값 밖에서 최근 동향을 포착(투자·증설·수출·신제품·수상 / 리콜·제재·소송 등).
  const SIGNALS = [
    { tag: '투자·자본', tone: 'up', re: /투자\s*유치|유상증자|상장|IPO|인수|합병|M&A|지분\s*인수|벤처\s*인증|시리즈\s*[A-D]/i },
    { tag: '증설·시설', tone: 'up', re: /증설|신설|준공|착공|공장\s*확장|생산\s*라인\s*증설|스마트\s*공장|이전\s*확장/i },
    { tag: '수출·계약', tone: 'up', re: /수출|수주|공급\s*계약|납품\s*계약|MOU|업무\s*협약|해외\s*진출|현지\s*법인|바이어/i },
    { tag: '신제품·개발', tone: 'up', re: /신제품|출시|런칭|리뉴얼|공동\s*개발|기술\s*이전|독점\s*판매/i },
    { tag: '인증·수상', tone: 'up', re: /인증\s*(획득|취득)|CGMP|ISO|비건\s*인증|특허\s*(등록|출원)|수상|대상\s*수상|선정|어워드|우수기업/i },
    { tag: '실적호조', tone: 'up', re: /최대\s*실적|매출\s*(증가|성장|돌파|신기록)|흑자\s*전환|영업이익\s*(증가|개선)/i },
    { tag: '리콜·회수', tone: 'down', re: /리콜|회수|판매\s*중지|제조\s*정지|영업\s*정지/i },
    { tag: '제재·위반', tone: 'down', re: /적발|제재|과징금|벌금|행정\s*처분|위반|허위|과대\s*광고|고발/i },
    { tag: '분쟁·소송', tone: 'down', re: /소송|분쟁|고소|피소|배상|논란|불매/i },
    { tag: '재무위험', tone: 'down', re: /적자|영업\s*손실|자본\s*잠식|부도|법정\s*관리|회생\s*절차|파산|워크아웃|구조조정|감원/i },
  ];
  const parsePub = (s) => { const d = new Date(s || ''); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
  const relForInsight = relevantNews;
  const insightItems = [];
  for (const n of relForInsight) {
    const txt = (String(n.title || '') + ' ' + String(n.description || '')).replace(/<\/?b>/g, '');
    const hits = SIGNALS.filter((s) => s.re.test(txt));
    if (!hits.length) continue; // 신호 없는 일반기사는 타임라인 제외(잡음 억제)
    const down = hits.find((h) => h.tone === 'down');
    const pick = down || hits[0]; // 리스크 신호 우선 표기
    insightItems.push({
      date: parsePub(n.pubDate), tag: pick.tag, tone: pick.tone,
      title: String(n.title || '').replace(/<\/?b>/g, ''),
      link: n.originallink || n.link || '',
      desc: String(n.description || '').replace(/<\/?b>/g, '').slice(0, 140), rel: n._rel || null,
    });
  }
  insightItems.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const timeline = insightItems.slice(0, 12);
  // 종합 판단(재량) — 최근 신호의 방향성으로 한 줄 코멘트
  const ups = timeline.filter((x) => x.tone === 'up').length;
  const downs = timeline.filter((x) => x.tone === 'down').length;
  let assessment = null;
  if (timeline.length) {
    const lvl = downs >= 2 || (downs && downs >= ups) ? 'watch' : (ups >= 2 ? 'good' : 'neutral');
    const takes = {
      good: `최근 언론에서 성장·거래 신호(${ups}건)가 우세합니다 — 투자·증설·수출·수상 등. 활동성이 높은 업체로 판단되며, 아래 기사 원문으로 사실관계를 확인하세요.`,
      neutral: `주목할 성장/리스크 신호는 제한적입니다(성장 ${ups} · 주의 ${downs}). 기사가 적어 동향 파악보다 API 정형 데이터 위주로 판단하세요.`,
      watch: `주의 신호(${downs}건)가 포착됩니다 — 리콜·제재·소송·재무위험 등. 거래 전 아래 기사 원문과 국세청·회수이력을 반드시 교차 확인하세요.`,
    };
    assessment = { level: lvl, ups, downs, note: takes[lvl] };
  }
  const insights = timeline.length ? { timeline, assessment } : null;

  // 웹 언급 추적 — 업체를 언급한 웹문서를 유형(제조원·채용·기업보고서)으로 분류(활동·거래 단서)
  const oemRaw = R.oemTrace && R.oemTrace.ok ? R.oemTrace.data : null;
  const oemItems = (oemRaw && oemRaw.items) || [];
  const oemTag = (host, txt) => /saramin|jobkorea|wanted|incruit|jobplanet|catch\.co|albamon/i.test(host) ? '채용'
    : /happycampus|nice|kisline|kportal|cretop|kised|creditn|report|기업보고서|신용/i.test(host + txt) ? '기업보고서'
    : /제조원|OEM|ODM|납품/i.test(txt) ? '제조원/납품' : '언급';
  // 제조원 표기(제조원·OEM·납품 등)를 요구하던 조건은 관련성 검증으로 대신한다 — 소재지·대표자로 확인된 언급이면 활동 단서다
  const oem_trace = oemItems.filter(judge('웹 언급')).slice(0, 6).map((it) => {
      let host = ''; try { host = new URL(it.link).hostname; } catch { /* ignore */ }
      const title = String(it.title || '').replace(/<\/?b>/g, '');
      const desc = String(it.description || '').replace(/<\/?b>/g, '').slice(0, 120);
      return { title, link: it.link || '', desc, tag: oemTag(host, title + ' ' + desc), rel: it._rel || null };
    });

  // 지자체 공장정보 페이지에서 대표자·연락처·종업원수를 발췌한다(있으면)
  const pubBizFacts = publicBizFacts(oem_trace);

  // 식약처 화장품 회수·판매중지 — 목록에서 업체명 일치 건. 응답 필드명 확정 전이라 값 스캔으로 견고하게 추출.
  // recallLookup()이 페이지를 합쳐 { items, total, scanned }로 준다. 옛 모양(원본 응답)도
  // 받아 넘길 수 있게 둘 다 읽는다.
  const recallRaw = (R.recall && R.recall.ok) ? R.recall.data : null;
  const recallListAll = recallRaw
    ? (Array.isArray(recallRaw.items) ? recallRaw.items
      : listOf(recallRaw, ['response.body.items.item', 'body.items', 'items']))
    : [];
  const recallTotal = recallRaw && isFinite(Number(recallRaw.total)) ? Number(recallRaw.total) : null;
  const recallKey = stripCorp(name).replace(/\s/g, '');
  const recallHits = recallKey.length >= 2 ? recallListAll.filter((rec) =>
    Object.values(rec).some((v) => stripCorp(String(v == null ? '' : v)).replace(/\s/g, '').includes(recallKey))) : [];
  const recalls = recallHits.map((rec) => {
    const ent = Object.entries(rec).filter(([, v]) => v != null && String(v).trim() !== '');
    const byKey = (re) => { const hit = ent.find(([k]) => re.test(k)); return hit ? String(hit[1]).trim() : null; };
    const isDate = (s) => /(\d{4})[-.\/]?\d{2}[-.\/]?\d{2}|^\d{8}$/.test(String(s).trim());
    const product = byKey(/PRDUCT|PRDT|PRDLST|PRODUCT|GOODS|품목|제품/i);
    const reason = byKey(/RESN|RSN|REASON|사유|위반|불량/i) || byKey(/_CN$|CONT|내용|DVLP/i);
    let date = null;
    for (const [k, v] of ent) if (/DE$|_DE|DT$|YMD|DATE|DAY|ORDER|일자|일$/i.test(k) && isDate(v)) { date = String(v).trim(); break; }
    if (!date) for (const [, v] of ent) if (isDate(v)) { date = String(v).trim(); break; }
    // 등급은 건수만큼 중요하다. 표시기재 오류(3등급)와 이물·미생물(1·2등급)은 위탁 제조에서
    // 의미가 완전히 다르다 — 같은 '1건'으로 뭉뚱그리면 판단을 그르친다.
    const gradeRaw = byKey(/GRAD|등급|CLASS|CLSF/i);
    const gradeNo = gradeRaw ? (String(gradeRaw).match(/[123]/) || [])[0] : null;
    const severe = gradeNo === '1' || gradeNo === '2'
      || /이물|미생물|세균|중금속|유해|기준\s*초과|발암/.test(String(reason || ''));
    return { product: product || null, reason: reason || null, date: fmtDate(date) || date || null,
      grade: gradeRaw || null, severe };
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  // CGMP 취득 시기 — 식약처 공개 명단(API)에는 판정일이 없다. '업체명 CGMP'로 찾은 기사 중
  // 이 업체 이름과 인증·획득 표현이 함께 나온 가장 이른 기사로 가늠한다(없으면 '판정일 비공개').
  const cgCore = String(name || '').replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '').replace(/\s/g, '');
  const cgmpNews = (hasCgmp && R.cgmpNews && R.cgmpNews.ok && R.cgmpNews.data && R.cgmpNews.data.items ? R.cgmpNews.data.items : [])
    .map((n) => ({ title: String(n.title || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), desc: String(n.description || '').replace(/<[^>]+>/g, ''),
      link: n.originallink || n.link || '', date: n.pubDate ? parsePubDate(n.pubDate) : null }))
    .filter((n) => n.date && cgCore.length >= 2 && `${n.title} ${n.desc}`.replace(/\s/g, '').includes(cgCore)
      && /CGMP/i.test(`${n.title} ${n.desc}`) && /획득|인증|적합|취득|지정|통과|판정/.test(`${n.title} ${n.desc}`)
      // 제목의 회사가 계열·동명 회사(코스맥스 → 코스맥스바이오)면 남의 인증이다
      && !String(n.title).split(/[\s,·…"'“”‘’()[\]]+/).some((w) => { const c = w.replace(/\(주\)|㈜|주식회사/g, ''); return c.startsWith(cgCore) && c.length > cgCore.length && !/^(?:이|가|은|는|의|와|과|도|에|,)$/.test(c.slice(cgCore.length)); })
      // 미국 FDA·UL cGMP 같은 해외 인증은 식약처 CGMP가 아니다
      && !/\bUL\b|FDA|美|미국|EU|유럽|NSF|WHO|호주|TGA|할랄/.test(n.title))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5).map(({ title, link, date }) => ({ title, link, date }));
  const cgFirst = cgmpNews[0] || null;
  const capacity = [
    // ★ 생산역량 칸에는 '제조소에 실제로 몇 명이 있나' 한 줄만 둔다.
    //   전체 근로자 구성·사업장별 내역·인력 추이·공장등록 신고값은 아래 「인력 · 사업장 구성」 표로 옮겼다.
    //   숫자가 하나로 떨어지지 않는 이유: 산재 상시(일용·단시간 포함, 대표·임원 제외)와
    //   국민연금 가입자(월 60시간 이상, 대표·임원 포함)는 세는 사람이 달라 어느 쪽이든 더 클 수 있다.
    (() => {
      const W = workforce;
      const key = '제조소 추정 근무 인원';
      if (W && W.mfgSiteN) {
        const R = W.mfgR;
        const val = `${R.one ? `${R.lo}명` : `${R.lo}~${R.hi}명`} · 제조소 ${W.mfgSiteN}곳`;
        const per = W.mfgSites.map((x) => `${x.short} ${x.cnt}명${x.npsCnt != null ? `(연금 ${x.npsCnt})` : ''}`).join(' · ');
        return f(key, val, W.matched ? 'A' : 'B', '근로복지공단 고용·산재보험 + 국민연금', today,
          `${per} — ${W.matched ? '제조업 허가 제조소와 같은 주소의 보험 사업장' : '화장품 제조 업종 보험 사업장(제조소 주소와는 대조 못 함)'}. `
          + (R.one
            ? (W.mfgR.lo === W.mfg && W.npsSplit ? '산재 상시와 국민연금 가입자가 같습니다.' : '산재보험 상시근로자 기준입니다 — 국민연금은 본점 일괄 신고라 제조소 몫을 가를 수 없습니다.')
            : `산재 상시 ${W.mfg}명과 국민연금 가입자 중 작은 쪽~큰 쪽입니다 — 둘은 세는 사람이 달라(일용·단시간 / 대표·임원) 폭으로 봅니다.`)
          + ` 본사·물류·다른 업종은 뺐습니다. 사업장별 내역은 아래 「인력 · 사업장 구성」`);
      }
      if (W) return f(key, `회사 전체 ${W.allR.one ? `${W.allR.lo}명` : `${W.allR.lo}~${W.allR.hi}명`} (제조 사업장 미확인)`, 'C', '근로복지공단 고용·산재보험', today,
        '보험 업종에 화장품 제조 사업장이 없어 회사 전체 인원을 적었습니다 — 직접 제조하는지, 위탁인지 방문 때 확인하세요');
      return f(key, empVal != null ? `${empVal}명 · 국민연금 참고값` : null, empVal != null ? 'C' : 'D', '국민연금 사업장 API', empVal != null ? today : null,
        empVal != null ? '고용·산재보험 자료가 없어 국민연금 가입자 수로 대신했습니다(본점 일괄 신고라 공장 인원과 다를 수 있음)' : why('insure', '고용·산재보험·국민연금 모두 인원 자료 없음'));
    })(),
    // 지자체 공장정보에 실린 연락처 — 방문 약속을 잡을 유일한 공개 번호다
    // 연락처 — 공장등록 응답의 전화번호를 먼저 쓰고, 없을 때만 웹에서 긁은 값을 쓴다
    f('공장 연락처', fctTel || pubBizFacts.tel || pubBizFacts.fctryTel || null,
      fctTel ? 'A' : ((pubBizFacts.tel || pubBizFacts.fctryTel) ? 'C' : 'D'),
      fctTel ? '산업단지공단 공장등록' : '지자체 공장정보(웹)',
      (fctTel || pubBizFacts.tel || pubBizFacts.fctryTel) ? (fctTel ? (fctRegDe || today) : today) : null,
      fctTel
        ? `공장등록증 신고 전화번호입니다${fctFax ? ` (팩스 ${fctFax})` : ''}.`
          + `${fctOrg ? ` 관할·입주기관 ${fctOrg}.` : ''} 방문 전 통화로 담당자를 확인하세요.`
        : ((pubBizFacts.tel || pubBizFacts.fctryTel)
          ? `지자체 공장정보 페이지 게재값입니다(공공 API에는 없음). 변경됐을 수 있으니 방문 전 통화로 확인하세요.`
            + `${pubBizFacts.link ? ` 근거: ${pubBizFacts.link}` : ''}`
          : why('factory', '공장등록 응답과 웹 어디에서도 연락처를 찾지 못했습니다'))),
    // 실제 공장 소재지 — 제조업 허가·공장등록·본점·연금·카카오맵 주소 중 방문·면적 조회에 쓴 주소와 그 근거
    siteField(R.site, R.bld, today),
    // 건평 — 방문 전 물류 동선을 가늠하는 유일한 공개 수치다(건축물대장 → 없으면 산단공 신고값)
    areaFieldFromBld(R.bld, fctFloor, fctRegDe, today),
    f('사업장 주소 (연금기준)', npsAddr, 'B', '국민연금 사업장 API', npsAddr ? today : null, npsAddr ? '식약처 제조소 주소와 대조용' : why('nps', '국민연금 결과 없음')),
    (() => {
      if (!airInfo) return f('대기 배출시설 신고', null, 'D', '행정안전부 대기배출시설 인허가', null, why('air', '조회 결과 없음'));
      const c = airInfo.rows.find((r) => r.atSite && !r.isClosed) || airInfo.rows.find((r) => r.atSite);
      const run = (r) => (r.days || r.hours) ? ` · 연 ${r.days || '—'}일×${r.hours || '—'}시간` : '';
      const val = c ? `${c.isClosed ? `${c.status} (${c.closed || '일자 미상'})` : '영업'}${c.kind ? ` · ${c.kind}` : ''}${run(c)}`
        : airInfo.rows.length ? `제조소 주소 신고 없음 · 이 회사 다른 신고 ${airInfo.rows.length}건` : '신고 없음 — 소규모 면제 가능';
      return f('대기 배출시설 신고', val, c ? (c.isClosed ? 'C' : 'A') : 'B', '행정안전부 대기배출시설 인허가', today,
        c ? `제조소 주소에 대기오염물질 배출시설 설치 신고가 있습니다${c.permit ? `(인허가 ${c.permit})` : ''} — ${c.isClosed ? '지금 제조소의 배출시설이 폐업·휴업 상태입니다. 가동 여부를 확인하세요' : '보일러·유화·건조 등 생산 설비가 신고된 실제 공장이라는 근거'}. 자세한 내역은 「공장 면적」 탭`
          : '배출시설 신고가 없는 것은 결격이 아닙니다 — 소규모 시설은 신고 대상이 아닐 수 있습니다');
    })(),
    // 추정 인건비(연금 고지액 ÷ 9%)는 뺐다 — 기준소득월액 상·하한 때문에 신뢰도가 낮고 방문 판단에 쓰이지 않았다(사용자 요청)
    (() => {
      // 도착지를 반드시 표기한다. 어느 주소로 계산했는지 안 보이면, 주소가 틀렸을 때
      // 거리만 보고는 알아챌 방법이 없다(본점·공장·연금 사업장 주소가 서로 다른 업체가 많다).
      const usedAddr = (kkTravel && kkTravel.destAddr) || fctAddr || corp?.addr || npsAddr || null;
      const siteD = R.site && R.site.ok ? R.site.data : null;
      const src = usedAddr && siteD && usedAddr === siteD.addr ? `실제 공장 소재지 · ${siteD.label}`
        : usedAddr && fctAddr && usedAddr === fctAddr ? '공장 소재지(산단공)'
        : usedAddr && corp?.addr && usedAddr === corp.addr ? '본점 주소(금융위 등기)'
          : usedAddr && npsAddr && usedAddr === npsAddr ? '연금 사업장 주소'
            : usedAddr ? '조회된 주소' : null;
      const dest = usedAddr ? `도착지: ${usedAddr}${src ? ` (${src})` : ''}` : '도착지 주소 미확보';
      const how = kkNavi ? '한국콜마 기준 실제 도로 경로 거리·소요시간'
        : (kkTravel ? '정확 좌표 직선거리×도로계수 추정 — 실측은 카카오내비(모빌리티) 신청 시 자동 전환'
          : '지역 중심점 직선거리 추정 — 카카오맵 버튼으로 재확인');
      return f('방문 이동거리',
        kkTravel ? travelText(kkTravel) : travelText(estimateTravel(usedAddr)),
        kkNavi ? 'B' : 'C',
        kkNavi ? '카카오내비 길찾기 (실측)' : (kkTravel ? '카카오맵 좌표 기반 추정' : '좌표 추정 (지역중심)'),
        today,
        `★ ${dest} — 이 주소가 실제 방문지와 다르면 거리도 틀립니다. 반드시 대조하세요. · ${how}`);
    })(),
    f('기능성 보고품목 수', rl.length || null, rl.length ? (fresh.length ? 'A' : 'C') : 'D', '식약처 보고품목 API', rl.length ? today : null,
      rl.length ? `전체 ${rl.length}건 · 최근 5년 ${fresh.length}건${fresh.length ? '' : ' — 최근 신고 없음(과거 이력)'}` : why('rpt', rptEmpty)),
    f('신고 제형 분포', allForms.length ? allForms.join(', ') : null, 'C', '식약처 보고품목 API', allForms.length ? today : null, allForms.length ? 'CAPA 직접 데이터 아님 — 실사 확인' : why('rpt', rptEmpty)),
    // 연도별 추이 — 재무제표보다 먼저 움직인다. 숫자보다 '방향'이 중요하다.
    f('보고품목 연도별 추이',
      yearStat.years.some((y) => y.n) ? yearStat.years.map((y) => `${String(y.year).slice(2)}년 ${y.n}건`).join(' · ') : null,
      yearStat.years.some((y) => y.n) ? 'A' : 'D', '식약처 보고품목 API',
      yearStat.years.some((y) => y.n) ? today : null,
      TREND_TEXT[yearStat.trend] || (yearStat.years.some((y) => y.n) ? '최근 신고 흐름에 큰 변동은 없습니다' : why('rpt', rptEmpty))),
    // 기능성 종류 — 자외선차단은 SPF 실측 시험이 붙어 기술 난이도가 한 단 위다
    f('취급 기능성 종류', funcKinds.length ? funcKinds.join(', ') : null,
      funcKinds.length ? 'A' : 'D', '식약처 보고품목 API', funcKinds.length ? today : null,
      funcKinds.length
        ? (funcKinds.includes('자외선차단')
          ? '자외선차단 품목 보유 — SPF 실측 시험을 수반하므로 품질관리 수준이 상대적으로 높습니다'
          : '신고 이력이 있는 기능성 범주입니다. 신규 범주를 요청하려면 별도 보고가 필요합니다')
        : why('rpt', rptEmpty)),
    // ★ 업체 주장과 맞대 볼 수 있는 거의 유일한 공개 근거
    f('보고품목 상 반복 브랜드',
      brands.length ? brands.map((b) => `${b.name}(${b.count}건)`).join(', ') : null,
      brands.length ? 'C' : 'D', '식약처 보고품목 API (제품명 분석)', brands.length ? today : null,
      brands.length
        ? '★ 제품명 앞머리에서 2건 이상 반복된 표기입니다 — 실제 납품 브랜드일 가능성이 높지만 추정입니다. '
          + '업체가 말하는 거래처와 대조해 보시고, 차이가 크면 그 이유를 물어보세요.'
        : (rl.length ? '제품명에서 반복되는 브랜드 표기를 찾지 못했습니다 — 자사 브랜드 위주이거나 제품명에 브랜드를 안 쓰는 경우' : why('rpt', rptEmpty))),
    f('CGMP 적합업소', hasCgmp ? `적합 (식약처 GMP 등재)${cgFirst ? ` · ${cgFirst.date.slice(0, 7)} 기사 확인` : ''}` : null, hasCgmp ? 'A' : 'D', '식약처 GMP API', hasCgmp ? today : null,
      hasCgmp ? (cgFirst
        ? `★ 취득 시기 추정: ${cgFirst.date} 「${cgFirst.title.slice(0, 60)}」 기사 — 식약처 공개 명단에는 판정일이 없어 이 업체의 CGMP 인증 기사 중 가장 이른 것으로 가늠했습니다. ※ 방문 때 CGMP 적합 증명서의 발급일로 확인하세요. ISO/할랄/비건은 공개 API 없음`
        : '★ 판정일은 공개되지 않습니다 — 식약처 명단(API)에 날짜 칸이 없고, 이 업체의 CGMP 인증 기사도 찾지 못했습니다. ※ 방문 때 CGMP 적합 증명서 발급일을 확인하세요. ISO/할랄/비건은 공개 API 없음')
        : why('gmp', 'CGMP 미등재 — 그 외 인증은 공개 API 없음(방문 확인)')),
  ];

  // 재무 — 연도별 '가장 완전한' 레코드 채택(같은 해 별도/연결 복수 제출 대비) 후 최신 5개년
  // 채용공고 판정 — 공고 건수는 채용 인원이 아니고 마감분은 검색에서 사라지므로 전부 추정이다
  // (재무 조립보다 앞에 둔다 — 아래에서 외부사이트 재무를 붙일 때 필요하다)
  const hireRaw = R.hiring && R.hiring.ok ? R.hiring.data : null;
  // 대표자 마지막 보강 — 금융위·식약처·공장등록 어디에도 없으면(신생·소규모 법인) 지자체 공장정보 → 채용사이트 기업정보
  // ('대표자 : 최경/이병만') 순으로 채운다. 회사가 직접 올린 값이라 등기보다 낮은 등급으로 둔다.
  // 채용사이트 기업정보의 대표자 — 보강용이자 교차 확인의 한 출처
  const hireRep = (() => {
    if (!hireRaw) return null;
    const REP = /대표(?:자|이사)?\s*(?:명|성명)?\s*[:：]\s*([가-힣]{2,4}(?:\s*[,/·]\s*[가-힣]{2,4}){0,2})(?![가-힣])/;
    const bad = /^(없음|미상|정보|확인|미공개|공개|비공개)$/;
    const texts = [...(hireRaw.posts || []).map((p) => [`${p.title} ${p.desc}`, p.host]), ...((hireRaw.extDiag || []).map((d) => [d.finSample || '', d.host]))];
    for (const [t, host] of texts) {
      const m = String(t).replace(/\s+/g, ' ').match(REP);
      if (m && !m[1].split(/[,/·]/).some((x) => bad.test(x.trim()))) return { rep: m[1].replace(/\s+/g, ''), src: `${String(host || '').replace(/^www\./, '')} 기업정보` };
    }
    return null;
  })();
  {
    const ri = basic.findIndex((x) => x.key === '대표자');
    if (ri >= 0 && !basic[ri].value) {
      let rep = null, src = null, link = null;
      if (pubBizFacts && pubBizFacts.rep) { rep = pubBizFacts.rep; src = '지자체 공장정보'; link = pubBizFacts.link; }
      if (!rep && hireRep) ({ rep, src } = hireRep);
      if (rep) basic[ri] = f('대표자', rep, 'C', src, today, `★ 금융위·식약처·공장등록에 대표자가 없어 ${src}에 게재된 값을 썼습니다 — 회사가 직접 올린 값이라 등기와 다를 수 있습니다. ※ 방문 때 사업자등록증으로 확인하세요.${link ? ` 근거: ${link}` : ''}`);
    }
  }
  // 대표자 교차 확인 — 첫 값 하나만 쓰지 않고 받은 출처를 모두 대조한다.
  // 같으면 믿을 근거, 다르면 대표 변경·공동대표·자료 노후를 의심할 신호다.
  const repCheck = repCross([
    ['금융위 등기', corp?.rep],
    ['식약처 제조업 허가', mkRep],
    ['산단공 공장등록', fctRep, fctRegDe ? `${fctRegDe.slice(0, 4)} 등록` : null],
    ['지자체 공장정보', pubBizFacts && pubBizFacts.rep],
    [hireRep ? hireRep.src.replace(/ 기업정보$/, ' 채용정보') : '채용사이트', hireRep && hireRep.rep],
  ]);
  { const ri = basic.findIndex((x) => x.key === '대표자'); if (ri >= 0 && repCheck) basic[ri] = { ...basic[ri], cross: repCheck }; }
  const hiring = hireRaw && typeof analyzeHiring === 'function'
    ? { ...analyzeHiring(hireRaw.posts, hireRaw.heads, workforce ? workforce.total : empVal, npsYm ? npsYm.replace('.', '-') : null, hireRaw.extDiag, hireRaw.extProfile, hireRaw.hpHints, hireRaw.workAddrs), affil: hireRaw.affil || [] }
    : null;
  if (hiring && hireRaw && hireRaw.contacts) hiring.contacts = hireRaw.contacts;   // 대표번호·메일(업체명 옆 표시)

  const flAll = R.finance && R.finance.ok ? listOf(R.finance.data, ['response.body.items.item', 'body.items']) : [];
  const byYear = new Map();
  const finScore = (r) => (r.enpSaleAmt ? 1 : 0) + (r.enpTastAmt ? 1 : 0) + (r.enpCptlAmt ? 1 : 0) + (r.enpBzopPft ? 1 : 0);
  flAll.forEach((it) => {
    const y = Number(it.bizYear || it.biz_year); if (!y) return;
    const prev = byYear.get(y);
    if (!prev || finScore(it) > finScore(prev)) byYear.set(y, it); // 매출·자산 등 값이 더 채워진 레코드 우선
  });
  // ── 채용사이트 재무를 연도 계열에 합친다 ──
  // 금융위가 끊긴 뒤 연도를 채우는 건 이 값뿐이라, 추이 그래프에도 함께 올려야 흐름이 보인다.
  // 다만 공시가 아니므로 연도에 표시를 남기고(src: 'ext') 공식 연도가 있으면 공식을 우선한다.
  const extByYear = new Map();
  ((hireRaw && hireRaw.extFin) || []).forEach((x) => {
    if (!x.year) return;                       // 연도 없는 값은 계열에 올리지 않는다(연도를 지어내지 않는다)
    const hosts = (x.sources || []).map((v) => v.host).join('·');
    const cur = extByYear.get(x.year) || { year: x.year, src: 'ext', host: hosts };
    if (x.key === '매출액') cur.revenue = x.eok;
    else if (x.key === '영업이익') cur.operatingProfit = x.eok;
    else if (x.key === '자산총계') cur.assets = x.eok;
    else if (x.key === '자본총계') cur.equity = x.eok;
    else if (x.key === '자본금') cur.capital = x.eok;
    else if (x.key === '당기순이익') cur.netIncome = x.eok;
    extByYear.set(x.year, cur);
  });
  // 가장 최근 6개년 — 공식·외부를 합친 뒤 자른다(공시가 끊긴 업체도 최근 흐름이 보이게)
  const years = [...new Set([...byYear.keys(), ...extByYear.keys()])]
    .sort((a, b) => b - a).slice(0, 6).sort((a, b) => a - b);
  let finance, finance_history = [];
  if (years.length) {
    // ── 공시 우선, 빈 칸만 채용사이트로 ──
    // 여태는 '연도 단위'로 통째 골랐다. 그래서 공시가 있는 해는 총자산·자본금이 비어 있어도
    // 채용사이트에 그 값이 있는 걸 못 썼고, 공시가 없는 해는 전부 외부값이 됐다.
    // 항목 단위로 바꾼다 — 같은 해에 공시값이 있으면 그걸 쓰고, 없는 항목만 외부에서 채운다.
    const FIN_F = [
      ['revenue', 'enpSaleAmt', '매출액'], ['operatingProfit', 'enpBzopPft', '영업이익'],
      ['netIncome', 'enpCrtmNpf', '당기순이익'], ['assets', 'enpTastAmt', '자산총계'],
      ['debt', 'enpTdbtAmt', '부채총계'], ['capital', 'enpCptlAmt', '자본금'],
    ];
    finance_history = years.map((y) => {
      const it = byYear.get(y);
      const e = extByYear.get(y) || {};
      const row = { year: y, srcOf: {} };
      let anyOff = false, anyExt = false;
      FIN_F.forEach(([f, apiKey]) => {
        const off = it ? won2eok(it[apiKey]) : null;
        if (off != null) { row[f] = off; row.srcOf[f] = 'official'; anyOff = true; return; }
        // 부채총계는 채용사이트가 주지 않아 외부 보완 대상이 아니다
        const ex = e[f] != null ? e[f] : null;
        if (ex != null) { row[f] = ex; row.srcOf[f] = 'ext'; anyExt = true; return; }
        row[f] = null;
      });
      row.src = anyOff ? 'official' : 'ext';
      row.mixed = anyOff && anyExt;                       // 한 해 안에서 공시+외부가 섞인 경우
      row.host = anyExt ? (e.host || null) : null;
      return row;
    });
    // 공시가 없는 해를 채용사이트 재무탭으로 메웠다면 그 사실을 재무 설명에 남긴다.
    // 같은 해가 양쪽에 다 있으면 공시를 그대로 두므로, 여기 적히는 연도는 '메운 해'뿐이다.
    const filledYears = finance_history.filter((r) => Object.values(r.srcOf).includes('ext')).map((r) => r.year);
    // host는 'saramin.co.kr·jobkorea.co.kr'처럼 합쳐진 문자열로 올 수 있어, 그대로 Set에
    // 넣으면 'jobkorea.co.kr·saramin.co.kr·jobkorea.co.kr'같이 같은 이름이 두 번 적힌다.
    const filledHosts = [...new Set(finance_history.filter((r) => r.host)
      .flatMap((r) => String(r.host || '').split('·')).map((h) => h.trim()).filter(Boolean))];
    // 재무 '필드'(매출액·총자산 등)는 공식 자료 기준을 유지한다 — 외부값은 별도 행으로 이미 표시된다
    const offRows = finance_history.filter((r) => r.src === 'official');
    // 공시가 한 건도 없으면 채용사이트 값으로 칸을 채우게 되는데, 그때도 등급 A에 출처를
    // '금융위 재무정보 API'로 찍고 있었다. 다산씨엔텍 조회에서 금융위는 '재무 레코드 없음'인데
    // 매출액 68억이 A등급 공시로 표시됐다 — 사람인에서 긁어 온 값이다. 공시가 아니면 공시라고
    // 하면 안 된다. 출처와 등급을 값의 출처대로 되돌린다.
    const usingExt = !offRows.length;
    const L = (offRows.length ? offRows : finance_history)[(offRows.length ? offRows : finance_history).length - 1];
    const eok = (v) => (v != null ? `${v}억 원` : null);
    // ★ 재무는 회계연도 기준 — as_of를 '조회일'이 아니라 '해당 회계연도'로(옛 자료가 최신처럼 보이는 문제 방지).
    //   재무는 통상 1년 지연 → 최신연도가 (조회연도-2)보다 오래되면 'stale'로 표기하고 등급 강등.
    const curYear = Number(String(today).slice(0, 4)) || 2026;
    const lag = curYear - L.year;
    const stale = lag >= 3;
    const asOf = `${L.year}-12`;
    const grade = usingExt ? 'C' : (stale ? 'C' : 'A');
    // 요약재무제표에 없어 계정과목(재무상태표·손익계산서)에서 보완한 연도는 출처를 구분 표기
    const viaAccounts = !!(byYear.get(L.year) || {})._fromAccounts;
    const src = usingExt
      ? `${L.host || '채용사이트'} 기업정보 (외부사이트자료 · 공시 아님)`
      : `금융위 재무정보 API (${L.year} 회계연도${viaAccounts ? ' · 계정과목 보완' : ''})`;
    // 계열이 끊겼거나 중간에 빠진 해가 있으면 그 사유를 추정해 덧붙인다
    // (끊긴 사실만 보이면 폐업·부실로 오해하기 쉬움 — financeBreakNote 주석 참고)
    const breakNote = financeBreakNote(finance_history, curYear, workforce ? workforce.total : empVal, bSttVal);
    const baseNote = (usingExt
      ? `★ 금융위 재무 API에 이 업체의 재무 레코드가 없습니다. 이 API는 외부감사·상장 공시분만 `
        + `수록하므로, 외감 대상이 아닌 법인은 매출 규모와 무관하게 조회되지 않습니다. `
        + `따라서 위 수치는 공시가 아니라 채용사이트 기업정보(${filledHosts.join('·') || '외부사이트'})의 `
        + `${filledYears.length > 1 ? `${filledYears[0]}~${filledYears[filledYears.length - 1]}년` : `${L.year}년`} 표기값이며 `
        + `등급도 C(참고치)입니다 — 방문 전 최근 결산서·표준재무제표증명(국세청 발급)을 반드시 요청하세요.`
      : stale
      ? `★ 금융위(DART 공시 기반) API가 제공하는 가장 최신 회계연도는 ${L.year}년입니다(약 ${lag}년 전). ` +
        `이 API는 상장·외부감사 공시분만 수록해 최근 자료가 없을 수 있습니다 — ` +
        `NICE·KED 등 신용조회에는 더 최근 재무가 있을 수 있으니 방문 전 최근 결산서를 요청하세요.`
      : `★ ${L.year} 회계연도 확정 실적(금융위 제출 최신). 재무는 통상 1년 지연 공시.`)
      + (usingExt ? '' : (breakNote ? ` ${breakNote}` : ''))
      + (usingExt || !filledYears.length ? ''
        : ''
        + ` ▣ 공시가 없는 ${filledYears.join('·')}년은 채용사이트 기업정보의 재무 탭`
          + `${filledHosts.length ? `(${filledHosts.join('·')})` : ''}에서 가져와 채웠습니다. `
          + '같은 해가 공시에도 있으면 공시값을 그대로 두었고, 비어 있던 해만 대체했습니다. '
          + '공시가 아니므로 추이 그래프에서도 해당 연도는 외부자료로 표시됩니다.');
    // 항목마다 '값이 있는 가장 최근 해'를 쓴다. 최신 연도 한 줄만 보면, 그 해에 비어 있는
    // 항목(총자산·자본금 등)이 통째로 '해당 없음'이 된다 — 바로 아래 해에 값이 있어도.
    // 공시가 있으면 공시를 먼저 쓰고, 없을 때만 채용사이트 값으로 채운다.
    const pickLatest = (k) => {
      for (let i = finance_history.length - 1; i >= 0; i--) {
        const r = finance_history[i];
        if (r[k] != null) return { v: r[k], year: r.year, from: r.srcOf[k], host: r.host };
      }
      return null;
    };
    const finRow = (label, k, note) => {
      const p = pickLatest(k);
      if (!p) return f(label, null, 'D', src, null, note || why('finance', '공개 자료에서 확인되지 않음'));
      const isExt = p.from === 'ext';
      const old3 = curYear - p.year >= 3;
      return f(label, eok(p.v), isExt ? 'C' : (old3 ? 'C' : 'A'),
        isExt ? `${p.host || '채용사이트'} 기업정보 (외부사이트자료 · 공시 아님)`
          : `금융위 재무정보 API (${p.year} 회계연도${(byYear.get(p.year) || {})._fromAccounts ? ' · 계정과목 보완' : ''})`,
        `${p.year}-12`,
        (note ? note + ' ' : '')
          + (isExt ? '※ 이 항목은 공시에 없어 채용사이트 기업정보의 재무 탭 값으로 채웠습니다 — 참고치입니다.' : ''),
        !old3);
    };
    finance = [
      finRow('매출액', 'revenue', baseNote),
      finRow('영업이익', 'operatingProfit'),
      finRow('당기순이익', 'netIncome'),
      finRow('총자산', 'assets'),
      finRow('총부채', 'debt'),
      finRow('자본금', 'capital'),
    ];
  } else {
    finance = ['매출액', '영업이익', '당기순이익', '총자산', '총부채', '자본금'].map((k) =>
      f(k, null, 'D', '금융위 재무정보 API', null, why('finance', '금융위 재무 API 미수록 — 상장·공시대상 위주(비상장은 DART/신용조회로 확인)')));
  }

  // ── 외부사이트 재무 보완 ──
  // 금융위 재무가 몇 년 전에서 끊긴 업체는 그 이후를 알 방법이 없다. 채용 사이트 기업정보에
  // 실린 매출·자본총계·순이익을 보태되, 공시가 아니므로 항목명에 '외부사이트자료'를 못 박아
  // 공식 수치와 섞이지 않게 한다. 등급도 C(추정·프록시)로 둔다.
  // 연도를 모르는 값은 아예 싣지 않는다. '영업이익 — 외부사이트자료 1억'처럼 어느 해 것인지
  // 알 수 없는 줄은 공시와 대조할 수도, 추이에 올릴 수도 없어 화면만 늘린다.
  const allExt = (hireRaw && hireRaw.extFin) || [];
  const extRows = allExt.filter((x) => x.year).map((x) => {
    const yr = `${String(x.year).slice(2)}년 `;
    // 같은 해 영업이익보다 당기순이익이 훨씬 크면 그대로 믿기 어렵다. 영업외수익이 컸을 수도
    // 있지만, 채용사이트 표가 열이 어긋나 자본총계 같은 값을 순이익 칸에 넣은 경우도 많다.
    // 다산씨엔텍에서 영업이익 3억 · 당기순이익 20억으로 나왔다 — 어느 쪽인지는 결산서로만
    // 가린다. 값을 버리지 않고 확인하라고 적어 둔다.
    let odd = '';
    if (x.key === '당기순이익' && x.eok > 0) {
      const op = allExt.find((v) => v.key === '영업이익' && v.year === x.year);
      if (op && op.eok > 0 && x.eok > op.eok * 3) {
        odd = ` ⚠ 같은 해 영업이익 ${op.eok}억의 ${Math.round(x.eok / op.eok)}배입니다 — `
          + '영업외수익이 컸을 수도, 사이트 표의 열이 어긋나 다른 항목(자본총계 등)이 실렸을 수도 '
          + '있습니다. 손익계산서로 확인하세요.';
      }
    }
    const srcs = x.sources || [];
    const hosts = srcs.map((v) => v.host).join(' · ');
    // 여러 사이트가 같은 값을 말하면 근거가 강해지고, 갈리면 그 자체가 확인 대상이다
    const cross = srcs.length < 2
      ? `${hosts || '외부사이트'} 1곳 확인`
      : (x.agree
        ? `${srcs.length}개 사이트 값 일치(${hosts})`
        : `⚠ 사이트 간 값 불일치 — ${srcs.map((v) => `${v.host} ${v.eok}억`).join(' / ')}`);
    // 같은 해 공시값이 있으면 함께 대조한다 — 사이트 값이 얼마나 믿을 만한지 바로 보인다
    const OFF_KEY = { 매출액: 'revenue', 영업이익: 'operatingProfit', 자산총계: 'assets' };
    const offRow = x.year ? finance_history.find((r) => r.year === x.year && r.src === 'official') : null;
    const offVal = offRow && OFF_KEY[x.key] ? offRow[OFF_KEY[x.key]] : null;
    let vsOff = '';
    if (offVal != null) {
      const gap = Number(x.eok) - offVal;
      const pct = offVal ? Math.round(Math.abs(gap) / Math.abs(offVal) * 100) : null;
      vsOff = gap === 0
        ? ` 같은 해 공시값과 일치(${offVal}억).`
        : ` ⚠ 같은 해 공시값 ${offVal}억과 ${gap > 0 ? '+' : ''}${gap}억 차이${pct != null ? `(${pct}%)` : ''} — 산출 기준이 다를 수 있습니다.`;
    }
    return f(`${x.key} — ${yr}외부사이트자료`,
      `${Number(x.eok).toLocaleString()}억 원`, 'C',
      srcs.length > 1 ? `채용사이트 ${srcs.length}곳` : `${hosts} 기업정보`, x.year ? `${x.year}-12` : null,
      `★ ${cross}.${vsOff}${odd} 공시자료가 아니라 채용 사이트가 자체 수집·표기한 값입니다. `
      + '금융위 재무가 끊긴 이후를 가늠하는 참고치이며, 산출 기준과 시점이 공시와 다를 수 있습니다 — '
      + '방문 전 최근 결산서로 반드시 대조하세요.');
  });
  if (extRows.length) finance = [...finance, ...extRows];

  const all = [...basic, ...capacity, ...finance];
  const order = { A: 0, B: 1, C: 2, D: 3 };
  const gs = all.filter((x) => !x.data_gap).map((x) => order[x.grade]).sort((a, b) => a - b);
  const overall = gs.length ? ['A', 'B', 'C', 'D'][gs[Math.floor(gs.length / 2)]] : 'D';
  const crosscheck = all.filter((x) => x.data_gap || x.grade === 'C')
    .map((x) => ({ key: x.key, expected: x.value, verified: null, match: null, src_type: x.source }));

  // 📡 소스별 조회 상태 — 왜 비었는지 화면에서 바로 보이게 (모바일에선 hover 불가)
  // key: 제외 토글용 소스 키(없으면 항상 포함). part: res 응답 키.
  const stat = (key, part, label, okDetail, emptyDetail) => {
    const r = R[part];
    if (!r) return { key, name: label, ok: false, detail: '미호출' };
    if (!r.ok) return { key, name: label, ok: false, detail: r.err };
    return okDetail != null ? { key, name: label, ok: true, detail: okDetail } : { key, name: label, ok: false, detail: emptyDetail };
  };
  const hasCorp = !!(corp && (corp.crno || corp.bzno || corp.rep || corp.addr));
  const src_status = [
    hasCorp
      ? { name: '금융위 기업기본정보', ok: true, detail: `기준정보 확보 (${corp.crno || '법인번호 미상'})` }
      : { name: '금융위 기업기본정보', ok: false, warn: true, detail: '법인 미검색 — 개인사업자이거나 법인명 불일치(상호명으로 타 소스 조회)' },
    // 연결 실패 / 조회성공·데이터없음 을 명확히 구분
    { key: 'nts', name: '국세청 사업자상태', ok: !!bStt,
      detail: bStt ? `${bStt}${bTax ? ' · ' + bTax : ''}`
        : (!R.nts ? '자료 미제출/미등록' : (!R.nts.ok ? briefErr(R.nts.err) : '조회 성공 · 해당 사업자 정보 없음')) },
    // 최신 연도를 못 얻었을 때 '왜'인지(재조회 시도 결과) 함께 노출 — 데이터 없음 vs 호출 실패 구분
    (() => {
      const fd = R.finance && R.finance.ok && R.finance.data ? R.finance.data._diag : null;
      let why = '';
      if (fd && years.length && Number(String(today).slice(0, 4)) - years[years.length - 1] >= 3) {
        const bits = [];
        if (fd.probe) bits.push(fd.probe.err ? `연도지정 재조회 실패(${fd.probe.err})` : `연도지정 재조회 ${fd.probe.years[fd.probe.years.length - 1]}~${fd.probe.years[0]} → ${fd.probe.rows}건`);
        if (fd.acct) bits.push(fd.acct.err ? `계정과목 보완 실패(${fd.acct.err})` : `계정과목(재무상태표·손익계산서) 보완 → ${fd.acct.rows}건`);
        if (bits.length) why = ' · ' + bits.join(' · ');
      }
      return stat('finance', 'finance', '금융위 재무정보',
        years.length
          ? `${years.length}개년 (${years[0]}~${years[years.length - 1]})` +
            (Number(String(today).slice(0, 4)) - years[years.length - 1] >= 3 ? ' ⚠ 최신자료 아님' : '') + why
          : null,
        '미수록 — 금융위 API는 상장·공시대상 위주(비상장은 DART/신용조회 확인)');
    })(),
    stat('rpt', 'rpt', '식약처 기능성 보고품목', rl.length ? `${rl.length}건 (5년내 ${fresh.length})` : null,
      rlAll.length ? `상호 일치 0건 (API가 업체명 미필터로 전체 ${rlAll.length}건 반환 — 이 업체 품목 아님)` : '0건 — 기능성 미취급 또는 미신고'),
    stat('insure', 'insure', '고용·산재보험 (사업장·상시인원)', workforce ? `보험 사업장 ${workforce.sites.length}곳 · 상시 ${workforce.total}명` : null, '가입 사업장 0건'),
    stat('air', 'air', '대기배출시설 신고', airInfo ? (airInfo.rows.length ? `${airInfo.rows.length}건${airInfo.cur ? ` · 제조소 주소 ${airInfo.cur}건` : ''}` : '신고 없음(소규모 면제 가능)') : null, '조회 결과 없음'),
    stat('nps', 'nps', '국민연금 (참고)', npsAll.length ? `상호·앞 6자리 일치 사업장 ${npsAll.length}곳${npsConf.length ? ` · 주소/적용일 확인 ${npsConf.length}곳` : ' · 주소 대조 못 함'}${empVal != null ? ` · 가입자 ${empVal}명` : ''}` : null, npsData && npsData.searched ? `상호 검색 ${npsData.searched}건 중 일치 사업장 없음` : '사업장 검색 0건'),
    { key: 'maker', name: '식약처 화장품제조업', ok: !!mk, warn: !mk && !!(R.maker && R.maker.ok),
      detail: mk ? `제조업 등록 확인${mkRep ? ` · 대표 ${mkRep}` : ''}${mkAddr ? ` · ${mkAddr}` : ''}`
        : (!R.maker ? '자료 미제출/미등록' : (!R.maker.ok ? briefErr(R.maker.err)
          : (mkList.length ? `상호 일치 0건 (전체 ${mkList.length}건 중 미포함 — 제조업 미등록이거나 업소명 표기 상이)` : '등록 0건 — 책임판매업만 등록 가능성'))) },
    R.nedrug ? { key: 'nedrug', name: '의약품안전나라 업체정보', ok: !!ned, warn: !ned && !!R.nedrug.ok,
      detail: ned ? `제조소 ${nedSites.length}곳${mkNo ? ` · 업허가 ${mkNo}` : ''}${ned.permitDate ? ` · ${ned.permitDate} 허가` : ''}`
        : (!R.nedrug.ok ? briefErr(R.nedrug.err) : (R.nedrug.data && R.nedrug.data.rows && R.nedrug.data.rows.length
          ? `상호 일치 없음 (검색 ${R.nedrug.data.rows.length}건: ${R.nedrug.data.rows.slice(0, 3).join(', ')})` : '화장품제조업 검색 0건')) } : null,
    { key: 'factory', name: '산업단지공단 공장등록', ok: !!fctAddr, warn: !fctAddr && !!(R.factory && R.factory.ok),
      detail: fctAddr ? `공장 확인${fctEmpl ? ` · 종업원 ${fctEmpl}명` : ''}${fctProduct ? ' · ' + fctProduct : ''}`
        : (!R.factory ? '자료 미제출/미등록' : (!R.factory.ok ? briefErr(R.factory.err) : (fctList.length ? `${fctList.length}건 조회 · 상호 미일치` : '공장등록 0건(미등록/임대 가능)'))) },
    // GMP: API가 응답했으면 체크(✓), 미해당은 빨간색으로 표시
    (R.gmp && R.gmp.ok)
      ? { key: 'gmp', name: '식약처 GMP (CGMP)', ok: true, warn: !hasCgmp, detail: (hasCgmp ? 'CGMP 적합업소 명단 확인' : `미해당 — 적합업체 ${gmpList.length}곳 중 미등재(CGMP 미인증)`) + savedNote(R.gmp.data) }
      : stat('gmp', 'gmp', '식약처 GMP (CGMP)', null, 'GMP 목록 조회 실패'),
    (R.naverNews && R.naverNews.ok)
      ? { key: 'news', name: '네이버 뉴스검색', ok: !!news, warn: !news, detail: news ? `${news.length}건 관련기사` : `업체명 포함 기사 없음 (검색결과 ${newsItems.length}건 중)` }
      : stat('news', 'naverNews', '네이버 뉴스검색', null, '기사 없음 또는 프록시 미설정'),
    // 회수·판매중지: 조회 성공 시 이력 유무 표시(이력 있으면 warn=위험 신호), 실패 시 연결오류
    (R.recall && R.recall.ok)
      ? { key: 'recall', name: '식약처 회수·판매중지', ok: true, warn: recalls.length > 0,
          detail: (recalls.length ? `⚠ 회수·판매중지 이력 ${recalls.length}건`
            // '없음'과 '못 봤음'은 다르다. 전체 몇 건 중 몇 건을 훑었는지 밝힌다.
            : `조회 범위 내 이력 없음 (${recallTotal != null && recallTotal > recallListAll.length
                ? `전체 ${recallTotal}건 중 ${recallListAll.length}건 확인 — 나머지는 미조회`
                : `전체 ${recallListAll.length}건 확인`})`) + savedNote(R.recall.data) }
      : stat('recall', 'recall', '식약처 회수·판매중지', null, '회수정보 조회 실패'),
    R.kakao ? { name: '카카오 이동거리', ok: !!kkTravel, detail: kkTravel ? `${kkNavi ? '실측' : '좌표추정'} 약 ${kkTravel.km}km · ${Math.floor(kkTravel.min / 60)}시간 ${kkTravel.min % 60}분` : (R.kakao.err || '실패 — 추정치 대체') } : null,
    R.hiring ? (hiring && hiring.ok
      ? { key: 'hiring', name: '채용공고 추적', ok: true, warn: hiring.signals.some((x) => x.level === 'high'),
          // '1개년'만 적으면 10건이 모두 그 해인 것처럼 읽힌다 — 날짜가 확인된 건수를 밝힌다
          detail: `공고 ${hiring.posts.length}건 · 날짜확인 ${hiring.dated}건`
            + (hiring.undated ? `(미상 ${hiring.undated})` : '')
            + (hiring.signals.length ? ` · 신호 ${hiring.signals.length}건` : '')
            + ((hiring.extDiag || []).some((d) => !d.ok) ? ' · 일부 페이지 접속 실패' : '') }
      : { key: 'hiring', name: '채용공고 추적', ok: false, warn: false, detail: (hiring && hiring.reason) || '공고 없음' }) : null,
    R.oemTrace ? { key: 'oem', name: '웹 언급 추적', ok: oem_trace.length > 0, warn: false,
      detail: oem_trace.length
        ? (() => { const c = {}; oem_trace.forEach((o) => { c[o.tag] = (c[o.tag] || 0) + 1; }); return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(' · '); })()
        : '업체 언급 웹문서 없음' } : null,
    // 국세청 진위확인 — 3요소 대조 결과(상태조회와 별개 항목)
    (() => {
      if (!R.ntsVal) return null;
      if (!R.ntsVal.ok) return { key: 'ntsval', name: '국세청 진위확인', ok: false, warn: true, detail: briefErr(R.ntsVal.err) };
      const v = R.ntsVal.data;
      if (!v) return { key: 'ntsval', name: '국세청 진위확인', ok: false, warn: true, detail: '대조 3요소(사업자번호·대표자·개업일) 미확보' };
      if (!v.ok) return { key: 'ntsval', name: '국세청 진위확인', ok: false, warn: true, detail: briefErr(v.err) };
      // 불일치는 '경고'가 아니라 '대조 불가'로 표기 — 개업일을 못 구해 설립일로 대신한 구조적 한계
      return { key: 'ntsval', name: '국세청 진위확인', ok: v.valid, warn: false,
        detail: v.valid
          ? '사업자번호·대표자·개업일 일치'
          : '대조 불가 — 등록증상 개업일이 필요하나 법인 설립일로 조회(정상 업체도 불일치). 휴·폐업은 사업자상태 참고' };
    })(),
  ].filter(Boolean);

  const risk_flags = [];
  // 국세청 상태가 계속사업자가 아니면 최우선 경고
  if (bStt && bSttCd && bSttCd !== '01') {
    risk_flags.push({ type: `${bStt}`, detail: `국세청 사업자상태가 '${bStt}' — 정상 영업 여부 확인 필요. 거래 전 반드시 재확인` });
  }
  // 교차검증 자동진단 — 인력(연금 vs 공장)·주소(본점 vs 연금 vs 공장) 대조

  const workAddr = (hireRaw && hireRaw.workAddrs && hireRaw.workAddrs[0]) || null;
  const cross_diag = crossVerify({
    empNps: empVal, empFct: fctEmpl, addrHq: corp?.addr, addrNps: npsAddr, addrFct: fctAddr || mkAddr,
    addrWork: workAddr,
    repHq: repVal, repPublic: fctRep || pubBizFacts.rep,
    repPublicSrc: fctRep ? '산단공 공장등록' : '지자체 공장정보',
    repPublicLink: fctRep ? null : pubBizFacts.link,
    repCheck,
  });
  cross_diag.items.forEach((c) => {
    if (c.status !== 'warn') return;
    if (c.label === '주소 정합성') risk_flags.push({ type: '주소 상이', detail: `${c.detail}` });
    if (c.label === '인력 정합성' && c.severe) risk_flags.push({ type: '인력 불일치', detail: `${c.detail}` });
    if (c.label === '대표자 정합성') risk_flags.push({ type: '대표자 표기 상이', detail: `${c.detail}` });
  });
  // 재무 건전성 — 위험 등급이면 리스크로 승격
  // 재무 건전성은 공시 연도로만 판정한다.
  // 외부사이트 연도는 매출만 있고 부채·자본이 비어 있어, 그대로 넣으면 부채비율이 '—'가 되고
  // 그 상태로 '양호'라는 결론이 나온다(한웅메디칼: 2026년 기준 debtRatio null · '양호').
  const finance_health = assessFinance(finance_history.filter((r) => r.src !== 'ext'));
  if (finance_health && finance_health.level === '위험') {
    risk_flags.push({ type: '재무 위험', detail: `${finance_health.year}년 재무: ${finance_health.reasons.join(' · ')} — 거래 전 신용조회·선급금·담보 검토 권장` });
  }
  // 회수·판매중지 이력 — 최우선 품질/안전 리스크
  if (recalls.length) {
    const latest = recalls[0];
    const bits = [latest.date, latest.product, latest.reason].filter(Boolean).join(' · ');
    const sev = recalls.filter((r) => r.severe);
    risk_flags.push({ type: '회수·판매중지',
      detail: `회수·판매중지 이력 ${recalls.length}건${sev.length ? ` (그중 중대 ${sev.length}건)` : ''} (최근: ${bits || '상세 확인'}) — 품질·안전 사고 이력. 거래 전 반드시 원인·재발방지 확인` });
    // 이물·미생물·기준 초과는 표시기재 오류와 급이 다르다 — 위탁 제조에서는 치명적이다
    if (sev.length) {
      risk_flags.push({ type: '중대 품질사고',
        detail: `이물·미생물·기준초과 등 중대 사유 회수가 ${sev.length}건 있습니다 (${sev.slice(0, 2).map((r) => [r.grade, r.reason].filter(Boolean).join(' ')).join(' / ')}) `
          + `— 표시기재 오류와 달리 제조공정·위생관리 실패입니다. 시정조치 결과와 재발방지 대책 문서를 요구하세요` });
    }
  }
  // 기능성 신고가 끊겼거나 급감 — 재무제표보다 먼저 움직이는 신호다
  if (yearStat.trend === 'stopped') {
    risk_flags.push({ type: '생산 활동 중단 의심',
      detail: `최근 2년간 기능성 보고가 0건입니다 (이전 ${yearStat.early}건). 기능성 라인이 멈췄거나 업체명이 바뀌었을 수 있습니다 — 현재 가동 품목과 최근 납품 실적을 확인하세요` });
  } else if (yearStat.trend === 'down') {
    risk_flags.push({ type: '생산 활동 감소',
      detail: `기능성 보고가 최근 2년 ${yearStat.late}건으로 직전 2년(${yearStat.early}건) 대비 절반 아래입니다 — 수주 감소·라인 축소 여부를 확인하세요` });
  }
  // 허가일과 설립일이 크게 벌어지면 업종을 바꿔 들어온 것이다
  if (mkDate && corp && corp.estbDt) {
    const yGap = Number(String(mkDate).slice(0, 4)) - Number(String(corp.estbDt).replace(/\D/g, '').slice(0, 4));
    if (isFinite(yGap) && yGap >= 5) {
      risk_flags.push({ type: '화장품 업력 짧음',
        detail: `설립 ${String(corp.estbDt).replace(/\D/g, '').slice(0, 4)}년, 화장품 제조업 허가 ${String(mkDate).slice(0, 4)}년 — ${yGap}년 차이입니다. `
          + `다른 업종을 하다 화장품에 진입한 경우로, 화장품 업력은 ${new Date().getFullYear() - Number(String(mkDate).slice(0, 4))}년입니다. 기존 거래처와 생산 경험을 확인하세요` });
    }
  }

  const reportOut = {
    meta: {
      vendor_name: name, vendor_id: name.replace(/[^\w가-힣]/g, '_'), query_at: new Date().toISOString(),
      version: 1, overall_grade: overall, data_grade: overall, sources_used: [...new Set(all.filter((x) => !x.data_gap).map((x) => x.source))],
      bld: R.bld ? (R.bld.ok ? R.bld.data : { err: R.bld.err, queried: R.bld.queried }) : null,
      site: R.site && R.site.ok ? R.site.data : null,          // 실제 공장 소재지 선정 결과(후보·근거)
      mfds_sites: nedSites.length ? nedSites : null,
      cgmp_news: cgmpNews.length ? cgmpNews : null,            // CGMP 인증 기사(이른 순) — 연혁의 취득 시점            // 의약품안전나라 등록 제조소(공장 면적 탭 합산용)
      lookup: (corp && corp._lookup) || null,                   // 어떤 입력으로, 무엇을 근거로 이 업체를 조회했는지
      workforce,                                                // 고용·산재보험 사업장별 인원·역할
      // 인력 표에 함께 싣는 참고값 — 국민연금 월별 추이, 공장등록 신고 종업원수
      manpower: {
        nps: empVal != null ? Number(empVal) : null, npsBasis, npsWhy, npsSiteN: npsAll.length, npsAddr: npsAddr || null, npsYm,
        trend: (npsData && npsData.trend) || null, trendSite: (npsData && npsData.trendSite) || null,
        fctEmpl: fctEmpl != null && fctEmpl !== '' ? Number(fctEmpl) : null, fctRegDe: fctRegDe || null,
      },
      air: airInfo,                                             // 대기배출시설 신고(제조소 주소 대조)
      max_age_years: 5, live: true, src_status, factory_homepage: fctHmpadr || null,
      no_corp: !hasCorp, // 금융위 법인 미검색(개인사업자·법인명 불일치) → 상호명 기반 조회 안내용
      // 길찾기(카카오·티맵) 연동용 — 기준점(한국콜마)→방문지
      ref_point: { name: REF_POINT.name, addr: REF_POINT.addr, lat: REF_POINT.lat, lng: REF_POINT.lng },
      visit_addr: (kkTravel && kkTravel.destAddr) || fctAddr || corp?.addr || npsAddr || null,
      visit_coord: (kkTravel && kkTravel.dest && isFinite(kkTravel.dest.lat) && isFinite(kkTravel.dest.lng)) ? { lat: kkTravel.dest.lat, lng: kkTravel.dest.lng } : null,
    },
    basic, capacity, finance, finance_history, finance_health, cross_diag, recalls, oem_trace, crosscheck, risk_flags, diff_from_prev: [],
    news, insights,
    // 관련성 검증에서 걸러낸 뉴스·웹 언급(사유 포함)과 판정에 쓴 근거 — 화면에서 접어 보여 준다
    rel_check: { excluded: rel_excluded.slice(0, 40), regions: relCtx.regions, rep: !!relCtx.rep, bzno: !!relCtx.bzno },
    homepage: R.homepage && R.homepage.ok ? R.homepage.data : null,
    // 채용공고 추적 — 수집은 조회 단계에서, 판정은 재직자수가 확정된 여기서
    hiring,
  };
  // 종합판정 — 공식 자료로 확인된 사실 기준(app.js qualityGrade). 예전 방식(신뢰도 가운데 값)은 data_grade로 남긴다
  if (typeof qualityGrade === 'function') reportOut.meta.overall_grade = qualityGrade(reportOut).grade;
  return reportOut;
}

window.VENDOR_SAMPLES = { '리니어코스메틱': linear, '샘플뷰티랩': beautylab };
window.VENDOR_SAMPLE_LIST = [linear, beautylab];
window.generateReport = generateReport;
window.mapMfdsReport = mapMfdsReport;
window.mapCorpCandidates = mapCorpCandidates;
window.assembleLiveReport = assembleLiveReport;
