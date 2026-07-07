// src/report/schema.js — 4블록 스키마 + 신뢰도/최신성 규칙

export const MAX_AGE_YEARS = Number(process.env.MAX_AGE_YEARS || 5);

// 필드 신뢰도: A(공식API) > B(공공DB 간접) > C(추정/프록시) > D(공백)
export const GRADE = { OFFICIAL: 'A', PUBLIC: 'B', PROXY: 'C', GAP: 'D' };

// 5년 초과 데이터 제외 필터
export function isFresh(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - MAX_AGE_YEARS);
  return d >= cutoff;
}

// 모든 필드는 이 형태로 통일 — 누락 없음 원칙: 실패해도 gap으로 기록
export function field({ key, value, grade, source, asOf, note }) {
  const fresh = asOf ? isFresh(asOf) : null;
  return {
    key,
    value: value ?? null,
    grade: value == null ? GRADE.GAP : grade,
    source: source || '—',
    as_of: asOf || null,
    fresh,                       // false면 리포트에서 "기간초과" 표기
    data_gap: value == null,
    note: note || null,
  };
}

// 리포트 골격 (4블록)
export function emptyReport(vendorName) {
  return {
    meta: {
      vendor_name: vendorName,
      vendor_id: null,
      query_at: new Date().toISOString(),
      version: null,             // build.js에서 기존 스냅샷 수 기반 자동 채번
      overall_grade: null,
      sources_used: [],
      max_age_years: MAX_AGE_YEARS,
    },
    basic: [],       // 사업자상태/대표자/설립/소재지/제조업등록
    capacity: [],    // 인원(국민연금)/제형신고이력(식약처)/수출실적(관세청)
    finance: [],     // 매출/영업이익/총자산/총부채/자본금 (금융위)
    crosscheck: [],  // { key, expected, verified:null, match:null, src_type }
    risk_flags: [],  // 상충/공백/행정처분 자동 수집
  };
}

// 전체등급 = 필수필드 등급의 중앙값 방식
export function overallGrade(fields) {
  const order = { A: 0, B: 1, C: 2, D: 3 };
  const gs = fields.filter(f => !f.data_gap).map(f => order[f.grade]).sort();
  if (!gs.length) return 'D';
  return Object.keys(order)[gs[Math.floor(gs.length / 2)]];
}
