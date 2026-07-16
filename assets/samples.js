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

// 관세청 국가코드(ISO2 추정) → 한글명. 미매핑 코드는 원본 표기 유지.
const COUNTRY_KO = {
  CN: '중국', US: '미국', JP: '일본', HK: '홍콩', VN: '베트남', RU: '러시아', TW: '대만',
  TH: '태국', ID: '인도네시아', MY: '말레이시아', SG: '싱가포르', PH: '필리핀', IN: '인도',
  KR: '한국', GB: '영국', FR: '프랑스', DE: '독일', NL: '네덜란드', CA: '캐나다', AU: '호주',
  AE: 'UAE', SA: '사우디', KZ: '카자흐스탄', MM: '미얀마', KH: '캄보디아', MN: '몽골',
};

// ── 방문 이동거리 추정 (한국콜마 세종 기준점) ──
const REF_POINT = { name: '한국콜마', addr: '세종시 전의면 산단길 22-17', lat: 36.631, lng: 127.046 };
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
    { key: '재직자수 (국민연금 가입자)', expected: '87명', verified: null, match: null, src_type: '국민연금 사업장 API' },
  ],
  risk_flags: [
    { type: 'address_conflict', detail: '본점주소: 제약공단로 45 | 제조소 소재지: 제약공단로 45 | 사업장 주소 (연금기준): 제약공단로 51' },
  ],
  diff_from_prev: [
    { key: '재직자수 (국민연금 가입자)', before: '81명', after: '87명' },
    { key: '기능성 보고품목 수 (5년내)', before: 39, after: 42 },
  ],
  trade_ref: {
    totalExportUsd: 8_541_000_000, totalImportUsd: 2_104_000_000,
    topCountries: ['중국', '미국', '일본', '베트남', '러시아'],
    itemCount: 156, hsCode: '33',
    note: '관세청 품목별 국가별 수출입실적 — 화장품(HS33) 업종 전체 통계 (데모)',
  },
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
  trade_ref: {
    totalExportUsd: 8_541_000_000, totalImportUsd: 2_104_000_000,
    topCountries: ['중국', '미국', '일본', '베트남', '러시아'],
    itemCount: 156, hsCode: '33',
    note: '관세청 품목별 국가별 수출입실적 — 화장품(HS33) 업종 전체 통계 (데모)',
  },
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
  // PLT: 공개 API 없음 → 규모·수출·제조 기반 예측
  const pScore = (isMaker ? 1 : 0) + (emp >= 50 ? 2 : emp >= 20 ? 1 : 0) + (hasExport ? 1 : 0);
  const pltLikely = pScore >= 3 ? '가능성 높음' : pScore >= 2 ? '보통' : '낮음/미상';
  const capacity = [
    f('재직자수 (국민연금 가입자)', `${emp}명`, 'B', '국민연금 사업장 API', '2026-05-31', '4대보험 가입 재직자 — 파견·일용·프리랜서 미포함. 방문 시 실인원 대조'),
    f('사업장 주소 (연금기준)', pensionAddr, 'C', '국민연금 사업장 정보', '2026-05-31'),
    f('방문 이동거리', travelText(estimateTravel(hqAddr)), 'C', `기준: ${REF_POINT.name} (${REF_POINT.addr})`, today, '직선거리 기반 추정 — 실데이터 연결 시 카카오내비 실측'),
    f('기능성 보고품목 수 (5년내)', funcCount || null, funcCount ? 'A' : 'D', '식약처 보고품목 API', today, funcCount ? null : '보고 이력 없음 — 기능성 미취급 또는 공백'),
    f('신고 제형 분포', funcCount ? shuffle(G_FORMS).slice(0, ri(1, 5)).join(', ') : null, 'C', '식약처 보고품목 API', today, 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인'),
    f('CGMP 적합업소', hasGmp ? '적합 (식약처 GMP 등재)' : null, hasGmp ? 'A' : 'D', '식약처 GMP API', hasGmp ? today : null, hasGmp ? 'CGMP 적합업소 — ISO/할랄/비건은 공개 API 없어 방문 시 인증서 확인' : 'CGMP 미등재 — 그 외 인증은 공개 API 없음(방문 확인)'),
    f('수출 실적 (최근)', hasExport ? `연 ${ri(3, 60)}회 통관 / 對 ${pick(G_EXPORT)}` : null, hasExport ? 'B' : 'D', '관세청 수출입 실적', hasExport ? '2026-04-30' : null, hasExport ? null : '통관 실적 없음 — 내수 전용 추정'),
    f('PLT 렌탈 거래 (예측)', `예측: ${pltLikely}`, 'C', '휴리스틱 추정 (공개 API 없음)', today, 'KPP/아주렌탈 고객사 비공개 → 규모·수출 기반 추정. 방문 시 파렛트 임대라벨·계약서로 확정'),
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
    basic, capacity, finance, finance_history, crosscheck, risk_flags,
    diff_from_prev: [],
    trade_ref: {
      totalExportUsd: ri(4e9, 10e9), totalImportUsd: ri(1e9, 3e9),
      topCountries: shuffle(['중국', '미국', '일본', '베트남', '러시아', '태국', '대만', '홍콩', '인도네시아', '말레이시아']).slice(0, 5),
      itemCount: ri(80, 200), hsCode: '33',
      note: '관세청 품목별 국가별 수출입실적 — 화장품(HS33) 업종 전체 통계 (데모)',
    },
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
  // V2 JSON 필드: 가입자수=jnngpCnt(상세), 도로명주소=wkplRoadNmDetAddr, 법정동=ldongAddrMgpldongNm
  const empRaw = (npsDet && (npsDet.jnngpCnt ?? npsDet.subscrCnt)) ?? (nps && (nps.jnngpCnt ?? nps.subscrCnt)) ?? null;
  const empVal = (empRaw != null && empRaw !== '') ? empRaw : null;
  const pick = (o, ...ks) => { if (!o) return null; for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return null; };
  const npsAddr = pick(nps, 'wkplRoadNmDetAddr', 'wkplRoadNmDtlAddr', 'ldongAddrMgpldongNm', 'ldongAddr')
    || pick(npsDet, 'wkplRoadNmDetAddr', 'wkplRoadNmDtlAddr', 'ldongAddrMgpldongNm') || null;

  // 관세청 수출입 (화장품 업종 참고 — 개별 업체가 아닌 HS33 업종 전체 통계)
  // getNitemtradeList 응답(XML): statCd=국가코드, expDlr/impDlr=USD, 총계행 statCd='ALL'
  const custList = R.customs && R.customs.ok ? listOf(R.customs.data, ['response.body.items.item', 'body.items', 'items']) : [];
  let trade_ref = null;
  if (custList.length) {
    const byCountry = {};
    let totalExp = 0, totalImp = 0, allExp = 0, allImp = 0;
    custList.forEach((it) => {
      const code = String(it.statCd || it.cntyCd || it.statKor || it.cntryNm || '').trim();
      const exp = Number(it.expDlr || it.exp_dlr || it.expUsdAmt || 0);
      const imp = Number(it.impDlr || it.imp_dlr || it.impUsdAmt || 0);
      // 총계행(ALL/총계)은 별도 보관 — 개별국가 합산과 중복 방지
      if (/^ALL$|총계|합계|total/i.test(code)) { allExp += exp; allImp += imp; return; }
      totalExp += exp; totalImp += imp;
      const name = COUNTRY_KO[code] || it.statKor || it.cntryNm || code || '기타';
      byCountry[name] = (byCountry[name] || 0) + exp;
    });
    const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
    trade_ref = {
      totalExportUsd: allExp || totalExp, totalImportUsd: allImp || totalImp,
      topCountries, itemCount: custList.length, hsCode: '33',
      note: '관세청 품목별 국가별 수출입실적 — 화장품(HS33) 업종 전체 통계이며 개별 업체 수치가 아닙니다',
    };
  }

  // 식약처 GMP 적합업소 (CGMP 등록여부) — 적합업체 전체목록에서 상호로 필터
  // 업체명 필드 키가 API마다 달라(BSSH_NM/CMPNY_NM/…) 모든 필드값을 훑어 상호 포함 여부로 매칭
  const gmpList = R.gmp && R.gmp.ok ? listOf(R.gmp.data, ['response.body.items.item', 'body.items', 'items']) : [];
  const cmpKey = stripCorp(name).replace(/\s/g, '');
  const gmpHit = cmpKey.length >= 2 ? gmpList.find((g) =>
    Object.values(g).some((v) => {
      const gn = stripCorp(String(v == null ? '' : v)).replace(/\s/g, '');
      return gn.length >= 3 && gn.includes(cmpKey);
    })
  ) : null;
  const hasCgmp = !!gmpHit;

  // 카카오 실측 이동거리 {km, min} — 없으면 하버사인 추정으로 폴백
  const kkTravel = R.kakao && R.kakao.ok ? R.kakao.data : null;

  // PLT(파렛트 렌탈) 거래여부 — 공개 API 없음 → 규모·수출·제조등록 기반 휴리스틱 예측
  const empN = Number(String(empVal || '').replace(/\D/g, '')) || 0;
  const pltScore = (mk ? 1 : 0) + (empN >= 50 ? 2 : empN >= 20 ? 1 : 0) + (trade_ref ? 1 : 0);
  const pltLikely = pltScore >= 3 ? '가능성 높음' : pltScore >= 2 ? '보통' : '낮음/미상';
  const pltReason = [mk ? '자사제조' : null, empN ? `재직 ${empN}명` : null, trade_ref ? '수출활동' : null].filter(Boolean).join('·') || '판단근거 부족';

  // 네이버 뉴스 (최근 기사)
  const newsRaw = R.naverNews && R.naverNews.ok ? R.naverNews.data : null;
  const newsItems = newsRaw && newsRaw.items ? newsRaw.items : [];
  const news = newsItems.length ? newsItems : null;

  const capacity = [
    f('재직자수 (국민연금 가입자)', empVal != null ? `${empVal}명` : null, empVal != null ? 'B' : 'D', '국민연금 사업장 API', empVal != null ? today : null, empVal != null ? '4대보험 가입 재직자 — 파견·일용·프리랜서 미포함. 방문 시 실인원 대조' : why('nps', '국민연금 사업장 결과 없음(상호 불일치 가능)')),
    f('사업장 주소 (연금기준)', npsAddr, 'B', '국민연금 사업장 API', npsAddr ? today : null, npsAddr ? '식약처 제조소 주소와 대조용' : why('nps', '국민연금 결과 없음')),
    f('방문 이동거리',
      kkTravel ? travelText(kkTravel) : travelText(estimateTravel(mkAddr || corp?.addr || npsAddr)),
      kkTravel ? 'B' : 'C',
      kkTravel ? '카카오내비 길찾기 (한국콜마 기준)' : '좌표 추정 (하버사인)',
      today,
      kkTravel ? '실제 도로 경로 기준 거리·예상 소요시간' : '직선거리 추정 — 도로사정 차이 가능. 카카오맵 버튼으로 재확인'),
    f('기능성 보고품목 수 (5년내)', fresh.length || null, fresh.length ? 'A' : 'D', '식약처 보고품목 API', fresh.length ? today : null, fresh.length ? null : why('rpt', rptEmpty)),
    f('신고 제형 분포', forms.length ? forms.join(', ') : null, 'C', '식약처 보고품목 API', forms.length ? today : null, forms.length ? 'CAPA 직접 데이터 아님 — 실사 확인' : why('rpt', rptEmpty)),
    f('CGMP 적합업소', hasCgmp ? '적합 (식약처 GMP 등재)' : null, hasCgmp ? 'A' : 'D', '식약처 GMP API', hasCgmp ? today : null, hasCgmp ? 'CGMP 적합업소 — ISO/할랄/비건은 공개 API 없어 방문 시 인증서 확인' : why('gmp', 'CGMP 미등재 — 그 외 인증은 공개 API 없음(방문 확인)')),
    f('수출 실적 (업종)', trade_ref ? `화장품(HS33) 수출 총 $${Math.round(trade_ref.totalExportUsd / 1e6)}M` : null, trade_ref ? 'C' : 'D', '관세청 수출입실적 API', trade_ref ? today : null, trade_ref ? '관세청 업종 통계 — 업체별 수출은 무역협회/자체자료 확인' : '관세청 API 연동 실패 또는 데이터 없음'),
    f('PLT 렌탈 거래 (예측)', `예측: ${pltLikely}`, 'C', '휴리스틱 추정 (공개 API 없음)', today, `${pltReason} · KPP/아주렌탈은 고객사 비공개 → 방문 시 파렛트 임대라벨·계약서로 확정`),
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
  // key: 제외 토글용 소스 키(없으면 항상 포함). part: res 응답 키.
  const stat = (key, part, label, okDetail, emptyDetail) => {
    const r = R[part];
    if (!r) return { key, name: label, ok: false, detail: '미호출' };
    if (!r.ok) return { key, name: label, ok: false, detail: r.err };
    return okDetail != null ? { key, name: label, ok: true, detail: okDetail } : { key, name: label, ok: false, detail: emptyDetail };
  };
  const src_status = [
    { name: '금융위 기업기본정보', ok: true, detail: `기준정보 확보 (${corp?.crno || '법인번호 미상'})` },
    stat('finance', 'finance', '금융위 재무정보', years.length ? `${years.length}개년 (${years[0]}~${years[years.length - 1]})` : null, '재무 데이터 없음(외감 비대상 추정)'),
    stat('rpt', 'rpt', '식약처 기능성 보고품목', rl.length ? `${rl.length}건 (5년내 ${fresh.length})` : null, '0건 — 기능성 미취급 또는 상호 불일치'),
    stat('nps', 'nps', '국민연금 (재직자수)', (npsData && npsData.count) ? `${npsData.count}건 매칭${empVal != null ? ` · 가입자 ${empVal}명` : ' · 가입자수 상세조회 실패'}` : null, '사업장 검색 0건 — 상호 표기 차이 가능'),
    stat('maker', 'maker', '식약처 화장품제조업', mk ? '제조업 등록 확인' : null, '등록 조회 0건 — 책임판매업만 등록 가능성'),
    stat('customs', 'customs', '관세청 수출입실적', custList.length ? `${custList.length}건 (HS33 화장품)` : null, '화장품 업종 수출입 데이터 없음'),
    (R.gmp && R.gmp.ok)
      ? { key: 'gmp', name: '식약처 GMP (CGMP)', ok: hasCgmp, detail: hasCgmp ? 'CGMP 적합업소 명단 확인' : `적합업체 ${gmpList.length}곳 중 미해당 (CGMP 미인증)` }
      : stat('gmp', 'gmp', '식약처 GMP (CGMP)', null, 'GMP 목록 조회 실패'),
    stat('news', 'naverNews', '네이버 뉴스검색', news ? `${news.length}건 관련기사` : null, '기사 없음 또는 프록시 미설정'),
    R.kakao ? { name: '카카오 길찾기 (이동거리)', ok: !!kkTravel, detail: kkTravel ? `실측 약 ${kkTravel.km}km · ${Math.floor(kkTravel.min / 60)}시간 ${kkTravel.min % 60}분` : (R.kakao.err || '실패 — 추정치 대체') } : null,
  ].filter(Boolean);

  return {
    meta: {
      vendor_name: name, vendor_id: name.replace(/[^\w가-힣]/g, '_'), query_at: new Date().toISOString(),
      version: 1, overall_grade: overall, sources_used: [...new Set(all.filter((x) => !x.data_gap).map((x) => x.source))],
      max_age_years: 5, live: true, src_status,
    },
    basic, capacity, finance, finance_history, crosscheck, risk_flags: [], diff_from_prev: [],
    trade_ref, news,
  };
}

window.VENDOR_SAMPLES = { '리니어코스메틱': linear, '샘플뷰티랩': beautylab };
window.VENDOR_SAMPLE_LIST = [linear, beautylab];
window.generateReport = generateReport;
window.mapMfdsReport = mapMfdsReport;
window.mapCorpCandidates = mapCorpCandidates;
window.assembleLiveReport = assembleLiveReport;
