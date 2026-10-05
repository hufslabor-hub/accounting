# 도메인 규칙 (화면 숫자 = 같은 계산)

## 원칙
- **상태 전이·마감 검사·월 누적·목별 집행액**은 `domain.js` 순수 함수만 사용한다.
- 승인 건이 바뀌면 **집계 무효화는 `invalidateReportAggregates(plan)` 한곳**으로만 한다.
  - `plan` 은 `ShowMeDomain.buildInvalidation` / `invalidationForEntryChange` 결과.

## 상태 전이
| From | To | 의미 |
|------|-----|------|
| input-complete | submitted | 결의 |
| submitted | approved | 승인 |
| submitted | input-complete | 반려 |
| approved (등) | submitted | 승인 취소 |
| approved (등) | input-complete | 수정 재오픈 |
| rejected | input-complete | 복원 |

## 테스트
```bash
node domain.test.js
```

## 캐시 버전
```bash
node stamp-version.mjs
```
`index.html`의 `APP_BUILD`가 갱신되고, 로드 시 `style.css`·`app.js`에 `?v=`가 붙습니다.
