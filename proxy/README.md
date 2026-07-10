# 식약처 실데이터 연결

## 방법 0 — 프록시 없이 "키 직접 입력" (먼저 이걸 시도)
사이트 우측 상단 **🔌 실데이터 연결**에 **data.go.kr 인증키**를 그대로 붙여넣으면,
브라우저가 `apis.data.go.kr`을 **직접 https로 조회**합니다. **서버·모듈 불필요.**
- 키는 **이 브라우저(localStorage)에만** 저장 — 저장소/남에게 노출되지 않음.
- data.go 응답에 CORS 허용이 있으면 그대로 실시간 조회됩니다.
- 만약 브라우저 콘솔에 **CORS 차단**이 뜨면 → 아래 프록시 방법으로 넘어가세요.

> 인증키는 **인코딩/디코딩 구분 없이** 그대로 사용 가능합니다 (data.go 정책 변경 반영).

---

## 방법 1 — 프록시 (CORS가 막힐 때만) · Cloudflare Worker
정적 사이트에서 data.go.kr을 직접 부르면 CORS로 막히는 경우, 이 워커가 **CORS를 허용**해 중계합니다. (무료, 서버 관리 없음)

### 1. data.go.kr 키 준비
- data.go.kr에서 **기능성화장품 보고품목 정보** 등 활용신청 → **인증키** 확보(인코딩/디코딩 아무거나).

## 2. 워커 배포 (택1)

### A. 대시보드 (가장 쉬움)
1. https://dash.cloudflare.com → **Workers & Pages → Create → Worker**
2. 이름 예: `vendor-scout-proxy` → **Deploy**
3. **Edit code** → `proxy/worker.js` 내용 전체 붙여넣기 → **Deploy**
4. **Settings → Variables and Secrets → Add → Secret**
   - Name: `DATA_GO_KR_API_KEY`  /  Value: (2번의 **Decoding** 키) → **Deploy**
5. 워커 주소 확인: `https://vendor-scout-proxy.<계정>.workers.dev`

### B. Wrangler CLI
```bash
npm i -g wrangler
wrangler login
wrangler deploy proxy/worker.js --name vendor-scout-proxy
wrangler secret put DATA_GO_KR_API_KEY   # 프롬프트에 키 입력
```

## 3. 사이트에 연결
배포된 사이트에서 **🔌 실데이터 연결** 버튼 → 워커 주소 입력.
또는 URL에 붙여 자동저장: `https://duckjin87-web.github.io/vendor-scout/?proxy=https://vendor-scout-proxy.<계정>.workers.dev`

동작 확인: 워커 주소로 직접 열기 → `https://<worker>/?service=rpt&name=코스맥스` → 식약처 JSON이 보이면 정상.

## 조회 흐름 (사이트가 워커를 호출하는 순서)
1. `service=corp&corpNm=<업체명>` → 금융위 **기업기본정보**(동명업체 후보). 2건 이상이면 사이트가 **선택 UI**를 띄움.
2. 선택 후 `service=finance&crno=<법인번호>` → 금융위 **재무정보**(최신 3개년 그래프),
   `service=rpt&entp_name=<업체명>` → 식약처 **기능성 보고품목**(제형 등).

## 참고 / 한계
- 워커는 **corp·finance·rpt** 3종을 중계합니다. 제조업 등록·GMP/품질인증·국민연금·관세청은
  각 API를 `SERVICES`에 추가하면 됩니다 (해당 카테고리는 현재 `data_gap`으로 표기).
- `src/collectors/*`에 남은 TODO처럼 **승인된 명세의 정확한 URL·파라미터명**으로 `SERVICES`를 맞춰야
  실제 응답이 옵니다. 파라미터명이 승인 화면과 다르면 `worker.js`를 수정하세요.
- 키가 없거나 프록시 미연결이면 사이트는 **데모(자동 생성) 모드**로 동작합니다.
