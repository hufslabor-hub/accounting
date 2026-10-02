# accounting
한국외국어대학교 노동조합 회계

## Firebase 설정

이 앱은 담당자 인증에 Firebase Authentication의 Google 로그인을, 공용 자료 저장에 Cloud Firestore를 사용합니다.

1. Firebase Console에서 **Authentication → 로그인 방법 → Google**을 사용 설정하고 Firestore 데이터베이스를 만듭니다.
2. **Authentication → 설정 → 승인된 도메인**에 배포된 사이트의 호스트명을 추가합니다. Google 로그인은 HTTPS 사이트에서 실행해야 합니다. `file://`로 직접 여는 방식은 지원하지 않습니다.
3. Firebase 웹 앱 설정을 [firebase-config.js](./firebase-config.js)에 둡니다. 웹 앱 설정은 공개 식별 정보이며, Admin SDK 서비스 계정 키나 비공개 키는 절대 넣지 마세요.
4. [firestore.rules](./firestore.rules)의 규칙을 **Firestore Database → 규칙**에 게시합니다.
5. 담당자가 Google로 최초 로그인하면 화면에 Firebase Authentication UID가 표시됩니다. Firestore에 `allowedUsers/{UID}` 문서를 만들면 해당 계정에 읽기·쓰기 권한이 부여됩니다. 문서 ID는 로그인 화면의 UID와 정확히 일치해야 합니다. 관리 참고용으로 `email` 필드를 추가할 수 있습니다.

Firestore의 `accountingData` 컬렉션에 연도별 자료가 저장되고 브라우저 간 실시간으로 동기화됩니다. Firestore에 자료 문서가 없을 때 같은 브라우저의 이전 로컬 자료가 있으면 먼저 복사하고, 없으면 기본 자료를 초기화합니다. 기존 거래 내역의 관·항·목 분류도 자동으로 이전됩니다.
