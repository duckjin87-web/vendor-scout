# vendor-scout

> ## 🌐 라이브 사이트 → **https://duckjin87-web.github.io/vendor-scout/**
>
> **지금 이 화면(README)은 "코드 저장소" 페이지이지 사이트가 아닙니다.**
> 실제 데모 사이트는 위 `github.io` 주소입니다. 위 링크를 눌러 접속하세요.

화장품 제조업체 신규처 발굴용 사전 정보 확보·검증 개인 서비스.
업체명/사업자번호 입력 → 공공 API 실시간 조회 → 조회시점 스냅샷 리포트 생성 → 방문 크로스체크.

## 원칙

- **범용성**: 어느 업체든 입력 즉시 현시점 최신정보 조회
- **신뢰성**: 필드마다 출처·신뢰도(A~D) 기록
- **무누락**: 조회 실패/데이터 없음도 `data_gap`으로 명시 기록 (빈칸 금지)
- **최신성**: 기준일 5년 초과 데이터는 자동 제외 (`MAX_AGE_YEARS=5`)

## 구조

```
vendor-scout/
├── .github/workflows/
│   └── collect.yml          # 수동/스케줄 실행 워크플로우
├── src/
│   ├── collectors/          # 소스별 수집기 (1소스 = 1파일)
│   │   ├── mfds.js          # 식약처: 제조업 등록, 기능성 심사/보고 품목(제형!)
│   │   ├── fsc_finance.js   # 금융위: 재무제표 (매출/자산/부채/자본금)
│   │   ├── nps.js           # 국민연금: 사업장 피보험자수 (실인원 프록시)
│   │   └── customs.js       # 관세청: 수출입 실적
│   ├── report/
│   │   ├── schema.js        # 4블록 스키마 + 신뢰도 등급 로직
│   │   └── build.js         # 스냅샷 리포트 생성 (JSON + MD)
│   └── index.js             # 엔트리: node src/index.js "리니어코스메틱"
├── data/snapshots/          # 불변 스냅샷 누적 (vendorId_v1.json, v2...)
├── docs/API_SOURCES.md      # 소스별 필드·신뢰도·갱신주기 문서
└── .env.example
```

## 셋업 (5단계)

1. **API 키 발급**: data.go.kr 로그인 → 아래 API 활용신청 (승인 즉시~1일)
   - 식약처 화장품 관련 정보 (15020628)
   - 식약처 기능성화장품 보고품목 (15095680)
   - 금융위 기업 재무정보 (15043459)
   - 국민연금 사업장 정보
2. **레포 생성**: GitHub에서 private 레포 생성 → 이 파일들 push
3. **시크릿 등록**: 레포 Settings → Secrets and variables → Actions →
   `DATA_GO_KR_API_KEY` 등록 (코드에는 절대 하드코딩 금지)
4. **로컬 테스트**: `.env.example`을 `.env`로 복사, 키 입력 후
   `npm install && node src/index.js "업체명"`
5. **자동화**: Actions 탭 → collect 워크플로우 → Run workflow에 업체명 입력

## 데모 사이트 (GitHub Pages)

API 키 없이 브라우저에서 리포트 UI를 검증할 수 있는 정적 데모가 저장소 **루트**(`index.html` + `assets/`)에 있습니다.
샘플 스냅샷 데이터로 4블록 리포트·A~D 신뢰도·크로스체크·리스크 플래그를 그대로 렌더링합니다.

**배포 방법** — 앱이 루트에 있어 Settings → Pages 소스가 **"GitHub Actions"** 든 **"Deploy from a branch (main / root)"** 든 동일하게 서빙됩니다.

1. `main`에 push → 자동 배포
2. 배포 URL: `https://duckjin87-web.github.io/vendor-scout/`

**로컬 미리보기**

```bash
npx http-server . -p 8099   # → http://127.0.0.1:8099
```

> 실 서비스(공공 API 실시간 조회)는 서버/시크릿이 필요하므로 정적 Pages로는 조회가 안 됩니다.
> Pages는 UI·리포트 포맷 검증용 데모이고, 실제 조회는 `collect.yml`(Actions + API 키)로 실행합니다.

## 스냅샷 규칙

- 조회 1회 = 파일 1개 (`data/snapshots/{vendorId}_v{n}.json`)
- 기존 파일 수정 금지, 재조회 시 v+1로 신규 생성
- diff는 리포트 생성 시 직전 버전과 자동 비교
