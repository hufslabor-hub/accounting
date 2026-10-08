/**
 * 화면 기능 규칙 테스트 — 브라우저 없이 실행:
 *   node features.test.js
 */
const F = require('./features.js');
let passed = 0;
let failed = 0;
const assert = (c, m) => {
  c ? passed++ : failed++;
  console.log(c ? '  ✓' : '  ✗', m);
};

console.log('1) 금액 해석');
assert(F.parseAmount('1,000') === 1000 && F.parseAmount(' 50,000원 ') === 50000, '쉼표·원 제거');
assert(F.parseAmount('') === null && F.parseAmount(null) === null, '빈 값은 null');
assert(Number.isNaN(F.parseAmount('12a')) && Number.isNaN(F.parseAmount('1.5')), '숫자가 아니면 NaN');
assert(F.parseAmount('-5000') === -5000, '음수(환불)');
assert(F.parseAmount('₩50,000') === 50000 && F.parseAmount('￦50,000') === 50000, '원 기호(₩)');
assert(F.parseAmount('△50,000') === -50000 && F.parseAmount('(50,000)') === -50000 && F.parseAmount('-₩50,000') === -50000, '△·괄호·기호 뒤 음수');
assert(F.parseAmount('５０，０００') === 50000, '전각 숫자·쉼표');
assert(Number.isNaN(F.parseAmount('₩')) && Number.isNaN(F.parseAmount('-')), '기호만 있으면 NaN');

console.log('2) 예산 잔액·경고');
const ok = F.budgetStatus({ type: 'expense', budget: 1000000, approved: 300000, pending: 100000, newAmount: 0 });
assert(ok.remaining === 600000 && ok.level === 'ok', '여유 있으면 ok');
const warn = F.budgetStatus({ type: 'expense', budget: 1000000, approved: 700000, pending: 50000, newAmount: 60000 });
assert(warn.level === 'warn' && warn.remainingAfter === 190000, '80% 이상이면 warn');
const over = F.budgetStatus({ type: 'expense', budget: 1000000, approved: 900000, pending: 50000, newAmount: 80000 });
assert(over.level === 'over' && over.overBy === 30000 && over.remainingAfter === -30000, '예산 초과면 over, 초과액 계산');
const exact = F.budgetStatus({ type: 'expense', budget: 1000, approved: 500, pending: 0, newAmount: 500 });
assert(exact.level === 'warn' && exact.overBy === 0, '딱 맞게 쓰면 초과 아님');
const refund = F.budgetStatus({ type: 'expense', budget: 1000, approved: 900, pending: 0, newAmount: -400 });
assert(refund.level === 'ok' && refund.remainingAfter === 500, '환불(음수)은 잔여를 늘림');
const none = F.budgetStatus({ type: 'expense', budget: 0, approved: 0, pending: 0, newAmount: 0 });
assert(none.level === 'nobudget', '예산·지출 모두 없으면 nobudget');
const noBudgetSpend = F.budgetStatus({ type: 'expense', budget: 0, approved: 0, pending: 0, newAmount: 5000 });
assert(noBudgetSpend.level === 'over', '예산 없이 지출하면 over');
const inc = F.budgetStatus({ type: 'income', budget: 1000, approved: 2000, pending: 0, newAmount: 0 });
assert(inc.level === 'info' && inc.overBy === 0, '수입은 경고 없이 info');

