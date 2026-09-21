// 드라이브 폴더 링크를 재생 URL로 바꿔 주는 화면
import { EFFECTS } from './effects.js';
import { parseFolderId } from './drive-source.js';
import { config } from '../config.js';

const $ = (id) => document.getElementById(id);

if (!config.apiKey) $('nokey').hidden = false;

// 효과 이름표
const tbody = $('rules').querySelector('tbody');
for (const effect of EFFECTS.filter((e) => e.id !== 'auto')) {
  const row = document.createElement('tr');
  const label = document.createElement('td');
  label.textContent = effect.label;
  const keyword = document.createElement('td');
  const code = document.createElement('code');
  code.textContent = effect.id;
  keyword.append(code);
  row.append(label, keyword);
  tbody.append(row);
}

function make() {
  const err = $('err');
  const folderId = parseFolderId($('folder').value);
  if (!folderId) {
    err.textContent = '폴더 링크를 인식하지 못했습니다. 드라이브에서 "링크 복사"한 주소를 그대로 붙여넣어 주세요.';
    err.hidden = false;
    $('result').hidden = true;
    return;
  }
  err.hidden = true;
  const url = new URL('./player.html', location.href);
  url.searchParams.set('folder', folderId);
  $('playUrl').value = url.href;
  $('open').href = url.href;
  $('result').hidden = false;
}

$('make').addEventListener('click', make);
$('folder').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') make();
});

$('copy').addEventListener('click', async () => {
  const input = $('playUrl');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  const btn = $('copy');
  btn.textContent = '복사됨';
  setTimeout(() => (btn.textContent = '복사'), 1200);
});
