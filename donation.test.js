/**
 * 기부금영수증 변환 규칙 테스트 — 브라우저 없이 실행:
 *   node donation.test.js
 * 암호 걸린 실제 파일까지 확인하려면:
 *   XLS_FILE=9월_노동조합비.xls XLS_PASSWORD=암호 node donation.test.js
 */
const D = require('./donation.js');
const P = require('./xls-protected.js');
let passed = 0;
let failed = 0;
const assert = (c, m) => {
  c ? passed++ : failed++;
  console.log(c ? '  ✓' : '  ✗', m);
};

(async () => {
  console.log('1) 주민번호·생년월일');
  assert(D.normRrn('770110-2783831') === '7701102783831', '하이픈 있는 주민번호 정규화');
  assert(D.normRrn('12345') === null, '자릿수 틀린 값은 null');
  assert(D.birthFromRrn('8901132031517') === '19890113', '1900년대 생');
  assert(D.birthFromRrn('0501013123456') === '20050101', '2000년대 생(뒷자리 3)');
  assert(D.normBirth('1978/12/20') === '19781220', '생년월일 슬래시 형식');

  console.log('2) 노동조합 파일');
  const union = D.parseUnion([
    ['순번', '직급', '성명', '공제액', '적용년월', '주민번호'],
    ['1', '임시직', '가나다', 20810, '202609', '890113-2031517'],
    ['2', '임시직', '라마바', null, '202609', '8001012345678'],
    [null, null, null, 107070, null, null]
  ]);
  assert(union.items.length === 1 && union.ym === '202609', '소계행 제외, 연월 추출');
  assert(union.items[0].rrn === '8901132031517', '파일 안의 주민번호 사용');
  assert(union.skipped.length === 1 && union.skipped[0].name === '라마바', '금액 없는 사람은 제외 목록');

  console.log('3) 연구산학협력단 파일');
  const research = D.parseResearch([
    [null, '2026년 8월 노동조합비 공제내역'],
    [],
    [],
    [null, '순번', '성명', '부서', '생년월일', '입사일자', '노동조합비', '비고'],
    [null, 1, '홍길동', '팀', '1978/12/20', '2004/11/22', 39630, null],
    [null, 2, '류은경', '팀', '1980/08/17', '2004/12/01', null, '자격정지자']
  ]);
  assert(research.ym === '202608', '제목에서 연월 추출');
  assert(research.items[0].birth === '19781220', '생년월일 정규화');
  assert(research.skipped[0].reason === '자격정지자', '제외 사유는 비고');

  console.log('4) 후생파트 파일');
  const welfareRows = [
    ['2026년 노동조합비'],
    [],
    ['NO.', '소속', null, '이름', '주민등록번호', '1월', '2월', '3월'],
    [1, '후생파트', 1, '권은숙', '710201-2528126', 17140, 17140, 22780],
    [2, '후생파트', 2, '김영숙', '660209-2019529', 22000, 22000, '정년퇴직'],
    ['합   계', null, null, null, null, 1, 2, 3]
  ];
  const w = D.parseWelfare({ '2025년': [], '2026년 ': welfareRows }, 2026, 3);
  assert(w.items.length === 1 && w.items[0].amount === 22780, '3월 열 금액 읽기(시트명 공백 허용)');
  assert(w.skipped[0].reason === '정년퇴직', '글자 금액은 제외 사유로');
  let threw = false;
  try {
    D.parseWelfare({ '2026년 ': welfareRows }, 2026, 7);
  } catch (e) {
    threw = true;
  }
  assert(threw, '없는 월은 오류');

  console.log('5) 주민번호 확정(동명이인)');
  const reg = D.createRegistry();
  reg.addFromReceiptRows([
    ['신청구분코드', '주민등록번호', '성명'],
    ['01', '7812202222222', '홍길동'],
    ['01', '9001011111111', '홍길동'],
    ['01', '8501012222222', '김철수']
  ]);
  assert(reg.size === 3, '기준 명단 3건');
  assert(D.resolveRrn({ name: '홍길동', birth: '19781220' }, reg).rrn === '7812202222222', '이름+생년월일로 동명이인 구분');
  assert(D.resolveRrn({ name: '홍길동', birth: '' }, reg).status === 'ambiguous', '생년월일 없으면 동명이인은 선택 필요');
  assert(D.resolveRrn({ name: '홍길동', birth: '19000101' }, reg).status === 'mismatch', '생년월일 불일치');
  assert(D.resolveRrn({ name: '김철수', birth: '' }, reg).rrn === '8501012222222', '동명이인 아니면 이름만으로');
  assert(D.resolveRrn({ name: '신입', birth: '' }, reg).status === 'missing', '명단에 없으면 missing');

  console.log('6) 합치기·행 생성');
  const built = D.buildItems(
    {
      union: {
        items: [{ source: 'union', name: '신입', amount: 100, birth: '', rrn: '9507011234567' }],
        skipped: []
      },
      research: {
        items: [{ source: 'research', name: '홍길동', amount: 200, birth: '19781220', rrn: null }],
        skipped: [{ source: 'research', name: 'x', reason: '자격정지' }]
      }
    },
    reg
  );
  assert(built.items.length === 2 && D.isRrnComplete(built.items), '두 건 모두 주민번호 확정');
  assert(built.skipped.length === 1, '제외 목록 합산');
  const rows = D.toReceiptRows(built.items, { ym: '202609', date: '2026-09-25' });
  assert(rows[0].length === 10 && rows[0][4] === 'hufs202609001' && rows[1][4] === 'hufs202609002', '관리번호 hufs+연월+순번');
  assert(rows[1][1] === '7812202222222' && rows[1][6] === '20260925' && rows[1][7] === 200 && rows[1][9] === 0, '열 구성(주민번호·일자·금액·장려금 0)');
  assert(rows[0][0] === '01' && rows[0][3] === '1 : 금전기부' && rows[0][5] === '421', '고정값(01/금전기부/421)');
  const conflict = D.buildItems(
    { union: { items: [{ source: 'union', name: '김철수', amount: 1, birth: '', rrn: '7001011111111' }], skipped: [] } },
    reg
  );
  assert(conflict.items[0].conflict === true, '기준 명단과 주민번호가 다르면 경고');
  threw = false;
  try {
    D.toReceiptRows([{ name: '누락', amount: 1, rrn: null }], { ym: '202609', date: '20260925' });
  } catch (e) {
    threw = true;
  }
  assert(threw, '주민번호 없는 항목이 있으면 생성 거부');

  if (process.env.XLS_FILE) {
    console.log('7) 암호 걸린 실제 xls');
    const fs = require('fs');
    const u8 = new Uint8Array(fs.readFileSync(process.env.XLS_FILE));
    assert(P.isEncryptedXls(u8), '암호 파일 감지');
    let code = '';
    try {
      await P.readProtectedXls(u8, '__wrong__');
    } catch (e) {
      code = e.code;
    }
    assert(code === 'BAD_PASSWORD', '틀린 암호는 BAD_PASSWORD');
    const { rows: r } = await P.readProtectedXls(u8, process.env.XLS_PASSWORD || '');
    const parsed = D.parseUnion(r);
    assert(parsed.items.length > 0 && parsed.ym.length === 6, `읽기 성공: ${parsed.items.length}명, ${parsed.ym}`);
  }

  console.log('\n결과:', passed, '통과,', failed, '실패');
  process.exit(failed ? 1 : 0);
})();
