#!/usr/bin/env bash
# Trivy — container image & filesystem CVE scanner (SCA + OS package CVEs).
# Run in CI before deploy, and on a schedule against running images.
# Install: https://aquasecurity.github.io/trivy
#   apt install -y wget apt-transport-https gnupg
#   wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor | tee /usr/share/keyrings/trivy.gpg >/dev/null
#   echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" | tee /etc/apt/sources.list.d/trivy.list
#   apt update && apt install -y trivy
#
# Usage:
#   ./trivy-scan.sh image  monitor-backend:latest
#   ./trivy-scan.sh fs      /opt/app
#   ./trivy-scan.sh compose ../../docker-compose.yml
set -euo pipefail

MODE="${1:-image}"
TARGET="${2:-}"
OUT_DIR="${TRIVY_OUT:-./trivy-reports}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/trivy-$MODE-$STAMP.json"

# Fail the build (exit 1) only on HIGH/CRITICAL. Adjust --severity as needed.
COMMON=(--severity HIGH,CRITICAL --no-progress --format json --output "$REPORT")

case "$MODE" in
  image)   trivy image "${COMMON[@]}" --exit-code 1 "$TARGET" ;;
  fs)      trivy fs    "${COMMON[@]}" --exit-code 1 --scanners vuln,secret,misconfig "$TARGET" ;;
  compose)
    # Scan every image referenced by a compose file.
    grep -E '^\s*image:' "$TARGET" | awk '{print $2}' | while read -r img; do
      echo ">> scanning $img"
      trivy image --severity HIGH,CRITICAL --no-progress "$img" || true
    done
    ;;
  *) echo "modes: image | fs | compose"; exit 2 ;;
esac

echo "Report written to $REPORT"
# Optional: POST the summary into your platform's security-events endpoint.
# CRIT=$(jq '[.Results[].Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length' "$REPORT")
# curl -s -X POST "$MONITOR_URL/api/v1/security-events" -H "X-Api-Key: $MONITOR_KEY" \
#   -H 'Content-Type: application/json' \
#   -d "{\"events\":[{\"event_type\":\"image_vulnerability\",\"severity\":\"critical\",\"message\":\"$CRIT critical CVEs in $TARGET\"}]}"
