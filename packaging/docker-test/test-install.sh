#!/usr/bin/env bash
# End-to-end test of the packaged monitor-agent .deb against a real backend,
# entirely in Docker — builds the .deb, brings up db+backend, registers a
# throwaway test server, installs the .deb into an Ubuntu container on the
# same network, starts the agent, and verifies data actually arrives.
#
# Also exercises the purge+reinstall config-preservation fix: purges the
# package (which used to silently wipe agent.yaml) and reinstalls, confirming
# the prerm backup / postinst restore brings the same server_url/api_key back
# instead of leaving the stock placeholder.
set -euo pipefail

# Git Bash on Windows rewrites leading-/ arguments as Windows paths (e.g.
# /repo -> C:/Program Files/Git/repo) before they ever reach docker — this
# breaks every -v/-w flag below that's meant to stay a path *inside* the
# container. Disable that rewriting for this script.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMG="monitor-agent-test"
CONTAINER="monitor-agent-test"
NET="cybersecurityservermetricsmonitoringplatform_default"
BACKEND_URL="http://localhost:4000"

log() { printf '\n\033[1;36m>> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mFAIL: %s\033[0m\n' "$1"; exit 1; }

log "1/7 Building the .deb (in an ubuntu container — dpkg-deb isn't available on the host)"
docker run --rm -v "$ROOT":/repo -w /repo/packaging ubuntu:22.04 \
  bash -c "chmod +x build-deb.sh debian/postinst debian/prerm debian/postrm && ./build-deb.sh"
DEB="$(ls -t "$ROOT"/dist/monitor-agent_*_all.deb | head -1)"
[ -f "$DEB" ] || fail "no .deb produced"
echo "using $DEB"

log "2/7 Starting db + backend"
(cd "$ROOT" && docker compose up -d db backend)

echo -n "waiting for backend"
for i in $(seq 1 30); do
  curl -s -o /dev/null "$BACKEND_URL/api/v1/auth/login" && break
  echo -n "."
  sleep 2
done
echo

log "3/7 Registering a throwaway test server directly in the DB"
# Bypasses the dashboard API/JWT entirely (the seeded admin in this dev DB
# already has MFA enrolled from prior manual testing, which the API login
# flow has no automated way through) — insert the row with the same
# generateApiKey()/hashApiKey() scheme the backend itself uses.
API_KEY="agt_$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
API_KEY_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$API_KEY")
SERVER_ID=$(cd "$ROOT" && docker compose exec -T db \
  psql -U monitor -d monitoring -t -A -c \
  "INSERT INTO servers (name, api_key_hash) VALUES ('docker-deb-test', '$API_KEY_HASH') RETURNING id;")
# psql -t still prints the "INSERT 0 1" command tag on its own line after the
# returned id — take just the first line rather than stripping all whitespace
# (which would glue the id and the tag into one string).
SERVER_ID=$(echo "$SERVER_ID" | head -1 | tr -d '[:space:]')
[ -n "$SERVER_ID" ] || fail "server insert failed"
echo "server_id=$SERVER_ID"

log "4/7 Building the test image"
# docker build's context argument (unlike -v's source path) doesn't understand
# Git Bash's /e/... drive convention — needs a real Windows path here.
docker build -t "$IMG" "$(cygpath -w "$ROOT/packaging/docker-test")"

log "5/7 Starting the container and installing the .deb"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" --network "$NET" "$IMG" >/dev/null

# docker cp's local-side source path has the same Windows-path requirement as
# docker build's context (see above) — unlike -v, it doesn't understand
# Git Bash's /e/... form.
docker cp "$(cygpath -w "$DEB")" "$CONTAINER:/tmp/monitor-agent.deb"
# postinst's `systemctl ...` calls are all `|| true` and simply no-op here —
# there's no systemd in this container, everything else (user/dirs/perms/npm
# install) runs exactly as it would on a real server.
docker exec "$CONTAINER" dpkg -i /tmp/monitor-agent.deb || \
  docker exec "$CONTAINER" apt-get -f install -y

docker exec "$CONTAINER" bash -c "cat > /etc/monitor-agent/agent.yaml <<EOF
server_url: http://backend:4000
api_key: $API_KEY
tls_verify: false
EOF"

# Start the agent directly (no systemd unit here) as the same user the real
# service would run as.
docker exec -d --user monitor-agent "$CONTAINER" bash -c \
  "MONITOR_CONFIG=/etc/monitor-agent/agent.yaml node /usr/lib/monitor-agent/src/index.js > /tmp/agent.log 2>&1"

log "6/7 Waiting for a send cycle (~35s) then checking logs"
sleep 35
docker exec "$CONTAINER" tail -n 40 /tmp/agent.log

COUNT=$(cd "$ROOT" && docker compose exec -T db \
  psql -U monitor -d monitoring -t -A -c \
  "SELECT count(*) FROM metrics WHERE server_id = '$SERVER_ID';")
COUNT=$(echo "$COUNT" | head -1 | tr -d '[:space:]')
if [ "${COUNT:-0}" -gt 0 ] 2>/dev/null; then
  echo "OK: $COUNT metric row(s) received by the backend"
else
  fail "no metrics arrived at the backend — check the agent log output above"
fi

log "7/7 Regression check: purge + reinstall must not lose the config"
docker exec "$CONTAINER" pkill -f index.js || true
ORIG_KEY=$(docker exec "$CONTAINER" grep api_key /etc/monitor-agent/agent.yaml)
docker exec "$CONTAINER" apt-get purge -y monitor-agent
docker exec "$CONTAINER" test ! -f /etc/monitor-agent/agent.yaml || fail "purge did not remove agent.yaml (unexpected)"
docker exec "$CONTAINER" dpkg -i /tmp/monitor-agent.deb || docker exec "$CONTAINER" apt-get -f install -y
NEW_KEY=$(docker exec "$CONTAINER" grep api_key /etc/monitor-agent/agent.yaml)
if [ "$ORIG_KEY" = "$NEW_KEY" ]; then
  echo "OK: agent.yaml was restored from the prerm backup after purge+reinstall"
else
  fail "config was NOT restored after purge — got: $NEW_KEY"
fi

echo
echo "All checks passed."
echo "Container '$CONTAINER' is left running for inspection:"
echo "  docker exec -it $CONTAINER tail -f /tmp/agent.log"
echo "  docker exec --user monitor-agent -d $CONTAINER bash -c 'MONITOR_CONFIG=/etc/monitor-agent/agent.yaml node /usr/lib/monitor-agent/src/index.js > /tmp/agent.log 2>&1'   # restart it, step 7 killed it"
echo "Tear down with:"
echo "  docker rm -f $CONTAINER && docker rmi $IMG"
echo "  (cd \"$ROOT\" && docker compose down)"
