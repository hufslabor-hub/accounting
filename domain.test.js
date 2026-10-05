/**
 * 순수 도메인 규칙 테스트 — 브라우저 없이 실행:
 *   node domain.test.js
 */
const d = require('./domain.js');
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    console.error('  ✗', msg);
  }
}

console.log('1) 상태 전이');
assert(d.canTransition('input-complete', 'submitted'), '입력완료 → 결의완료');
assert(d.canTransition('submitted', 'approved'), '결의완료 → 승인');
assert(d.canTransition('submitted', 'input-complete'), '결의완료 → 반려(입력복귀)');
assert(d.canTransition('approved', 'submitted'), '승인 → 승인취소(결의)');
assert(d.canTransition('rejected', 'input-complete'), '반려됨 → 입력복원');
assert(!d.canTransition('input-complete', 'approved'), '입력완료에서 바로 승인 불가');
assert(!d.canTransition('approved', 'rejected'), '승인에서 반려 상태로 직접 전이 불가');

console.log('2) 마감 후 수정 거부');
const closedEntry = { status: 'approved', month: '3월', date: '2026-03-15', amount: 1000 };
assert(!d.assertNotClosedForEdit(closedEntry, 3).ok, '3월 마감 시 3월 승인건 수정 불가');
assert(d.assertNotClosedForEdit(closedEntry, 2).ok, '2월까지만 마감이면 3월 승인건 수정 가능');
assert(!d.assertNotClosedForUnapprove({ status: 'approved', acctMonth: 4 }, 4).ok, '마감월 승인취소 불가');
assert(d.assertNotClosedForUnapprove({ status: 'approved', acctMonth: 5 }, 4).ok, '미마감월 승인취소 가능');
assert(d.isMonthClosed(3, 3), 'isMonthClosed(3,3)');
assert(!d.isMonthClosed(4, 3), 'isMonthClosed(4,3) false');

console.log('3) 월 누적 합계');
const sample = [
  { gubun: '수입', amount: 10000, month: '1월', status: 'approved' },
  { gubun: '지출', amount: 3000, month: '1월', status: 'approved' },
  { gubun: '지출', amount: 2000, month: '2월', status: 'approved' },
  { gubun: '지출', amount: 9999, month: '2월', status: 'input-complete' }, // 미승인 제외
  { gubun: '수입', amount: 5000, month: '3월', status: 'approved' }
];
const upTo2 = d.cumulativeTotals(sample, 2);
assert(upTo2.income === 10000, '2월 누적 수입 10000');
assert(upTo2.expense === 5000, '2월 누적 지출 5000');
assert(upTo2.balance === 5000, '2월 누적 잔액 5000');
const upTo3 = d.cumulativeTotals(sample, 3);
assert(upTo3.income === 15000, '3월 누적 수입 15000');
assert(upTo3.expense === 5000, '3월 누적 지출 5000');

console.log('4) 목별 집행액 (화면과 동일 계산)');
const spent = d.spentByMokFromList([
  { gubun: '지출', amount: 100, gwan: '사업비_관', hang: '조직사업비_항', category: '조직강화비' },
  { gubun: '지출', amount: 50, gwan: '사업비_관', hang: '조직사업비_항', category: '조직강화비' },
  { gubun: '수입', amount: 200, gwan: '조합비_관', hang: '조합비_항', category: '조합비(외대)' }
]);
const expKey = 'expense|사업비_관|조직사업비_항|조직강화비';
const incKey = 'income|조합비_관|조합비_항|조합비(외대)';
assert(spent[expKey] === 150, '지출 목 합계 150');
assert(spent[incKey] === 200, '수입 목 합계 200');

console.log('5) 집계 무효화 지시');
const inv1 = d.invalidationForEntryChange(
  { status: 'submitted', month: '5월' },
  { status: 'approved', month: '5월' }
);
assert(inv1.dirtyMonthly === true && inv1.months.includes('5월'), '승인 시 5월 캐시 무효');
const inv2 = d.invalidationForEntryChange(
  { status: 'input-complete', month: '1월' },
  { status: 'submitted', month: '1월' }
);
assert(inv2.dirtyMonthly === false, '미승인 구간 전이는 집계 무효화 없음');
const full = d.buildInvalidation('full');
assert(full.clearSummary && full.clearAllMonthCaches, 'full 무효화');

console.log('\n결과:', passed, '통과,', failed, '실패');
process.exit(failed ? 1 : 0);
