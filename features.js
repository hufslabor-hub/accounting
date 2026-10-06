/**
 * 쇼미더머니 — 화면 기능의 순수 규칙 (DOM/Firebase 비의존, Node에서 테스트 가능)
 *
 *  1) 입력 시 예산 잔액 표시   budgetStatus / approvedSpentFromSummary / pendingSpent
 *  2) 월 마감 증빙 묶음        groupForBundle / bundlePlan / dataUrlToBytes
 *  3) 중복 입력 경고           findDuplicates
 *  4) 검색·필터·엑셀 내보내기  parseAmount / filterEntries / entriesToRows
 *  5) 설정 문서 동시 저장 충돌 isCasKey / casConflict
 *
 * Node 테스트: node features.test.js
 * 브라우저: index.html 에서 app.js 보다 먼저 로드
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShowMeFeatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const APPROVED = ['approved', 'paid', 'confirmed'];
  const PENDING = ['input-complete', 'submitted'];

  const str = (v) => (v == null ? '' : String(v));
  /** 검색·비교용: 공백 제거 + 소문자 + 한글 정규화 */
  const norm = (v) => str(v).normalize('NFC').replace(/\s+/g, '').toLowerCase();

  /** '1,000' → 1000, '' → null, 숫자가 아니면 NaN */
  function parseAmount(v) {
    if (v == null) return null;
    const s = str(v).replace(/[,\s원]/g, '');
    if (s === '') return null;
    if (!/^-?\d+$/.test(s)) return NaN;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : NaN;
  }

  // ---------- 1) 예산 잔액 ----------
  /**
   * 한 목(관·항·목)의 예산 상태.
   * @param {object} p  { type:'income'|'expense', budget, approved, pending, newAmount }
   *   approved: 승인된 금액 합계, pending: 입력완료·결의완료(미승인) 합계, newAmount: 지금 입력 중인 금액(없으면 0)
   * @returns level: 'ok' | 'warn'(80% 이상) | 'over'(예산 초과) | 'nobudget'(예산 없음·지출 없음) | 'info'(수입)
   */
  function budgetStatus(p) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const budget = num(p.budget);
    const approved = num(p.approved);
    const pending = num(p.pending);
    const newAmount = num(p.newAmount);
    const used = approved + pending;
    const usedAfter = used + newAmount;
    const out = {
      type: p.type === 'income' ? 'income' : 'expense',
      budget,
      approved,
      pending,
      used,
      remaining: budget - used,
      newAmount,
      remainingAfter: budget - usedAfter,
      pctNow: budget > 0 ? (used / budget) * 100 : null,
      pctAfter: budget > 0 ? (usedAfter / budget) * 100 : null,
      overBy: Math.max(0, usedAfter - budget),
      level: 'ok'
    };
    if (out.type === 'income') {
      out.level = 'info';
      out.overBy = 0;
      return out;
    }
    if (budget <= 0) {
      out.level = usedAfter > 0 ? 'over' : 'nobudget';
      out.overBy = Math.max(0, usedAfter);
    } else if (usedAfter > budget) {
      out.level = 'over';
    } else if ((usedAfter / budget) * 100 >= 80) {
      out.level = 'warn';
    }
    return out;
  }

  /**
   * 보고서 집계(report-summary)의 cells 에서 한 목의 승인 합계.
   * cells 키: JSON.stringify([월, 구분(수입/지출), 관, 항, 목]) → {a:금액, n:건수}
   */
  function approvedSpentFromSummary(cells, gubun, gwan, hang, category) {
    let sum = 0;
    Object.keys(cells || {}).forEach((key) => {
      let k;
      try {
        k = JSON.parse(key);
      } catch (e) {
        return;
      }
      if (!Array.isArray(k)) return;
      if (k[1] === gubun && k[2] === gwan && k[3] === hang && k[4] === category) sum += Number(cells[key].a) || 0;
    });
    return sum;
  }

  /** 아직 승인되지 않은(입력완료·결의완료) 내역 중 같은 목의 합계. excludeId: 지금 수정 중인 내역 */
  function pendingSpent(entries, target, opts) {
    const o = opts || {};
    const resolve = typeof o.resolve === 'function' ? o.resolve : (e) => ({ gwan: e.gwan, hang: e.hang, category: e.category });
    let sum = 0;
    (entries || []).forEach((e) => {
      if (!PENDING.includes(e.status)) return;
      if (o.excludeId && e.id === o.excludeId) return;
      if (e.gubun !== target.gubun) return;
      const r = resolve(e) || {};
      if (r.gwan === target.gwan && r.hang === target.hang && r.category === target.category) sum += Number(e.amount) || 0;
    });
    return sum;
  }

  // ---------- 3) 중복 입력 ----------
  /**
   * 같은 결제일 + 같은 금액 + 같은 지급처(공백·대소문자 무시)인 기존 내역.
   * 지급처가 비어 있으면 비교하지 않는다(우연의 일치가 너무 많음).
   */
  function findDuplicates(entries, cand, opts) {
    const payee = norm(cand.payee);
    const blank = cand.amount === null || cand.amount === undefined || cand.amount === '';
    const amount = blank ? NaN : Number(cand.amount);
    if (!payee || !cand.date || !Number.isFinite(amount)) return [];
    const excludeId = opts && opts.excludeId;
    return (entries || [])
      .filter(
        (e) =>
          e.id !== excludeId &&
          e.date === cand.date &&
          Number(e.amount) === amount &&
          norm(e.payee) === payee &&
          (!e.gubun || !cand.gubun || e.gubun === cand.gubun)
      )
      .sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)) || str(a.id).localeCompare(str(b.id)));
  }

  // ---------- 4) 검색·필터 ----------
  const SEARCH_FIELDS = ['desc', 'payee', 'spender', 'category', 'gwan', 'hang', 'managementNo', 'resolutionNo'];

  /** text: 공백으로 나눈 단어가 모두 들어 있어야 함(AND). min/max: 금액 절댓값 범위(포함) */
  function filterEntries(entries, f) {
    const filter = f || {};
    const tokens = str(filter.text)
      .split(/\s+/)
      .map(norm)
      .filter(Boolean);
    const min = parseAmount(filter.min);
    const max = parseAmount(filter.max);
    return (entries || []).filter((e) => {
      if (tokens.length) {
        const hay = norm(SEARCH_FIELDS.map((k) => e[k]).join(' ') + ' ' + str(e._searchExtra));
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      const amt = Math.abs(Number(e.amount) || 0);
      if (Number.isFinite(min) && min !== null && amt < Math.abs(min)) return false;
      if (Number.isFinite(max) && max !== null && amt > Math.abs(max)) return false;
      return true;
    });
  }

  function isFilterActive(f) {
    if (!f) return false;
    return !!(str(f.text).trim() || parseAmount(f.min) !== null || parseAmount(f.max) !== null);
  }

  /**
   * 엑셀 내보내기용 2차원 배열.
   * mode 'report': 결제일·구분·관·항·목·내용·지급처·담당자·수입·지출·관리번호 (+합계 행)
   * mode 'entry' : 결의번호·결제일·구분·관·항·목·내용·지급처·담당자·금액·상태·승인번호
   */
  function entriesToRows(entries, opts) {
    const o = opts || {};
    const strip = (v) => str(v).replace(/_(관|항)$/, '');
    const statusLabel = o.statusLabel || ((s) => s);
    if (o.mode === 'entry') {
      const rows = [['결의번호', '결제일', '구분', '관', '항', '목', '내용', '지급처', '담당자', '금액', '상태', '승인번호']];
      entries.forEach((e) => {
        rows.push([
          o.resolutionNo ? o.resolutionNo(e) || '' : '',
          str(e.date),
          str(e.gubun),
          strip(e.gwan),
          strip(e.hang),
          str(e.category),
          str(e.desc),
          str(e.payee),
          str(e.spender),
          Number(e.amount) || 0,
          statusLabel(e.status),
          o.approvalNo ? o.approvalNo(e) || '' : ''
        ]);
      });
      return rows;
    }
    const rows = [['결제일', '구분', '관', '항', '목', '내용', '지급처', '담당자', '수입', '지출', '관리번호']];
    let income = 0;
    let expense = 0;
    entries.forEach((e) => {
      const amt = Number(e.amount) || 0;
      if (e.gubun === '수입') income += amt;
      else if (e.gubun === '지출') expense += amt;
      rows.push([
        str(e.date),
        str(e.gubun),
        strip(e.gwan),
        strip(e.hang),
        str(e.category),
        str(e.desc),
        str(e.payee),
        str(e.spender),
        e.gubun === '수입' ? amt : '',
        e.gubun === '지출' ? amt : '',
        str(e.managementNo)
      ]);
    });
    rows.push(['합계', `${entries.length}건`, '', '', '', '', '', '', income, expense, '']);
    return rows;
  }

  // ---------- 2) 월 마감 증빙 묶음 ----------
  /** 파일·폴더 이름 한 조각: 금지 문자 치환, 길이 제한 */
  function sanitizePart(text, max) {
    const limit = max || 40;
    let s = str(text)
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '');
    if (s.length > limit) s = s.slice(0, limit).trim();
    return s || '이름없음';
  }

  /** 같은 경로가 있으면 " (2)" 를 확장자 앞에 붙여 겹치지 않게 한다 */
  function uniquePath(path, used) {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const hasExt = dot > slash + 1;
    const base = hasExt ? path.slice(0, dot) : path;
    const ext = hasExt ? path.slice(dot) : '';
    for (let i = 2; i < 1000; i++) {
      const next = `${base} (${i})${ext}`;
      if (!used.has(next)) {
        used.add(next);
        return next;
      }
    }
    throw new Error('파일 이름을 만들지 못했습니다.');
  }

  function receiptExt(receipt) {
    const type = str(receipt && receipt.type).toLowerCase();
    const map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
    if (map[type]) return map[type];
    const m = /\.([a-z0-9]{2,5})$/i.exec(str(receipt && receipt.name));
    return m ? m[1].toLowerCase() : 'bin';
  }

  /** 승인된 내역 → 지급 묶음(관리번호) 단위 그룹. 관리번호 순, 관리번호 없는 묶음은 뒤로 */
  function groupForBundle(entries) {
    const map = new Map();
    (entries || []).forEach((e) => {
      const spender = str(e.spender).trim();
      const key = e.managementNo ? String(e.managementNo) : `관리번호없음-${spender || '담당자없음'}`;
      if (!map.has(key)) map.set(key, { key, managementNo: e.managementNo ? String(e.managementNo) : '', entries: [] });
      map.get(key).entries.push(e);
    });
    const groups = [...map.values()].map((g) => {
      g.entries.sort((a, b) => str(a.date).localeCompare(str(b.date)) || str(a.id).localeCompare(str(b.id)));
      g.spenders = [...new Set(g.entries.map((e) => str(e.spender).trim()).filter(Boolean))];
      g.spender = g.spenders.join('·') || '담당자없음';
      g.total = g.entries.reduce((sum, e) => sum + (e.gubun === '수입' ? -1 : 1) * (Number(e.amount) || 0), 0);
      g.approvedAt = g.entries.map((e) => e.approvedAt).filter(Boolean).sort().slice(-1)[0] || '';
      return g;
    });
    groups.sort((a, b) => {
      if (!!a.managementNo !== !!b.managementNo) return a.managementNo ? -1 : 1;
      return a.key.localeCompare(b.key);
    });
    return groups;
  }

  /**
   * ZIP 안의 파일 목록 계획.
   * @param {object} p { year, month(1~12), groups, receipts: Map|object(entryId→{type,name}) }
   */
  function bundlePlan(p) {
    const mm = String(p.month).padStart(2, '0');
    const root = `${p.year}-${mm}월_증빙묶음`;
    const used = new Set();
    const has = (id) => (p.receipts instanceof Map ? p.receipts.get(id) : p.receipts && p.receipts[id]);
    const items = [{ kind: 'workbook', path: uniquePath(`${root}/00_${p.year}-${mm}월_승인내역.xlsx`, used) }];
    p.groups.forEach((g, gi) => {
      const label = `${String(gi + 1).padStart(2, '0')}_${sanitizePart(g.managementNo || g.key, 30)}_${sanitizePart(g.spender, 20)}_${Math.abs(g.total)}원`;
      const folder = `${root}/${label}`;
      items.push({ kind: 'pdf', groupKey: g.key, path: uniquePath(`${folder}/지급신청서.pdf`, used) });
      g.entries.forEach((e, ei) => {
        const rec = has(e.id);
        if (!rec) return;
        const name = `${String(ei + 1).padStart(2, '0')}_${sanitizePart(e.date, 10)}_${sanitizePart(e.payee || e.desc, 20)}_${Math.abs(Number(e.amount) || 0)}원.${receiptExt(rec)}`;
        items.push({ kind: 'receipt', groupKey: g.key, entryId: e.id, path: uniquePath(`${folder}/영수증/${name}`, used) });
      });
    });
    return { root, items };
  }

  /** data:...;base64,xxxx → Uint8Array (브라우저 atob / Node Buffer 모두 지원) */
  function dataUrlToBytes(dataUrl) {
    const s = str(dataUrl);
    const i = s.indexOf(',');
    if (i < 0) throw new Error('데이터 형식이 올바르지 않습니다.');
    const b64 = s.slice(i + 1);
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  // ---------- 5) 설정 문서 동시 저장 충돌 ----------
  const CAS_PREFIXES = ['budget:', 'categories:', 'staff-names:', 'staff-bank-details:', 'staff-groups:', 'quick-templates:', 'years:', 'account-balance:'];
  const isCasKey = (key) => CAS_PREFIXES.some((p) => str(key).startsWith(p));

  /**
   * base: 이 화면이 마지막으로 읽은 값(모르면 undefined), serverValue: 지금 서버 값(문서가 없으면 null).
   * 값이 달라졌으면 다른 담당자가 먼저 저장한 것 → 덮어쓰지 않는다.
   */
  function casConflict(base, serverValue) {
    if (base === undefined) return false;
    return base !== serverValue;
  }

  return {
    APPROVED,
    PENDING,
    norm,
    parseAmount,
    budgetStatus,
    approvedSpentFromSummary,
    pendingSpent,
    findDuplicates,
    filterEntries,
    isFilterActive,
    entriesToRows,
    sanitizePart,
    uniquePath,
    receiptExt,
    groupForBundle,
    bundlePlan,
    dataUrlToBytes,
    CAS_PREFIXES,
    isCasKey,
    casConflict
  };
});
