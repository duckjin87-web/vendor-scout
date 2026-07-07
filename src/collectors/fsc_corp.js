// src/collectors/fsc_corp.js — 금융위원회 기업기본정보
// 역할: 업체명 → 법인등록번호(crno)·사업자번호·대표자·설립일·주소 확보
// ★ 이 수집기가 파이프라인 1단계: 여기서 얻은 crno로 재무조회가 이어짐
import { field, GRADE } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
const BASE = 'https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2';

export async function collectCorpBasic(vendorName) {
  const fields = [];
  const flags = [];
  let crno = null;

  try {
    const q = new URLSearchParams({
      serviceKey: KEY, resultType: 'json', numOfRows: '10',
      corpNm: vendorName, // TODO: 실제 명세서에서 파라미터명 확인 (corpNm 예상)
    });
    const res = await fetch(`${BASE}/getCorpOutline_V2?${q}`);
    const data = await res.json();
    const items = data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);

    // 동명법인 대응: 복수 결과면 전부 플래그로 남기고 첫 건 사용
    if (list.length > 1) {
      flags.push({
        type: 'ambiguous_match',
        source: 'fsc_corp',
        detail: `동명 법인 ${list.length}건 — 소재지로 식별 필요: ${list.map(i => i.enpBsadr || '').join(' / ')}`,
      });
    }
    const c = list[0];
    crno = c?.crno || null;

    const today = new Date().toISOString().slice(0, 10);
    fields.push(field({ key: '법인등록번호', value: crno, grade: GRADE.OFFICIAL, source: '금융위 기업기본정보', asOf: today }));
    fields.push(field({ key: '사업자등록번호', value: c?.bzno ?? null, grade: GRADE.OFFICIAL, source: '금융위 기업기본정보', asOf: today }));
    fields.push(field({ key: '대표자', value: c?.enpRprFnm ?? null, grade: GRADE.OFFICIAL, source: '금융위 기업기본정보', asOf: today }));
    fields.push(field({ key: '설립일', value: c?.enpEstbDt ?? null, grade: GRADE.OFFICIAL, source: '금융위 기업기본정보', asOf: today }));
    fields.push(field({ key: '본점주소', value: c?.enpBsadr ?? null, grade: GRADE.OFFICIAL, source: '금융위 기업기본정보', asOf: today }));
  } catch (e) {
    flags.push({ type: 'collect_error', source: 'fsc_corp', detail: e.message });
    ['법인등록번호', '사업자등록번호', '대표자', '설립일', '본점주소'].forEach(k =>
      fields.push(field({ key: k, value: null, source: '금융위 기업기본정보', note: `조회실패: ${e.message}` }))
    );
  }

  return { fields, flags, crno };
}