console.log('3) 집계·미승인 합계');
const cells = {
  [JSON.stringify(['1월', '지출', '사업비_관', '조직_항', '조직강화비'])]: { a: 100, n: 1 },
  [JSON.stringify(['2월', '지출', '사업비_관', '조직_항', '조직강화비'])]: { a: 250, n: 2 },
  [JSON.stringify(['2월', '지출', '사업비_관', '조직_항', '다른목'])]: { a: 999, n: 1 },
  [JSON.stringify(['2월', '수입', '사업비_관', '조직_항', '조직강화비'])]: { a: 777, n: 1 }
};
assert(F.approvedSpentFromSummary(cells, '지출', '사업비_관', '조직_항', '조직강화비') === 350, '월별 칸을 합산, 다른 목·수입 제외');
const led = [
  { id: 'a', status: 'input-complete', gubun: '지출', gwan: 'G', hang: 'H', category: 'M', amount: 100 },
  { id: 'b', status: 'submitted', gubun: '지출', gwan: 'G', hang: 'H', category: 'M', amount: 50 },
  { id: 'c', status: 'approved', gubun: '지출', gwan: 'G', hang: 'H', category: 'M', amount: 999 },
  { id: 'd', status: 'rejected', gubun: '지출', gwan: 'G', hang: 'H', category: 'M', amount: 888 },
  { id: 'e', status: 'input-complete', gubun: '지출', gwan: 'G', hang: 'H', category: 'X', amount: 7 }
];
const tgt = { gubun: '지출', gwan: 'G', hang: 'H', category: 'M' };
assert(F.pendingSpent(led, tgt) === 150, '입력완료+결의완료만 합산');
assert(F.pendingSpent(led, tgt, { excludeId: 'a' }) === 50, '수정 중인 내역은 제외');

console.log('4) 중복 입력');
const base = [
  { id: '1', date: '2026-03-02', amount: 50000, payee: '배달의민족', gubun: '지출', status: 'approved' },
  { id: '2', date: '2026-03-02', amount: 50000, payee: '배달의 민족', gubun: '지출', status: 'input-complete', createdAt: '2026-03-02T01:00:00Z' },
  { id: '3', date: '2026-03-03', amount: 50000, payee: '배달의민족', gubun: '지출' },
  { id: '4', date: '2026-03-02', amount: 40000, payee: '배달의민족', gubun: '지출' }
];
const dups = F.findDuplicates(base, { date: '2026-03-02', amount: 50000, payee: ' 배달의민족 ', gubun: '지출' });
assert(dups.length === 2 && dups.map((d) => d.id).join() === '1,2', '날짜·금액·지급처(공백 무시)가 같으면 중복');
assert(F.findDuplicates(base, { date: '2026-03-02', amount: 50000, payee: '배달의민족' }, { excludeId: '1' }).length === 1, '수정 중인 내역은 제외');
assert(F.findDuplicates(base, { date: '2026-03-02', amount: 50000, payee: '' }).length === 0, '지급처가 비면 검사하지 않음');
assert(F.findDuplicates([{ id: 'z', date: '2026-03-02', amount: 0, payee: 'a' }], { date: '2026-03-02', amount: null, payee: 'a' }).length === 0, '금액이 비어 있으면 0원과 비교하지 않음');
assert(F.findDuplicates(base, { date: '2026-03-02', amount: 50000, payee: '배달의민족', gubun: '수입' }).length === 0, '구분이 다르면 중복 아님');

console.log('5) 검색·필터');
const rows = [
  { id: '1', desc: '집행부 회의 식비', payee: '배달의민족', spender: '임창석', category: '임원/중집/대의원회의비', amount: 50000, managementNo: '20260302001' },
  { id: '2', desc: '사무용품', payee: '다이소', spender: '장혜정', category: '사무실운영비', amount: 12000 },
  { id: '3', desc: '환불', payee: '다이소', spender: '장혜정', category: '사무실운영비', amount: -12000 },
  { id: '4', desc: '교육', payee: '강사', spender: '임창석', category: '교육비', amount: 300000 }
];
assert(F.filterEntries(rows, { text: '회의 식비' }).length === 1, '단어 여러 개는 모두 포함(AND)');
assert(F.filterEntries(rows, { text: '다이소' }).length === 2, '지급처 검색');
assert(F.filterEntries(rows, { text: '20260302' }).length === 1, '관리번호 검색');
assert(F.filterEntries(rows, { text: '임창석', min: '100,000' }).map((r) => r.id).join() === '4', '검색 + 최소 금액');
assert(F.filterEntries(rows, { min: '10000', max: '50000' }).length === 3, '금액 범위(경계 포함, 환불은 절댓값)');
assert(F.filterEntries(rows, {}).length === 4 && !F.isFilterActive({}), '조건이 없으면 전체');
assert(F.isFilterActive({ text: ' ' }) === false && F.isFilterActive({ max: '1' }) === true, '필터 활성 판별');

