@echo off
REM ============================================================
REM  MediaMaid -> Cloudflare Pages mirror (mediamaid.pages.dev)
REM  Shared cfut token (readaloud-5a/cf-deploy/.token, Pages rights).
REM  Primary = GitHub Pages https://mdshezkhn.github.io/mediamaid/
REM  v4 notes:
REM   - rebuilds build\cf-deploy FRESH every run
REM   - cmd `copy` does NOT accept space-separated multi-source
REM     (2nd file = destination -> "syntax incorrect"); loop instead
REM ============================================================
cd /d "%~dp0.."
if exist "build\cf-deploy" rmdir /s /q "build\cf-deploy"
echo Building deploy dir...
mkdir "build\cf-deploy" 2>nul
for %%F in (index.html about.html contact.html disclaimer.html privacy-policy.html terms-of-service.html style.css glass.css main.js universal.js compressor.js tools-core.js tools-video.js tools-audio.js tools-doc.js tools-ui.js robots.txt sitemap.xml) do copy /y "%%F" "build\cf-deploy\" >nul
xcopy /e /i /y assets "build\cf-deploy\assets\" >nul
mkdir "build\cf-deploy\vendor" 2>nul
for %%F in (mediabunny.mjs pdf-lib.min.js lame.min.js) do copy /y "vendor\%%F" "build\cf-deploy\vendor\" >nul
for /f "usebackq delims=" %%T in ("..\readaloud-5a\cf-deploy\.token") do set "CLOUDFLARE_API_TOKEN=%%T"
for /f "usebackq delims=" %%A in ("..\readaloud-5a\cf-deploy\.acct") do set "CLOUDFLARE_ACCOUNT_ID=%%A"
if not defined CLOUDFLARE_API_TOKEN ( echo TOKEN MISSING & exit /b 1 )
set WRANGLER_SEND_METRICS=false
"..\readaloud-5a\tools\wrangler\node_modules\.bin\wrangler.cmd" pages deploy build\cf-deploy --project-name mediamaid --branch main --commit-dirty=true
