// src/collectors/fsc_finance.js — 금융위원회 기업 재무정보 (법인등록번호 기준)
// 매출액/영업이익/총자산/총부채/자본금 + 재무상태표/손익계산서
import { field, GRADE, isFresh } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
const BASE = 'https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2';

export async function collectFinance(corpRegNo) {
  const fields = [];
  const flags = [];

  if (!corpRegNo) {
    // 누락 없음 원칙: 입력 자체가 없어도 gap으로 기록
    ['매출액', '영업이익', '총자산', '총부채', '자본금'].forEach(k =>
      fields.push(field({ key: k, value: null, source: '금융위 재무정보 API', note: '법인등록번호 미확보 — 등기부 열람 필요' }))
    );
    flags.push({ type: 'input_gap', detail: '법인등록번호 없음' });
    return { fields, flags };
  }

  try {
    const q = new URLSearchParams({
      serviceKey: KEY, resultType: 'json', numOfRows: '10',
      crno: corpRegNo,
    });
    const res = await fetch(`${BASE}/getSummFinaStat_V2?${q}`);
    const data = await res.json();
    const items = data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);

    // 최신 사업연도 1건, 단 5년 초과분 제외
    const fresh = list
      .filter(i => isFresh(`${i.bizYear || i.biz_year}-12-31`))
      .sort((a, b) => (b.bizYear || 0) - (a.bizYear || 0));
    const latest = fresh[0];

    const map = [
      ['매출액', 'enpSaleAmt'], ['영업이익', 'enpBzopPft'],
      ['총자산', 'enpTastAmt'], ['총부채', 'enpTdbtAmt'], ['자본금', 'enpCptlAmt'],
    ];
    for (const [k, apiKey] of map) {
      fields.push(field({
        key: k,
        value: latest?.[apiKey] ?? null,
        grade: GRADE.OFFICIAL,
        source: `금융위 재무정보 API (${latest?.bizYear || '—'}년)`,
        asOf: latest ? `${latest.bizYear}-12-31` : null,
        note: latest ? null : '데이터 미제출 법인 가능성 — 벤더 자체제출 폴백',
      }));
    }
    if (!latest) flags.push({ type: 'data_gap', source: 'fsc', detail: '재무 데이터 없음 (외감 비대상 추정)' });
  } catch (e) {
    flags.push({ type: 'collect_error', source: 'fsc', detail: e.message });
  }

  return { fields, flags };
}
