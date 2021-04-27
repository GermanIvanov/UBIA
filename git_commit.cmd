@echo off
git add -A
git commit -m "%computername% regular bild"
git push --all --progress "origin"
pause