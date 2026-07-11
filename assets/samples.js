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
    f('사업장 가입자수 (연금기준)', '87명', 'C', '국민연금 사업장 정보', '2026-05-31', '실인원 프록시 — 파견/외주 미포함'),
    f('사업장 주소 (연금기준)', '경기도 화성시 향남읍 제약공단로 51', 'C', '국민연금 사업장 정보', '2026-05-31', '본점/제조소와 번지 상이 — 실사 확인 필요'),
    f('기능성 보고품목 수 (5년내)', 42, 'A', '식약처 보고품목 API', '2026-07-07'),
    f('신고 제형 분포', '크림, 로션, 앰플/세럼, 마스크팩, 젤', 'C', '식약처 보고품목 API', '2026-07-07', 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    fc('품질인증', certList([1, 1, 1, 0, 1]), 'A', '식약처 GMP·인증기관', '2024-11-20', 'CGMP 적합업소(유효) + 국제 품질/윤리 인증'),
    f('수출 실적 (최근)', '연 24회 통관 / 對 미·일·베트남', 'B', '관세청 수출입 실적', '2026-04-30'),
    fc('PLT 거래여부', [{ label: 'KPP', ok: true }, { label: '아주렌탈', ok: false }], 'B', '렌탈 거래처 대사', '2026-07-07', '렌탈 파렛트 거래 이력'),
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
    { key: '사업장 가입자수 (연금기준)', expected: '87명', verified: null, match: null, src_type: '국민연금 사업장 정보' },
  ],
  risk_flags: [
    { type: 'address_conflict', detail: '본점주소: 제약공단로 45 | 제조소 소재지: 제약공단로 45 | 사업장 주소 (연금기준): 제약공단로 51' },
  ],
  diff_from_prev: [
    { key: '사업장 가입자수 (연금기준)', before: '81명', after: '87명' },
    { key: '기능성 보고품목 수 (5년내)', before: 39, after: 42 },
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
    f('사업장 가입자수 (연금기준)', '11명', 'C', '국민연금 사업장 정보', '2026-05-31', '실인원 프록시'),
    f('사업장 주소 (연금기준)', '충청북도 청주시 흥덕구 오송생명로 12', 'C', '국민연금 사업장 정보', '2026-05-31'),
    f('기능성 보고품목 수 (5년내)', 3, 'A', '식약처 보고품목 API', '2026-07-07'),
    f('신고 제형 분포', '앰플/세럼', 'C', '식약처 보고품목 API', '2026-07-07', '단일 제형 — 소품목 소량 추정'),
    fc('품질인증', certList([0, 0, 0, 0, 0]), 'B', '식약처 GMP·인증기관', '2026-07-07', 'CGMP 적합업소 목록 미포함 — 인증 미확인'),
    f('수출 실적 (최근)', null, 'D', '관세청 수출입 실적', null, '통관 실적 없음 — 내수 전용 추정'),
    fc('PLT 거래여부', [{ label: 'KPP', ok: false }, { label: '아주렌탈', ok: false }], 'B', '렌탈 거래처 대사', '2026-07-07', '거래 이력 없음'),
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
    { key: '수출 실적 (최근)', expected: null, verified: null, match: null, src_type: '관세청 수출입 실적' },
    { key: '매출액', expected: null, verified: null, match: null, src_type: '금융위 재무정보 API' },
  ],
  risk_flags: [
    { type: 'data_gap', source: 'fsc', detail: '재무 데이터 없음 (외감 비대상 추정)' },
    { type: 'data_gap', source: 'mfds', detail: '제조업 등록 미확인 — 자사 제조 여부 실사 필수' },
  ],
  diff_from_prev: [],
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
const G_EXPORT = ['미·일·중', '동남아 3개국', '미국·캐나다', '일본·대만', '중국·홍콩', '유럽 2개국', '베트남·태국'];

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
  const hasExport = chance(0.45);
  const pensionAddr = chance(0.7) ? hqAddr : `${region} ${pick(G_STREET)} ${ri(1, 99)}`;
  // 품질인증: CGMP는 제조·GMP 보유 시, 나머지는 확률적으로
  const certs = certList([hasGmp, hasGmp && chance(0.7), chance(0.35), chance(0.3), chance(0.35)]);
  const plt = [{ label: 'KPP', ok: chance(0.4) }, { label: '아주렌탈', ok: chance(0.25) }];
  const capacity = [
    f('사업장 가입자수 (연금기준)', `${emp}명`, 'C', '국민연금 사업장 정보', '2026-05-31', '실인원 프록시 — 파견/외주 미포함'),
    f('사업장 주소 (연금기준)', pensionAddr, 'C', '국민연금 사업장 정보', '2026-05-31'),
    f('기능성 보고품목 수 (5년내)', funcCount || null, funcCount ? 'A' : 'D', '식약처 보고품목 API', today, funcCount ? null : '보고 이력 없음 — 기능성 미취급 또는 공백'),
    f('신고 제형 분포', funcCount ? shuffle(G_FORMS).slice(0, ri(1, 5)).join(', ') : null, 'C', '식약처 보고품목 API', today, 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    fc('품질인증', certs, 'A', '식약처 GMP·인증기관', today, certs.some((c) => c.ok) ? null : '보유 인증 미확인'),
    f('수출 실적 (최근)', hasExport ? `연 ${ri(3, 60)}회 통관 / 對 ${pick(G_EXPORT)}` : null, hasExport ? 'B' : 'D', '관세청 수출입 실적', hasExport ? '2026-04-30' : null, hasExport ? null : '통관 실적 없음 — 내수 전용 추정'),
    fc('PLT 거래여부', plt, 'B', '렌탈 거래처 대사', today, plt.some((c) => c.ok) ? '렌탈 파렛트 거래 이력' : '거래 이력 없음'),
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
      generated: true, // 자동 생성 데모 표시
    },
    basic, capacity, finance, finance_history, crosscheck, risk_flags,
    diff_from_prev: [],
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
    f('수출 실적 (최근)', null, 'D', '관세청 수출입 실적', null, '관세청 API 연동 필요'),
    fc('PLT 거래여부', [{ label: 'KPP', ok: false }, { label: '아주렌탈', ok: false }], 'B', '렌탈 거래처 대사', null, '렌탈 거래처 API 연동 필요'),
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
  return list.map((c) => ({
    corpNm: c.corpNm || c.enpNm || c.corp_nm || '',
    crno: c.crno || null,
    bzno: c.bzno || null,
    rep: c.enpRprFnm || null,
    addr: c.enpBsadr || null,
    estbDt: c.enpEstbDt || null,
    raw: c,
  })).filter((c) => c.corpNm || c.crno);
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
  // 왜 비었는지 진단 문구: 미호출 / 조회실패(에러) / 빈결과
  const why = (part, emptyMsg) => {
    const r = R[part];
    if (!r) return '미연동 — 해당 API 미호출';
    if (!r.ok) return `조회 실패: ${r.err}`;
    return emptyMsg;
  };

  // 식약처 제조업 등록 (maker)
  const mkList = R.maker && R.maker.ok ? listOf(R.maker.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const mk = mkList[0];
  const mkNo = mk ? (mk.LCNS_NO ?? mk.lcnsNo ?? mk.MAKER_REG_NO ?? null) : null;
  const mkAddr = mk ? (mk.ADDR ?? mk.addr ?? mk.SITE_ADDR ?? null) : null;

  const basic = [
    f('법인등록번호', corp?.crno || null, 'A', '금융위 기업기본정보', today),
    f('사업자등록번호', corp?.bzno || null, 'A', '금융위 기업기본정보', today),
    f('대표자', corp?.rep || null, 'A', '금융위 기업기본정보', today),
    f('설립일', fmtDate(corp?.estbDt), 'A', '금융위 기업기본정보', fmtDate(corp?.estbDt)),
    f('본점주소', corp?.addr || null, 'A', '금융위 기업기본정보', today),
    f('제조업 등록', mk ? `등록${mkNo ? ` (제${mkNo}호)` : ''}` : null, mk ? 'A' : 'D', '식약처 화장품제조업 API', mk ? today : null, mk ? null : why('maker', '제조업 등록 결과 없음 — 책임판매업만 등록(OEM 위탁) 가능성')),
    f('제조소 소재지', mkAddr, mkAddr ? 'A' : 'D', '식약처 화장품제조업 API', mkAddr ? today : null, mkAddr ? '★ 방문지 기준 주소' : why('maker', '제조소 주소 미확보')),
  ];

  // 식약처 기능성 보고품목 (rpt)
  const rl = R.rpt && R.rpt.ok ? listOf(R.rpt.data, ['body.items', 'response.body.items.item']) : [];
  const fresh = rl.filter((i) => isFresh5(i.REPORT_DAY || i.report_day || i.PRDLST_REPORT_DE));
  const forms = [...new Set(fresh.map((i) => i.DOSAGE_FORM || i.dosage_form).filter(Boolean))];
  const rptEmpty = '기능성 보고 이력 없음 — 기능성 미취급 또는 업체명 불일치';

  // 국민연금 (nps) — {search, detail, count} 형태 (검색→상세 2단계)
  const npsData = R.nps && R.nps.ok ? R.nps.data : null;
  const nps = npsData ? npsData.search : null;
  const npsDet = npsData ? npsData.detail : null;
  const empVal = (npsDet && (npsDet.jnngpCnt ?? npsDet.subscrCnt)) ?? (nps && (nps.jnngpCnt ?? nps.subscrCnt)) ?? null;
  const npsAddr = (nps && (nps.wkplRoadNmDtlAddr ?? nps.ldongAddr)) ?? (npsDet && npsDet.wkplRoadNmDtlAddr) ?? null;

  const capacity = [
    f('사업장 가입자수 (연금기준)', empVal != null ? `${empVal}명` : null, empVal != null ? 'B' : 'D', '국민연금 사업장 API', empVal != null ? today : null, empVal != null ? '실인원 프록시 — 파견/외주 미포함' : why('nps', '국민연금 사업장 결과 없음(상호 불일치 가능)')),
    f('사업장 주소 (연금기준)', npsAddr, 'B', '국민연금 사업장 API', npsAddr ? today : null, npsAddr ? '식약처 제조소 주소와 대조용' : why('nps', '국민연금 결과 없음')),
    f('기능성 보고품목 수 (5년내)', fresh.length || null, fresh.length ? 'A' : 'D', '식약처 보고품목 API', fresh.length ? today : null, fresh.length ? null : why('rpt', rptEmpty)),
    f('신고 제형 분포', forms.length ? forms.join(', ') : null, 'C', '식약처 보고품목 API', forms.length ? today : null, forms.length ? 'CAPA 직접 데이터 아님 — 실사 확인' : why('rpt', rptEmpty)),
    fc('품질인증', certList([false, false, false, false, false]), 'A', '식약처 GMP·인증기관', null, '미연동 — CGMP는 식약처 GMP API로 가능, ISO/할랄/비건은 인증기관별 개별(공개 API 없음)'),
    f('수출 실적 (최근)', null, 'D', '관세청/무역협회', null, '미연동 — 관세청 공개 API는 업체별 조회 미지원(무역협회/자체자료 필요)'),
    fc('PLT 거래여부', [{ label: 'KPP', ok: false }, { label: '아주렌탈', ok: false }], 'D', '수기 확인 항목', null, '공개 API 없음 — KPP/아주렌탈은 고객사 목록 비공개. 업체 문의 또는 파트너 계정으로만 확인'),
  ];

  // 재무 — 연도 중복 제거(같은 해 복수 제출 대비) 후 최신 3개년
  const flAll = R.finance && R.finance.ok ? listOf(R.finance.data, ['response.body.items.item', 'body.items']) : [];
  const byYear = new Map();
  flAll.forEach((it) => { const y = Number(it.bizYear || it.biz_year); if (y && !byYear.has(y)) byYear.set(y, it); });
  const years = [...byYear.keys()].sort((a, b) => b - a).slice(0, 5).sort((a, b) => a - b);
  let finance, finance_history = [];
  if (years.length) {
    finance_history = years.map((y) => { const it = byYear.get(y); return { year: y, revenue: won2eok(it.enpSaleAmt), operatingProfit: won2eok(it.enpBzopPft), assets: won2eok(it.enpTastAmt), debt: won2eok(it.enpTdbtAmt), capital: won2eok(it.enpCptlAmt) }; });
    const L = finance_history[finance_history.length - 1];
    const eok = (v) => (v != null ? `${v}억 원` : null);
    finance = [
      f('매출액', eok(L.revenue), 'A', `금융위 재무정보 API (${L.year}년)`, today),
      f('영업이익', eok(L.operatingProfit), 'A', `금융위 재무정보 API (${L.year}년)`, today),
      f('총자산', eok(L.assets), 'A', `금융위 재무정보 API (${L.year}년)`, today),
      f('총부채', eok(L.debt), 'A', `금융위 재무정보 API (${L.year}년)`, today),
      f('자본금', eok(L.capital), 'A', `금융위 재무정보 API (${L.year}년)`, today),
    ];
  } else {
    finance = ['매출액', '영업이익', '총자산', '총부채', '자본금'].map((k) =>
      f(k, null, 'D', '금융위 재무정보 API', null, why('finance', '재무 데이터 없음 (외감 비대상 추정)')));
  }

  const all = [...basic, ...capacity, ...finance];
  const order = { A: 0, B: 1, C: 2, D: 3 };
  const gs = all.filter((x) => !x.data_gap).map((x) => order[x.grade]).sort((a, b) => a - b);
  const overall = gs.length ? ['A', 'B', 'C', 'D'][gs[Math.floor(gs.length / 2)]] : 'D';
  const crosscheck = all.filter((x) => x.data_gap || x.grade === 'C')
    .map((x) => ({ key: x.key, expected: x.value, verified: null, match: null, src_type: x.source }));

  // 📡 소스별 조회 상태 — 왜 비었는지 화면에서 바로 보이게 (모바일에선 hover 불가)
  const stat = (part, label, okDetail, emptyDetail) => {
    const r = R[part];
    if (!r) return { name: label, ok: false, detail: '미호출' };
    if (!r.ok) return { name: label, ok: false, detail: r.err };
    return okDetail != null ? { name: label, ok: true, detail: okDetail } : { name: label, ok: false, detail: emptyDetail };
  };
  const src_status = [
    { name: '금융위 기업기본정보', ok: true, detail: `기준정보 확보 (${corp?.crno || '법인번호 미상'})` },
    stat('finance', '금융위 재무정보', years.length ? `${years.length}개년 (${years[0]}~${years[years.length - 1]})` : null, '재무 데이터 없음(외감 비대상 추정)'),
    stat('rpt', '식약처 기능성 보고품목', rl.length ? `${rl.length}건 (5년내 ${fresh.length})` : null, '0건 — 기능성 미취급 또는 상호 불일치'),
    stat('nps', '국민연금 사업장', (npsData && npsData.count) ? `${npsData.count}건 매칭${empVal != null ? ` · 가입자 ${empVal}명` : ' · 가입자수 상세조회 실패'}` : null, '사업장 검색 0건 — 상호 표기 차이 가능'),
    stat('maker', '식약처 화장품제조업', mk ? '제조업 등록 확인' : null, '등록 조회 0건 — 책임판매업만 등록 가능성'),
  ];

  return {
    meta: {
      vendor_name: name, vendor_id: name.replace(/[^\w가-힣]/g, '_'), query_at: new Date().toISOString(),
      version: 1, overall_grade: overall, sources_used: [...new Set(all.filter((x) => !x.data_gap).map((x) => x.source))],
      max_age_years: 5, live: true, src_status,
    },
    basic, capacity, finance, finance_history, crosscheck, risk_flags: [], diff_from_prev: [],
  };
}

window.VENDOR_SAMPLES = { '리니어코스메틱': linear, '샘플뷰티랩': beautylab };
window.VENDOR_SAMPLE_LIST = [linear, beautylab];
window.generateReport = generateReport;
window.mapMfdsReport = mapMfdsReport;
window.mapCorpCandidates = mapCorpCandidates;
window.assembleLiveReport = assembleLiveReport;
