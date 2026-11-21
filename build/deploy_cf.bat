@echo off
REM ============================================================
REM  MediaMaid -> Cloudflare Pages mirror (mediamaid.pages.dev)
REM  Uses the shared cfut token from readaloud-5a/cf-deploy/.token
REM  (Pages rights only). Primary hosting = GitHub Pages
REM  https://mdshezkhn.github.io/mediamaid/ (push to main).
REM ============================================================
cd /d "%~dp0.."
if not exist "build\cf-deploy" (
  echo Building deploy dir...
  mkdir build\cf-deploy 2>nul
  copy /y index.html about.html contact.html disclaimer.html privacy-policy.html terms-of-service.html style.css main.js universal.js compressor.js robots.txt sitemap.xml build\cf-deploy\ >nul
  xcopy /e /i /y assets build\cf-deploy\assets >nul
  mkdir build\cf-deploy\vendor 2>nul
  copy /y vendor\mediabunny.mjs build\cf-deploy\vendor\ >nul
)
for /f "usebackq delims=" %%T in ("..\readaloud-5a\cf-deploy\.token") do set "CLOUDFLARE_API_TOKEN=%%T"
for /f "usebackq delims=" %%A in ("..\readaloud-5a\cf-deploy\.acct") do set "CLOUDFLARE_ACCOUNT_ID=%%A"
set WRANGLER_SEND_METRICS=false
"..\readaloud-5a\tools\wrangler\node_modules\.bin\wrangler.cmd" pages deploy build\cf-deploy --project-name mediamaid --branch main --commit-dirty=true
