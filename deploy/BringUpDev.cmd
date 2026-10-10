@echo off
rem Brings the development stack up to date and starts it, open to your network both ways
rem (deploy/compose.lan.yaml): other machines use it over https, and the connector reaches sources on
rem this machine and your network. Run from the repo root:
rem
rem   deploy\BringUpDev.cmd
rem
rem It works from anywhere, since it moves to the repo root itself. It stops at the first problem.
setlocal EnableExtensions

pushd "%~dp0.." || (echo Could not find the repo root beside deploy\. & exit /b 1)

set "COMPOSE=docker compose -f deploy\compose.yaml -f deploy\compose.lan.yaml"

echo == Checking the tools
where git >nul 2>&1 || (call :fail "Git is not on the PATH." & goto :end)
where curl >nul 2>&1 || (call :fail "curl is not on the PATH; Windows 10 and later include it." & goto :end)
where docker >nul 2>&1 || (call :fail "Docker is not on the PATH. Install Docker Desktop." & goto :end)
docker compose version >nul 2>&1 || (call :fail "Docker Compose v2 is missing: 'docker compose' does not run." & goto :end)
docker info >nul 2>&1 || (call :fail "Docker is not running. Start Docker Desktop and try again." & goto :end)

rem The connector's isolated networks need Docker Engine 28.0.0 or later (deploy/README.md).
set "ENGINE="
for /f "delims=" %%v in ('docker version --format "{{.Server.Version}}" 2^>nul') do set "ENGINE=%%v"
if not defined ENGINE (call :fail "Could not read the Docker Engine version." & goto :end)
for /f "tokens=1 delims=." %%m in ("%ENGINE%") do set "ENGINE_MAJOR=%%m"
if %ENGINE_MAJOR% LSS 28 (call :fail "Docker Engine %ENGINE% is too old: 28.0.0 or later is needed." & goto :end)
echo Docker Engine %ENGINE%

rem This machine's address on the network: ALLOY_LAN_ADDRESS from the environment or deploy\.env, else
rem the address of the adapter with the default route.
set "ADDRESS_FROM=the environment"
if not defined ALLOY_LAN_ADDRESS if exist deploy\.env (
  set "ADDRESS_FROM=deploy\.env"
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"ALLOY_LAN_ADDRESS=" deploy\.env') do set "ALLOY_LAN_ADDRESS=%%b"
)
if not defined ALLOY_LAN_ADDRESS (
  set "ADDRESS_FROM=found"
  for /f "delims=" %%a in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"') do set "ALLOY_LAN_ADDRESS=%%a"
)
if not defined ALLOY_LAN_ADDRESS (call :fail "Could not find this machine's network address. Set ALLOY_LAN_ADDRESS in deploy\.env." & goto :end)

rem A set address must be one of this machine's own, not loopback or link-local, which the containers
rem cannot reach the host by: another machine's, copied in a .env, fails much later as a refused
rem connection from the setup. Read from the environment by PowerShell, so the value is never code.
set "MINE="
for /f "delims=" %%a in ('powershell -NoProfile -Command "$mine = (Get-NetIPAddress -AddressFamily IPv4).IPAddress | Where-Object { $_ -notlike '127.*' -and $_ -notlike '169.254.*' }; if ($mine -contains $env:ALLOY_LAN_ADDRESS) { 'yes' } else { $mine -join ', ' }"') do set "MINE=%%a"
if not "%MINE%"=="yes" (
  call :fail "ALLOY_LAN_ADDRESS is %ALLOY_LAN_ADDRESS% (from %ADDRESS_FROM%), which is not one of this machine's network addresses. They are %MINE%. Set it to one of them, or remove it to let this script find it."
  goto :end
)
echo Network address %ALLOY_LAN_ADDRESS% (%ADDRESS_FROM%)

echo == Checking the repo
git rev-parse --is-inside-work-tree >nul 2>&1 || (call :fail "%CD% is not a Git checkout." & goto :end)
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="main" (call :fail "The checkout is on '%BRANCH%', not main. Run: git switch main" & goto :end)
set "DIRTY="
for /f "delims=" %%s in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  git status --short
  call :fail "The checkout has uncommitted changes, listed above. Commit, stash or discard them first."
  goto :end
)

echo == Pulling main
git pull --ff-only || (call :fail "git pull could not fast-forward main. Check for local commits on main." & goto :end)
git log -1 --format="Now at %%h %%s"

echo == Building the images
%COMPOSE% build || (call :fail "The build failed; its output is above." & goto :end)

echo == Starting the stack and waiting for it to be healthy
%COMPOSE% up -d --wait --wait-timeout 600 --remove-orphans || (
  %COMPOSE% ps -a
  call :fail "The stack did not come up healthy. Read a container's log with: docker logs alloy-works-service-1"
  goto :end
)

rem The service has no healthcheck, so --wait stops once it runs: ask it until it answers. Its port
rem is SERVICE_PORT, from the environment or deploy\.env, else 8088.
if not defined SERVICE_PORT if exist deploy\.env (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"SERVICE_PORT=" deploy\.env') do set "SERVICE_PORT=%%b"
)
if not defined SERVICE_PORT set "SERVICE_PORT=8088"
echo == Waiting for the service on port %SERVICE_PORT%
set /a TRIES=0
:probe
curl -s -o nul --max-time 5 http://127.0.0.1:%SERVICE_PORT%/ && goto :answered
set /a TRIES+=1
if %TRIES% GEQ 60 (call :fail "The service did not answer on port %SERVICE_PORT% within two minutes. Read: docker logs alloy-works-service-1" & goto :end)
timeout /t 2 /nobreak >nul
goto :probe
:answered

%COMPOSE% ps
echo.
if not defined LAN_SERVICE_PORT set "LAN_SERVICE_PORT=8443"
if not defined LAN_IDP_PORT set "LAN_IDP_PORT=9443"
if not defined LAN_STORE_PORT set "LAN_STORE_PORT=8343"
echo The stack is up. Open http://dev.acme.localhost:%SERVICE_PORT% (or http://127.0.0.1:%SERVICE_PORT%).
echo From another machine: https://%ALLOY_LAN_ADDRESS%:%LAN_SERVICE_PORT%, signing in through the
echo organisation's provider. Trust https://%ALLOY_LAN_ADDRESS%:%LAN_IDP_PORT%/lan-proxy/root.crt there, or
echo accept the warning at each of ports %LAN_SERVICE_PORT%, %LAN_IDP_PORT% and %LAN_STORE_PORT% once.
echo The firewall must let those ports in. The connector can reach this machine and your network.
echo See deploy\compose.lan.yaml.
set "RESULT=0"
goto :end

:fail
echo.
echo FAILED: %~1
set "RESULT=1"
exit /b 1

:end
popd
if not defined RESULT set "RESULT=1"
exit /b %RESULT%
