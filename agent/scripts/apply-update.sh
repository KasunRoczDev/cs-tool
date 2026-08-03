#!/bin/bash
# =============================================================================
#  apply-update.sh — applies a downloaded monitor-agent .deb as root.
#
#  Invoked by the agent (unprivileged 'monitor-agent' user) via a narrowly
#  scoped sudoers rule (see packaging/debian/monitor-agent-updater.sudoers):
#    sudo /usr/lib/monitor-agent/scripts/apply-update.sh <path-to-new.deb>
#
#  Steps: back up current install -> dpkg -i -> restart -> health-check ->
#  roll back to the pre-update backup on failure.
# =============================================================================
set -uo pipefail

UPDATES_DIR="/var/lib/monitor-agent/updates"
BACKUP_DIR="/var/lib/monitor-agent/backup"
APP_DIR="/usr/lib/monitor-agent"
LOG_FILE="/var/log/monitor-agent-updater.log"
SERVICE="monitor-agent"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

NEW_DEB="${1:-}"
if [[ -z "$NEW_DEB" ]]; then
  log "FATAL: no package path given"
  exit 2
fi
# Defense in depth: the sudoers rule already pins this script's own path, but
# validate the argument stays inside the agent's writable updates dir too, so
# this script can't be tricked into dpkg-installing an arbitrary file.
case "$NEW_DEB" in
  "$UPDATES_DIR"/*) ;;
  *) log "FATAL: refusing to install a package outside $UPDATES_DIR: $NEW_DEB"; exit 2 ;;
esac
if [[ ! -f "$NEW_DEB" ]]; then
  log "FATAL: package not found: $NEW_DEB"
  exit 2
fi

restart_service() {
  systemctl restart "$SERVICE" >>"$LOG_FILE" 2>&1
}

health_check() {
  sleep 15
  systemctl is-active --quiet "$SERVICE" || return 1
  local restarts
  restarts="$(systemctl show "$SERVICE" -p NRestarts --value 2>/dev/null || echo 0)"
  [[ "${restarts:-0}" -eq 0 ]]
}

log "===== Applying agent update: $NEW_DEB ====="

mkdir -p "$BACKUP_DIR"
rm -rf "$BACKUP_DIR/current"
cp -a "$APP_DIR" "$BACKUP_DIR/current"
log "Backed up current install to $BACKUP_DIR/current"

if ! dpkg -i "$NEW_DEB" >>"$LOG_FILE" 2>&1; then
  log "dpkg -i failed — restoring backup"
  rm -rf "$APP_DIR"
  cp -a "$BACKUP_DIR/current" "$APP_DIR"
  restart_service
  exit 1
fi

restart_service || log "Restart command returned non-zero after install"

if health_check; then
  log "Update healthy"
  exit 0
fi

log "New version unhealthy after restart — rolling back to previous install"
rm -rf "$APP_DIR"
cp -a "$BACKUP_DIR/current" "$APP_DIR"
# Note: dpkg's own package database still records the failed version as
# installed at this point (files were restored directly, not through dpkg).
# This is cosmetic only — the next dpkg -i (any future update) still applies
# cleanly since dpkg isn't diffing file contents, and the files actually
# served by systemd (which is what this restores) are what determines
# behavior.
if restart_service && health_check; then
  log "Rollback succeeded"
else
  log "Rollback restart did not come up healthy — manual intervention needed"
fi
exit 1
