// src/collectors/nps.js — 국민연금 가입 사업장 내역 + 가입현황
// 역할: 피보험자수(실인원 프록시) + 월별 취득/상실로 인력 변동 추이
// ★ 구인사이트 인원수보다 정확 — 비정규직 미가입분은 여전히 누락될 수 있음 (실사 확인)
import { field, GRADE } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
// TODO: 활용신청 승인 페이지의 실제 엔드포인트로 교체
const BASE = 'http://apis.data.go.kr/B552015/NpsBplcInfoInqireService';

export async function collectNps(vendorName, bzno) {
  const fields = [];
  const flags = [];

  try {
    // 1) 사업장 검색 (업체명 or 사업자번호 앞6자리)
    const q = new URLSearchParams({
      serviceKey: KEY, resultType: 'json', numOfRows: '10',
      wkpl_nm: vendorName, // TODO: 명세서 파라미터명 확인
      ...(bzno ? { bzowr_rgst_no: bzno.slice(0, 6) } : {}),
    });
    const res = await fetch(`${BASE}/getBassInfoSearch?${q}`);
    const data = await res.json();
    const items = data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);
    const hit = list[0];

    const today = new Date().toISOString().slice(0, 10);

    fields.push(field({
      key: '국민연금 가입 인원',
      value: hit?.jnngpCnt ?? null, // TODO: 필드명 확인
      grade: GRADE.PUBLIC,
      source: '국민연금 사업장 API',
      asOf: today,
      note: '정규 가입자 기준 — 비정규/일용직 누락 가능, 실사 시 총원 대조',
    }));
    fields.push(field({
      key: '월 신규취득/상실',
      value: hit ? `${hit.nwAcqzrCnt ?? '?'} / ${hit.lssJnngpCnt ?? '?'}` : null,
      grade: GRADE.PUBLIC,
      source: '국민연금 가입현황 API',
      asOf: today,
      note: '상실 급증 = 구조조정/이탈 신호',
    }));
    fields.push(field({
      key: '사업장 주소 (연금기준)',
      value: hit?.wkplRoadNmDtlAddr ?? null,
      grade: GRADE.PUBLIC,
      source: '국민연금 사업장 API',
      asOf: today,
      note: '식약처 제조소 주소와 3중 대조용',
    }));
  } catch (e) {
    flags.push({ type: 'collect_error', source: 'nps', detail: e.message });
    fields.push(field({ key: '국민연금 가입 인원', value: null, source: '국민연금 API', note: `조회실패: ${e.message}` }));
  }

  return { fields, flags };
}
