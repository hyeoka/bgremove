# BG Remover Web

Cloudflare Pages에 올릴 수 있는 브라우저 실행형 배경 제거 앱입니다. 이미지는 서버로 업로드하지 않고 사용자의 브라우저에서 처리합니다.

## Local run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

빌드 결과는 `dist` 폴더에 생성됩니다.

## Cloudflare Pages

- Project root: `bg_remover_pro_v6/web`
- Build command: `npm run build`
- Build output directory: `dist`

`public/_headers`에 WebGPU/WASM 성능을 위한 COOP/COEP 헤더를 넣어두었습니다.

## Notes

- 첫 실행은 모델과 WASM 파일을 내려받아서 느릴 수 있습니다. 이후에는 브라우저 캐시가 사용됩니다.
- 기본 모델 자산은 `@imgly/background-removal`의 CDN에서 내려받습니다. Cloudflare Pages의 단일 파일 용량 제한 때문에 큰 ONNX 모델을 Pages에 직접 올리지 않는 구성입니다.
- `@imgly/background-removal`은 AGPL 라이선스입니다. 공개 서비스나 상업적 폐쇄 소스에서 쓸 계획이면 라이선스 조건을 확인해야 합니다.
