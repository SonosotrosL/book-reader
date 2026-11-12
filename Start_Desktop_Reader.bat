@echo off
cd /d "%~dp0"
start "" pythonw "%~dp0portable_book_reader.py" %* || python "%~dp0portable_book_reader.py" %*
