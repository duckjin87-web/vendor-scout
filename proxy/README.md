# 식약처 실데이터 프록시 (Cloudflare Worker)

정적 사이트에서 data.go.kr(식약처)을 직접 부르면 **CORS·키노출·http 혼합콘텐츠**로 막힙니다.
이 워커가 **키를 숨기고 CORS를 허용**해 브라우저가 실시간 조회할 수 있게 중계합니다. (무료, 서버 관리 없음)

## 1. data.go.kr 키 준비
- data.go.kr에서 **기능성화장품 보고품목 정보** 등 활용신청 → **일반 인증키(Encoding/Decoding)** 확보.

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

## 참고 / 한계
- 현재 워커는 **기능성화장품 보고품목**(업체명 조회, `service=rpt`) 하나를 중계합니다.
  제조업 등록·GMP·재무 등은 각 API(식약처 화장품정보/GMP, 금융위 재무)를 `SERVICES`에 추가하면 됩니다.
  단, `src/collectors/*`에 남은 TODO처럼 **승인된 명세의 정확한 path·파라미터명**으로 맞춰야 합니다.
- 식약처 엔드포인트/파라미터명이 승인 화면과 다르면 `worker.js`의 `SERVICES`를 수정하세요.
- 키가 없거나 프록시 미연결이면 사이트는 **데모(자동 생성) 모드**로 동작합니다.
