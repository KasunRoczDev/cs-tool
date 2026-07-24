#!/bin/bash
# =============================================================================
#  OMS Release Utility  —  deploy-release.sh
#
#  Runs the fixed release pipeline for ONE repo in ONE environment on this
#  server, with structured step markers so the platform can show per-step status.
#
#  Two modes:
#    • Interactive  : run with no args → the original menu (env/repo/branch/cmds).
#    • Non-interactive (used by the monitoring agent):
#        deploy-release.sh --env <env_path> --repo <repo_slug> \
#                          [--branch <name>] [--commit <sha>] \
#                          [--cmd "command"]... [--base-dir DIR] [--log-dir DIR]
#
#  Pipeline steps: fetch → checkout → install → build → migrate → restart →
#                  health-check → custom-commands. On failure the working tree
#                  is reset back to the pre-deploy commit (rollback).
#
#  Step markers (parsed by the agent):  ::step:<name>:<start|ok|fail>::
# =============================================================================
set -uo pipefail

BASE_DIR="${BASE_DIR:-/var/www/release-env}"
LOG_DIR="${LOG_DIR:-/var/log/oms-release}"
ENV_PATH=""
REPO_NAME=""
BRANCH_NAME=""
COMMIT_SHA=""
CUSTOM_COMMANDS=()
INTERACTIVE=1

# ---- Parse non-interactive flags --------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      ENV_PATH="$2"; INTERACTIVE=0; shift 2 ;;
    --repo)     REPO_NAME="$2"; INTERACTIVE=0; shift 2 ;;
    --branch)   BRANCH_NAME="$2"; shift 2 ;;
    --commit)   COMMIT_SHA="$2"; shift 2 ;;
    --cmd)      CUSTOM_COMMANDS+=("$2"); shift 2 ;;
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --log-dir)  LOG_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"

# ---- Interactive menu (original UX) -----------------------------------------
if [[ "$INTERACTIVE" -eq 1 ]]; then
  clear
  echo "====================================="
  echo "      OMS Release Utility"
  echo "====================================="
  echo ""
  echo "Select Environment"
  echo "1) Canary   2) Beta   3) Production   4) Enterprise"
  read -rp "Enter choice [1-4]: " ENV_CHOICE
  case $ENV_CHOICE in
    1) ENV_PATH="oms-canary" ;;
    2) ENV_PATH="oms-beta" ;;
    3) echo "⚠ Production selected!"; read -rp "Type YES to continue: " C; [ "$C" != "YES" ] && exit 1; ENV_PATH="oms-production" ;;
    4) ENV_PATH="oms-enterprise" ;;
    *) echo "Invalid choice"; exit 1 ;;
  esac
  echo ""
  echo "Select Repository"
  echo "1) oms-master-be   2) oms-order-be   3) oms-report-be"
  read -rp "Enter choice [1-3]: " REPO_CHOICE
  case $REPO_CHOICE in
    1) REPO_NAME="oms-master-be" ;;
    2) REPO_NAME="oms-order-be" ;;
    3) REPO_NAME="oms-report-be" ;;
    *) echo "Invalid choice"; exit 1 ;;
  esac
  read -rp "Enter Branch Name (empty = current): " BRANCH_NAME
  echo "Enter custom commands (empty line to finish):"
  while true; do read -rp "> " CMD; [ -z "$CMD" ] && break; CUSTOM_COMMANDS+=("$CMD"); done
fi

[[ -z "$ENV_PATH" || -z "$REPO_NAME" ]] && { echo "env and repo are required"; exit 2; }

LOG_FILE="$LOG_DIR/${ENV_PATH}-${REPO_NAME}.log"
APP_PATH="$BASE_DIR/$ENV_PATH/$REPO_NAME"
ROLLBACK_SHA=""

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
step() { echo "::step:$1:$2::" | tee -a "$LOG_FILE"; }

run() {                       # run <step-name> <command...>
  local name="$1"; shift
  step "$name" start
  if "$@" >>"$LOG_FILE" 2>&1; then
    step "$name" ok
    return 0
  else
    step "$name" fail
    return 1
  fi
}

