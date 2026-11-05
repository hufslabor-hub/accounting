/**
 * 내역 처리 규칙 테스트 — 브라우저 없이 실행:
 *   node entry-tools.test.js
 */
const T = require('./entry-tools.js');
let passed = 0;
let failed = 0;
const assert = (c, m) => {
  c ? passed++ : failed++;
  console.log(c ? '  ✓' : '  ✗', m);
};
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}${JSON.stringify(a) === JSON.stringify(b) ? '' : `  (실제: ${JSON.stringify(a)}, 기대: ${JSON.stringify(b)})`}`);

// ─────────────────────────────────────────────
console.log('1) 한국 시간(KST) 날짜');
eq(T.seoulParts(new Date('2026-10-13T14:59:59Z')).date, '2026-10-13', 'UTC 14:59 = KST 같은 날 23:59');
eq(T.seoulParts(new Date('2026-10-13T15:00:00Z')).date, '2026-10-14', 'UTC 15:00 = KST 다음 날 00:00');
eq(T.seoulParts(new Date('2026-10-13T15:00:00Z')).time, '00:00:00', 'KST 자정은 00:00:00 (24:00 아님)');
eq(T.paymentDateKey(new Date('2026-10-13T22:00:00Z')), '20261014', '승인번호 날짜는 한국 시간 기준');
eq(T.seoulParts(new Date('2026-12-31T15:30:00Z')).date, '2027-01-01', '연말 UTC → KST 해가 바뀜');

// ─────────────────────────────────────────────
console.log('2) 승인일 키 — approvedAt은 UTC로 저장됨 (회귀: 새벽 승인이 하루 전으로 보이던 문제)');
eq(T.entryApprovalDateKey({ approvedAt: '2026-10-13T22:00:00.000Z', managementNo: '20261014001' }), '2026-10-14', '한국 시간 새벽 7시 승인 → 14일');
eq(T.entryApprovalDateKey({ approvedAt: '2026-10-14T05:00:00.000Z' }), '2026-10-14', '낮 승인은 그대로');
eq(T.entryApprovalDateKey({ approvedAt: '2026-09-30T16:00:00.000Z' }), '2026-10-01', '월말 UTC → 한국 시간 다음 달 1일');
eq(T.entryApprovalDateKey({ managementNo: '20261014002', date: '2026-09-07' }), '2026-10-14', 'approvedAt이 없으면 승인번호 앞 8자리');
eq(T.entryApprovalDateKey({ managementNo: '7', date: '2026-09-07' }), '2026-09-07', '결의번호만 있으면 결제일');
eq(T.entryApprovalDateKey({ approvedAt: 'not-a-date', managementNo: '20261014001' }), '2026-10-14', '잘못된 approvedAt은 건너뜀');
eq(T.entryApprovalDateKey(null), '', 'null 안전');

// ─────────────────────────────────────────────
console.log('3) 승인월·승인연도 우선순위 (acctMonth → 승인번호 → approvedAt → 결제일)');
eq(T.entryApprovalMonth({ acctMonth: 10, managementNo: '20260915001', month: '9월' }), 10, 'acctMonth가 최우선');
eq(T.entryApprovalMonth({ managementNo: '20261014001', month: '9월' }), 10, '승인번호 → 10월 (결제월 9월 아님)');
eq(T.entryApprovalMonth({ approvedAt: '2026-09-30T16:00:00.000Z', month: '9월' }), 10, 'approvedAt은 한국 시간 월로 변환');
eq(T.entryApprovalMonth({ month: '9월', date: '2026-09-07' }), 9, '승인 정보가 없으면 결제월');
eq(T.entryApprovalMonth({ date: '2026-09-07' }), 9, 'month 없으면 결제일에서 월 추출');
eq(T.entryApprovalMonth({ acctMonth: 13, managementNo: '20261014001' }), 10, '범위 밖 acctMonth는 무시');
eq(T.entryApprovalYear({ acctYear: 2026, managementNo: '20271014001' }), 2026, 'acctYear 최우선');
eq(T.entryApprovalYear({ managementNo: '20261014001' }), 2026, '승인번호에서 연도');
eq(T.entryApprovalYear({ approvedAt: '2026-12-31T16:00:00.000Z' }), 2027, 'approvedAt 한국 시간 기준 연도');

// ─────────────────────────────────────────────
console.log('4) 승인일 오름차순 정렬');
const sorted = [
  { id: 'c', date: '2026-09-20', managementNo: '20261020001' },
  { id: 'a2', date: '2026-09-22', managementNo: '20261014002' },
  { id: 'a1b', date: '2026-09-09', managementNo: '20261014001' },
  { id: 'a1', date: '2026-09-07', managementNo: '20261014001' },
  { id: 'b', date: '2026-09-01', managementNo: '20261003001' }
].sort(T.compareByApprovalDateAsc).map((t) => t.id);
eq(sorted, ['b', 'a1', 'a1b', 'a2', 'c'], '승인일 → 승인번호 → 결제일 순');
const early = [
  { id: 'later', approvedAt: '2026-10-14T05:00:00.000Z', managementNo: '20261014002' },
  { id: 'dawn', approvedAt: '2026-10-13T22:00:00.000Z', managementNo: '20261014001' }
].sort(T.compareByApprovalDateAsc).map((t) => t.id);
eq(early, ['dawn', 'later'], '새벽 승인(UTC 전날)도 같은 날 안에서 승인번호 순');
eq([{ id: 'x', date: '2026-10-02' }, { id: 'y', date: '2026-10-01' }].sort(T.compareByApprovalDateAsc).map((t) => t.id), ['y', 'x'], '승인 정보 없는 내역은 결제일 순');

// ─────────────────────────────────────────────
console.log('4-2) 결의일 · 결의 내역의 월 구분');
eq(T.entrySubmittedDateKey({ submittedAt: '2026-11-03T05:00:00.000Z' }), '2026-11-03', '결의일은 submittedAt의 한국 날짜');
eq(T.entrySubmittedDateKey({ submittedAt: '2026-11-03T15:30:00.000Z' }), '2026-11-04', '한국 시간 자정 이후(UTC 전날)는 다음 날');
eq(T.entrySubmittedDateKey({}), '', '결의 전 내역은 결의일 없음');
eq(T.entrySubmittedDateKey({ submittedAt: 'bad' }), '', '잘못된 값은 없음 처리');
eq(T.resolutionMonthKey({ submittedAt: '2026-10-31T15:00:00.000Z' }), '202611', '월말 한국 시간 자정은 다음 달 결의월 (결의번호 카운터 기준)');
const listCases = [
  ['결의 건: 결제월이 아니라 결의월', { status: 'submitted', month: '9월', date: '2026-09-07', submittedAt: '2026-11-03T05:00:00.000Z' }, '11월'],
  ['승인 건도 승인월이 아니라 결의월', { status: 'approved', month: '9월', submittedAt: '2026-10-10T01:00:00.000Z', approvedAt: '2026-11-04T05:00:00.000Z', acctMonth: 11, managementNo: '20261104001' }, '10월'],
  ['한국 시간 월초 새벽 결의', { status: 'submitted', month: '9월', submittedAt: '2026-10-31T16:00:00.000Z' }, '11월'],
  ['결의일이 없으면 결제월', { status: 'rejected', month: '9월', date: '2026-09-07' }, '9월'],
  ['결의일이 잘못돼도 결제월', { status: 'submitted', month: '9월', submittedAt: 'x' }, '9월']
];
listCases.forEach(([name, entry, want]) => eq(T.entryListMonth(entry), want, name));
const resolutionOrder = [
  { id: 'nov2', status: 'submitted', submissionSequence: 2, managementNo: '2', submittedAt: '2026-11-03T05:00:00.000Z', date: '2026-09-01' },
  { id: 'none', status: 'rejected', date: '2026-09-30' },
  { id: 'oct5', status: 'approved', submissionSequence: 5, managementNo: '20261014001', submittedAt: '2026-10-10T05:00:00.000Z', date: '2026-09-01' },
  { id: 'nov1', status: 'submitted', submissionSequence: 1, managementNo: '1', submittedAt: '2026-11-02T05:00:00.000Z', date: '2026-09-20' }
].sort(T.compareByResolution).map((e) => e.id);
eq(resolutionOrder, ['oct5', 'nov1', 'nov2', 'none'], '결의월 → 결의번호 순, 결의번호 없는 내역은 맨 뒤');
// 기기 시간대와 무관해야 함: 다른 시간대로 같은 계산을 돌려 본다
const { execFileSync } = require('child_process');
['America/Los_Angeles', 'Asia/Seoul', 'UTC'].forEach((tz) => {
  const out = execFileSync(process.execPath, ['-e',
    "const T=require('./entry-tools.js');process.stdout.write(T.entrySubmittedDateKey({submittedAt:'2026-11-03T15:30:00.000Z'})+'|'+T.entryListMonth({month:'9월',submittedAt:'2026-10-31T16:00:00.000Z'}))"],
  { cwd: __dirname, env: { ...process.env, TZ: tz } }).toString();
  eq(out, '2026-11-04|11월', `기기 시간대 ${tz}에서도 같은 결과`);
});

// ─────────────────────────────────────────────
console.log('5) 감사 이력 — withAudit');
const base = { id: 'e1', status: 'submitted' };
const a1 = T.withAudit(base, 'submit', { resolutionNo: '7' }, '2026-11-03T05:00:00.000Z', 'kim@union.kr');
eq(base.auditLog, undefined, '원본 내역은 바뀌지 않음');
eq(a1.auditLog, [{ at: '2026-11-03T05:00:00.000Z', by: 'kim@union.kr', action: 'submit', resolutionNo: '7' }], '한 줄 추가');
const a2 = T.withAudit(a1, 'approve', { managementNo: '20261014001', approvalDate: '2026-10-14', specified: true, skip: undefined, nothing: null }, '2026-11-03T05:10:00.000Z', 'kim@union.kr');
eq(a2.auditLog.length, 2, '누적됨');
assert(!('skip' in a2.auditLog[1]) && !('nothing' in a2.auditLog[1]), 'undefined·null 값은 제외 (Firestore는 undefined 저장 불가)');
assert(!JSON.stringify(a2, (k, v) => (v === undefined ? '__U__' : v)).includes('__U__'), '결과에 undefined 없음');
let big = base;
for (let i = 0; i < 60; i++) big = T.withAudit(big, 'reject', { resolutionNo: String(i) }, `2026-11-03T05:${String(i % 60).padStart(2, '0')}:00.000Z`, 'x');
eq(big.auditLog.length, T.AUDIT_LOG_MAX, `최근 ${T.AUDIT_LOG_MAX}건만 보관`);
eq(big.auditLog[big.auditLog.length - 1].resolutionNo, '59', '가장 최근 기록이 남음');
assert(typeof T.withAudit(base, 'reject', {}).auditLog[0].at === 'string', 'at 생략 시 현재 시각 자동');

console.log('6) 감사 이력 — 설명 문장');
eq(T.describeAuditEvent({ action: 'submit', resolutionNo: '7' }), '결의 · 결의번호 7', '결의');
const dApprove = T.describeAuditEvent({ action: 'approve', at: '2026-11-03T05:10:00.000Z', managementNo: '20261014001', approvalDate: '2026-10-14', specified: true });
assert(dApprove.includes('승인일 2026-10-14') && dApprove.includes('직접 지정') && dApprove.includes('실제 처리일 2026-11-03'), '날짜를 직접 지정한 승인은 실제 처리일과 함께 표시');
assert(!T.describeAuditEvent({ action: 'approve', at: '2026-10-14T05:00:00.000Z', managementNo: '20261014001', approvalDate: '2026-10-14', specified: false }).includes('직접 지정'), '지정하지 않은 승인에는 경고 없음');
assert(T.describeAuditEvent({ action: 'unapprove', bulk: true, managementNo: '20261014001', approvalDate: '2026-10-14' }).includes('(일괄)'), '일괄 취소 표시');
eq(T.describeAuditEvent({ action: 'edit-reopen', fromStatus: 'submitted' }, { submitted: '결의완료' }), '수정을 위해 입력 내역으로 되돌림 (이전 상태: 결의완료)', '상태 이름 치환');
eq(T.describeAuditEvent({ action: 'something-new' }), 'something-new', '알 수 없는 동작은 이름 그대로');

// ─────────────────────────────────────────────
console.log('7) 승인 취소 사본 — unapprovedCopy');
const approved = {
  id: 'e1', status: 'approved', amount: 5400, gubun: '지출', locked: true,
  submissionSequence: 7, managementNo: '20261014001', approvedAt: '2026-10-13T22:00:00.000Z', approvedBy: 'kim@union.kr',
  paidAt: '2026-10-13T22:00:00.000Z', paidBy: 'kim@union.kr', acctYear: 2026, acctMonth: 10,
  approvalActualAt: '2026-11-03T05:10:00.000Z', approvalDateSpecified: true
};
const snapshot = JSON.stringify(approved);
const un = T.unapprovedCopy(approved, { actor: 'lee@union.kr', at: '2026-11-04T01:00:00.000Z', bulk: true });
eq(JSON.stringify(approved), snapshot, '원본 내역은 바뀌지 않음');
eq(un.status, 'submitted', '결의완료(승인 대기)로 복귀');
eq(un.locked, false, '잠금 해제');
eq(un.managementNo, '7', '승인번호 제거 → 결의번호로 복귀');
eq(un.submissionSequence, 7, '결의번호 유지');
assert(['approvedAt', 'approvedBy', 'paidAt', 'paidBy', 'acctMonth', 'acctYear', 'approvalActualAt', 'approvalDateSpecified'].every((k) => !(k in un)), '승인 관련 값 모두 제거');
eq(un.approvalCancelledBy, 'lee@union.kr', '취소한 사람 기록');
const last = un.auditLog[un.auditLog.length - 1];
eq([last.action, last.managementNo, last.approvalDate, last.specified, last.bulk, last.by, last.at], ['unapprove', '20261014001', '2026-10-14', true, true, 'lee@union.kr', '2026-11-04T01:00:00.000Z'], '취소 이력: 이전 승인번호·승인일(한국 시간)·직접 지정 여부·일괄 여부');
const again = T.unapprovedCopy(T.withAudit(un, 'approve', { managementNo: '20261104001' }, '2026-11-04T02:00:00.000Z', 'kim'), { actor: 'lee@union.kr', at: '2026-11-05T01:00:00.000Z' });
eq(again.auditLog.map((e) => e.action), ['unapprove', 'approve', 'unapprove'], '취소·재승인·재취소 이력이 순서대로 누적');
const noSeq = T.unapprovedCopy({ id: 'z', status: 'approved', managementNo: '20261014001' }, {});
assert(!('managementNo' in noSeq), '결의번호가 없던 내역은 승인번호만 제거');

// ─────────────────────────────────────────────
console.log('8) 날짜·금액 해석');
eq(T.parseEntryDate('20260907'), '2026-09-07', 'YYYYMMDD');
eq(T.parseEntryDate('2026.09.07'), '2026-09-07', '점 구분');
eq(T.parseEntryDate('2026-02-30'), '', '없는 날짜는 빈 값');
eq(T.parseLooseDate('2026.9.7'), '2026-09-07', '한 자리 월·일');
eq(T.parseLooseDate('2026년 9월 7일'), '2026-09-07', '한글 날짜');
eq(T.parseLooseDate('9/7'), '', '연도 없으면 거부');
eq(T.parseLooseAmount('5,400원'), 5400, '쉼표·원');
eq(T.parseLooseAmount('₩ 44,005'), 44005, '원 기호·공백');
eq(T.parseLooseAmount('(5,000)'), -5000, '괄호는 음수');
eq(T.parseLooseAmount('-5000'), -5000, '음수');
assert(Number.isNaN(T.parseLooseAmount('1.5')) && Number.isNaN(T.parseLooseAmount('abc')) && Number.isNaN(T.parseLooseAmount('')), '정수가 아니면 NaN');

// ─────────────────────────────────────────────
console.log('9) 구분 텍스트 파서');
eq(T.parseDelimitedText('a\tb\tc\n1\t2\t3'), [['a', 'b', 'c'], ['1', '2', '3']], '탭 구분(엑셀 붙여넣기)');
eq(T.parseDelimitedText('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']], '쉼표 + CRLF');
eq(T.parseDelimitedText('a;b\n1;2'), [['a', 'b'], ['1', '2']], '세미콜론');
eq(T.parseDelimitedText('x,"회의, 식비 ""특별""",y'), [['x', '회의, 식비 "특별"', 'y']], '따옴표 안의 쉼표·큰따옴표');
eq(T.parseDelimitedText('a,"줄\n바꿈",c'), [['a', '줄\n바꿈', 'c']], '따옴표 안의 줄바꿈');
eq(T.parseDelimitedText('a,b\n\n  ,  \n1,2'), [['a', 'b'], ['1', '2']], '빈 줄·빈 칸만 있는 줄은 건너뜀');
eq(T.parseDelimitedText('\uFEFFa,b\n1,2'), [['a', 'b'], ['1', '2']], 'BOM 제거');
eq(T.parseDelimitedText(''), [], '빈 입력');
eq(T.parseDelimitedText('a,b,c\n1,2'), [['a', 'b', 'c'], ['1', '2']], '칸 수가 모자란 줄도 읽음');

console.log('10) 파일 인코딩');
const sample = '한글,내용\n';
eq(T.decodeImportBuffer(Buffer.from(sample, 'utf-8')), sample, 'UTF-8');
eq(T.decodeImportBuffer(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(sample, 'utf-8')])), sample, 'UTF-8 BOM 제거');
eq(T.decodeImportBuffer(Buffer.from([0xC7, 0xD1, 0xB1, 0xDB])), '한글', '엑셀 한글 CSV(CP949/EUC-KR)');
eq(T.decodeImportBuffer(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('한글', 'utf16le')])), '한글', 'UTF-16 LE(엑셀 유니코드 텍스트)');
eq(T.decodeImportBuffer(new Uint8Array(Buffer.from(sample, 'utf-8')).buffer), sample, 'ArrayBuffer도 처리');

// ─────────────────────────────────────────────
console.log('11) 일괄 입력 검증');
const categories = {
  income: [{ name: '사업수입_관', accounts: [{ name: '기타수입_항', items: ['잡수입'] }] }],
  expense: [
    { name: '사업비_관', accounts: [{ name: '조직강화비_항', items: ['조직강화비', '교통유류비', '대학노조회비'] }, { name: '회의비_항', items: ['회의비', '공용'] }] },
    { name: '운영비_관', accounts: [{ name: '일반_항', items: ['공용'] }] }
  ]
};
const ledger = [{ date: '2026-09-07', gubun: '지출', amount: 5400, payee: '메가커피', desc: '조직강화비 커피' }];
const ctx = { ledger, accountCategories: categories, fiscalYear: 2026 };
const build = (text, defaults) => T.buildBulkImportItems(T.parseDelimitedText(text), defaults || { gubun: '지출', spender: '' }, ctx);

let items = build('결제일\t구분\t세부 계정과목\t내용\t금액\t지급처\t담당자\n2026.9.8\t\t교통유류비\t주유\t(44,005)\t금강석유\t임창석');
eq(items.length, 1, '제목 행은 데이터에서 제외');
eq(items[0].entry && [items[0].entry.date, items[0].entry.gubun, items[0].entry.amount, items[0].entry.category, items[0].entry.hang, items[0].entry.month], ['2026-09-08', '지출', -44005, '교통유류비', '조직강화비_항', '9월'], '열 순서가 달라도 제목으로 인식, 구분 생략은 지출, 괄호 금액은 음수');
eq(items[0].line, 2, '줄 번호는 파일 기준(제목 포함)');

items = build('지출,2026-10-14,회의비,식비,배민,12000,홍길동');
eq(items[0].line, 1, '제목이 없으면 정해진 순서로 읽고 줄 번호는 1부터');
assert(items[0].entry && items[0].entry.spender === '홍길동', '제목 없는 7열 순서');

items = build('2026-10-15,교통유류비,주유,x,100', { gubun: '지출', spender: '' });
assert(items[0].errors.length > 0, '열이 모자라거나 순서가 다르면 오류로 잡힘 (제목 없을 때 날짜가 구분 칸으로 읽힘)');

items = build('결제일,목,내용,금액\n2026-10-20,잡수입,이자,120', { gubun: '수입', spender: '' });
eq(items[0].entry && items[0].entry.gubun, '수입', '현재 폼 구분(수입)이 기본값');

items = build('구분,결제일,목,내용,금액\n수입,2026-10-20,잡수입,이자,120\n입금,2026-10-21,잡수입,이자2,130\n출금,2026-10-22,교통유류비,주유,50\n기타,2026-10-22,교통유류비,주유2,50');
eq(items.map((i) => (i.entry ? i.entry.gubun : '오류')), ['수입', '수입', '지출', '오류'], '입금·출금 동의어, 알 수 없는 구분은 오류');

const errorCases = {
  '날짜 형식': '구분,결제일,목,내용,금액\n지출,2026-13-45,회의비,x,100',
  '회계연도 이후': '구분,결제일,목,내용,금액\n지출,2027-01-01,회의비,x,100',
  '내용 없음': '구분,결제일,목,내용,금액\n지출,2026-10-01,회의비,,100',
  '금액 0': '구분,결제일,목,내용,금액\n지출,2026-10-01,회의비,x,0',
  '금액 문자': '구분,결제일,목,내용,금액\n지출,2026-10-01,회의비,x,abc',
  '목 없음': '구분,결제일,목,내용,금액\n지출,2026-10-01,,x,100',
  '등록 안 된 목': '구분,결제일,목,내용,금액\n지출,2026-10-01,없는목,x,100',
  '대학노조회비 제외': '구분,결제일,목,내용,금액\n지출,2026-10-01,대학노조회비,x,100',
  '수입 목으로 지출 등록': '구분,결제일,목,내용,금액\n지출,2026-10-01,잡수입,x,100',
  '모호한 목': '구분,결제일,목,내용,금액\n지출,2026-10-01,공용,x,100'
};
Object.entries(errorCases).forEach(([name, text]) => {
  const r = build(text)[0];
  assert(r.errors.length > 0 && r.entry === null && r.include === false, `오류: ${name}`);
});
assert(build(errorCases['모호한 목'])[0].errors[0].includes('사업비/회의비'), '모호한 목은 후보 관/항을 안내');

items = build('결제일,목,관,내용,금액\n2026-10-20,공용,사업비,회의 공용,3000\n2026-10-20,공용,운영비,일반 공용,4000');
eq(items.map((i) => i.entry && i.entry.gwan), ['사업비_관', '운영비_관'], '관 열로 같은 이름의 목을 구분');
items = build('결제일,목,관,항,내용,금액\n2026-10-20,공용,사업비,회의비,회의 공용,3000');
eq(items[0].entry && items[0].entry.hang, '회의비_항', '_관·_항 접미사 없이도 매칭');

items = build('구분,결제일,목,내용,지급처,금액\n지출,2026-09-07,조직강화비,조직강화비 커피,메가커피,5400');
assert(items[0].entry && items[0].include === false && items[0].warnings.some((w) => w.includes('중복')), '이미 있는 내역은 중복 경고 + 기본 제외');
items = build('구분,결제일,목,내용,지급처,금액\n지출,2026-10-01,회의비,간식,A,1000\n지출,2026-10-01,회의비,간식,A,1000');
eq(items.map((i) => i.include), [true, false], '같은 파일 안 중복은 두 번째만 제외');

items = build('구분,결제일,목,내용,금액\n지출,2026-10-01,회의비,간식,1000');
assert(items[0].entry && items[0].warnings.includes('담당자 없음') && items[0].include, '담당자 없음은 경고일 뿐 등록 가능');
items = build('구분,결제일,목,내용,금액\n지출,2026-10-01,회의비,간식,1000', { gubun: '지출', spender: '  임창석 ' });
eq(items[0].entry.spender, '임창석', '담당자 기본값 적용(공백 제거)');
eq(build('').length, 0, '빈 입력은 항목 없음');

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
