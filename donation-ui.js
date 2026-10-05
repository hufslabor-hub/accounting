/**
 * "기부금영수증" 탭 화면. 규칙은 donation.js, 암호 xls 는 xls-protected.js, 엑셀 입출력은 SheetJS(XLSX).
 * 주민등록번호는 브라우저 메모리에서만 처리하며 서버(Firestore)에 저장하지 않습니다.
 */
(function () {
  'use strict';
  const D = window.ShowMeDonation;
  const P = window.ShowMeXlsProtected;
  const root = document.getElementById('view-donation');
  if (!D || !P || !root || typeof XLSX === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const el = {
    base: $('don-file-base'),
    union: $('don-file-union'),
    research: $('don-file-research'),
    welfare: $('don-file-welfare'),
    password: $('don-password'),
    ym: $('don-ym'),
    date: $('don-date'),
    preview: $('don-btn-preview'),
    status: $('don-status'),
    result: $('don-result'),
    summary: $('don-summary'),
    notices: $('don-notices'),
    attention: $('don-attention'),
    attentionBody: $('don-attention-body'),
    fullBody: $('don-full-body'),
    fullCount: $('don-full-count'),
    download: $('don-btn-download'),
    downloadHint: $('don-download-hint')
  };

  const state = { baseWb: null, items: [], skipped: [], ym: '', dateTouched: false };
  const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';
  const ymLabel = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;

  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    });
    kids.flat().forEach((c) => c != null && n.append(c.nodeType ? c : document.createTextNode(String(c))));
    return n;
  }

  function setStatus(msg, kind) {
    el.status.textContent = msg || '';
    el.status.className = 'don-status' + (kind ? ' ' + kind : '');
  }

  // ---------- 파일 읽기 ----------
  async function readSheets(file, label) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    try {
      if (P.isEncryptedXls(u8)) {
        const pw = el.password.value;
        if (!pw) throw new Error('암호가 걸린 파일입니다. "엑셀 파일 암호"를 입력해 주세요.');
        const { rows, sheetName } = await P.readProtectedXls(u8, pw);
        return { sheets: { [sheetName]: rows }, names: [sheetName] };
      }
      const wb = XLSX.read(u8, { type: 'array' });
      const sheets = {};
      wb.SheetNames.forEach((n) => {
        sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true });
      });
      return { sheets, names: wb.SheetNames, wb };
    } catch (e) {
      e.message = `${label}: ${e.message}`;
      throw e;
    }
  }

  const firstSheetRows = (r) => r.sheets[r.names[0]];

  // ---------- 미리보기 ----------
  async function makePreview() {
    el.result.classList.add('hidden');
    setStatus('');
    const baseFile = el.base.files[0];
    if (!baseFile) return setStatus('전월 전자기부금영수증 파일(기준 영수증)을 선택해 주세요.', 'error');
    if (!el.union.files[0] && !el.research.files[0] && !el.welfare.files[0]) {
      return setStatus('노동조합·연구산학협력단·후생파트 파일 중 하나 이상을 선택해 주세요.', 'error');
    }
    el.preview.disabled = true;
    setStatus('파일을 읽고 있습니다…');
    try {
      const notices = [];
      // 기준 영수증 → 주민번호 명단 + 출력 서식
      const base = await readSheets(baseFile, '기준 영수증');
      const sheetName = base.names.find((n) => /^\s*40/.test(n));
      if (!sheetName || !base.wb) throw new Error('기준 영수증: "40 종교단체외일반(지정)" 시트를 찾지 못했습니다. 전월 전자기부금영수증 .xls 파일을 선택해 주세요.');
      const registry = D.createRegistry();
      const regCount = registry.addFromReceiptRows(base.sheets[sheetName]);

      const parsed = {};
      const detected = [];
      if (el.union.files[0]) {
        parsed.union = D.parseUnion(firstSheetRows(await readSheets(el.union.files[0], '노동조합 파일')));
        if (parsed.union.ym) detected.push(['노동조합', parsed.union.ym]);
      }
      if (el.research.files[0]) {
        parsed.research = D.parseResearch(firstSheetRows(await readSheets(el.research.files[0], '연구산학협력단 파일')));
        if (parsed.research.ym) detected.push(['연구산학협력단', parsed.research.ym]);
      }
      if (!el.ym.value && detected.length) {
        el.ym.value = detected[0][1].slice(0, 4) + '-' + detected[0][1].slice(4);
        onYmChange();
      }
      const ym = D.digits(el.ym.value);
      if (ym.length !== 6) throw new Error('대상 연월을 선택해 주세요.');
      detected.forEach(([label, v]) => {
        if (v !== ym) notices.push(`${label} 파일의 연월(${ymLabel(v)})이 대상 연월(${ymLabel(ym)})과 다릅니다. 파일이 맞는지 확인해 주세요.`);
      });
      if (el.welfare.files[0]) {
        const w = await readSheets(el.welfare.files[0], '후생파트 파일');
        parsed.welfare = D.parseWelfare(w.sheets, Number(ym.slice(0, 4)), Number(ym.slice(4)));
      }
      const { items, skipped } = D.buildItems(parsed, registry);
      if (!items.length) throw new Error('입력 대상(금액이 있는 사람)이 없습니다.');

      state.baseWb = { wb: base.wb, sheetName };
      state.items = items;
      state.skipped = skipped;
      state.ym = ym;
      state.notices = notices;
      state.regCount = regCount;
      render();
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), 'error');
    } finally {
      el.preview.disabled = false;
    }
  }

  // ---------- 화면 그리기 ----------
  const SRC_LABEL = { union: '노동조합', research: '연구산학', welfare: '후생파트' };
  const needsAttention = (it) => it.status !== 'ok' || it.conflict || it.dup;

  function statusText(it) {
    const t = [];
    if (it.status === 'missing') t.push('기준 명단에 없음');
    if (it.status === 'ambiguous') t.push('동명이인 — 선택 필요');
    if (it.status === 'mismatch') t.push('생년월일 불일치');
    if (it.conflict) t.push('전월 명단과 주민번호 다름(파일 값 사용)');
    if (it.dup) t.push('주민번호 중복');
    return t.join(' · ') || '확인됨';
  }

  function renderSummary() {
    const total = state.items.reduce((s, i) => s + i.amount, 0);
    const bySrc = {};
    state.items.forEach((i) => (bySrc[i.source] = (bySrc[i.source] || 0) + 1));
    const pending = state.items.filter((i) => !D.normRrn(i.rrn)).length;
    el.summary.replaceChildren(
      h('div', { class: 'don-stat' }, h('span', { class: 'don-stat-label', text: '대상 연월' }), h('b', { text: ymLabel(state.ym) })),
      h('div', { class: 'don-stat' }, h('span', { class: 'don-stat-label', text: '입력 인원' }), h('b', { text: state.items.length + '명' })),
      h('div', { class: 'don-stat' }, h('span', { class: 'don-stat-label', text: '합계 금액' }), h('b', { text: won(total) })),
      h('div', { class: 'don-stat' + (pending ? ' warn' : '') }, h('span', { class: 'don-stat-label', text: '주민번호 입력 필요' }), h('b', { text: pending + '건' }))
    );
    const lines = [];
    lines.push(Object.keys(bySrc).map((k) => `${SRC_LABEL[k]} ${bySrc[k]}명`).join(' · '));
    (state.notices || []).forEach((n) => lines.push('⚠ ' + n));
    if (state.skipped.length) {
      lines.push(`제외된 ${state.skipped.length}명: ` + state.skipped.map((s) => `${s.name}(${SRC_LABEL[s.source]}, ${s.reason})`).join(', '));
    }
    el.notices.replaceChildren(...lines.map((l) => h('p', { class: l.startsWith('⚠') ? 'don-warn' : '', text: l })));
    el.download.disabled = pending > 0;
    el.downloadHint.textContent = pending > 0 ? `주민등록번호가 비어 있는 ${pending}건을 먼저 입력해 주세요.` : '엑셀(.xls) 파일로 내려받습니다.';
  }

  function attentionRow(it) {
    const input = h('input', {
      type: 'text',
      inputmode: 'numeric',
      maxlength: '14',
      placeholder: '주민등록번호 13자리',
      value: it.status === 'ok' ? D.maskRrn(it.rrn) : '',
      disabled: it.status === 'ok' || null,
      autocomplete: 'off'
    });
    const msg = h('span', { class: 'don-row-msg', text: statusText(it) });
    const origStatus = it.status;
    const apply = (value) => {
      const rrn = D.normRrn(value);
      it.rrn = rrn;
      it.status = rrn ? 'ok' : origStatus;
      input.classList.toggle('invalid', !!value && !rrn);
      msg.textContent = rrn ? '입력됨' : value ? '13자리 숫자로 입력해 주세요' : statusText(it);
      renderSummary();
    };
    if (origStatus !== 'ok') input.addEventListener('input', () => apply(input.value));
    const cells = [input];
    if (it.candidates && it.candidates.length && it.status !== 'ok') {
      const sel = h(
        'select',
        { onchange: (e) => { if (e.target.value) { input.value = e.target.value; apply(e.target.value); } } },
        h('option', { value: '', text: '후보 선택' }),
        it.candidates.map((c) => h('option', { value: c.rrn, text: `${c.birth.slice(0, 4)}.${c.birth.slice(4, 6)}.${c.birth.slice(6)}생 · ${D.maskRrn(c.rrn)}` }))
      );
      cells.unshift(sel);
    }
    return h(
      'tr',
      {},
      h('td', { text: SRC_LABEL[it.source] }),
      h('td', { text: it.name }),
      h('td', { text: it.birth ? `${it.birth.slice(0, 4)}.${it.birth.slice(4, 6)}.${it.birth.slice(6)}` : '-' }),
      h('td', { class: 'don-rrn-cell' }, cells),
      h('td', { class: 'num', text: won(it.amount) }),
      h('td', {}, msg)
    );
  }

  function render() {
    renderSummary();
    const att = state.items.filter(needsAttention);
    el.attention.classList.toggle('hidden', !att.length);
    el.attentionBody.replaceChildren(...att.map(attentionRow));
    el.fullCount.textContent = `전체 ${state.items.length}명 보기`;
    el.fullBody.replaceChildren(
      ...state.items.map((it, i) =>
        h(
          'tr',
          {},
          h('td', { text: i + 1 }),
          h('td', { text: SRC_LABEL[it.source] }),
          h('td', { text: it.name }),
          h('td', { text: D.maskRrn(it.rrn) || '-' }),
          h('td', { class: 'num', text: won(it.amount) }),
          h('td', { text: D.makeManagementNo(state.ym, i + 1) })
        )
      )
    );
    el.result.classList.remove('hidden');
  }

  // ---------- 다운로드 ----------
  function download() {
    try {
      const date = D.digits(el.date.value);
      const rows = D.toReceiptRows(state.items, { ym: state.ym, date });
      const { wb, sheetName } = state.baseWb;
      const ws = wb.Sheets[sheetName];
      // 5행(데이터 시작) 이하 기존 내용 삭제 — 1~4행(제목·안내)은 그대로 둠
      Object.keys(ws).forEach((k) => {
        if (k[0] === '!') return;
        if (XLSX.utils.decode_cell(k).r >= 4) delete ws[k];
      });
      rows.forEach((row, i) =>
        row.forEach((v, j) => {
          const addr = XLSX.utils.encode_cell({ r: 4 + i, c: j });
          ws[addr] = typeof v === 'number' ? { t: 'n', v, z: '#,##0_ ' } : { t: 's', v: String(v), z: '@' };
        })
      );
      ws['!ref'] = 'A1:J' + (4 + rows.length);
      XLSX.writeFile(wb, `전자기부금영수증_${state.ym}.xls`, { bookType: 'biff8' });
      setStatus(`${rows.length}건을 내려받았습니다. 홈택스에 올리기 전에 엑셀에서 한 번 열어 확인해 주세요.`, 'ok');
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), 'error');
    }
  }

  // ---------- 이벤트 ----------
  function onYmChange() {
    const ym = D.digits(el.ym.value);
    if (ym.length === 6 && !state.dateTouched) el.date.value = `${ym.slice(0, 4)}-${ym.slice(4)}-25`;
  }
  el.ym.addEventListener('change', onYmChange);
  el.date.addEventListener('change', () => (state.dateTouched = true));
  el.preview.addEventListener('click', makePreview);
  el.download.addEventListener('click', download);
})();
