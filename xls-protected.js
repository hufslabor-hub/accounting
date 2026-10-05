/**
 * 암호가 걸린 .xls(BIFF8, RC4 CryptoAPI / 표준 RC4) 읽기 — 첫 시트를 2차원 배열로 반환.
 * 외부 라이브러리 비의존 (SHA-1/MD5 는 crypto.subtle 사용 → HTTPS 또는 localhost 필요).
 * 암호 없는 .xls 는 이 모듈이 아니라 SheetJS 로 읽는다. isEncryptedXls() 로 구분.
 *
 * Node 테스트: node donation.test.js
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ShowMeXlsProtected = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const ENDOFCHAIN = 0xfffffffa;

  const u16 = (d, o) => d[o] | (d[o + 1] << 8);
  const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const u64 = (d, o) => u32(d, o) + u32(d, o + 4) * 4294967296;

  function isOle(u8) {
    return u8.length > 512 && OLE_MAGIC.every((b, i) => u8[i] === b);
  }

  // ---------- OLE(CFB) 최소 리더 ----------
  function readStream(d, wanted) {
    const ss = 1 << u16(d, 30);
    const mss = 1 << u16(d, 32);
    const nfat = u32(d, 44);
    const dirStart = u32(d, 48);
    const cutoff = u32(d, 56);
    const miniFatStart = u32(d, 60);
    if (nfat > 109) throw new Error('지원하지 않는 큰 엑셀 파일입니다.');
    const fat = [];
    for (let i = 0; i < nfat; i++) {
      const o = 512 + u32(d, 76 + i * 4) * ss;
      for (let k = 0; k < ss; k += 4) fat.push(u32(d, o + k));
    }
    const chain = (s) => {
      const r = [];
      while (s < ENDOFCHAIN && r.length < fat.length + 1) {
        r.push(s);
        s = fat[s];
      }
      return r;
    };
    const readChain = (s) => {
      const parts = chain(s).map((x) => d.subarray(512 + x * ss, 512 + (x + 1) * ss));
      const out = new Uint8Array(parts.length * ss);
      parts.forEach((p, i) => out.set(p, i * ss));
      return out;
    };
    const dir = readChain(dirStart);
    const ents = [];
    for (let i = 0; i + 128 <= dir.length; i += 128) {
      const nl = u16(dir, i + 64);
      let name = '';
      for (let k = 0; k + 2 <= nl - 2; k += 2) name += String.fromCharCode(u16(dir, i + k));
      ents.push({ name, start: u32(dir, i + 116), size: u64(dir, i + 120) });
    }
    const ent = ents.find((e) => e.name === wanted) || ents.find((e) => e.name === 'Book');
    if (!ent) throw new Error('엑셀 통합 문서 스트림을 찾지 못했습니다.');
    if (ent.size >= cutoff) return readChain(ent.start).subarray(0, ent.size);
    // 미니 스트림
    const mf = readChain(miniFatStart);
    const mfat = [];
    for (let k = 0; k + 4 <= mf.length; k += 4) mfat.push(u32(mf, k));
    const mini = readChain(ents[0].start);
    const out = new Uint8Array(ent.size);
    let s = ent.start;
    let pos = 0;
    while (s < ENDOFCHAIN && pos < ent.size) {
      const part = mini.subarray(s * mss, (s + 1) * mss);
      out.set(part.subarray(0, Math.min(part.length, ent.size - pos)), pos);
      pos += mss;
      s = mfat[s];
    }
    return out;
  }

  function listRecords(st) {
    const recs = [];
    let pos = 0;
    while (pos + 4 <= st.length) {
      const id = u16(st, pos);
      const len = u16(st, pos + 2);
      recs.push({ pos, id, len });
      pos += 4 + len;
    }
    return recs;
  }

  function isEncryptedXls(u8) {
    if (!isOle(u8)) return false;
    try {
      const st = readStream(u8, 'Workbook');
      return listRecords(st).slice(0, 8).some((r) => r.id === 0x2f);
    } catch (e) {
      return false;
    }
  }

  // ---------- RC4 / 해시 ----------
  function rc4(key, data) {
    const S = new Uint8Array(256);
    for (let i = 0; i < 256; i++) S[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 255;
      [S[i], S[j]] = [S[j], S[i]];
    }
    const out = new Uint8Array(data.length);
    let a = 0;
    let b = 0;
    for (let n = 0; n < data.length; n++) {
      a = (a + 1) & 255;
      b = (b + S[a]) & 255;
      [S[a], S[b]] = [S[b], S[a]];
      out[n] = data[n] ^ S[(S[a] + S[b]) & 255];
    }
    return out;
  }

  const concat = (...arrs) => {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
    let o = 0;
    arrs.forEach((a) => {
      out.set(a, o);
      o += a.length;
    });
    return out;
  };
  const le32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const utf16le = (s) => {
    const o = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      o[i * 2] = c & 255;
      o[i * 2 + 1] = c >> 8;
    }
    return o;
  };
  async function digest(alg, data) {
    const subtle = (globalThis.crypto || {}).subtle;
    if (!subtle) throw new Error('이 브라우저 환경에서는 암호 해독을 사용할 수 없습니다. HTTPS 주소에서 열어 주세요.');
    return new Uint8Array(await subtle.digest(alg, data));
  }
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /**
   * FilePass 레코드에서 블록 키 생성기를 만든다. 암호가 틀리면 null.
   * 지원: CryptoAPI RC4(Office 2003, SHA-1) — 이번 파일 형식
   */
  async function makeKeyFn(st, rec, password) {
    let p = rec.pos + 4;
    const type = u16(st, p);
    const major = u16(st, p + 2);
    const minor = u16(st, p + 4);
    if (type !== 1) throw new Error('지원하지 않는 암호화 방식(XOR)입니다.');
    p += 6;
    if (major === 1 && minor === 1) {
      throw new Error('이 암호화 방식(Office 97 표준 RC4)은 지원하지 않습니다. 엑셀에서 암호를 풀어 다시 저장해 주세요.');
    }
    // CryptoAPI
    const headerSize = u32(st, p + 4);
    const keyBits = u32(st, p + 8 + 16);
    p += 8 + headerSize;
    const salt = st.subarray(p + 4, p + 20);
    const ev = st.subarray(p + 20, p + 36);
    const evh = st.subarray(p + 40, p + 60);
    const h0 = await digest('SHA-1', concat(salt, utf16le(password)));
    const keyLen = 16; // 40bit 키는 0으로 채워 16바이트로 맞춤
    const blockKey = async (b) => {
      const hf = await digest('SHA-1', concat(h0, le32(b)));
      const k = hf.subarray(0, keyBits / 8);
      const full = new Uint8Array(keyLen);
      full.set(k);
      return full;
    };
    const chk = rc4(await blockKey(0), concat(ev, evh));
    const okHash = await digest('SHA-1', chk.subarray(0, 16));
    if (!eq(okHash, chk.subarray(16, 36))) return null;
    return blockKey;
  }

  const PLAIN_RECORDS = new Set([0x809, 0x2f, 0xe1, 0x194, 0x195, 0x196, 0x138]);

  async function decryptWorkbook(st, password) {
    const recs = listRecords(st);
    const fp = recs.find((r) => r.id === 0x2f);
    if (!fp) return st;
    const blockKey = await makeKeyFn(st, fp, password);
    if (!blockKey) {
      const err = new Error('엑셀 파일 암호가 맞지 않습니다.');
      err.code = 'BAD_PASSWORD';
      throw err;
    }
    const out = new Uint8Array(st);
    const streams = new Map();
    for (const r of recs) {
      if (PLAIN_RECORDS.has(r.id)) continue;
      for (let i = 0; i < r.len; i++) {
        if (r.id === 0x85 && i < 4) continue; // BoundSheet 시트 위치는 평문
        const a = r.pos + 4 + i;
        const b = Math.floor(a / 1024);
        if (!streams.has(b)) streams.set(b, rc4(await blockKey(b), new Uint8Array(1024)));
        out[a] = st[a] ^ streams.get(b)[a % 1024];
      }
    }
    return out;
  }

  // ---------- BIFF8 셀 읽기 (첫 시트) ----------
  function rkValue(rk) {
    let v;
    if (rk & 2) v = rk >> 2;
    else {
      const buf = new DataView(new ArrayBuffer(8));
      buf.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
      v = buf.getFloat64(0, true);
    }
    return rk & 1 ? v / 100 : v;
  }

  function parseSst(recs, idx, st) {
    const first = recs[idx];
    const segs = [st.subarray(first.pos + 4 + 8, first.pos + 4 + first.len)];
    for (let j = idx + 1; j < recs.length && recs[j].id === 0x3c; j++) {
      segs.push(st.subarray(recs[j].pos + 4, recs[j].pos + 4 + recs[j].len));
    }
    const count = u32(st, first.pos + 4 + 4);
    let si = 0;
    let p = 0;
    const take = (k) => {
      const out = new Uint8Array(k);
      let n = 0;
      while (n < k) {
        if (p >= segs[si].length) {
          si++;
          p = 0;
          if (si >= segs.length) throw new Error('SST 범위를 벗어났습니다.');
          continue;
        }
        const m = Math.min(k - n, segs[si].length - p);
        out.set(segs[si].subarray(p, p + m), n);
        n += m;
        p += m;
      }
      return out;
    };
    const list = [];
    for (let n = 0; n < count; n++) {
      if (p >= segs[si].length && si + 1 < segs.length) {
        si++;
        p = 0;
      }
      const h = take(3);
      const cch = h[0] | (h[1] << 8);
      const flags = h[2];
      const runs = flags & 8 ? u16(take(2), 0) : 0;
      const ext = flags & 4 ? u32(take(4), 0) : 0;
      let wide = flags & 1;
      let rem = cch;
      let s = '';
      while (rem > 0) {
        if (p >= segs[si].length) {
          si++;
          p = 0;
          wide = segs[si][0] & 1;
          p = 1;
        }
        const avail = Math.floor((segs[si].length - p) / (wide ? 2 : 1));
        const k = Math.min(rem, avail);
        const b = take(k * (wide ? 2 : 1));
        if (wide) for (let q = 0; q < b.length; q += 2) s += String.fromCharCode(b[q] | (b[q + 1] << 8));
        else for (let q = 0; q < b.length; q++) s += String.fromCharCode(b[q]);
        rem -= k;
      }
      take(runs * 4);
      take(ext);
      list.push(s);
    }
    return list;
  }

  function sheetRowsFromBiff(st) {
    const recs = listRecords(st);
    let sst = [];
    const names = [];
    let sheetNo = -1;
    const cells = []; // 첫 시트만
    let maxR = -1;
    let maxC = -1;
    const put = (r, c, v) => {
      if (!cells[r]) cells[r] = [];
      cells[r][c] = v;
      if (r > maxR) maxR = r;
      if (c > maxC) maxC = c;
    };
    recs.forEach((rec, idx) => {
      const o = rec.pos + 4;
      switch (rec.id) {
        case 0xfc:
          sst = parseSst(recs, idx, st);
          break;
        case 0x85: {
          const cch = st[o + 6];
          const wide = st[o + 7] & 1;
          let s = '';
          for (let i = 0; i < cch; i++) s += String.fromCharCode(wide ? u16(st, o + 8 + i * 2) : st[o + 8 + i]);
          names.push(s);
          break;
        }
        case 0x809:
          if (u16(st, o + 2) === 0x10) sheetNo++;
          break;
        case 0xfd:
          if (sheetNo === 0) put(u16(st, o), u16(st, o + 2), sst[u32(st, o + 6)]);
          break;
        case 0x203:
          if (sheetNo === 0) put(u16(st, o), u16(st, o + 2), new DataView(st.buffer, st.byteOffset + o + 6, 8).getFloat64(0, true));
          break;
        case 0x27e:
          if (sheetNo === 0) put(u16(st, o), u16(st, o + 2), rkValue(u32(st, o + 6) | 0));
          break;
        case 0xbd:
          if (sheetNo === 0) {
            const r = u16(st, o);
            const c0 = u16(st, o + 2);
            const n = Math.floor((rec.len - 6) / 6);
            for (let k = 0; k < n; k++) put(r, c0 + k, rkValue(u32(st, o + 4 + k * 6 + 2) | 0));
          }
          break;
        default:
      }
    });
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) row.push(cells[r] && cells[r][c] !== undefined ? cells[r][c] : null);
      rows.push(row);
    }
    return { sheetName: names[0] || 'Sheet1', rows };
  }

  /** 암호 걸린 xls → { sheetName, rows } (첫 시트) */
  async function readProtectedXls(u8, password) {
    if (!isOle(u8)) throw new Error('엑셀(.xls) 파일이 아닙니다.');
    const st = readStream(u8, 'Workbook');
    const dec = await decryptWorkbook(st, String(password == null ? '' : password));
    return sheetRowsFromBiff(dec);
  }

  return { isEncryptedXls, readProtectedXls };
});
