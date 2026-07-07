// src/collectors/mfds_biz.js — 식약처 화장품 관련 정보
// 역할: 화장품제조업/책임판매업 등록 여부·등록번호·소재지 (규제 적격성의 기본)
import { field, GRADE } from '../report/schema.js';

const KEY = process.env.DATA_GO_KR_API_KEY;
// TODO: 활용신청 승인 페이지의 실제 엔드포인트로 교체 (데이터ID 15020628)
const BASE = 'http://apis.data.go.kr/1471000/CsmtcsInfoService';

export async function collectMfdsBiz(vendorName) {
  const fields = [];
  const flags = [];

  try {
    const q = new URLSearchParams({
      serviceKey: KEY, type: 'json', numOfRows: '20',
      entpName: vendorName, // TODO: 명세서 파라미터명 확인
    });
    const res = await fetch(`${BASE}/getMakerList?${q}`); // TODO: 오퍼레이션명 확인
    const data = await res.json();
    const items = data?.body?.items || data?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items].filter(Boolean);
    const hit = list[0];

    const today = new Date().toISOString().slice(0, 10);

    fields.push(field({
      key: '화장품제조업 등록',
      value: hit ? '등록' : null,
      grade: GRADE.OFFICIAL,
      source: '식약처 화장품정보 API',
      asOf: today,
      note: hit ? null : '미등재 — 제조업 미등록이면 거래 부적격',
    }));
    fields.push(field({
      key: '제조업 등록번호',
      value: hit?.LCNS_NO || hit?.lcnsNo || null,
      grade: GRADE.OFFICIAL,
      source: '식약처 화장품정보 API',
      asOf: today,
    }));
    fields.push(field({
      key: '제조소 소재지',
      value: hit?.ADDR || hit?.addr || null,
      grade: GRADE.OFFICIAL,
      source: '식약처 화장품정보 API',
      asOf: today,
      note: '★ 방문지 기준 주소 — 본점주소와 다르면 이쪽이 공장',
    }));
    // 책임판매업 겸업 여부 (OEM+브랜드 병행 신호)
    fields.push(field({
      key: '책임판매업 겸업',
      value: null, // TODO: 책임판매업 오퍼레이션 별도 호출로 채움
      grade: GRADE.GAP,
      source: '식약처 화장품정보 API',
      note: '겸업 시 자사브랜드 보유 — 이해상충/우선순위 참고',
    }));
  } catch (e) {
    flags.push({ type: 'collect_error', source: 'mfds_biz', detail: e.message });
    fields.push(field({ key: '화장품제조업 등록', value: null, source: '식약처', note: `조회실패: ${e.message}` }));
  }

  return { fields, flags };
}
