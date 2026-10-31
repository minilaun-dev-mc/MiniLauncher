# MiniLauncher: публикация на GitHub и сборка .exe

## Часть 1. Выложить на GitHub

1. Установите [Git](https://git-scm.com/download/win) и создайте аккаунт на github.com.
2. На github.com нажмите **New repository**: имя `MiniLauncher`, без README и .gitignore (они уже есть в проекте). Видимость — Public или Private.
3. В папке проекта выполните:
   ```bat
   git init
   git add .
   git commit -m "MiniLauncher 2.0.1"
   git branch -M main
   git remote add origin https://github.com/<ваш-логин>/MiniLauncher.git
   git push -u origin main
   ```
   Файл `.gitignore` не пустит в репозиторий `node_modules`, `dist`, `out` и скачанную Java (она огромная).
4. Перед публикацией откройте `installer\legal\LAUNCHER_LICENSE.ru.txt` и впишите правообладателя, дату и контакт.
5. Логотип: если он ваш, всё хорошо. Название и ресурсы Minecraft принадлежат Mojang, проект неофициальный. Добавьте это в README.

## Часть 2. Собрать .exe вручную (Windows 10/11)

Нужны [Node.js 18+](https://nodejs.org) и интернет на время сборки.

```bat
npm install
cd installer
npm install
npm run java:detect
npm run build
```

Готовый файл: `installer\out\MiniLauncher-Setup-2.0.1.exe` (250–350 МБ: лаунчер + Java 8/17/21/25). Для установки интернет не нужен.

Только проверить лаунчер без установщика: `npm start` в корне, или `npm run pack` (папка `dist\win-unpacked`).

Если `electron-builder` пишет `Cannot create symbolic link`, включите «Режим разработчика» в Windows или запустите терминал от администратора.

## Часть 3. Релиз на GitHub

### Способ А: автоматически (рекомендуется)
В проект уже добавлен `.github/workflows/release.yml`. Он сам соберёт установщик на серверах GitHub:
```bat
git tag v2.0.1
git push origin v2.0.1
```
Через 10–20 минут в разделе **Releases** появятся `MiniLauncher-Setup-2.0.1.exe` и `latest.json`.

### Способ Б: вручную
```bat
cd installer
npm run manifest -- https://github.com/<логин>/MiniLauncher/releases/download/v2.0.1 "Что нового"
```
Затем на GitHub: **Releases → Draft a new release**, тег `v2.0.1`, прикрепите `MiniLauncher-Setup-2.0.1.exe` и `out\latest.json`.

## Часть 4. Автообновление

В `package.json` лаунчера укажите (один раз, до сборки):
```json
"minilauncher": { "updateUrl": "https://github.com/<логин>/MiniLauncher/releases/latest/download/latest.json" }
```
Новый релиз: поднимите `version` в `package.json`, соберите, выпустите тег. У игроков на главной появится плашка «Доступно обновление».

## Версии
`MAJOR.0.0` — новые возможности, `X.Y.Z` с ненулевыми Y/Z — исправления. Тег на GitHub: `v` + версия.

## Предупреждения Windows
Без подписи кода SmartScreen покажет «Неизвестный издатель»: «Подробнее → Выполнить в любом случае». Убрать окончательно можно только подписью (Azure Trusted Signing или сертификат).
