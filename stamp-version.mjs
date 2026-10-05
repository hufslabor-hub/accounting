/**
 * 배포 전 캐시 버스팅 버전을 자동으로 찍습니다.
 *
 *   node stamp-version.mjs
 *
 * index.html 의 window.APP_BUILD = '...' 값을
 * 현재 시각(YYYYMMDD-HHmm)으로 바꿉니다.
 * 페이지 로드 시 style.css / app.js 가 이 값으로 ?v= 됩니다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, 'index.html');
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const build =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
  `${pad(now.getHours())}${pad(now.getMinutes())}`;

let html = fs.readFileSync(indexPath, 'utf8');
const next = html.replace(
  /window\.APP_BUILD\s*=\s*['"][^'"]*['"]/,
  `window.APP_BUILD = '${build}'`
);
if (next === html) {
  console.error('index.html 에서 window.APP_BUILD 문자열을 찾지 못했습니다.');
  process.exit(1);
}
fs.writeFileSync(indexPath, next);
console.log('APP_BUILD =', build);
console.log('index.html 업데이트 완료. 커밋 후 배포하세요.');