console.log('6) 엑셀 행');
const rep = F.entriesToRows(
  [
    { date: '2026-03-02', gubun: '지출', gwan: '사업비_관', hang: '조직_항', category: '조직강화비', desc: 'a', payee: 'b', spender: 'c', amount: 100, managementNo: 'M1' },
    { date: '2026-03-03', gubun: '수입', gwan: '조합비_관', hang: '조합비_항', category: '조합비', desc: 'd', payee: '', spender: '', amount: 300 }
  ],
  { mode: 'report' }
);
assert(rep[0].length === 11 && rep[1][2] === '사업비' && rep[1][9] === 100 && rep[2][8] === 300, '보고서 행: 접미사 제거·수입/지출 분리');
assert(rep[3][0] === '합계' && rep[3][8] === 300 && rep[3][9] === 100, '합계 행');
const ent = F.entriesToRows([{ id: 'x', date: '2026-03-02', gubun: '지출', amount: 5, status: 'approved' }], {
  mode: 'entry',
  resolutionNo: () => 'R-1',
  approvalNo: () => 'A-1',
  statusLabel: () => '승인'
});
assert(ent[1][0] === 'R-1' && ent[1][10] === '승인' && ent[1][11] === 'A-1' && ent[1][9] === 5, '결의 내역 행');

console.log('7) 증빙 묶음 계획');
assert(F.sanitizePart('a/b:c*?') === 'a_b_c__' && F.sanitizePart('  ') === '이름없음', '파일명 금지 문자');
assert(F.sanitizePart('가'.repeat(100), 10).length === 10, '길이 제한');
const used = new Set();
assert(F.uniquePath('a/b.pdf', used) === 'a/b.pdf' && F.uniquePath('a/b.pdf', used) === 'a/b (2).pdf', '경로 중복 시 (2) 부여');
assert(F.receiptExt({ type: 'image/jpeg' }) === 'jpg' && F.receiptExt({ type: 'application/pdf' }) === 'pdf' && F.receiptExt({ name: 'x.HEIC' }) === 'heic', '영수증 확장자');
const approved = [
  { id: 'e2', date: '2026-03-05', amount: 2000, payee: '다이소', desc: 'x', spender: '장혜정', managementNo: '20260305001', gubun: '지출', approvedAt: '2026-03-05T05:00:00Z' },
  { id: 'e1', date: '2026-03-02', amount: 1000, payee: '문구/점', desc: 'y', spender: '장혜정', managementNo: '20260305001', gubun: '지출', approvedAt: '2026-03-05T05:00:00Z' },
  { id: 'e3', date: '2026-03-01', amount: 500, payee: '', desc: '식비', spender: '임창석', managementNo: '20260301001', gubun: '지출' },
  { id: 'e4', date: '2026-03-09', amount: 700, payee: 'z', desc: 'q', spender: '', gubun: '지출' }
];
const groups = F.groupForBundle(approved);
assert(groups.length === 3 && groups[0].managementNo === '20260301001' && groups[2].managementNo === '', '관리번호 순, 번호 없는 묶음은 뒤로');
assert(groups[1].total === 3000 && groups[1].entries[0].id === 'e1', '묶음 합계·날짜순');
const plan = F.bundlePlan({ year: 2026, month: 3, groups, receipts: new Map([['e1', { type: 'image/jpeg' }], ['e3', { type: 'application/pdf' }]]) });
assert(plan.root === '2026-03월_증빙묶음' && plan.items[0].kind === 'workbook', '루트 폴더·승인내역 엑셀');
assert(plan.items.filter((i) => i.kind === 'pdf').length === 3, '묶음마다 지급신청서 PDF');
const rc = plan.items.filter((i) => i.kind === 'receipt');
assert(rc.length === 2 && /문구_점_1000원\.jpg$/.test(rc.find((r) => r.entryId === 'e1').path), '영수증 파일명(금지 문자 치환)');
assert(new Set(plan.items.map((i) => i.path)).size === plan.items.length, '모든 경로가 서로 다름');
const bytes = F.dataUrlToBytes('data:text/plain;base64,SGVsbG8=');
assert(Buffer.from(bytes).toString() === 'Hello', 'data URL → 바이트');
let threw = false;
try {
  F.dataUrlToBytes('abc');
} catch (e) {
  threw = true;
}
assert(threw, '잘못된 data URL은 오류');

