// GitHub Pages(구글 드라이브) 모드 설정.
//
// apiKey: Google Cloud에서 만든 Drive API 키. 브라우저 코드에 그대로 노출되므로
//         반드시 "HTTP 리퍼러 제한(내 github.io 주소)"과 "API 제한(Google Drive API만)"을 걸어 두세요.
//         (빌드 시 환경변수 DRIVE_API_KEY 가 있으면 이 값을 덮어씁니다. README 참고)
export const config = {
  apiKey: '',
  apiBase: 'https://www.googleapis.com/drive/v3',
  imageBase: 'https://lh3.googleusercontent.com/d',
};
