@echo off
setlocal EnableExtensions
chcp 65001 >nul
title MiniLauncher
mode con: cols=112 lines=30
cd /d "%~dp0"

rem --- ESC-символ для цветов ANSI (Windows 10+) ---
for /F %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

cls
echo.
echo.
echo   %ESC%[38;2;255;236;110m███╗   ███╗%ESC%[38;2;255;233;103m██╗%ESC%[38;2;255;230;95m███╗   ██╗%ESC%[38;2;255;228;88m██╗%ESC%[38;2;255;225;80m██╗     %ESC%[38;2;255;222;73m █████╗ %ESC%[38;2;255;220;66m██╗   ██╗%ESC%[38;2;255;217;58m███╗   ██╗%ESC%[38;2;255;214;51m ██████╗%ESC%[38;2;255;207;47m██╗  ██╗%ESC%[38;2;255;200;42m███████╗%ESC%[38;2;255;192;38m██████╗ %ESC%[0m
echo   %ESC%[38;2;255;231;97m████╗ ████║%ESC%[38;2;255;228;89m██║%ESC%[38;2;255;226;82m████╗  ██║%ESC%[38;2;255;223;75m██║%ESC%[38;2;255;220;67m██║     %ESC%[38;2;255;217;60m██╔══██╗%ESC%[38;2;255;215;52m██║   ██║%ESC%[38;2;255;208;48m████╗  ██║%ESC%[38;2;255;201;43m██╔════╝%ESC%[38;2;255;194;39m██║  ██║%ESC%[38;2;255;187;35m██╔════╝%ESC%[38;2;255;180;31m██╔══██╗%ESC%[0m
echo   %ESC%[38;2;255;226;83m██╔████╔██║%ESC%[38;2;255;223;76m██║%ESC%[38;2;255;221;69m██╔██╗ ██║%ESC%[38;2;255;218;61m██║%ESC%[38;2;255;215;54m██║     %ESC%[38;2;255;210;48m███████║%ESC%[38;2;255;203;44m██║   ██║%ESC%[38;2;255;195;40m██╔██╗ ██║%ESC%[38;2;255;188;36m██║     %ESC%[38;2;255;181;31m███████║%ESC%[38;2;255;174;27m█████╗  %ESC%[38;2;255;167;23m██████╔╝%ESC%[0m
echo   %ESC%[38;2;255;221;70m██║╚██╔╝██║%ESC%[38;2;255;218;63m██║%ESC%[38;2;255;216;55m██║╚██╗██║%ESC%[38;2;255;211;49m██║%ESC%[38;2;255;204;45m██║     %ESC%[38;2;255;197;41m██╔══██║%ESC%[38;2;255;190;37m██║   ██║%ESC%[38;2;255;182;32m██║╚██╗██║%ESC%[38;2;255;175;28m██║     %ESC%[38;2;255;168;24m██╔══██║%ESC%[38;2;255;161;20m██╔══╝  %ESC%[38;2;255;154;15m██╔══██╗%ESC%[0m
echo   %ESC%[38;2;255;216;57m██║ ╚═╝ ██║%ESC%[38;2;255;213;50m██║%ESC%[38;2;255;205;46m██║ ╚████║%ESC%[38;2;255;198;42m██║%ESC%[38;2;255;191;37m███████╗%ESC%[38;2;255;184;33m██║  ██║%ESC%[38;2;255;177;29m╚██████╔╝%ESC%[38;2;255;170;25m██║ ╚████║%ESC%[38;2;255;162;20m╚██████╗%ESC%[38;2;255;155;16m██║  ██║%ESC%[38;2;255;148;12m███████╗%ESC%[38;2;255;141;8m██║  ██║%ESC%[0m
echo   %ESC%[38;2;255;207;47m╚═╝     ╚═╝%ESC%[38;2;255;200;42m╚═╝%ESC%[38;2;255;192;38m╚═╝  ╚═══╝%ESC%[38;2;255;185;34m╚═╝%ESC%[38;2;255;178;30m╚══════╝%ESC%[38;2;255;171;26m╚═╝  ╚═╝%ESC%[38;2;255;164;21m ╚═════╝ %ESC%[38;2;255;157;17m╚═╝  ╚═══╝%ESC%[38;2;255;150;13m ╚═════╝%ESC%[38;2;255;142;8m╚═╝  ╚═╝%ESC%[38;2;255;135;4m╚══════╝%ESC%[38;2;255;128;0m╚═╝  ╚═╝%ESC%[0m
echo.
echo   %ESC%[38;2;255;214;51m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%ESC%[0m
echo   %ESC%[38;2;154;154;166mЛаунчер для Minecraft  ·  запуск через npm start%ESC%[0m
echo.

rem --- Проверка Node.js ---
where node >nul 2>&1
if errorlevel 1 (
    echo   %ESC%[38;2;255;92;92m✖ Node.js не найден.%ESC%[0m Установите его с https://nodejs.org и запустите снова.
    echo.
    pause
    exit /b 1
)

rem --- Первый запуск: ставим зависимости ---
if not exist "node_modules" (
    echo   %ESC%[38;2;255;214;51m▸%ESC%[0m Первый запуск: установка зависимостей, это займёт пару минут...
    echo.
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo   %ESC%[38;2;255;92;92m✖ Не удалось установить зависимости.%ESC%[0m
        echo.
        pause
        exit /b 1
    )
    echo.
)

rem --- Запуск npm start в скрытом окне ---
if exist "launcher.log" del /q "launcher.log" >nul 2>&1
<nul set /p "=  %ESC%[38;2;255;214;51m▸%ESC%[0m Запускаю MiniLauncher "
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm start > launcher.log 2>&1' -WindowStyle Hidden"

rem --- Ждём, пока появится окно лаунчера (до ~60 секунд) ---
set /a tries=0
:wait
tasklist /V /FI "IMAGENAME eq electron.exe" 2>nul | find /I "MiniLauncher" >nul
if not errorlevel 1 goto opened
set /a tries+=1
if %tries% geq 120 goto failed
<nul set /p "=%ESC%[38;2;255;214;51m.%ESC%[0m"
ping -n 1 -w 500 127.0.0.1 >nul
ping -n 1 -w 500 192.0.2.1 >nul
goto wait

:opened
echo.
echo.
echo   %ESC%[38;2;93;214;138m✔ Лаунчер открыт. Приятной игры!%ESC%[0m
ping -n 3 127.0.0.1 >nul
exit

:failed
echo.
echo.
echo   %ESC%[38;2;255;92;92m✖ Лаунчер не открылся за 60 секунд.%ESC%[0m Лог запуска:
echo.
if exist "launcher.log" type "launcher.log"
echo.
pause
exit /b 1