console.log('8) 동시 저장 충돌(CAS)');
assert(F.isCasKey('budget:2026') && F.isCasKey('staff-names:list') && !F.isCasKey('ledger:2026') && !F.isCasKey('month-closure:2026'), '대상 키 판별');
assert(F.casConflict(undefined, 'x') === false, '처음 쓰는 키는 검사하지 않음');
assert(F.casConflict('a', 'a') === false && F.casConflict('a', 'b') === true, '값이 달라졌으면 충돌');
assert(F.casConflict(null, null) === false && F.casConflict(null, 'x') === true, '없던 문서를 다른 사람이 만들었으면 충돌');

console.log('9) 이월 자료(엑셀) 읽기·분류 맞추기');
const sheet = require('fs').existsSync(__dirname + '/fixtures/carryover-rows.json') ? require('./fixtures/carryover-rows.json') : null;
const defaults = {
  income: [
    { name: '조합비_관', accounts: [{ name: '조합비_항', items: ['조합비(외대)', '조합비(후생)', '조합비(산단)', '조합비(지출원)'] }] },
    { name: '창립행사지원금_관', accounts: [{ name: '창립행사지원금_항', items: ['창립행사지원금(학교)'] }] },
    { name: '전기이월금_관', accounts: [{ name: '전기이월금_항', items: ['전기이월금'] }] },
    { name: '이자수입_관', accounts: [{ name: '이자수입_항', items: ['이자수입'] }] },
    { name: '기금회계전입금_관', accounts: [{ name: '기금회계전입금_항', items: ['기금회계 전입금'] }] },
    { name: '기타수입_기부금등_관', accounts: [{ name: '기타수입_기부금등_항', items: ['기타수입(기부금 등)'] }] }
  ],
  expense: [
    { name: '운영비_관', accounts: [{ name: '사무실운영비_항', items: ['사무실운영비'] }, { name: '신문도서비_항', items: ['신문도서비'] }, { name: '통신비_SMS등_항', items: ['통신비(SMS 등)'] }] },
    { name: '사업비_관', accounts: [
      { name: '조직사업비_항', items: ['조직강화비', '생일축하사업비', '부서별간담회비', '소모임지원비'] },
      { name: '교육사업비_항', items: ['대의원/중집수련회비', '간부/교섭위원교육비'] },
      { name: '홍보사업비_항', items: ['홍보물/선전물제작비', '홈페이지 관리비'] },
      { name: '정책사업비_항', items: ['정책개발비', '법률자문비'] },
      { name: '후생복지사업비_항', items: ['경조비', '퇴직조합원기념품구입비', '포상비', '문화사업지원비'] },
      { name: '연대사업비_항', items: ['교내외 연대사업비'] }] },
    { name: '회의비_관', accounts: [{ name: '임원중집위회의비_항', items: ['임원/중집/대의원회의비'] }, { name: '단체교섭회의비_항', items: ['단체교섭회의비'] }, { name: '회계감사선관위회의비_항', items: ['회계감사/선관위회의비'] }] },
    { name: '행사비_관', accounts: [{ name: '조합원총회비_항', items: ['조합원총회비'] }, { name: '창립기념행사비_항', items: ['창립기념행사비'] }, { name: '야외행사비_항', items: ['야외행사비'] }, { name: '퇴직조합원환송회비_항', items: ['퇴직조합원 환송회비'] }, { name: '노동절행사비_항', items: ['노동절행사비'] }] },
    { name: '활동비_관', accounts: [{ name: '중앙집행위원활동비_항', items: ['중앙집행위원활동비'] }, { name: '대의원활동비_항', items: ['대의원활동비'] }] },
    { name: '예비비_관', accounts: [{ name: '교통유류비_항', items: ['교통유류비'] }, { name: '예비비_항', items: ['예비비'] }] },
    { name: '조합비환불비_관', accounts: [{ name: '조합비환불비_항', items: ['조합비환불비'] }] },
    { name: '차기이월금_관', accounts: [{ name: '차기이월금_항', items: ['차기이월금'] }] }
  ]
};
if (sheet) {
  const parsed = F.parseCarryOverRows(sheet);
  assert(parsed.items.length === 42, `항목 42개를 읽음 (수입 9, 지출 33) → ${parsed.items.length}`);
  assert(parsed.totals.income === 17350274 && parsed.totals.expense === 128947119, '엑셀의 수입·지출 총계 읽기');
  const sum = (g) => parsed.items.filter((i) => i.gubun === g).reduce((s, i) => s + i.amount, 0);
  assert(sum('수입') === 17350274 && sum('지출') === 128947119, '항목 합계가 엑셀 총계와 일치(조합비 합계 행은 이중 계산 안 함)');
  assert(!parsed.items.some((i) => /합계|총계|계정과목/.test(i.label)), '합계·총계·제목 행 제외');
  const outer = parsed.items.find((i) => i.label === '외대');
  assert(outer && outer.parents.join('') === '조합비' && outer.amount === 420998, '조합비 하위 항목은 큰 분류와 함께 읽음');
  const unmatched = [];
  parsed.items.forEach((it) => {
    if (!F.suggestMok(it, defaults)) unmatched.push(it.label);
  });
  assert(unmatched.join('|') === '대학노조회비', `기본 분류표에 없는 것은 대학노조회비뿐 → ${unmatched.join('|')}`);
  const pick = (label) => {
    const it = parsed.items.find((x) => x.label === label);
    const r = F.suggestMok(it, defaults);
    return r && r.mok;
  };
  assert(pick('외대') === '조합비(외대)' && pick('산학협력') === '조합비(산단)' && pick('후생파트') === '조합비(후생)' && pick('지출원') === '조합비(지출원)', '조합비 4종 연결');
  assert(pick('생일축하사업') === '생일축하사업비' && pick('간부.교섭위원교육') === '간부/교섭위원교육비' && pick('교통비.유류비') === '교통유류비', '이름이 다른 항목 연결');
  assert(pick('회계감사.선거관리위원 회의') === '회계감사/선관위회의비' && pick('대의원(17명)') === '대의원활동비', '괄호·구두점이 다른 항목 연결');
  assert(pick('조합비 환불') === '조합비환불비' && pick('예비비') === '예비비', '환불·예비비 연결');
}
const withUnion = JSON.parse(JSON.stringify(defaults));
withUnion.expense[0].accounts.push({ name: '대학노조회비_항', items: ['대학노조회비'] });
assert(F.suggestMok({ gubun: '지출', label: '대학노조회비', parents: [] }, withUnion).mok === '대학노조회비', '분류표에 있으면 대학노조회비도 연결');
assert(F.suggestMok({ gubun: '지출', label: '없는항목', parents: [] }, defaults) === null, '못 찾으면 null');
const built = F.buildCarryOverEntries({
  rows: [
    { gubun: '수입', label: '외대', amount: 420998, gwan: '조합비_관', hang: '조합비_항', mok: '조합비(외대)' },
    { gubun: '지출', label: '사무실운영비', amount: 100, gwan: '운영비_관', hang: '사무실운영비_항', mok: '사무실운영비' }
  ],
  baseDate: '2026-09-30', spender: '전월 이월 자료', actor: 'a@b.c', submissionSequence: 7, managementNo: '20260930001', nowISO: '2026-10-07T00:00:00.000Z'
});
assert(built.length === 2 && built[0].id === 'carry_20260930_001' && built[1].id === 'carry_20260930_002', '결정적인 문서 번호');
assert(built[0].status === 'approved' && built[0].month === '9월' && built[0].acctMonth === 9 && built[0].acctYear === 2026, '승인 상태·9월·회계월');
assert(built[0].approvedAt === '2026-09-30T14:59:00.000Z' && built[0].confirmedAt === built[0].approvedAt && !('paidAt' in built[0]), '기준일 23:59(한국) 승인 — 수입은 확인 기록');
assert(built[1].paidAt === built[1].approvedAt && !('confirmedAt' in built[1]), '지출은 지급 기록');
assert(built[0].spender === '전월 이월 자료' && built[0].managementNo === '20260930001' && built[0].carryoverBatch === 'carryover-2026-09-30' && built[0].source === 'carryover', '담당자·승인번호·배치 표시');

console.log('\n결과:', passed, '통과,', failed, '실패');
process.exit(failed ? 1 : 0);
