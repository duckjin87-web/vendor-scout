// src/collectors/mfds_gmp.js — 식약처 화장품 GMP 적합 업체현황
// 역할: CGMP 적합 판정 여부·판정일 확인 (품질역량의 최상위 공식 지표)
import { field, GRADE, isFresh } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
// TODO: 활용신청 승인 페이지의 실제 엔드포인트로 교체
const BASE = 'http://apis.data.go.kr/1471000/CsmtcsGmpSuitBzentyStusService';

export async function collectGmp(vendorName) {
  const fields = [];
  const flags = [];

  try {
    const q = new URLSearchParams({
      serviceKey: KEY, type: 'json', numOfRows: '20',
      entpName: vendorName, // TODO: 명세서 파라미터명 확인
    });
    const res = await fetch(`${BASE}/getGmpSuitList?${q}`);
    const data = await res.json();
    const items = data?.body?.items || data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);
    const hit = list[0];

    const today = new Date().toISOString().slice(0, 10);
    const judgeDate = hit?.JUDGE_DATE || hit?.judgeDate || null;

    fields.push(field({
      key: 'CGMP 적합 여부',
      value: hit ? '적합' : null,
      grade: GRADE.OFFICIAL,
      source: '식약처 GMP 적합업체 API',
      asOf: today,
      note: hit ? null : 'GMP 목록 미등재 — 미인증 또는 업체명 표기 차이 확인',
    }));
    fields.push(field({
      key: 'GMP 판정일',
      value: judgeDate,
      grade: GRADE.OFFICIAL,
      source: '식약처 GMP 적합업체 API',
      asOf: judgeDate,
      note: judgeDate && !isFresh(judgeDate) ? '판정 5년 초과 — 갱신 여부 실사 확인' : null,
    }));
    fields.push(field({
      key: 'GMP 인증 소재지',
      value: hit?.ADDR || hit?.addr || null,
      grade: GRADE.OFFICIAL,
      source: '식약처 GMP 적합업체 API',
      asOf: today,
      note: '본점주소와 불일치 시 공장 소재지로 판단',
    }));
  } catch (e) {
    flags.push({ type: 'collect_error', source: 'mfds_gmp', detail: e.message });
    fields.push(field({ key: 'CGMP 적합 여부', value: null, source: '식약처 GMP API', note: `조회실패: ${e.message}` }));
  }

  return { fields, flags };
}
