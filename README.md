# Public-ready virtual try-on demo

## Что внутри
- `index.html` — основной интерфейс
- `style.css` — стили, включая мобильный layout
- `app.js` — логика камеры, трекинга, 2D/3D примерки и измерений
- `data/frames.json` — каталог оправ и их конфиги
- `assets/images/` — PNG оправы
- `assets/models/` — OBJ модели

## Как запустить локально
Используйте любой локальный HTTP-сервер. Например:

```bash
python -m http.server 8000
```

Откройте `http://localhost:8000`.

## Как добавить новую оправу
1. Положите PNG в `assets/images/`
2. Положите OBJ в `assets/models/`
3. Добавьте запись в `data/frames.json`

Пример:
```json
{
  "id": "new_frame",
  "name": "New Frame",
  "type": "both",
  "pngUrl": "./assets/images/new_frame.png",
  "objUrl": "./assets/models/new_frame.obj",
  "frameWidthMM": 138,
  "fitOffsetX": 0,
  "fitOffsetY": 8,
  "fitOffsetZ": 80,
  "pngOffsetX": 0,
  "pngOffsetY": 0,
  "scaleDivisor3D": 165
}
```

## Для публичного деплоя
Подходит любой статический хостинг с HTTPS:
- Vercel
- Netlify
- Cloudflare Pages

Камера работает только на `https://` или `localhost`.
