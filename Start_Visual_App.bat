@echo off
setlocal
set "HTML_PATH=%~dp0portable_book_reader.html"
where msedge >nul 2>nul && (
    start "" msedge --app="file:///%HTML_PATH:\=/%"
    exit /b 0
)
where chrome >nul 2>nul && (
    start "" chrome --app="file:///%HTML_PATH:\=/%"
    exit /b 0
)
start "" "%HTML_PATH%"
