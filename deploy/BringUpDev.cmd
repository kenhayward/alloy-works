@echo off
rem Brings the development stack up to date and starts it, with the connector able to reach sources
rem on this machine and your network (deploy/compose.lan.yaml). Run from the repo root:
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
rem is SERVICE_PORT, from the environment or deploy.env, else 8088.
if not defined SERVICE_PORT if exist deploy.env (
  for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"SERVICE_PORT=" deploy.env') do set "SERVICE_PORT=%%b"
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
echo The stack is up. Open http://dev.acme.localhost:%SERVICE_PORT% (or http://127.0.0.1:%SERVICE_PORT%).
echo The connector can reach this machine and your network; see deploy\compose.lan.yaml.
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
