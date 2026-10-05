/**
 * 노동조합비 → 국세청 전자기부금영수증(40 종교단체외일반(지정)) 변환 규칙
 * DOM/라이브러리 비의존. 입력은 모두 "2차원 배열(rows)" 입니다.
 *
 * Node 테스트: node donation.test.js
 * 브라우저: index.html 에서 donation-ui.js 보다 먼저 로드
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShowMeDonation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    applyCode: '01', // 01 신규
    donationKind: '1 : 금전기부',
    orgCode: '421', // 노동조합비
    idPrefix: 'hufs'
  });

  const SOURCES = Object.freeze({
    union: '노동조합',
    research: '연구산학협력단',
    welfare: '후생파트',
    publish: '지식출판콘텐츠원'
  });

  // ---------- 기본 변환 ----------
  const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const normName = (v) => String(v == null ? '' : v).replace(/\s+/g, '');
  const isBlank = (v) => v == null || String(v).trim() === '';

  function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (isBlank(v)) return NaN;
    const s = String(v).replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  /** 주민등록번호(하이픈 유무 무관) → 13자리 숫자 문자열. 아니면 null */
  function normRrn(v) {
    const d = digits(v);
    return d.length === 13 ? d : null;
  }

  /** 주민등록번호 → 생년월일 YYYYMMDD (뒷자리 첫 숫자로 세기 판별) */
  function birthFromRrn(rrn) {
    const d = digits(rrn);
    if (d.length < 13) return '';
    const century = { 1: 1900, 2: 1900, 5: 1900, 6: 1900, 3: 2000, 4: 2000, 7: 2000, 8: 2000, 9: 1800, 0: 1800 }[d[6]];
    if (!century) return '';
    return String(century + Number(d.slice(0, 2))) + d.slice(2, 6);
  }

  /** '1978/12/20', '1978-12-20', 19781220 → '19781220' */
  function normBirth(v) {
    const d = digits(v);
    return d.length === 8 ? d : '';
  }

  const maskRrn = (rrn) => {
    const d = digits(rrn);
    return d.length === 13 ? d.slice(0, 6) + '-' + d[6] + '******' : '';
  };

  function findHeaderRow(rows, mustHave, maxScan) {
    const lim = Math.min((rows || []).length, maxScan || 20);
    for (let i = 0; i < lim; i++) {
      const cells = (rows[i] || []).map((c) => String(c == null ? '' : c).trim());
      if (mustHave.every((k) => cells.some((c) => c === k || c.startsWith(k)))) return i;
    }
    return -1;
  }
  const colOf = (headerRow, key) =>
    (headerRow || []).findIndex((c) => String(c == null ? '' : c).trim().startsWith(key));

  // ---------- 원본 3종 파서 ----------
  /** 노동조합(대학) 공제 파일: 성명 / 공제액 / 적용년월. 소계·합계 행(성명 없음)은 제외 */
  function parseUnion(rows) {
    const h = findHeaderRow(rows, ['성명', '공제액']);
    if (h < 0) throw new Error('노동조합 파일에서 "성명", "공제액" 제목 행을 찾지 못했습니다.');
    const head = rows[h];
    const cName = colOf(head, '성명');
    const cAmt = colOf(head, '공제액');
    const cYm = colOf(head, '적용년월');
    const cDept = colOf(head, '소속부서');
    const cRrn = colOf(head, '주민');
    const items = [];
    const skipped = [];
    let ym = '';
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = normName(r[cName]);
      if (!name) continue; // 소계/합계
      if (!ym && cYm >= 0 && digits(r[cYm]).length === 6) ym = digits(r[cYm]);
      const amount = toNumber(r[cAmt]);
      if (!(amount > 0)) {
        skipped.push({ source: 'union', name, reason: '공제액 없음' });
        continue;
      }
      const rrn = cRrn >= 0 ? normRrn(r[cRrn]) : null;
      items.push({ source: 'union', name, amount, birth: rrn ? birthFromRrn(rrn) : '', rrn, note: cDept >= 0 ? String(r[cDept] || '') : '' });
    }
    return { items, skipped, ym };
  }

  /** 연구산학협력단 공제내역: 제목에서 연월, 성명/생년월일/노동조합비/비고 */
  function parseResearch(rows) {
    const h = findHeaderRow(rows, ['성명', '노동조합비']);
    if (h < 0) throw new Error('연구산학협력단 파일에서 "성명", "노동조합비" 제목 행을 찾지 못했습니다.');
    const head = rows[h];
    const cName = colOf(head, '성명');
    const cBirth = colOf(head, '생년월일');
    const cAmt = colOf(head, '노동조합비');
    const cMemo = colOf(head, '비고');
    const cDept = colOf(head, '부서');
    const cRrn = colOf(head, '주민');
    let ym = '';
    for (let i = 0; i < h && !ym; i++) {
      for (const c of rows[i] || []) {
        const m = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(String(c == null ? '' : c));
        if (m) {
          ym = m[1] + String(m[2]).padStart(2, '0');
          break;
        }
      }
    }
    const items = [];
    const skipped = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = normName(r[cName]);
      if (!name) continue;
      const amount = toNumber(r[cAmt]);
      if (!(amount > 0)) {
        const memo = cMemo >= 0 && !isBlank(r[cMemo]) ? String(r[cMemo]).trim() : '금액 없음';
        skipped.push({ source: 'research', name, reason: memo });
        continue;
      }
      items.push({
        source: 'research',
        name,
        amount,
        birth: cBirth >= 0 ? normBirth(r[cBirth]) : '',
        rrn: cRrn >= 0 ? normRrn(r[cRrn]) : null,
        note: cDept >= 0 ? String(r[cDept] || '') : ''
      });
    }
    return { items, skipped, ym };
  }

  /**
   * 후생파트: 연도별 시트(시트명 '2026년 ' 등), 월 열 제목 '3월' 또는 '3월 노동조합비'.
   * sheetMap: { 시트명: rows }, 금액 칸의 '정년퇴직' 같은 글자는 제외 사유로 기록.
   */
  function parseWelfare(sheetMap, year, month) {
    const key = Object.keys(sheetMap || {}).find((k) => {
      const m = /^\s*(\d{4})\s*년/.exec(k);
      return m && Number(m[1]) === Number(year);
    });
    if (!key) throw new Error(`후생파트 파일에 ${year}년 시트가 없습니다.`);
    const rows = sheetMap[key];
    const h = findHeaderRow(rows, ['이름']);
    if (h < 0) throw new Error(`후생파트 ${year}년 시트에서 "이름" 제목 행을 찾지 못했습니다.`);
    const head = rows[h];
    const cName = colOf(head, '이름');
    const cRrn = colOf(head, '주민');
    const re = new RegExp('^\\s*' + Number(month) + '월(\\s|$)');
    const cAmt = head.findIndex((c) => re.test(String(c == null ? '' : c)));
    if (cAmt < 0) throw new Error(`후생파트 ${year}년 시트에서 ${month}월 열을 찾지 못했습니다.`);
    const items = [];
    const skipped = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = normName(r[cName]);
      if (!name) continue; // 합계
      const raw = r[cAmt];
      const amount = toNumber(raw);
      if (!(amount > 0)) {
        skipped.push({ source: 'welfare', name, reason: isBlank(raw) ? `${month}월 금액 없음` : String(raw).trim() });
        continue;
      }
      const rrn = cRrn >= 0 ? normRrn(r[cRrn]) : null;
      items.push({ source: 'welfare', name, amount, birth: rrn ? birthFromRrn(rrn) : '', rrn, note: '' });
    }
    return { items, skipped, ym: String(year) + String(month).padStart(2, '0') };
  }

  /** 영수증 40번 시트 rows → [{ name, rrn, amount }] (주민번호가 있는 행만) */
  function parseReceiptRows(rows) {
    const h = findHeaderRow(rows, ['주민등록번호', '성명'], 10);
    if (h < 0) throw new Error('영수증 40번 시트에서 "주민등록번호", "성명" 제목 행을 찾지 못했습니다.');
    const cR = colOf(rows[h], '주민등록번호');
    const cN = colOf(rows[h], '성명');
    const cA = colOf(rows[h], '기부금액합계');
    const out = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const rrn = normRrn(r[cR]);
      const name = normName(r[cN]);
      if (rrn && name) out.push({ name, rrn, amount: cA >= 0 && toNumber(r[cA]) > 0 ? toNumber(r[cA]) : 0 });
    }
    return out;
  }

  // ---------- 주민번호 기준 명단 ----------
  function createRegistry() {
    const byName = new Map();
    const api = {
      add(name, rrn) {
        const n = normName(name);
        const d = normRrn(rrn);
        if (!n || !d) return;
        const list = byName.get(n) || [];
        if (!list.some((x) => x.rrn === d)) list.push({ rrn: d, birth: birthFromRrn(d) });
        byName.set(n, list);
      },
      /** 영수증 40번 시트 rows(초기 명단 가져오기용)에서 성명/주민번호 수집. 추가한 건수 반환 */
      addFromReceiptRows(rows) {
        const list = parseReceiptRows(rows);
        list.forEach((p) => api.add(p.name, p.rrn));
        return list.length;
      },
      /** { 주민번호: 성명 } — Firestore 저장 형태 */
      toMap() {
        const m = {};
        byName.forEach((list, name) => list.forEach((c) => (m[c.rrn] = name)));
        return m;
      },
      addFromMap(map) {
        Object.keys(map || {}).forEach((rrn) => api.add(map[rrn], rrn));
      },
      hasRrn(rrn) {
        const d = normRrn(rrn);
        let found = false;
        byName.forEach((list) => list.forEach((c) => c.rrn === d && (found = true)));
        return found;
      },
      candidates(name) {
        return (byName.get(normName(name)) || []).slice();
      },
      get size() {
        let c = 0;
        byName.forEach((v) => (c += v.length));
        return c;
      }
    };
    return api;
  }

  /**
   * 지식출판콘텐츠원 등 수동 입력 인원 → parse 결과 형태. 금액이 없거나 0이면 제외 목록.
   * members: [{ name, amount }]
   */
  function parseManual(members) {
    const items = [];
    const skipped = [];
    (members || []).forEach((m) => {
      const name = normName(m.name);
      if (!name) return;
      const amount = toNumber(m.amount);
      if (!(amount > 0)) skipped.push({ source: 'publish', name, reason: '금액 없음' });
      else items.push({ source: 'publish', name, amount, birth: '', rrn: null, note: '' });
    });
    return { items, skipped, ym: '' };
  }

  /**
   * 한 건의 주민번호 확정.
   * status: ok | missing(명단에 없음) | ambiguous(동명이인, 생년월일 없음) | mismatch(생년월일 불일치)
   */
  function resolveRrn(item, registry) {
    if (item.rrn) return { status: 'ok', rrn: item.rrn, candidates: [] };
    const cands = registry.candidates(item.name);
    if (item.birth) {
      const hit = cands.filter((c) => c.birth === item.birth);
      if (hit.length === 1) return { status: 'ok', rrn: hit[0].rrn, candidates: [] };
      if (hit.length > 1) return { status: 'ambiguous', rrn: null, candidates: hit };
      return { status: cands.length ? 'mismatch' : 'missing', rrn: null, candidates: cands };
    }
    if (cands.length === 1) return { status: 'ok', rrn: cands[0].rrn, candidates: [] };
    if (cands.length > 1) return { status: 'ambiguous', rrn: null, candidates: cands };
    return { status: 'missing', rrn: null, candidates: [] };
  }

  /**
   * 파싱 결과를 합쳐 미리보기 항목을 만든다. (노동조합 → 연구산학 → 후생 → 지식출판콘텐츠원 순)
   * 원본 파일에 주민번호가 있으면(노동조합·후생) 그 값을 우선 쓰고, 없으면(연구산학) 기준 명단에서 이름+생년월일로 찾는다.
   */
  function buildItems(parsed, registry) {
    const all = [];
    const skipped = [];
    ['union', 'research', 'welfare', 'publish'].forEach((k) => {
      const p = parsed[k];
      if (!p) return;
      skipped.push(...p.skipped);
      all.push(...p.items);
    });
    // 파일에 주민번호가 있는데 기준 명단(전월 영수증)의 같은 이름과 다르면 경고
    all.forEach((it) => {
      const cands = registry.candidates(it.name);
      it.conflict = !!(it.rrn && cands.length && !cands.some((c) => c.rrn === it.rrn));
    });
    all.forEach((it) => it.rrn && registry.add(it.name, it.rrn));
    const items = all.map((it, idx) => {
      const r = resolveRrn(it, registry);
      return { id: idx, ...it, rrn: r.rrn, status: r.status, candidates: r.candidates };
    });
    // 같은 주민번호가 두 번 나오면 경고
    const seen = new Map();
    items.forEach((it) => {
      if (!it.rrn) return;
      if (seen.has(it.rrn)) {
        it.dup = true;
        items[seen.get(it.rrn)].dup = true;
      } else seen.set(it.rrn, it.id);
    });
    return { items, skipped };
  }

  const isRrnComplete = (items) => items.every((it) => !!normRrn(it.rrn));

  /** 관리번호: hufs + YYYYMM + 3자리 순번 (한 사람이 12개월 내 중복되지 않도록 월을 포함) */
  const makeManagementNo = (ym, seq, prefix) => (prefix || DEFAULTS.idPrefix) + ym + String(seq).padStart(3, '0');

  /**
   * 40번 시트 데이터 행(10열) 생성.
   * 신청구분코드, 주민등록번호, 성명, 기부내용구분, 관리번호, 단체코드, 기부일자, 합계, 공제대상, 장려금
   */
  function toReceiptRows(items, opts) {
    const o = { ...DEFAULTS, ...opts };
    const date = digits(o.date);
    if (date.length !== 8) throw new Error('기부일자가 올바르지 않습니다.');
    if (!/^\d{6}$/.test(o.ym)) throw new Error('대상 연월이 올바르지 않습니다.');
    const bad = items.filter((it) => !normRrn(it.rrn));
    if (bad.length) throw new Error(`주민등록번호가 없는 항목이 ${bad.length}건 있습니다: ${bad.map((b) => b.name).join(', ')}`);
    return items.map((it, i) => [
      o.applyCode,
      normRrn(it.rrn),
      it.name,
      o.donationKind,
      makeManagementNo(o.ym, i + 1, o.idPrefix),
      o.orgCode,
      date,
      it.amount,
      it.amount,
      0
    ]);
  }

  return {
    DEFAULTS,
    SOURCES,
    digits,
    normName,
    toNumber,
    normRrn,
    normBirth,
    birthFromRrn,
    maskRrn,
    parseUnion,
    parseResearch,
    parseWelfare,
    parseManual,
    parseReceiptRows,
    createRegistry,
    resolveRrn,
    buildItems,
    isRrnComplete,
    makeManagementNo,
    toReceiptRows
  };
});