rollback() {
  if [[ -n "$ROLLBACK_SHA" ]]; then
    log "Rolling back to $ROLLBACK_SHA"
    git reset --hard "$ROLLBACK_SHA" >>"$LOG_FILE" 2>&1 || true
  fi
}

log "===== Releasing $ENV_PATH/$REPO_NAME ====="
if [[ ! -d "$APP_PATH/.git" ]]; then
  log "FATAL: git repo not found at $APP_PATH"
  step "fetch" fail
  exit 1
fi
cd "$APP_PATH" || { log "cannot cd $APP_PATH"; exit 1; }
ROLLBACK_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
log "Pre-deploy commit: ${ROLLBACK_SHA:0:8}"

# 1) fetch
run fetch git fetch --all --prune || { rollback; exit 1; }

# 2) checkout (branch and/or commit)
if [[ -n "$COMMIT_SHA" ]]; then
  run checkout git checkout -f "$COMMIT_SHA" || { rollback; exit 1; }
elif [[ -n "$BRANCH_NAME" ]]; then
  step checkout start
  if git checkout "$BRANCH_NAME" >>"$LOG_FILE" 2>&1 && git reset --hard "origin/$BRANCH_NAME" >>"$LOG_FILE" 2>&1; then
    step checkout ok
  else
    step checkout fail; rollback; exit 1
  fi
else
  run checkout git pull --ff-only || { rollback; exit 1; }
fi

# 3) install deps (auto-detect stack)
step install start
INSTALL_OK=1
if [[ -f composer.json ]]; then
  composer install --no-interaction --prefer-dist --no-dev >>"$LOG_FILE" 2>&1 || INSTALL_OK=0
fi
if [[ -f package.json ]]; then
  (npm ci >>"$LOG_FILE" 2>&1 || npm install >>"$LOG_FILE" 2>&1) || INSTALL_OK=0
fi
[[ "$INSTALL_OK" -eq 1 ]] && step install ok || { step install fail; rollback; exit 1; }

# 4) build (front-end / asset build if present)
step build start
if [[ -f package.json ]] && grep -q '"build"' package.json; then
  npm run build >>"$LOG_FILE" 2>&1 || { step build fail; rollback; exit 1; }
fi
step build ok

# 5) migrate (Laravel artisan if present)
step migrate start
if [[ -f artisan ]]; then
  php artisan migrate --force >>"$LOG_FILE" 2>&1 || { step migrate fail; rollback; exit 1; }
fi
step migrate ok

# 6) restart services (php-fpm reload, queue restart, pm2 if used)
step restart start
{
  [[ -f artisan ]] && php artisan config:cache >>"$LOG_FILE" 2>&1
  [[ -f artisan ]] && php artisan queue:restart >>"$LOG_FILE" 2>&1
  command -v systemctl >/dev/null && sudo systemctl reload php*-fpm >>"$LOG_FILE" 2>&1 || true
  command -v pm2 >/dev/null && pm2 reload "$REPO_NAME" >>"$LOG_FILE" 2>&1 || true
} || true
step restart ok

# 7) health check (optional HEALTHCHECK_URL env)
step health start
if [[ -n "${HEALTHCHECK_URL:-}" ]]; then
  if curl -fsS --max-time 15 "$HEALTHCHECK_URL" >>"$LOG_FILE" 2>&1; then
    step health ok
  else
    step health fail; rollback; exit 1
  fi
else
  log "No HEALTHCHECK_URL set — skipping health probe"
  step health ok
fi

# 8) custom commands
if [[ ${#CUSTOM_COMMANDS[@]} -gt 0 ]]; then
  step custom start
  CUSTOM_OK=1
  for CMD in "${CUSTOM_COMMANDS[@]}"; do
    log "Executing custom: $CMD"
    bash -c "$CMD" >>"$LOG_FILE" 2>&1 || { CUSTOM_OK=0; break; }
  done
  [[ "$CUSTOM_OK" -eq 1 ]] && step custom ok || { step custom fail; rollback; exit 1; }
fi

log "===== Release complete: $ENV_PATH/$REPO_NAME @ $(git rev-parse --short HEAD) ====="
exit 0
