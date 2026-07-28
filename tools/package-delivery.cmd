@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

cd /d "%~dp0.."
set ROOT=%cd%
set VERSION=v3.1.1

if not "%1"=="" set VERSION=%1

for %%I in ("%ROOT%") do set PARENT=%%~dpI
set PKGDIR=%PARENT%myPDM-Delivery-%VERSION%

if exist "%PKGDIR%" rd /s /q "%PKGDIR%"
mkdir "%PKGDIR%"

echo [1/6] docker-compose.prod.yml
copy /y "%ROOT%\docker-compose.prod.yml" "%PKGDIR%\" >nul

echo [2/6] nginx\
if not exist "%PKGDIR%\nginx" mkdir "%PKGDIR%\nginx"
copy /y "%ROOT%\nginx\nginx.conf" "%PKGDIR%\nginx\nginx.conf" >nul

echo [3/6] certs\ initdb\
if exist "%ROOT%\certs" xcopy /e /i /y "%ROOT%\certs" "%PKGDIR%\certs" >nul
if exist "%ROOT%\initdb" xcopy /e /i /y "%ROOT%\initdb" "%PKGDIR%\initdb" >nul

echo [4/6] frontend\dist\
if exist "%ROOT%\frontend\dist" (
    xcopy /e /i /y "%ROOT%\frontend\dist" "%PKGDIR%\frontend\dist" >nul
) else (
    echo Warning: frontend\dist\ not found, run: cd frontend ^&^& npm run build
)

echo [5/6] mypdm-backend-%VERSION%.tar
if exist "%ROOT%\backend\mypdm-backend-%VERSION%.tar" (
    copy /y "%ROOT%\backend\mypdm-backend-%VERSION%.tar" "%PKGDIR%\" >nul
) else (
    echo Warning: image tar not found, run: docker save -o backend\mypdm-backend-%VERSION%.tar mypdm-backend:%VERSION%
)

echo [6/6] env.template
if exist "%ROOT%\.env" copy /y "%ROOT%\.env" "%PKGDIR%\env.template" >nul

echo.
echo Done: %PKGDIR%
pause
