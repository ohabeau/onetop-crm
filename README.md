# 원탑 CRM (One TOP CRM)

![One TOP CRM](public/logo.png)

광고로 들어온 고객 DB를 실시간으로 모으고, 상담·구매까지 관리하고, 텔레그램과 카카오 알림톡을 자동으로 보내는 웹앱입니다.

## 기능

| 영역 | 내용 |
|---|---|
| DB 수집 | 메타 인스턴트 양식 웹훅, 자체 랜딩페이지(`/l/주소`), 외부 폼·구글 시트 웹훅, 직접 등록, 엑셀(CSV) 업로드. 중복 번호 자동 표시 |
| 분배 | 캠페인 → 업체 자동 분배, 업체 안의 상담원에게 순서대로 자동 배정 |
| 알림 | 신규 DB 접수 시 텔레그램(운영사 공통방 + 업체별 방), 알림톡 실패/완료 텔레그램 알림 |
| 알림톡 | DB 접수 시 / 상태 변경 시(1차·2차 부재, 예약 완료, 구매 완료 등) 자동 발송, 업종·성별·연령 등 유형별 템플릿, 지연 발송(예: 구매 30일 후 재구매 안내), 수동 발송 + 미리보기 |
| CRM | 목록·보드(드래그로 상태 변경), 상세(전화·문자, 메모 이력, 콜백 예약, 구매 금액), 일괄 상태/담당 변경, 내려받기 |
| 분석 | 오늘 DB, 광고비, DB 단가, 매출, ROAS, 매체별 단가, 단계별 현황, 구매자/허수 인구통계, 시간대·업종별, 캠페인/타겟/광고별 효율 순위 |
| 랜딩 | 랜딩페이지 제작·모아보기, 방문수·DB·전환율, utm 으로 매체/캠페인/광고 자동 분류 |
| 조직 | 운영자 / 관리자(업체 대표) / 상담원 권한, 가입 신청 → 운영자 승인, 업체별 인원 제한, 직원별 응답 속도 |
| 모바일 | 반응형 + 홈 화면 설치(PWA) |

## 실행

Node.js 22.5 이상이 필요합니다 (내장 SQLite 사용, DB 서버 불필요).

```bash
npm install
npm run seed:demo   # 선택: 데모 데이터
npm start           # http://localhost:3000
```

첫 실행 시 운영자 계정 `admin / admin1234` 가 만들어집니다 (`ADMIN_USER`, `ADMIN_PASSWORD` 환경변수로 변경). 로그인 후 바로 비밀번호를 바꾸세요.
데모 계정: 업체 관리자 `hanbit / demo1234`, 상담원 `hanbit1 / demo1234`.

Docker: `docker build -t onetop-crm . && docker run -p 3000:3000 -v onetop:/data onetop-crm`

데이터는 `data/app.db` 한 파일에 저장됩니다. 서버리스(Vercel 등)가 아닌, 디스크가 유지되는 서버(VPS, Railway, Render, Fly.io 등)에 올려야 합니다. 메타 웹훅을 받으려면 HTTPS 주소가 필요합니다.

## 연동 설정 (로그인 → 설정)

- **메타**: 앱 Webhooks → Page → `leadgen` 구독. 콜백 `https://도메인/webhooks/meta`, 확인 토큰은 설정 화면의 값. 페이지 액세스 토큰(leads_retrieval)을 넣으면 리드 상세를 자동 조회합니다. 광고 계정 ID + ads_read 토큰을 넣으면 [광고 효율 → 메타 광고비 불러오기]로 광고 단위 광고비를 가져옵니다.
- **텔레그램**: BotFather 봇 토큰 → 봇을 방에 초대 → [채팅방 찾기]로 채팅 ID 확인. 업체별 방은 업체 관리에서 지정.
- **카카오 알림톡**: 솔라피 또는 알리고 키, 발신 프로필 키, 발신 번호. 템플릿 내용·코드는 카카오에서 검수받은 것과 같아야 합니다. 키가 없으면 "테스트 모드"로 기록만 남깁니다.
- **외부 폼·구글 시트**: `POST /webhooks/lead?key=API키` 로 JSON 또는 form 데이터를 보내면 됩니다. 설정 화면에 curl 예시와 Apps Script 코드가 있습니다.

## 구조

```
src/server.js            Express 진입점, 지연 알림톡 스케줄러
src/db.js                SQLite 스키마·설정 저장
src/services/leads.js    리드 생성·중복·배정·알림 트리거 (핵심 로직)
src/adapters/            meta.js, telegram.js, kakao.js (solapi / aligo / mock)
src/routes/api.js        로그인 후 API
src/routes/webhooks.js   메타·외부 폼 수신
src/routes/public.js     가입 신청, 랜딩페이지
public/                  화면 (의존성 없는 SPA, Chart.js)
```

## 아직 없는 것

카드 정기결제(구독 요금 청구)는 넣지 않았습니다. 등급·인원은 운영자가 승인할 때 지정합니다. 구글·네이버·카카오 광고비 API 자동 수집은 어댑터만 추가하면 되며, 지금은 직접 입력합니다.
