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
    err.textContent = '사진 폴더 링크를 인식하지 못했습니다. 드라이브에서 "링크 복사"한 주소를 그대로 붙여넣어 주세요.';
    err.hidden = false;
    $('result').hidden = true;
    return;
  }

  const bgmInput = $('bgmFolder').value.trim();
  let bgmFolderId = null;
  if (bgmInput) {
    bgmFolderId = parseFolderId(bgmInput);
    if (!bgmFolderId) {
      err.textContent = '배경음악 폴더 링크를 인식하지 못했습니다. 비워 두면 배경음악 없이 만들어집니다.';
      err.hidden = false;
      $('result').hidden = true;
      return;
    }
  }

  err.hidden = true;
  const url = new URL('./player.html', location.href);
  url.searchParams.set('folder', folderId);
  if (bgmFolderId) url.searchParams.set('bgm', bgmFolderId);
  $('playUrl').value = url.href;
  $('open').href = url.href;
  $('result').hidden = false;
}

$('make').addEventListener('click', make);
for (const id of ['folder', 'bgmFolder']) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') make();
  });
}

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
