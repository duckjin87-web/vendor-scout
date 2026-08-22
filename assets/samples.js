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
function crossVerify(ctx) {
  const { empNps, empFct, addrHq, addrNps, addrFct } = ctx;
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
  const addrs = [['본점(등기)', addrHq], ['연금 사업장', addrNps], ['공장 소재지', addrFct]].filter(([, v]) => v);
  if (addrs.length >= 2) {
    const uniq = [...new Set(addrs.map(([, v]) => shortA(v)))];
    if (uniq.length === 1) items.push({ label: '주소 정합성', status: 'match', detail: `${addrs.map(([l]) => l).join(' · ')} 동일 권역 — 등기·근무·생산지 일치` });
    else items.push({ label: '주소 정합성', status: 'warn', detail: `${addrs.map(([l, v]) => `${l} ${v}`).join(' / ')} — 소재지 상이. 실제 생산현장(공장/연금 사업장) 기준으로 방문` });
  } else {
    items.push({ label: '주소 정합성', status: 'na', detail: '대조할 주소 2건 미만 (일부 출처 미확보)' });
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
function findBzno(rec) {
  if (!rec) return null;
  const dash = /(\d{3})-?(\d{2})-?(\d{5})/;
  // 1) 키에 사업자번호 힌트가 있는 필드 우선
  for (const [k, v] of Object.entries(rec)) {
    if (!/사업자|BIZR|BZNO|BSNM|CORP_?NO|business|regist.*no/i.test(k)) continue;
    const m = String(v == null ? '' : v).match(dash);
    if (m) return m[1] + m[2] + m[3];
  }
  // 2) 값에서 사업자번호 형식(###-##-#####) 스캔 — 대시 있는 경우만(전화·허가번호 오탐 방지)
  for (const v of Object.values(rec)) {
    const s = String(v == null ? '' : v);
    if (/\d{3}-\d{2}-\d{5}/.test(s)) { const m = s.match(dash); if (m) return m[1] + m[2] + m[3]; }
  }
  return null;
}

// 목록 응답에서 상호가 포함된 레코드 찾기(필드명이 API마다 달라 전체 값 스캔). stripCorp는 런타임(app.js) 전역.
function matchByName(name, list) {
  const key = stripCorp(name).replace(/\s/g, '');
  if (key.length < 2 || !Array.isArray(list)) return null;
  return list.find((it) => Object.values(it).some((v) => {
    const gn = stripCorp(String(v == null ? '' : v)).replace(/\s/g, '');
    return gn.length >= 3 && gn.includes(key);
  })) || null;
}


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
  return `약 ${est.km}km · 차량 ${h?h+'시간 ':''}${m}분`;
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

// 선택된 업체 기준정보 + 재무/식약처/국민연금 응답 → 전체 리포트 조립 (실데이터 + 진단)
// res = { finance:{ok,data|err}, rpt:{ok,...}, nps:{ok,...} }
function assembleLiveReport(name, corp, res) {
  const today = '2026-07-07';
  const R = res || {};
  // 장황한 상류 오류를 짧은 사유로 정규화 — "조회불가"/"자료 미제출" 등 간략 표기(사용자 요청)
  const briefErr = (msg) => {
    const m = String(msg || '');
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
  const mk = matchByName(name, mkList);
  const mkNo = mk ? (mk.LCNS_NO ?? mk.lcnsNo ?? mk.MAKER_REG_NO ?? mk.PRMISN_NO ?? mk.prmisnNo ?? null) : null;

  // 국세청 사업자상태 (odcloud: {data:[{b_stt, tax_type, ...}]})
  const ntsItem = R.nts && R.nts.ok && R.nts.data && Array.isArray(R.nts.data.data) ? R.nts.data.data[0] : null;
  const bStt = ntsItem ? (ntsItem.b_stt || null) : null;            // 계속사업자 / 휴업자 / 폐업자
  const bSttCd = ntsItem ? (ntsItem.b_stt_cd || null) : null;       // 01 계속 / 02 휴업 / 03 폐업
  const bTax = ntsItem ? (ntsItem.tax_type || null) : null;
  // 국세청이 상태를 확인해준 사업자번호 = 실제 활성 번호(대표값으로 우선)
  const ntsBno = (ntsItem && bStt && ntsItem.b_no) ? String(ntsItem.b_no).replace(/\D/g, '') : null;

  // 산단공 공장등록(생산)정보 — 회사명 검색 결과에서 상호 일치 건
  const fctList = R.factory && R.factory.ok ? listOf(R.factory.data, ['response.body.items.item', 'body.items', 'items']) : [];
  // ★ fctList[0] 폴백 금지: 산단공 공장 API도 상호 필터링이 불완전 → 첫 레코드가 '남의 공장'일 수 있음.
  //   단건이면 그대로(회사명 검색이 1건만 준 경우), 여러 건이면 상호 일치 건만 채택.
  const fctHit = matchByName(name, fctList) || (fctList.length === 1 ? fctList[0] : null);
  // 주소 필드명이 API마다 달라 명시 후보 → 실패 시 값 스캔(한글 주소 패턴)
  const looksAddr = (v) => /[가-힣]{2,}(시|군|구|읍|면)\s|[가-힣]+(로|길)\s?\d/.test(String(v || ''));
  const fctAddr = fctHit ? (
    fctHit.rnAdres ?? fctHit.lnmAdres ?? fctHit.lotNoAddr ?? fctHit.roadNmAddr ?? fctHit.adres ?? fctHit.ADRES ?? fctHit.fctryAddr ?? fctHit.lctnAddr ?? fctHit.addr ??
    Object.values(fctHit).find(looksAddr) ?? null) : null;
  const fctProduct = fctHit ? (fctHit.mainProductCn ?? fctHit.prdlstNm ?? fctHit.prductNm ?? fctHit.MAIN_PRDLST ?? null) : null;
  const fctInduty = fctHit ? (fctHit.indutyNm ?? null) : null;
  const fctEmpl = fctHit ? (fctHit.allEmplyCo ?? fctHit.emplyCo ?? null) : null; // 공장등록 종업원수
  // 홈페이지는 여러 공장 레코드 중 등재된 것을 채택(첫 매칭에 없을 수 있음)
  const fctHmpadr = (fctList.find((it) => /^https?:\/\//i.test(String(it.hmpadr || ''))) || {}).hmpadr || null;
  const fctRegDe = fctHit ? fmtDate(fctHit.frstFctryRegistDe) : null;
  const fctNote = fctAddr ? ['★ 실제 공장 주소', fctProduct ? `생산: ${fctProduct}` : null, fctInduty || null, fctRegDe ? `등록 ${fctRegDe}` : null].filter(Boolean).join(' · ')
    : why('factory', '공장등록 조회 결과 없음 — 미등록 공장(임대/소규모) 또는 상호 불일치');

  // 식약처 제조업 허가 레코드에서 대표자·소재지 추출 — 금융위 법인 미확보 시 이 값으로 보강
  const mkRep = mk ? (mk.PRSNL_NM ?? mk.RPRSNTV ?? mk.prsdntNm ?? mk.reprsntvNm ?? mk.repNm ??
    ((Object.entries(mk).find(([k, v]) => /대표|PRSNL|RPRSNTV|PRSDNT|REPRE/i.test(k) && v) || [])[1]) ?? null) : null;
  const mkAddr = mk ? (mk.ADDR ?? mk.SITE_ADDR ?? mk.LOCP_ADDR ?? mk.locplc ?? mk.소재지 ??
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

  // 금융위 법인 미확보 시 보강: 식약처/공장 레코드 → 외부 집계 사이트(비공식) 순
  const agg = R.bizAgg && R.bizAgg.ok && R.bizAgg.data ? R.bizAgg.data : null;
  const aggSrc = agg ? `외부 집계(${agg.host})` : '외부 집계';
  const recBzno = corp?.bzno ? null : (findBzno(mk) || findBzno(fctHit));
  // 우선순위: 금융위 > 국세청 확인번호(활성) > 식약처/공장 추출 > 집계
  const bznoVal = corp?.bzno || ntsBno || recBzno || (agg && agg.bzno) || null;
  const bznoSrc = corp?.bzno ? '금융위 기업기본정보' : (ntsBno ? '국세청 확인' : (recBzno ? '식약처/공장등록' : ((agg && agg.bzno) ? aggSrc : '금융위 기업기본정보')));
  const bznoNote = corp?.bzno ? null : (ntsBno ? '국세청 사업자상태로 확인된 활성 사업자번호' : (recBzno ? '식약처/공장 레코드 추출' : ((agg && agg.bzno) ? '외부 집계 사이트 참고(비공식·국세청 원본 확인 권장)' : '법인 미검색으로 미확보')));
  const repVal = corp?.rep || mkRep || (agg && agg.rep) || null;
  const repSrc = corp?.rep ? '금융위 기업기본정보' : (mkRep ? '식약처 화장품제조업 API' : ((agg && agg.rep) ? aggSrc : '식약처 화장품제조업 API'));
  const repNote = corp?.rep ? null : (mkRep ? '식약처 제조업 허가상 대표자 (금융위 법인 미확보 보강)' : ((agg && agg.rep) ? '외부 집계 사이트 참고(비공식)' : why('maker', '대표자 정보 없음')));
  const mkRegDate = mkRegDt ? fmtDate(mkRegDt) : null;
  const estbVal = fmtDate(corp?.estbDt) || (agg && agg.opneDe) || mkRegDate || null;
  const estbSrc = corp?.estbDt ? '금융위 기업기본정보' : ((agg && agg.opneDe) ? aggSrc + ' 개업일' : (mkRegDate ? '식약처 화장품제조업 API' : '금융위 기업기본정보'));
  const estbNote = corp?.estbDt ? null : ((agg && agg.opneDe) ? '외부 집계 사이트상 개업일(비공식)' : (mkRegDate ? '★ 식약처 제조업 등록(허가)일 — 법인 설립일과 다를 수 있음' : null));
  const bSttVal = bStt || (agg && agg.status) || null;

  const basic = [
    f('법인등록번호', corp?.crno || null, 'A', '금융위 기업기본정보', today),
    f('사업자등록번호', bznoVal, bznoVal ? (corp?.bzno ? 'A' : 'B') : 'D', bznoSrc, bznoVal ? today : null, bznoNote),
    f('사업자 상태', bSttVal, bSttVal ? (bStt ? 'A' : 'C') : 'D', bStt ? '국세청 사업자상태' : (agg && agg.status ? aggSrc : '국세청 사업자상태'), bSttVal ? today : null,
      bStt ? (bTax || null) : (agg && agg.status ? '외부 집계 사이트 참고(비공식·국세청 원본 확인 권장)' : why('nts', '국세청 상태 조회 실패 — 사업자번호/승인 확인'))),
    f('대표자', repVal, repVal ? (corp?.rep ? 'A' : 'B') : 'D', repSrc, repVal ? today : null, repNote),
    f('설립일 / 등록일', estbVal, estbVal ? (corp?.estbDt ? 'A' : 'C') : 'D', estbSrc, estbVal || null, estbNote),
    f('본점주소', corp?.addr || null, 'A', '금융위 기업기본정보', today),
    f('제조업 등록', mk ? `등록${mkNo ? ` (허가 ${mkNo})` : ''}` : null, mk ? 'A' : 'D', '식약처 화장품제조업 API', mk ? today : null,
      mk ? ([mkRep ? `대표 ${mkRep}` : null, mkAddr ? `소재지 ${mkAddr}` : null].filter(Boolean).join(' · ') || '화장품 제조업 등록 확인') : why('maker', '제조업 등록 결과 없음 — 책임판매업만 등록(OEM 위탁) 가능성')),
    f('공장/제조소 소재지', fctAddr || mkAddr || null, (fctAddr || mkAddr) ? 'A' : 'D',
      fctAddr ? '산업단지공단 공장등록' : (mkAddr ? '식약처 화장품제조업 API' : '산업단지공단 공장등록'),
      (fctAddr || mkAddr) ? today : null,
      fctAddr ? fctNote : (mkAddr ? '식약처 제조업 허가상 제조소 소재지 (산단공 공장등록 없음)' : fctNote)),
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

  // 업종은 식약처 등록 사실 기준으로 정확히(집계 페이지 자유텍스트 오추출 방지). 연락처는 집계 참고.
  if (mk) basic.push(f('업종', '화장품 제조업', 'A', '식약처 화장품제조업 API', today, '식약처 화장품제조업 등록 기준'));
  if (agg && agg.tel) basic.push(f('대표 연락처', agg.tel, 'C', aggSrc, today, '외부 집계 사이트 참고(비공식) — 방문 전 확인'));

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

  // 국민연금 (nps) — {search, detail, count} 형태 (검색→상세 2단계)
  const npsData = R.nps && R.nps.ok ? R.nps.data : null;
  const nps = npsData ? npsData.search : null;
  const npsDet = npsData ? npsData.detail : null;
  // V2 JSON 필드: 가입자수=jnngpCnt(상세), 도로명주소=wkplRoadNmDetAddr, 법정동=ldongAddrMgpldongNm
  // total = 동일 사업자번호의 전 사업장 가입자 합산(대기업 본사·공장 분리등록 대응)
  const npsTotal = npsData ? npsData.total : null;
  const npsSites = npsData ? (npsData.sites || 0) : 0;
  const empRawSingle = (npsDet && (npsDet.jnngpCnt ?? npsDet.subscrCnt)) ?? (nps && (nps.jnngpCnt ?? nps.subscrCnt)) ?? null;
  const empVal = (npsTotal != null && npsTotal !== '') ? npsTotal : ((empRawSingle != null && empRawSingle !== '') ? empRawSingle : null);
  const pick = (o, ...ks) => { if (!o) return null; for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return null; };
  const npsAddr = pick(nps, 'wkplRoadNmDetAddr', 'wkplRoadNmDtlAddr', 'ldongAddrMgpldongNm', 'ldongAddr')
    || pick(npsDet, 'wkplRoadNmDetAddr', 'wkplRoadNmDtlAddr', 'ldongAddrMgpldongNm') || null;
  // 국민연금 자료 기준년월(dataCrtYm, YYYYMM) → 갱신일 표기
  const npsYmRaw = pick(npsDet, 'dataCrtYm') || pick(nps, 'dataCrtYm');
  const npsYm = npsYmRaw ? String(npsYmRaw).replace(/^(\d{4})(\d{2}).*$/, '$1.$2') : null;

  // 식약처 GMP 적합업소 (CGMP 등록여부) — 적합업체 전체목록에서 상호로 필터
  // 업체명 필드 키가 API마다 달라(BSSH_NM/CMPNY_NM/…) 모든 필드값을 훑어 상호 포함 여부로 매칭
  const gmpList = R.gmp && R.gmp.ok ? listOf(R.gmp.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const gmpHit = matchByName(name, gmpList);
  const hasCgmp = !!gmpHit;

  // 카카오 이동거리 {km, min, method} — navi=모빌리티 실측 / coord=카카오맵 좌표추정
  const kkTravel = R.kakao && R.kakao.ok ? R.kakao.data : null;
  const kkNavi = kkTravel && kkTravel.method === 'navi';

  // 네이버 뉴스 (최근 기사) — 제목/본문에 업체명이 실제 포함된 관련 기사만 채택
  const newsRaw = R.naverNews && R.naverNews.ok ? R.naverNews.data : null;
  const newsItems = newsRaw && newsRaw.items ? newsRaw.items : [];
  const newsKey = stripCorp(name).replace(/\s/g, '');
  const relevantNews = newsKey.length >= 2 ? newsItems.filter((n) => {
    const t = (String(n.title || '') + ' ' + String(n.description || '')).replace(/<\/?b>/g, '').replace(/\s/g, '');
    return t.includes(newsKey);
  }) : [];
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
  const relForInsight = newsKey.length >= 2 ? newsItems.filter((n) => {
    const t = (String(n.title || '') + ' ' + String(n.description || '')).replace(/<\/?b>/g, '').replace(/\s/g, '');
    return t.includes(newsKey);
  }) : [];
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
      desc: String(n.description || '').replace(/<\/?b>/g, '').slice(0, 140),
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
  const oemKey = stripCorp(name).replace(/\s/g, '');
  const MFG = /(제조원|제조사|OEM|ODM|생산|납품)/i;
  const oemTag = (host, txt) => /saramin|jobkorea|wanted|incruit|jobplanet|catch\.co|albamon/i.test(host) ? '채용'
    : /happycampus|nice|kisline|kportal|cretop|kised|creditn|report|기업보고서|신용/i.test(host + txt) ? '기업보고서'
    : /제조원|OEM|ODM|납품/i.test(txt) ? '제조원/납품' : '언급';
  const oem_trace = oemKey.length >= 2 ? oemItems.filter((it) => {
    const t = (String(it.title || '') + ' ' + String(it.description || '')).replace(/<\/?b>/g, '');
    return t.replace(/\s/g, '').includes(oemKey) && MFG.test(t);
  }).slice(0, 6).map((it) => {
    let host = ''; try { host = new URL(it.link).hostname; } catch { /* ignore */ }
    const title = String(it.title || '').replace(/<\/?b>/g, '');
    const desc = String(it.description || '').replace(/<\/?b>/g, '').slice(0, 120);
    return { title, link: it.link || '', desc, tag: oemTag(host, title + ' ' + desc) };
  }) : [];

  // 식약처 화장품 회수·판매중지 — 목록에서 업체명 일치 건. 응답 필드명 확정 전이라 값 스캔으로 견고하게 추출.
  const recallListAll = R.recall && R.recall.ok ? listOf(R.recall.data, ['response.body.items.item', 'body.items', 'items']) : [];
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
    return { product: product || null, reason: reason || null, date: fmtDate(date) || date || null };
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const capacity = [
    f('재직자수 (국민연금 가입자)',
      empVal != null ? `${empVal}명${npsSites > 1 ? ` (${npsSites}개 사업장 합산)` : ''}${npsYm ? ` · ${npsYm} 기준` : ''}` : null,
      empVal != null ? 'B' : 'D', '국민연금 사업장 API',
      empVal != null ? (npsYmRaw ? String(npsYmRaw).replace(/^(\d{4})(\d{2}).*$/, '$1-$2') : today) : null,
      empVal != null
        ? (npsSites > 1
            ? `★ 동일 사업자번호의 ${npsSites}개 국민연금 사업장(본사·공장 등) 가입자 합산 — 4대보험 재직자(월 갱신). 파견·일용·프리랜서 미포함`
            : '★ 현재 인원에 가장 근접 — 4대보험 가입 재직자(월 갱신). 사업장 단위 신고이며 파견·일용·프리랜서 미포함')
        : why('nps', '국민연금 사업장 결과 없음(상호 불일치 가능)')),
    f('공장 종업원수', fctEmpl != null && fctEmpl !== '' ? `${fctEmpl}명${fctRegDe ? ` (${fctRegDe} 등록)` : ''}` : null, fctEmpl ? 'A' : 'D', '산업단지공단 공장등록', fctEmpl ? (fctRegDe || today) : null, fctEmpl ? '공장등록증 신고값(등록·변경 시점 스냅샷 — 오래될 수 있음). 국민연금 재직자수와 대조용' : why('factory', '공장등록 없음')),
    f('사업장 주소 (연금기준)', npsAddr, 'B', '국민연금 사업장 API', npsAddr ? today : null, npsAddr ? '식약처 제조소 주소와 대조용' : why('nps', '국민연금 결과 없음')),
    // ★ 월 갱신 지표 — 재무가 오래된 업체에서 '현재 상태'를 보여주는 가장 최신 근거
    (() => {
      const nw = npsData ? Number(npsData.newCnt || 0) : 0;
      const ls = npsData ? Number(npsData.lostCnt || 0) : 0;
      // 0(그 달 변동 없음)과 필드 미확보를 구분 — 0을 공백으로 처리하면 '변동 없음'이 사라진다
      const has = !!(npsData && npsData.churnKnown);
      const net = nw - ls;
      const val = has ? `+${nw} / -${ls} (순 ${net >= 0 ? '+' : ''}${net}명)` : null;
      return f('최근 인력 증감 (연금 취득·상실)', val, has ? 'B' : 'D', '국민연금 사업장 API',
        has ? (npsYmRaw ? String(npsYmRaw).replace(/^(\d{4})(\d{2}).*$/, '$1-$2') : today) : null,
        has
          ? `해당 월 신규취득 ${nw}명 · 상실 ${ls}명 — ${net > 0 ? '증원(채용 진행) 신호' : net < 0 ? '감소(이탈·감원) 신호 — 사유 확인 권장' : '변동 없음'}. 월 단위로 갱신되는 최신 지표`
          : ((npsData && npsData.numKeys)
              ? `취득·상실 필드를 응답에서 찾지 못했습니다 (응답 내 수치 항목: ${npsData.numKeys})`
              : why('nps', '취득·상실 자료 없음')));
    })(),
    (() => {
      const amt = npsData ? Number(npsData.payrollEst || 0) : 0;
      const eok = amt > 0 ? (amt / 1e8) : 0;
      const val = amt > 0 ? (eok >= 1 ? `월 약 ${eok.toFixed(1)}억 원 이상` : `월 약 ${Math.round(amt / 1e4).toLocaleString()}만 원 이상`) : null;
      return f('추정 인건비 규모 (연금 고지액 기준)', val, amt > 0 ? 'C' : 'D', '국민연금 사업장 API',
        amt > 0 ? (npsYmRaw ? String(npsYmRaw).replace(/^(\d{4})(\d{2}).*$/, '$1-$2') : today) : null,
        amt > 0
          ? '★ 당월 연금 고지금액 ÷ 보험료율 9% = 기준소득월액 합계(하한 추정). 기준소득월액에 상한·하한이 있어 고소득자는 과소 반영되므로 실제 인건비는 이보다 큽니다. 재무가 오래된 업체의 현재 규모 가늠용'
          : why('nps', '고지금액 자료 없음'));
    })(),
    f('방문 이동거리',
      kkTravel ? travelText(kkTravel) : travelText(estimateTravel(fctAddr || corp?.addr || npsAddr)),
      kkNavi ? 'B' : 'C',
      kkNavi ? '카카오내비 길찾기 (실측)' : (kkTravel ? '카카오맵 좌표 기반 추정' : '좌표 추정 (지역중심)'),
      today,
      kkNavi ? '한국콜마 기준 실제 도로 경로 거리·소요시간'
        : (kkTravel ? '정확 좌표 직선거리×도로계수 추정 — 실측은 카카오내비(모빌리티) 신청 시 자동 전환'
        : '지역 중심점 직선거리 추정 — 카카오맵 버튼으로 재확인')),
    f('기능성 보고품목 수', rl.length || null, rl.length ? (fresh.length ? 'A' : 'C') : 'D', '식약처 보고품목 API', rl.length ? today : null,
      rl.length ? `전체 ${rl.length}건 · 최근 5년 ${fresh.length}건${fresh.length ? '' : ' — 최근 신고 없음(과거 이력)'}` : why('rpt', rptEmpty)),
    f('신고 제형 분포', allForms.length ? allForms.join(', ') : null, 'C', '식약처 보고품목 API', allForms.length ? today : null, allForms.length ? 'CAPA 직접 데이터 아님 — 실사 확인' : why('rpt', rptEmpty)),
    f('CGMP 적합업소', hasCgmp ? '적합 (식약처 GMP 등재)' : null, hasCgmp ? 'A' : 'D', '식약처 GMP API', hasCgmp ? today : null, hasCgmp ? 'CGMP 적합업소 — ISO/할랄/비건은 공개 API 없어 방문 시 인증서 확인' : why('gmp', 'CGMP 미등재 — 그 외 인증은 공개 API 없음(방문 확인)')),
  ];

  // 재무 — 연도별 '가장 완전한' 레코드 채택(같은 해 별도/연결 복수 제출 대비) 후 최신 5개년
  const flAll = R.finance && R.finance.ok ? listOf(R.finance.data, ['response.body.items.item', 'body.items']) : [];
  const byYear = new Map();
  const finScore = (r) => (r.enpSaleAmt ? 1 : 0) + (r.enpTastAmt ? 1 : 0) + (r.enpCptlAmt ? 1 : 0) + (r.enpBzopPft ? 1 : 0);
  flAll.forEach((it) => {
    const y = Number(it.bizYear || it.biz_year); if (!y) return;
    const prev = byYear.get(y);
    if (!prev || finScore(it) > finScore(prev)) byYear.set(y, it); // 매출·자산 등 값이 더 채워진 레코드 우선
  });
  // 최신 6개년까지 표시(연도 누락이 있는 업체도 흐름이 보이도록)
  const years = [...byYear.keys()].sort((a, b) => b - a).slice(0, 6).sort((a, b) => a - b);
  let finance, finance_history = [];
  if (years.length) {
    finance_history = years.map((y) => { const it = byYear.get(y); return { year: y, revenue: won2eok(it.enpSaleAmt), operatingProfit: won2eok(it.enpBzopPft), assets: won2eok(it.enpTastAmt), debt: won2eok(it.enpTdbtAmt), capital: won2eok(it.enpCptlAmt) }; });
    const L = finance_history[finance_history.length - 1];
    const eok = (v) => (v != null ? `${v}억 원` : null);
    // ★ 재무는 회계연도 기준 — as_of를 '조회일'이 아니라 '해당 회계연도'로(옛 자료가 최신처럼 보이는 문제 방지).
    //   재무는 통상 1년 지연 → 최신연도가 (조회연도-2)보다 오래되면 'stale'로 표기하고 등급 강등.
    const curYear = Number(String(today).slice(0, 4)) || 2026;
    const lag = curYear - L.year;
    const stale = lag >= 3;
    const asOf = `${L.year}-12`;
    const grade = stale ? 'C' : 'A';
    // 요약재무제표에 없어 계정과목(재무상태표·손익계산서)에서 보완한 연도는 출처를 구분 표기
    const viaAccounts = !!(byYear.get(L.year) || {})._fromAccounts;
    const src = `금융위 재무정보 API (${L.year} 회계연도${viaAccounts ? ' · 계정과목 보완' : ''})`;
    // 계열이 끊겼거나 중간에 빠진 해가 있으면 그 사유를 추정해 덧붙인다
    // (끊긴 사실만 보이면 폐업·부실로 오해하기 쉬움 — financeBreakNote 주석 참고)
    const breakNote = financeBreakNote(finance_history, curYear, empVal, bSttVal);
    const baseNote = (stale
      ? `★ 금융위(DART 공시 기반) API가 제공하는 가장 최신 회계연도는 ${L.year}년입니다(약 ${lag}년 전). ` +
        `이 API는 상장·외부감사 공시분만 수록해 최근 자료가 없을 수 있습니다 — ` +
        `NICE·KED 등 신용조회에는 더 최근 재무가 있을 수 있으니 방문 전 최근 결산서를 요청하세요.`
      : `★ ${L.year} 회계연도 확정 실적(금융위 제출 최신). 재무는 통상 1년 지연 공시.`)
      + (breakNote ? ` ${breakNote}` : '');
    finance = [
      f('매출액', eok(L.revenue), grade, src, asOf, baseNote, !stale),
      f('영업이익', eok(L.operatingProfit), grade, src, asOf, null, !stale),
      f('총자산', eok(L.assets), grade, src, asOf, null, !stale),
      f('총부채', eok(L.debt), grade, src, asOf, null, !stale),
      f('자본금', eok(L.capital), grade, src, asOf, null, !stale),
    ];
  } else {
    finance = ['매출액', '영업이익', '총자산', '총부채', '자본금'].map((k) =>
      f(k, null, 'D', '금융위 재무정보 API', null, why('finance', '금융위 재무 API 미수록 — 상장·공시대상 위주(비상장은 DART/신용조회로 확인)')));
  }

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
    stat('nps', 'nps', '국민연금 (재직자수)', (npsData && npsData.count) ? `사업장 ${npsData.count}곳${npsSites > 1 ? `(${npsSites}곳 합산)` : ''}${empVal != null ? ` · 가입자 ${empVal}명` : ' · 가입자수 상세조회 실패'}` : null, '사업장 검색 0건 — 상호 표기 차이 가능'),
    { key: 'maker', name: '식약처 화장품제조업', ok: !!mk, warn: !mk && !!(R.maker && R.maker.ok),
      detail: mk ? `제조업 등록 확인${mkRep ? ` · 대표 ${mkRep}` : ''}${mkAddr ? ` · ${mkAddr}` : ''}`
        : (!R.maker ? '자료 미제출/미등록' : (!R.maker.ok ? briefErr(R.maker.err)
          : (mkList.length ? `상호 일치 0건 (전체 ${mkList.length}건 중 미포함 — 제조업 미등록이거나 업소명 표기 상이)` : '등록 0건 — 책임판매업만 등록 가능성'))) },
    { key: 'factory', name: '산업단지공단 공장등록', ok: !!fctAddr, warn: !fctAddr && !!(R.factory && R.factory.ok),
      detail: fctAddr ? `공장 확인${fctEmpl ? ` · 종업원 ${fctEmpl}명` : ''}${fctProduct ? ' · ' + fctProduct : ''}`
        : (!R.factory ? '자료 미제출/미등록' : (!R.factory.ok ? briefErr(R.factory.err) : (fctList.length ? `${fctList.length}건 조회 · 상호 미일치` : '공장등록 0건(미등록/임대 가능)'))) },
    // GMP: API가 응답했으면 체크(✓), 미해당은 빨간색으로 표시
    (R.gmp && R.gmp.ok)
      ? { key: 'gmp', name: '식약처 GMP (CGMP)', ok: true, warn: !hasCgmp, detail: hasCgmp ? 'CGMP 적합업소 명단 확인' : `미해당 — 적합업체 ${gmpList.length}곳 중 미등재(CGMP 미인증)` }
      : stat('gmp', 'gmp', '식약처 GMP (CGMP)', null, 'GMP 목록 조회 실패'),
    (R.naverNews && R.naverNews.ok)
      ? { key: 'news', name: '네이버 뉴스검색', ok: !!news, warn: !news, detail: news ? `${news.length}건 관련기사` : `업체명 포함 기사 없음 (검색결과 ${newsItems.length}건 중)` }
      : stat('news', 'naverNews', '네이버 뉴스검색', null, '기사 없음 또는 프록시 미설정'),
    // 회수·판매중지: 조회 성공 시 이력 유무 표시(이력 있으면 warn=위험 신호), 실패 시 연결오류
    (R.recall && R.recall.ok)
      ? { key: 'recall', name: '식약처 회수·판매중지', ok: true, warn: recalls.length > 0, detail: recalls.length ? `⚠ 회수·판매중지 이력 ${recalls.length}건` : `이력 없음 (전체 ${recallListAll.length}건 조회)` }
      : stat('recall', 'recall', '식약처 회수·판매중지', null, '회수정보 조회 실패'),
    R.kakao ? { name: '카카오 이동거리', ok: !!kkTravel, detail: kkTravel ? `${kkNavi ? '실측' : '좌표추정'} 약 ${kkTravel.km}km · ${Math.floor(kkTravel.min / 60)}시간 ${kkTravel.min % 60}분` : (R.kakao.err || '실패 — 추정치 대체') } : null,
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
    agg ? { name: `외부 집계 보강 (${agg.host})`, ok: true, warn: true, detail: `비공식 참고 — ${[agg.bzno ? '사업자번호' : null, agg.rep ? '대표자' : null, agg.opneDe ? '개업일' : null, agg.status ? '상태' : null].filter(Boolean).join('·') || '정보'} 추출` } : null,
  ].filter(Boolean);

  const risk_flags = [];
  // 국세청 상태가 계속사업자가 아니면 최우선 경고
  if (bStt && bSttCd && bSttCd !== '01') {
    risk_flags.push({ type: `${bStt}`, detail: `국세청 사업자상태가 '${bStt}' — 정상 영업 여부 확인 필요. 거래 전 반드시 재확인` });
  }
  // 교차검증 자동진단 — 인력(연금 vs 공장)·주소(본점 vs 연금 vs 공장) 대조
  const cross_diag = crossVerify({
    empNps: empVal, empFct: fctEmpl, addrHq: corp?.addr, addrNps: npsAddr, addrFct: fctAddr || mkAddr,
  });
  cross_diag.items.forEach((c) => {
    if (c.status !== 'warn') return;
    if (c.label === '주소 정합성') risk_flags.push({ type: '주소 상이', detail: `${c.detail}` });
    if (c.label === '인력 정합성' && c.severe) risk_flags.push({ type: '인력 불일치', detail: `${c.detail}` });
  });
  // 재무 건전성 — 위험 등급이면 리스크로 승격
  const finance_health = assessFinance(finance_history);
  if (finance_health && finance_health.level === '위험') {
    risk_flags.push({ type: '재무 위험', detail: `${finance_health.year}년 재무: ${finance_health.reasons.join(' · ')} — 거래 전 신용조회·선급금·담보 검토 권장` });
  }
  // 회수·판매중지 이력 — 최우선 품질/안전 리스크
  if (recalls.length) {
    const latest = recalls[0];
    const bits = [latest.date, latest.product, latest.reason].filter(Boolean).join(' · ');
    risk_flags.push({ type: '회수·판매중지', detail: `회수·판매중지 이력 ${recalls.length}건 (최근: ${bits || '상세 확인'}) — 품질·안전 사고 이력. 거래 전 반드시 원인·재발방지 확인` });
  }

  return {
    meta: {
      vendor_name: name, vendor_id: name.replace(/[^\w가-힣]/g, '_'), query_at: new Date().toISOString(),
      version: 1, overall_grade: overall, sources_used: [...new Set(all.filter((x) => !x.data_gap).map((x) => x.source))],
      max_age_years: 5, live: true, src_status, factory_homepage: fctHmpadr || null,
      no_corp: !hasCorp, // 금융위 법인 미검색(개인사업자·법인명 불일치) → 상호명 기반 조회 안내용
      biz_agg: agg ? { host: agg.host, url: agg.url } : null, // 외부 집계 보강 출처(비공식)
      // 길찾기(카카오·티맵) 연동용 — 기준점(한국콜마)→방문지
      ref_point: { name: REF_POINT.name, addr: REF_POINT.addr, lat: REF_POINT.lat, lng: REF_POINT.lng },
      visit_addr: (kkTravel && kkTravel.destAddr) || fctAddr || corp?.addr || npsAddr || null,
      visit_coord: (kkTravel && kkTravel.dest && isFinite(kkTravel.dest.lat) && isFinite(kkTravel.dest.lng)) ? { lat: kkTravel.dest.lat, lng: kkTravel.dest.lng } : null,
    },
    basic, capacity, finance, finance_history, finance_health, cross_diag, recalls, oem_trace, crosscheck, risk_flags, diff_from_prev: [],
    news, insights, homepage: R.homepage && R.homepage.ok ? R.homepage.data : null,
  };
}

window.VENDOR_SAMPLES = { '리니어코스메틱': linear, '샘플뷰티랩': beautylab };
window.VENDOR_SAMPLE_LIST = [linear, beautylab];
window.generateReport = generateReport;
window.mapMfdsReport = mapMfdsReport;
window.mapCorpCandidates = mapCorpCandidates;
window.assembleLiveReport = assembleLiveReport;
