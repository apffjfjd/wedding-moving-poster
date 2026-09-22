// 구글 드라이브 폴더를 사진 소스로 쓰는 재생기 데이터 소스 (GitHub Pages 모드).
// 드라이브 폴더가 곧 편집기다: 사진을 넣고 빼고 이름을 바꾸면 재생 화면에 반영된다.
import { EFFECT_IDS } from './effects.js';

const FOLDER_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

/** 폴더 링크(공유 링크 등) 또는 폴더 ID 문자열에서 폴더 ID를 뽑는다. 못 찾으면 null. */
export function parseFolderId(input) {
  const text = String(input || '').trim();
  if (FOLDER_ID_RE.test(text)) return text;
  try {
    const url = new URL(text);
    const fromPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/);
    if (fromPath && FOLDER_ID_RE.test(fromPath[1])) return fromPath[1];
    const fromQuery = url.searchParams.get('id');
    if (fromQuery && FOLDER_ID_RE.test(fromQuery)) return fromQuery;
  } catch {
    /* URL이 아님 */
  }
  return null;
}

/**
 * 파일명에서 전환 효과를 읽는다. 확장자를 뺀 이름을 '_' 또는 공백으로 나눈 조각 중
 * 효과 이름(대소문자·하이픈 무시)이 있으면 그 효과를 쓰고, 없으면 자동이다.
 *   "03_kenburns.jpg" -> kenburns,  "04_zoom-in.jpg" -> zoomin,  "05.jpg" -> auto
 */
export function parsePhotoName(name) {
  const base = String(name).replace(/\.[^.]+$/, '');
  let effect = 'auto';
  for (const token of base.split(/[_\s]+/)) {
    const normalized = token.toLowerCase().replace(/-/g, '');
    if (EFFECT_IDS.includes(normalized)) effect = normalized;
  }
  return { effect };
}

/** 이름순(숫자는 크기순: 2 < 10) 정렬 비교 함수 */
const byName = (a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id);

/**
 * Drive API files.list 응답을 재생기용 사진 목록으로 바꾼다.
 * 이미지는 (1) lh3 리사이즈 URL → (2) API가 준 썸네일 → (3) API 원본 다운로드 순으로 시도한다.
 * 크기(width/height)는 재생기가 실제 이미지를 불러온 뒤 측정하므로 여기서는 참고용이다.
 */
export function toPhotos(list, { apiBase, imageBase, apiKey }) {
  return (list.files || [])
    .filter((f) => f.mimeType?.startsWith('image/') && !f.name.startsWith('.'))
    .sort(byName)
    .map((f) => {
      const fallbacks = [];
      if (f.thumbnailLink) fallbacks.push(f.thumbnailLink.replace(/=s\d+(-c)?$/, '') + '=s1920');
      fallbacks.push(`${apiBase}/files/${f.id}?alt=media&key=${encodeURIComponent(apiKey)}`);
      return {
        id: f.id,
        url: `${imageBase}/${f.id}=s1920`,
        fallbacks,
        viaFetch: true,
        version: f.modifiedTime,
        width: f.imageMediaMetadata?.width,
        height: f.imageMediaMetadata?.height,
        effect: parsePhotoName(f.name).effect,
      };
    });
}

/**
 * 폴더 안 오디오 파일 중 이름순 첫 번째를 배경음악으로 쓴다(여러 개면 나머지는 무시).
 * 오디오는 lh3 리사이즈 URL 같은 게 없으므로 Drive API 원본 다운로드만 쓴다.
 */
export function findAudio(list, { apiBase, apiKey }) {
  const file = (list.files || [])
    .filter((f) => f.mimeType?.startsWith('audio/') && !f.name.startsWith('.'))
    .sort(byName)[0];
  if (!file) return null;
  return {
    id: file.id,
    url: `${apiBase}/files/${file.id}?alt=media&key=${encodeURIComponent(apiKey)}`,
    viaFetch: true,
    version: file.modifiedTime,
  };
}

/**
 * folderId(사진 폴더)와 bgmFolderId(배경음악 폴더, 완전히 별도의 드라이브 폴더)를 각각 조회한다.
 * 두 폴더는 서로 무관하게 공유·관리된다 — 예: 사진만 바꾸고 싶을 때 음악 폴더 권한은 건드릴 필요가 없다.
 * 사진 폴더는 필수(없거나 접근 불가하면 재생 불가)이고, 음악 폴더는 선택(문제가 있어도 사진 재생은 계속한다).
 */
export function createDriveSource({ folderId, bgmFolderId, config }) {
  const { apiKey, apiBase, imageBase } = config;

  async function folderExists(id) {
    const params = new URLSearchParams({ fields: 'id', key: apiKey });
    try {
      const res = await fetch(`${apiBase}/files/${id}?${params}`, { cache: 'no-store' });
      return res.status !== 404;
    } catch {
      return true; // 확인 불가 시 빈 폴더로 취급
    }
  }

  function listFiles(id, mimePrefix) {
    const params = new URLSearchParams({
      q: `'${id}' in parents and trashed = false and mimeType contains '${mimePrefix}'`,
      fields: 'files(id,name,mimeType,modifiedTime,thumbnailLink,imageMediaMetadata(width,height))',
      pageSize: '1000',
      key: apiKey,
    });
    return fetch(`${apiBase}/files?${params}`, { cache: 'no-store' });
  }

  return {
    pollMs: 30000, // 드라이브 변경 반영 주기 (API 호출 한도를 고려)
    messages: {
      empty: '사진 폴더에 사진이 없습니다.\n구글 드라이브 사진 폴더에 사진을 넣어 주세요.',
      gone: '사진 폴더를 찾을 수 없습니다.\n폴더가 "링크가 있는 모든 사용자"에게 공유되어 있는지 확인해 주세요.',
      offline: '네트워크에 연결할 수 없습니다.\n연결되면 자동으로 재생됩니다.',
      error: '구글 드라이브를 불러오지 못했습니다.',
    },
    async load() {
      if (!apiKey) return { status: 'error', message: 'Drive API 키가 설정되지 않았습니다.\nconfig.js 의 apiKey 를 확인해 주세요.' };

      let res;
      try {
        res = await listFiles(folderId, 'image/');
      } catch {
        return { status: 'offline' }; // 현장 네트워크 불안정: 마지막 목록(또는 서비스 워커 캐시)으로 계속 재생
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { status: 'error', message: 'Drive API 접근이 거부되었습니다.\nAPI 키·허용 도메인 설정 또는 사용 한도를 확인해 주세요.' };
      }
      if (!res.ok) return { status: 'offline' };

      const photos = toPhotos(await res.json(), { apiBase, imageBase, apiKey });
      // 공유되지 않은/없는 폴더도 목록은 빈 채로 200이 오므로, 비어 있으면 폴더 접근 가능 여부를 확인한다.
      if (!photos.length && !(await folderExists(folderId))) return { status: 'gone' };

      let audio = null;
      if (bgmFolderId) {
        try {
          const audioRes = await listFiles(bgmFolderId, 'audio/');
          if (audioRes.ok) audio = findAudio(await audioRes.json(), { apiBase, apiKey });
        } catch {
          /* 음악 폴더는 선택 사항이므로, 못 불러와도 사진 재생을 막지 않는다 */
        }
      }

      return { status: 'ok', photos, audio };
    },
  };
}
