# Песня наоборот

Игра для компании, работает прямо в браузере телефона (без установки и без сервера).

Игрок А напевает песню, игрок Б повторяет её задом наперёд по кусочкам, голосом, а потом запись разворачивается обратно, и все слушают, что получилось и угадывают песню.

Играть: https://snoopthedogg.github.io/pesnya-naoborot/

Страницу можно добавить на экран «Домой» в Safari.

## Разработка

Зависимостей в рантайме нет: обычные ES-модули, без сборки.

```sh
npm install                       # только для Playwright
npm test                          # юнит-тесты (node --test)
npx playwright install chromium   # один раз
npm run e2e                       # E2E в Chromium с фейковым микрофоном (порт 8173, E2E_PORT меняет)
node scripts/serve.mjs            # локальный сервер, порт 8080 (переменная PORT)
BASE_URL=https://snoopthedogg.github.io/pesnya-naoborot/ npm run e2e   # E2E против опубликованной версии
node scripts/make-icons.mjs       # перегенерировать иконки
```
