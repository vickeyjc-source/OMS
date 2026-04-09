@echo off
setlocal enabledelayedexpansion

echo Adding branding to all React pages...

set TARGET_DIR=client\src\pages

for /r %TARGET_DIR% %%f in (*.js *.jsx) do (
    echo Processing %%f

    findstr /C:"Powered by Sencilla Tec Solutions" "%%f" >nul
    if errorlevel 1 (
        powershell -Command ^
        "(Get-Content '%%f') -replace '</div>\s*$', '<div style={{position:\"fixed\",bottom:\"8px\",right:\"12px\",fontSize:\"10px\",color:\"rgba(0,0,0,0.5)\",zIndex:9999,pointerEvents:\"none\"}}>Powered by Sencilla Tec Solutions · All Rights Reserved</div>`n</div>' | Set-Content '%%f'"
        
        echo ✔ Branding added to %%f
    ) else (
        echo ⏩ Already exists in %%f
    )
)

echo Done!
pause