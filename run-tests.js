/**
 * 폴더 안의 모든 테스트 파일(*.test.js, *_test.js)을 차례로 실행합니다.
 *   npm test   (또는)   node run-tests.js
 * 하나라도 실패하면 종료 코드 1 — GitHub Actions 같은 자동 검사에 그대로 쓸 수 있습니다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => /(\.test|_test)\.js$/.test(f))
  .sort();
if (!files.length) {
  console.error('테스트 파일이 없습니다.');
  process.exit(1);
}
let failed = 0;
files.forEach((f) => {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
});
console.log(failed ? `\n실패한 테스트 파일 ${failed}개` : `\n테스트 파일 ${files.length}개 모두 통과`);
process.exit(failed ? 1 : 0);
