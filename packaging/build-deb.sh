#!/usr/bin/env bash
# Builds monitor-agent_<version>_all.deb
# Usage: ./build-deb.sh   (run from the packaging/ directory or repo root)
set -euo pipefail

VERSION="1.0.0"
PKG="monitor-agent"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"        # repo root
PKGDIR="$ROOT/packaging"
AGENT="$ROOT/agent"
BUILD="$(mktemp -d)"
STAGE="$BUILD/${PKG}_${VERSION}_all"

echo ">> staging in $STAGE"
mkdir -p "$STAGE/DEBIAN"
mkdir -p "$STAGE/usr/lib/monitor-agent"
mkdir -p "$STAGE/etc/monitor-agent"
mkdir -p "$STAGE/lib/systemd/system"

# --- application files ---
cp -r "$AGENT/src" "$STAGE/usr/lib/monitor-agent/"
cp "$AGENT/package.json" "$STAGE/usr/lib/monitor-agent/"

# --- default config (installed as conffile) ---
cp "$AGENT/config/agent.example.yaml" "$STAGE/etc/monitor-agent/agent.yaml"

# --- systemd unit ---
cp "$PKGDIR/systemd/monitor-agent.service" "$STAGE/lib/systemd/system/"

# --- control files ---
cp "$PKGDIR/debian/control"    "$STAGE/DEBIAN/control"
cp "$PKGDIR/debian/conffiles"  "$STAGE/DEBIAN/conffiles"
cp "$PKGDIR/debian/postinst"   "$STAGE/DEBIAN/postinst"
cp "$PKGDIR/debian/prerm"      "$STAGE/DEBIAN/prerm"
cp "$PKGDIR/debian/postrm"     "$STAGE/DEBIAN/postrm"
chmod 0755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm" "$STAGE/DEBIAN/postrm"

# --- build ---
OUT="$ROOT/dist"
mkdir -p "$OUT"
dpkg-deb --build --root-owner-group "$STAGE" "$OUT/${PKG}_${VERSION}_all.deb"

echo ">> built $OUT/${PKG}_${VERSION}_all.deb"
echo ">> install with: sudo dpkg -i $OUT/${PKG}_${VERSION}_all.deb"
rm -rf "$BUILD"
