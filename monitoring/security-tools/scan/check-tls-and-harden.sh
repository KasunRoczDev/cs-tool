#!/usr/bin/env bash
# Standalone TLS-expiry + hardening checks for hosts NOT running the Node agent
# (cron-friendly). Mirrors agent/src/collectors/cert-cve.js. Posts to your API.
#
# Usage:  MONITOR_URL=https://api.example.com MONITOR_KEY=agt_xxx \
#         ./check-tls-and-harden.sh api.example.com:443 dashboard.example.com:443
#
# Cron:   17 6 * * *  /opt/monitor/check-tls-and-harden.sh api.example.com:443
set -uo pipefail

post_event() {
  local type="$1" sev="$2" msg="$3"
  echo "[$sev] $type: $msg"
  if [[ -n "${MONITOR_URL:-}" && -n "${MONITOR_KEY:-}" ]]; then
    curl -s -X POST "$MONITOR_URL/api/v1/security-events" \
      -H "X-Api-Key: $MONITOR_KEY" -H 'Content-Type: application/json' \
      -d "{\"events\":[{\"event_type\":\"$type\",\"severity\":\"$sev\",\"message\":\"$msg\"}]}" >/dev/null || true
  fi
}

# ── TLS expiry for each target ─────────────────────────────────────────────
for target in "$@"; do
  host="${target%%:*}"; port="${target##*:}"; [[ "$port" == "$host" ]] && port=443
  end=$(echo | timeout 8 openssl s_client -servername "$host" -connect "$host:$port" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [[ -z "$end" ]]; then
    post_event tls_cert_error high "Could not read TLS cert for $target"; continue
  fi
  end_epoch=$(date -d "$end" +%s 2>/dev/null || echo 0)
  days=$(( (end_epoch - $(date +%s)) / 86400 ))
  if   (( days < 0 ));  then post_event tls_cert_expired critical "Cert for $target EXPIRED ${days#-}d ago"
  elif (( days <= 7 )); then post_event tls_cert_expiry critical "Cert for $target expires in ${days}d"
  elif (( days <= 30 ));then post_event tls_cert_expiry medium "Cert for $target expires in ${days}d"
  else echo "OK: $target cert valid for ${days}d"; fi
done

# ── Quick host hardening signals ───────────────────────────────────────────
# SSH root login allowed?
if grep -Eq '^\s*PermitRootLogin\s+yes' /etc/ssh/sshd_config 2>/dev/null; then
  post_event ssh_root_login_enabled high "PermitRootLogin yes — disable root SSH"
fi
# Password auth enabled (prefer keys only)?
if grep -Eq '^\s*PasswordAuthentication\s+yes' /etc/ssh/sshd_config 2>/dev/null; then
  post_event ssh_password_auth_enabled medium "SSH PasswordAuthentication enabled"
fi
# Pending OS security updates?
if command -v apt-get >/dev/null; then
  sec=$(apt-get -s -o Debug::NoLocking=true upgrade 2>/dev/null | grep -ci '^Inst.*security' || true)
  (( sec > 0 )) && post_event os_security_updates_pending medium "$sec OS security update(s) pending"
fi
# World-writable files in sensitive dirs?
ww=$(find /etc /usr/local/bin -xdev -type f -perm -0002 2>/dev/null | head -5)
[[ -n "$ww" ]] && post_event world_writable_files high "World-writable files found: $(echo "$ww" | tr '\n' ' ')"

echo "Done. For a full audit run: lynis audit system"
