#!/usr/bin/env bash
# install.sh — Set up ABrain and register it in the application launcher.
#
# What it does:
#   1. Creates a Python virtualenv at .venv (if absent)
#   2. Installs Python dependencies from requirements.txt into the venv
#   3. Makes run.sh executable
#   4. Copies the SVG icon to ~/.local/share/icons/hicolor/scalable/apps/
#   5. Writes a .desktop file to ~/.local/share/applications/ with the
#      correct absolute Exec= and Icon= paths for this machine
#   6. Runs update-desktop-database to refresh the launcher index
#
# To uninstall, run:  ./install.sh --uninstall

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="abrain"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"

uninstall() {
  rm -f "$DESKTOP_DIR/$APP_NAME.desktop"
  rm -f "$ICON_DIR/$APP_NAME.svg"
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  echo "ABrain removed from application launcher."
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# ── Detect distro family ───────────────────────────────────────────────
IS_ARCH=false
if command -v pacman &>/dev/null; then
  IS_ARCH=true
fi

# ── Check Python ───────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found."
  if $IS_ARCH; then
    echo "Install it with: sudo pacman -S python"
  fi
  exit 1
fi

# ── Create virtualenv if missing ───────────────────────────────────────
if [[ ! -f "$SCRIPT_DIR/.venv/bin/python" ]]; then
  echo "Creating virtualenv at .venv ..."

  # On Arch, python-virtualenv / ensurepip may need the base package
  if $IS_ARCH && ! python3 -m ensurepip --version &>/dev/null 2>&1; then
    echo "ERROR: python3 ensurepip is unavailable."
    echo "Install the standard library extras with: sudo pacman -S python"
    exit 1
  fi

  python3 -m venv "$SCRIPT_DIR/.venv"
fi

# ── Install / update Python dependencies ──────────────────────────────
echo "Installing Python dependencies ..."
"$SCRIPT_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$SCRIPT_DIR/.venv/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"

# ── Make run.sh executable ─────────────────────────────────────────────
chmod +x "$SCRIPT_DIR/run.sh"

# ── Install icon ───────────────────────────────────────────────────────
mkdir -p "$ICON_DIR"
cp "$SCRIPT_DIR/ui/icons/abrain.svg" "$ICON_DIR/$APP_NAME.svg"

# ── Write .desktop file ────────────────────────────────────────────────
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/$APP_NAME.desktop" <<EOF
[Desktop Entry]
Name=ABrain
Comment=Mind map and brain-dump tool
Exec=$SCRIPT_DIR/run.sh
Icon=$APP_NAME
Terminal=false
Type=Application
Categories=Utility;Office;MindMapping;
Keywords=mindmap;notes;brain;ideas;
StartupNotify=true
EOF

# Mark it trusted (required by some KDE versions to show in launcher)
chmod +x "$DESKTOP_DIR/$APP_NAME.desktop"

# ── Refresh launcher database ──────────────────────────────────────────
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$DESKTOP_DIR"
fi

echo "Done. ABrain has been installed and added to the application launcher."
if $IS_ARCH; then
  echo "You can find it by searching 'ABrain' in your app menu or KRunner (Alt+F2)."
else
  echo "You can find it by searching 'ABrain' in KRunner (Alt+F2) or the app menu."
fi
