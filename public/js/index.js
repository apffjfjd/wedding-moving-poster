// 계정 없이 동작하므로, 이 브라우저에서 만든 슬라이드쇼의 편집 키를 localStorage에 보관한다.
const STORE = 'wmp:shows';

function loadShows() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '[]');
  } catch {
    return [];
  }
}

const createBtn = document.getElementById('create');
const errorEl = document.getElementById('error');

createBtn.addEventListener('click', async () => {
  createBtn.disabled = true;
  errorEl.hidden = true;
  try {
    const res = await fetch('/api/slideshows', { method: 'POST' });
    if (!res.ok) throw new Error('생성에 실패했습니다.');
    const { id, editKey, editUrl } = await res.json();
    const shows = loadShows();
    shows.unshift({ id, key: editKey, createdAt: Date.now() });
    try {
      localStorage.setItem(STORE, JSON.stringify(shows));
    } catch {
      /* 저장 실패해도 편집 URL에 키가 있으므로 진행 가능 */
    }
    location.href = editUrl;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    createBtn.disabled = false;
  }
});

const shows = loadShows();
if (shows.length) {
  document.getElementById('mine').hidden = false;
  const list = document.getElementById('list');
  for (const show of shows) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'grow';
    name.textContent = `${new Date(show.createdAt).toLocaleDateString('ko-KR')} 생성 · ${show.id}`;
    const edit = document.createElement('a');
    edit.className = 'btn';
    edit.textContent = '편집';
    edit.href = `/e/${show.id}#key=${show.key}`;
    const play = document.createElement('a');
    play.className = 'btn primary';
    play.textContent = '재생';
    play.href = `/s/${show.id}`;
    play.target = '_blank';
    li.append(name, edit, play);
    list.append(li);
  }
}
