#!/usr/bin/env bash
# build-deb.sh — Build abrain_1.0.0_amd64.deb using dpkg-deb (no debhelper needed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="abrain"
VERSION="${VERSION:-$(tr -d '[:space:]' < "${SCRIPT_DIR}/VERSION")}"
ARCH="${ARCH:-amd64}"
DEB_FILE="${SCRIPT_DIR}/${PKG_NAME}_${VERSION}_${ARCH}.deb"
STAGE="${SCRIPT_DIR}/.deb-stage"

echo "==> Staging package tree…"
rm -rf "$STAGE"

# ── App files ──────────────────────────────────────────────────────────────
install -d "$STAGE/opt/abrain"
cp -r "$SCRIPT_DIR/main.py" \
      "$SCRIPT_DIR/api.py" \
      "$SCRIPT_DIR/requirements.txt" \
      "$STAGE/opt/abrain/"
cp -r "$SCRIPT_DIR/ui" "$STAGE/opt/abrain/"

# ── Launcher wrapper ───────────────────────────────────────────────────────
install -d "$STAGE/usr/bin"
cat > "$STAGE/usr/bin/abrain" <<'EOF'
#!/bin/bash
exec /opt/abrain/.venv/bin/python /opt/abrain/main.py "$@"
EOF
chmod 755 "$STAGE/usr/bin/abrain"

# ── Desktop integration ────────────────────────────────────────────────────
install -d "$STAGE/usr/share/applications"
install -m 644 "$SCRIPT_DIR/abrain.desktop" \
    "$STAGE/usr/share/applications/abrain.desktop"

install -d "$STAGE/usr/share/icons/hicolor/scalable/apps"
install -m 644 "$SCRIPT_DIR/ui/icons/abrain.svg" \
    "$STAGE/usr/share/icons/hicolor/scalable/apps/abrain.svg"

# ── DEBIAN metadata ────────────────────────────────────────────────────────
install -d "$STAGE/DEBIAN"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: abrain
Version: ${VERSION}
Architecture: ${ARCH}
Maintainer: Andrew Faulkner <andrew.faulkner@fasthosts.com>
Depends: python3, python3-venv, python3-pip, libgl1
Section: utils
Priority: optional
Description: Mind map and brain-dump tool
 ABrain is an interactive mind-mapping and note-taking application
 built on PyWebView and Qt6, with KDE Plasma integration.
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/bash
set -e
case "$1" in
    configure|reconfigure)
        echo "ABrain: setting up Python environment (this may take a minute)…"
        rm -rf /opt/abrain/.venv
        python3 -m venv /opt/abrain/.venv
        /opt/abrain/.venv/bin/pip install --quiet --no-cache-dir \
            -r /opt/abrain/requirements.txt
        echo "ABrain: environment ready."
        ;;
esac
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/bash
set -e
case "$1" in
    remove|purge)
        rm -rf /opt/abrain/.venv
        ;;
esac
EOF
chmod 755 "$STAGE/DEBIAN/prerm"

# ── Build ──────────────────────────────────────────────────────────────────
echo "==> Building ${DEB_FILE}…"
dpkg-deb --build --root-owner-group "$STAGE" "$DEB_FILE"
rm -rf "$STAGE"

echo ""
echo "Done: ${DEB_FILE}"
echo ""
echo "Install with:"
echo "  sudo dpkg -i ${DEB_FILE}"
echo "  sudo apt-get install -f   # if any dependencies are missing"
