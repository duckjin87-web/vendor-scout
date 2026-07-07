// src/collectors/mfds.js — 식약처: 제조업 등록 확인 + 기능성 보고품목으로 제형 이력 역추적
import { field, GRADE, isFresh } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
const BASE = 'http://apis.data.go.kr/1471000';

async function callApi(path, params) {
  const q = new URLSearchParams({ serviceKey: KEY, type: 'json', numOfRows: '100', ...params });
  const res = await fetch(`${BASE}/${path}?${q}`);
  if (!res.ok) throw new Error(`MFDS ${path} HTTP ${res.status}`);
  return res.json();
}

export async function collectMfds(vendorName) {
  const fields = [];
  const flags = [];

  // 1) 기능성화장품 보고품목 → 제형/품목 이력 (생산역량 프록시)
  try {
    const data = await callApi('FtnltCosmRptPrdlstInfoService/getRptPrdlstInq', {
      entp_name: vendorName,
    });
    const items = data?.body?.items || data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);

    // 최신성 필터: 보고일 5년 이내만
    const fresh = list.filter(i => isFresh(i.REPORT_DAY || i.report_day));
    const formTypes = [...new Set(fresh.map(i => i.DOSAGE_FORM || i.dosage_form).filter(Boolean))];

    fields.push(field({
      key: '기능성 보고품목 수 (5년내)',
      value: fresh.length || null,
      grade: GRADE.OFFICIAL,
      source: '식약처 보고품목 API',
      asOf: new Date().toISOString().slice(0, 10),
      note: fresh.length ? null : '보고 이력 없음 — 기능성 미취급 또는 데이터 공백',
    }));
    fields.push(field({
      key: '신고 제형 분포',
      value: formTypes.length ? formTypes.join(', ') : null,
      grade: GRADE.PROXY, // 제형→라인 보유의 간접 증거이므로 C
      source: '식약처 보고품목 API',
      asOf: new Date().toISOString().slice(0, 10),
      note: 'CAPA 직접 데이터 아님 — 실제 가동라인은 실사 확인 필요',
    }));
  } catch (e) {
    fields.push(field({ key: '기능성 보고품목 수 (5년내)', value: null, source: '식약처', note: `조회실패: ${e.message}` }));
    flags.push({ type: 'collect_error', source: 'mfds', detail: e.message });
  }

  return { fields, flags };
}
