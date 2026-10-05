/**
 * 쇼미더머니 — 순수 도메인 규칙 (DOM/Firebase 비의존)
 * 화면 숫자·상태 전이는 이 모듈의 함수만 사용하도록 한다.
 *
 * Node 테스트: node domain.test.js
 * 브라우저: index.html 에서 app.js 보다 먼저 로드
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShowMeDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APPROVED_STATES = Object.freeze(['approved', 'paid', 'confirmed']);
  const WORKFLOW_STATES = Object.freeze([
    'input-complete',
    'submitted',
    'approved',
    'paid',
    'confirmed',
    'rejected'
  ]);

  /** 허용된 상태 전이: from → Set(to). 동일 상태 유지는 별도 허용하지 않음 */
  const ALLOWED_TRANSITIONS = Object.freeze({
    'input-complete': Object.freeze(['submitted', 'rejected']), // rejected는 레거시; 삭제는 상태 전이가 아님
    submitted: Object.freeze(['approved', 'input-complete']), // 승인 또는 반려(입력으로 복귀)
    approved: Object.freeze(['submitted', 'input-complete']), // 승인 취소 / 수정 재오픈
    paid: Object.freeze(['submitted', 'input-complete']),
    confirmed: Object.freeze(['submitted', 'input-complete']),
    rejected: Object.freeze(['input-complete'])
  });

  function isApprovedStatus(status) {
    return APPROVED_STATES.includes(status);
  }

  function canTransition(fromStatus, toStatus) {
    if (!fromStatus || !toStatus) return false;
    if (fromStatus === toStatus) return true;
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    return !!(allowed && allowed.includes(toStatus));
  }

  /**
   * 마감된 월의 승인(또는 마감월 거래) 수정 가능 여부.
   * closedThrough: 0=마감 없음, N=1..N월 마감.
   * txnMonth: 거래 결제일 기준 월(1~12), 없으면 0.
   */
  function isMonthClosed(txnMonth, closedThrough) {
    const m = Number(txnMonth) || 0;
    const c = Number(closedThrough) || 0;
    return c > 0 && m > 0 && m <= c;
  }

  /**
   * 수정·승인취소·삭제 등이 막혀야 하는지.
   * @returns {{ok:boolean, reason?:string}}
   */
  function assertNotClosedForEdit(entry, closedThrough) {
    if (!entry) return { ok: false, reason: '내역이 없습니다.' };
    const txn =
      Number(entry.txnMonth) ||
      (entry.month ? parseInt(String(entry.month), 10) || 0 : 0) ||
      (entry.date && String(entry.date).length >= 7
        ? parseInt(String(entry.date).slice(5, 7), 10) || 0
        : 0);
    if (isApprovedStatus(entry.status) && isMonthClosed(txn, closedThrough)) {
      return {
        ok: false,
        reason: `${txn}월은 마감되어 수정할 수 없습니다. 마감을 취소한 뒤 시도해 주세요.`
      };
    }
    if (!isApprovedStatus(entry.status) && isMonthClosed(txn, closedThrough)) {
      // 미승인 건은 마감 후에도 결산에서 보이지만, 정책 액션에서 막을 수 있음
      return { ok: true };
    }
    return { ok: true };
  }

  function assertNotClosedForUnapprove(entry, closedThrough) {
    if (!entry) return { ok: false, reason: '내역이 없습니다.' };
    const txn =
      Number(entry.acctMonth) ||
      Number(entry.txnMonth) ||
      (entry.month ? parseInt(String(entry.month), 10) || 0 : 0);
    if (isMonthClosed(txn, closedThrough)) {
      return {
        ok: false,
        reason: `${txn}월은 마감되어 승인 취소할 수 없습니다. 마감을 취소한 뒤 시도해 주세요.`
      };
    }
    return { ok: true };
  }

  /**
   * 승인 목록 → 목 단위 집행액 (월별 누적 보고서·예산 그래프 공통).
   * list 항목: {gubun, amount, gwan?, hang?, category?}
   * keyFn: (type, gwan, hang, mok) => string  — 앱의 mokBudgetKey와 동일해야 함
   */
  function spentByMokFromList(list, keyFn) {
    const spentByMok = {};
    const toKey =
      typeof keyFn === 'function'
        ? keyFn
        : (type, gwan, hang, mok) =>
            `${type}|${gwan || '미분류'}|${hang || '미분류'}|${mok || '미분류'}`;
    (list || []).forEach((t) => {
      if (t.gubun !== '수입' && t.gubun !== '지출') return;
      const type = t.gubun === '수입' ? 'income' : 'expense';
      const gwan = t.gwan || '미분류';
      const hang = t.hang || '미분류';
      const mok = t.category || t.mok || '미분류';
      const key = toKey(type, gwan, hang, mok);
      spentByMok[key] = (spentByMok[key] || 0) + Number(t.amount || 0);
    });
    return spentByMok;
  }

  /**
   * 월 누적 합계 (1..throughMonth).
   * entries: {month|date, gubun, amount, status?}
   * onlyApproved: true면 status가 승인계열인 것만
   */
  function cumulativeTotals(entries, throughMonth, options) {
    const onlyApproved = !options || options.onlyApproved !== false;
    const through = Number(throughMonth) || 12;
    let income = 0;
    let expense = 0;
    let count = 0;
    (entries || []).forEach((t) => {
      if (onlyApproved && t.status && !isApprovedStatus(t.status)) return;
      let m =
        Number(t.txnMonth) ||
        (t.month ? parseInt(String(t.month), 10) || 0 : 0) ||
        (t.date && String(t.date).length >= 7
          ? parseInt(String(t.date).slice(5, 7), 10) || 0
          : 0);
      if (m < 1 || m > through) return;
      const amount = Number(t.amount) || 0;
      if (t.gubun === '수입') {
        income += amount;
        count += 1;
      } else if (t.gubun === '지출') {
        expense += amount;
        count += 1;
      }
    });
    return {
      income,
      expense,
      balance: income - expense,
      count,
      throughMonth: through
    };
  }

  /**
   * 집계 캐시 무효화 지시서 (순수). 앱이 이 결과를 받아 실제 변수를 갱신한다.
   * @param {'full'|'months'|'none'} level
   * @param {string[]} [months] 예: ['1월','3월']
   */
  function buildInvalidation(level, months) {
    if (level === 'full') {
      return { clearSummary: true, clearAllMonthCaches: true, dirtyMonthly: true, months: [] };
    }
    if (level === 'months') {
      const list = Array.isArray(months) ? months.filter(Boolean) : [];
      return {
        clearSummary: false,
        clearAllMonthCaches: false,
        dirtyMonthly: true,
        months: list
      };
    }
    return { clearSummary: false, clearAllMonthCaches: false, dirtyMonthly: false, months: [] };
  }

  /** 승인 전/후 비교로 어떤 무효화가 필요한지 결정 */
  function invalidationForEntryChange(before, after) {
    const was = before && isApprovedStatus(before.status);
    const will = after && isApprovedStatus(after.status);
    if (!was && !will) return buildInvalidation('none');
    const months = new Set();
    const monthOf = (e) => {
      if (!e) return null;
      if (e.month) return String(e.month).endsWith('월') ? String(e.month) : `${parseInt(e.month, 10)}월`;
      const m =
        Number(e.txnMonth) ||
        (e.date && e.date.length >= 7 ? parseInt(e.date.slice(5, 7), 10) : 0);
      return m ? `${m}월` : null;
    };
    const b = monthOf(before);
    const a = monthOf(after);
    if (b) months.add(b);
    if (a) months.add(a);
    // 금액·분류 변경 등 승인 유지 수정도 해당 월 캐시만 지움
    return buildInvalidation('months', [...months]);
  }

  return {
    APPROVED_STATES,
    WORKFLOW_STATES,
    ALLOWED_TRANSITIONS,
    isApprovedStatus,
    canTransition,
    isMonthClosed,
    assertNotClosedForEdit,
    assertNotClosedForUnapprove,
    spentByMokFromList,
    cumulativeTotals,
    buildInvalidation,
    invalidationForEntryChange
  };
});
