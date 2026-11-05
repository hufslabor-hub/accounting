/**
 * 쇼미더머니 — 내역 처리의 순수 규칙 (DOM/Firebase 비의존, Node에서 테스트 가능)
 *
 *  1) 한국 시간(KST) 날짜·승인월·승인일   seoulParts / entryApprovalDateKey / entryApprovalMonth / entryApprovalYear
 *  2) 승인일 오름차순 정렬                compareByApprovalDateAsc
 *  3) 감사 이력                           withAudit / describeAuditEvent / unapprovedCopy
 *  4) 여러 건 한꺼번에 입력(CSV·TXT)      decodeImportBuffer / parseDelimitedText / buildBulkImportItems
 *
 * Node 테스트: node entry-tools.test.js
 * 브라우저: index.html 에서 app.js 보다 먼저 로드 (window.ShowMeEntryTools)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShowMeEntryTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ───────── 1) 한국 시간(KST) ─────────

  /** 한국 시간 기준 날짜·시각 → {date:'YYYY-MM-DD', time:'HH:MM:SS'} (기기 시간대와 무관) */
  function seoulParts(date) {
    const d = date === undefined ? new Date() : date;
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    const g = (type) => p.find((x) => x.type === type).value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}:${g('second')}` };
  }

  /** 승인번호의 날짜 부분 'YYYYMMDD' (한국 시간 기준) */
  function paymentDateKey(date) {
    return seoulParts(date).date.replace(/-/g, '');
  }

  const monthNo = (m) => parseInt(m, 10) || 0;

  /** 거래 결제일 기준 월(1~12), 알 수 없으면 0 */
  function entryTxnMonth(t) {
    const fromMonth = monthNo(t && t.month);
    if (fromMonth) return fromMonth;
    const d = String((t && t.date) || '');
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (iso) return parseInt(iso[2], 10) || 0;
    const kor = /(\d{1,2})\s*월/.exec(d);
    if (kor) return parseInt(kor[1], 10) || 0;
    return 0;
  }

  /** approvedAt(ISO, UTC 저장)을 한국 시간 연·월로 변환 */
  function approvalSeoulParts(t) {
    if (!t || !t.approvedAt) return null;
    const d = new Date(t.approvedAt);
    if (Number.isNaN(d.getTime())) return null;
    const [y, m] = seoulParts(d).date.split('-');
    const year = Number(y) || 0;
    const month = Number(m) || 0;
    return year && month ? { year, month } : null;
  }

  /**
   * 승인일 키 'YYYY-MM-DD' (정렬·표시).
   * approvedAt은 UTC로 저장되므로 앞 10자리를 그대로 쓰면 한국 시간 새벽(0~9시) 승인이 하루 전으로 보인다
   * → 한국 시간으로 바꿔서 쓴다. approvedAt이 없으면 승인번호(YYYYMMDD…) 앞 8자리, 최후에 결제일.
   */
  function entryApprovalDateKey(t) {
    if (t && t.approvedAt) {
      const d = new Date(t.approvedAt);
      if (!Number.isNaN(d.getTime())) return seoulParts(d).date;
    }
    const mgmt = String((t && t.managementNo) || '');
    if (/^\d{8}/.test(mgmt)) return `${mgmt.slice(0, 4)}-${mgmt.slice(4, 6)}-${mgmt.slice(6, 8)}`;
    return (t && t.date) || '';
  }

  /** 승인 월(1~12) — 결제일과 무관. 우선순위: acctMonth → 승인번호 → approvedAt(한국 시간) → 결제일 */
  function entryApprovalMonth(t) {
    const acct = Number(t && t.acctMonth) || 0;
    if (acct >= 1 && acct <= 12) return acct;
    const mgmt = String((t && t.managementNo) || '');
    if (/^\d{8}/.test(mgmt)) return parseInt(mgmt.slice(4, 6), 10) || 0;
    const seoul = approvalSeoulParts(t);
    if (seoul) return seoul.month;
    return entryTxnMonth(t);
  }

  function entryApprovalYear(t) {
    const acctY = Number(t && t.acctYear) || 0;
    if (acctY) return acctY;
    const mgmt = String((t && t.managementNo) || '');
    if (/^\d{8}/.test(mgmt)) return parseInt(mgmt.slice(0, 4), 10) || 0;
    const seoul = approvalSeoulParts(t);
    if (seoul) return seoul.year;
    const d = String((t && t.date) || '');
    return parseInt(d.slice(0, 4), 10) || 0;
  }

  // ───────── 2) 승인일 오름차순 정렬 ─────────

  /** 승인일 → 승인번호 → 결제일 → id 순 (오래된 승인이 먼저) */
  function compareByApprovalDateAsc(a, b) {
    const ka = entryApprovalDateKey(a);
    const kb = entryApprovalDateKey(b);
    return (ka || '').localeCompare(kb || '')
      || String(a.managementNo || '').localeCompare(String(b.managementNo || ''), 'ko', { numeric: true })
      || (a.date || '').localeCompare(b.date || '')
      || String(a.id || '').localeCompare(String(b.id || ''));
  }

  // ───────── 3) 감사 이력 ─────────

  const AUDIT_LOG_MAX = 40;

  /**
   * 내역 사본에 감사 이력 한 줄을 덧붙인다 (원본은 바꾸지 않음).
   * at: 같은 처리(일괄 처리 등)에 속한 내역은 같은 시각을 넘겨 화면에서 한 줄로 묶이게 한다.
   * Firestore는 undefined 값을 저장하지 못하므로 undefined/null 항목은 뺀다.
   */
  function withAudit(entry, action, detail, at, actor) {
    const clean = Object.fromEntries(Object.entries(detail || {}).filter(([, v]) => v !== undefined && v !== null));
    const log = Array.isArray(entry.auditLog) ? entry.auditLog.slice(-(AUDIT_LOG_MAX - 1)) : [];
    log.push({ at: at || new Date().toISOString(), by: actor || '', action, ...clean });
    return { ...entry, auditLog: log };
  }

  /** 이력 한 줄의 설명 문장. statusLabel: {상태값: 표시이름} */
  function describeAuditEvent(ev, statusLabel) {
    const labels = statusLabel || {};
    switch (ev.action) {
      case 'submit':
        return `결의${ev.resolutionNo ? ` · 결의번호 ${ev.resolutionNo}` : ''}`;
      case 'approve': {
        const actual = ev.at ? seoulParts(new Date(ev.at)).date : '';
        return `승인 · 승인번호 ${ev.managementNo || '-'} · 승인일 ${ev.approvalDate || '-'}`
          + (ev.specified ? ` ⚠ 승인일을 직접 지정함 (실제 처리일 ${actual})` : '');
      }
      case 'unapprove':
        return `승인 취소${ev.bulk ? ' (일괄)' : ''} · 이전 승인번호 ${ev.managementNo || '-'}`
          + (ev.approvalDate ? ` (승인일 ${ev.approvalDate}${ev.specified ? ', 직접 지정' : ''})` : '');
      case 'reject':
        return `반려${ev.resolutionNo ? ` · 결의번호 ${ev.resolutionNo}` : ''}`;
      case 'edit-reopen':
        return `수정을 위해 입력 내역으로 되돌림 (이전 상태: ${labels[ev.fromStatus] || ev.fromStatus || '-'})`;
      default:
        return String(ev.action || '');
    }
  }

  /**
   * 승인 취소된 내역 사본: 결의완료(승인 대기)로 되돌리고 승인 관련 값을 지운다.
   * 승인번호만 지우고 결의번호(submissionSequence)는 유지. 취소 사실은 감사 이력에 누적.
   * opts: {bulk, at, actor}
   */
  function unapprovedCopy(entry, opts) {
    const o = opts || {};
    const next = {
      ...entry, status: 'submitted', locked: false,
      approvalCancelledAt: new Date().toISOString(),
      approvalCancelledBy: o.actor || ''
    };
    ['approvedAt', 'approvedBy', 'paidAt', 'paidBy', 'confirmedAt', 'confirmedBy', 'acctMonth', 'acctYear',
      'approvalActualAt', 'approvalDateSpecified'].forEach((key) => { delete next[key]; });
    if (next.submissionSequence != null && String(next.submissionSequence).trim() !== '') {
      next.managementNo = String(next.submissionSequence);
    } else {
      delete next.managementNo;
    }
    return withAudit(next, 'unapprove', {
      managementNo: String(entry.managementNo || ''),
      approvalDate: entryApprovalDateKey(entry) || '',
      specified: !!entry.approvalDateSpecified,
      bulk: !!o.bulk
    }, o.at, o.actor);
  }

  // ───────── 4) 여러 건 한꺼번에 입력 ─────────

  const BULK_IMPORT_ALIASES = {
    gubun: ['구분', '수입지출', '수입/지출'],
    date: ['결제일', '결제일자', '날짜', '일자', '거래일'],
    mok: ['세부계정과목', '계정과목', '세부계정', '목'],
    desc: ['내용', '적요', '내역'],
    payee: ['지급처', '거래처', '사용처'],
    amount: ['금액', '금액(원)', '지출액'],
    spender: ['담당자', '입력자', '사용자', '담당'],
    gwan: ['관'],
    hang: ['항']
  };
  const BULK_IMPORT_DEFAULT_ORDER = ['gubun', 'date', 'mok', 'desc', 'payee', 'amount', 'spender'];

  function normalizeCategoryName(name, suffix) {
    return String(name || '').trim().replace(new RegExp(`${suffix}$`), '').trim();
  }

  /** 결제일 입력 해석: YYYY-MM-DD / YYYYMMDD / YYYY.MM.DD / YYYY/MM/DD. 달력에 없는 날짜는 ''. */
  function parseEntryDate(value) {
    const raw = String(value || '').trim();
    const normalized = /^\d{8}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : raw.replace(/[./]/g, '-');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) return '';
    const [, year, month, day] = match;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
      return '';
    }
    return normalized;
  }

  /** 일괄 입력용 느슨한 날짜: 2026.9.7 · 2026년 9월 7일 도 허용 */
  function parseLooseDate(value) {
    const t = String(value || '').trim().replace(/\s+/g, '');
    const m = /^(\d{4})[-./년](\d{1,2})[-./월](\d{1,2})일?$/.exec(t);
    return parseEntryDate(m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : t);
  }

  /** 금액: 쉼표·공백·원·₩ 제거, (5,000)은 음수. 정수가 아니면 NaN */
  function parseLooseAmount(value) {
    let t = String(value || '').replace(/[,\s원₩]/g, '');
    const paren = /^\((.*)\)$/.exec(t);
    if (paren) t = '-' + paren[1];
    if (!/^-?\d+$/.test(t)) return NaN;
    return Number(t);
  }

  /** 파일 바이트 → 문자열 (UTF-8 우선, 엑셀 한글 CSV는 CP949/EUC-KR, 유니코드 텍스트는 UTF-16) */
  function decodeImportBuffer(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes).replace(/^\uFEFF/, '');
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes).replace(/^\uFEFF/, '');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (error) {
      return new TextDecoder('euc-kr').decode(bytes);
    }
  }

  /** 탭·쉼표·세미콜론 구분 텍스트 → 행 배열 (따옴표로 감싼 칸, 칸 안의 쉼표·줄바꿈 지원) */
  function parseDelimitedText(text) {
    const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const firstLine = src.split('\n').find((line) => line.trim() !== '') || '';
    const count = (ch) => firstLine.split(ch).length - 1;
    const delimiter = count('\t') > 0 ? '\t' : (count(',') >= count(';') ? ',' : ';');
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    const pushCell = () => { row.push(cell); cell = ''; };
    const pushRow = () => { pushCell(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"' && cell === '') { inQuotes = true; }
      else if (ch === delimiter) { pushCell(); }
      else if (ch === '\n') { pushRow(); }
      else cell += ch;
    }
    if (cell !== '' || row.length) pushRow();
    return rows;
  }

  function hasAccount(accountCategories, type, classification) {
    if (classification.mok === '대학노조회비') return false;
    return ((accountCategories && accountCategories[type]) || []).some((gwan) =>
      gwan.name === classification.gwan && (gwan.accounts || []).some((hang) =>
        hang.name === classification.hang && (hang.items || []).includes(classification.mok)));
  }

  /**
   * 행 배열 → 검증된 미리보기 항목 [{line, errors, warnings, entry|null, include, view}]
   * defaults: {gubun, spender}   ctx: {ledger, accountCategories, fiscalYear}
   */
  function buildBulkImportItems(rows, defaults, ctx) {
    const d = defaults || {};
    const c = ctx || {};
    const ledger = c.ledger || [];
    const accountCategories = c.accountCategories || { income: [], expense: [] };
    const fiscalYearEnd = `${c.fiscalYear}-12-31`;
    if (!rows.length) return [];
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    const headerKeys = rows[0].map((cell) => {
      const key = norm(cell);
      return Object.keys(BULK_IMPORT_ALIASES).find((name) => BULK_IMPORT_ALIASES[name].some((alias) => norm(alias) === key)) || null;
    });
    const hasHeader = headerKeys.filter(Boolean).length >= 2 && (headerKeys.includes('date') || headerKeys.includes('amount'));
    const columns = hasHeader ? headerKeys : BULK_IMPORT_DEFAULT_ORDER;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const firstLine = hasHeader ? 2 : 1;
    const existingKeys = new Set(ledger.map((t) => [t.date, t.gubun, t.amount, (t.payee || '').trim(), (t.desc || '').trim()].join('|')));
    const batchKeys = new Set();
    const gubunDefault = d.gubun === '수입' ? '수입' : '지출';

    return dataRows.map((cells, index) => {
      const raw = {};
      columns.forEach((name, col) => { if (name && raw[name] === undefined) raw[name] = String(cells[col] == null ? '' : cells[col]).trim(); });
      const errors = [], warnings = [];

      let gubun = raw.gubun || gubunDefault;
      if (['입금', '수입', 'income'].includes(gubun.toLowerCase())) gubun = '수입';
      else if (['출금', '지출', 'expense'].includes(gubun.toLowerCase())) gubun = '지출';
      else { errors.push(`구분은 수입/지출 중 하나여야 합니다 (${gubun})`); }

      const date = parseLooseDate(raw.date);
      if (!date) errors.push('결제일 형식 오류 (YYYY-MM-DD, YYYYMMDD, YYYY.M.D 가능)');
      else if (date > fiscalYearEnd) errors.push(`${c.fiscalYear} 회계연도 이후 날짜`);

      const desc = raw.desc || '';
      if (!desc) errors.push('내용 없음');

      const amount = parseLooseAmount(raw.amount);
      if (!Number.isInteger(amount) || amount === 0) errors.push('금액은 0이 아닌 정수 (환불은 음수)');

      let classification = null;
      const type = gubun === '수입' ? 'income' : 'expense';
      if (!raw.mok) {
        errors.push('세부 계정과목(목) 없음');
      } else if (gubun === '수입' || gubun === '지출') {
        const matches = [];
        (accountCategories[type] || []).forEach((gwan) => (gwan.accounts || []).forEach((hang) => (hang.items || []).forEach((mok) => {
          if (mok.trim() !== raw.mok.trim()) return;
          if (raw.gwan && normalizeCategoryName(gwan.name, '_관') !== normalizeCategoryName(raw.gwan, '_관')) return;
          if (raw.hang && normalizeCategoryName(hang.name, '_항') !== normalizeCategoryName(raw.hang, '_항')) return;
          const candidate = { gwan: gwan.name, hang: hang.name, mok };
          if (hasAccount(accountCategories, type, candidate)) matches.push(candidate);
        })));
        if (matches.length === 1) classification = matches[0];
        else if (!matches.length) errors.push(`등록되지 않은 ${gubun} 목: ${raw.mok}`);
        else errors.push(`'${raw.mok}'이(가) 여러 분류에 있습니다 — 관·항 열로 지정하세요 (${matches.map((m) => `${normalizeCategoryName(m.gwan, '_관')}/${normalizeCategoryName(m.hang, '_항')}`).join(', ')})`);
      }

      const spender = raw.spender || (d.spender || '').trim();
      if (!spender) warnings.push('담당자 없음');

      const payee = raw.payee || '';
      if (!errors.length) {
        const key = [date, gubun, amount, payee, desc].join('|');
        if (existingKeys.has(key)) warnings.push('이미 같은 내역이 있습니다(중복 의심)');
        else if (batchKeys.has(key)) warnings.push('이 목록 안에 같은 내역이 있습니다(중복 의심)');
        batchKeys.add(key);
      }
      const entry = errors.length ? null : {
        date, month: (parseInt(date.split('-')[1], 10)) + '월', gubun, desc, payee, spender, amount,
        gwan: classification.gwan, hang: classification.hang, category: classification.mok
      };
      const duplicate = warnings.some((w) => w.includes('중복'));
      return {
        line: firstLine + index, errors, warnings, entry, include: !!entry && !duplicate,
        view: { gubun, date: date || raw.date || '', mok: raw.mok || '', desc, payee, amount: Number.isFinite(amount) ? amount : raw.amount, spender }
      };
    });
  }

  return {
    seoulParts, paymentDateKey, entryTxnMonth, approvalSeoulParts,
    entryApprovalDateKey, entryApprovalMonth, entryApprovalYear, compareByApprovalDateAsc,
    AUDIT_LOG_MAX, withAudit, describeAuditEvent, unapprovedCopy,
    normalizeCategoryName, parseEntryDate, parseLooseDate, parseLooseAmount,
    decodeImportBuffer, parseDelimitedText, hasAccount, buildBulkImportItems
  };
});
