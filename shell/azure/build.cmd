@echo off

SET THIS=%~dp0

cd ..
node ../node_modules/typescript/bin/tsc
cd azure

"C:\Program Files\Microsoft SDKs\Azure\.NET SDK\v2.9\bin\cspack.exe" %THIS%\tdshell.csdef /out:%THIS%\..\..\built\tdshell.cspkg /roleFiles:ShellRole;%THIS%\files.txt
if %ERRORLEVEL% NEQ 0 (
    echo Error building bootstrap.cspkg. Make sure cspack.exe from Windows Azure SDK is on the PATH.
    exit /b -1
)

exit /b 0
