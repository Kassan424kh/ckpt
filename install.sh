#!/bin/bash
# ckpt installer.
#
# Local install (from a clone):
#     ./install.sh
#
# Remote install (curl | sh):
#     curl -fsSL https://raw.githubusercontent.com/<user>/ckpt/main/install.sh | sh
#
# Override download source: CKPT_REPO=<user>/<repo> sh install.sh
#                           CKPT_REF=main          (branch/tag/sha to fetch)

set -e

INSTALL_BIN="${INSTALL_BIN:-$HOME/.local/bin}"
INSTALL_DATA="${INSTALL_DATA:-$HOME/.local/share/ckpt}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
REPO="${CKPT_REPO:-Kassan424kh/ckpt}"
REF="${CKPT_REF:-main}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required but not installed" >&2; exit 1; }; }
need python3
need git
need curl

# 1) Decide source: local clone vs. remote tarball.
if [ -f "./ckpt" ] && [ -d "./web" ]; then
  echo "==> Using local source at $(pwd)"
  SRC_DIR="$(pwd)"
  CLEANUP=""
else
  TMP="$(mktemp -d)"
  CLEANUP="$TMP"
  TAR_URL="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
  echo "==> Downloading $TAR_URL"
  curl -fsSL "$TAR_URL" | tar -xz -C "$TMP"
  SRC_DIR="$(find "$TMP" -maxdepth 1 -type d -name 'ckpt-*' | head -1)"
  if [ -z "$SRC_DIR" ]; then
    echo "error: couldn't locate extracted source" >&2; exit 1
  fi
fi
trap '[ -n "$CLEANUP" ] && rm -rf "$CLEANUP"' EXIT

# 2) Install files.
mkdir -p "$INSTALL_BIN" "$INSTALL_DATA/web"
install -m 0755 "$SRC_DIR/ckpt" "$INSTALL_BIN/ckpt"
cp -f "$SRC_DIR/web/index.html" "$INSTALL_DATA/web/index.html"
cp -f "$SRC_DIR/web/app.js"     "$INSTALL_DATA/web/app.js"
cp -f "$SRC_DIR/web/styles.css" "$INSTALL_DATA/web/styles.css"

echo "==> Installed:"
echo "    $INSTALL_BIN/ckpt"
echo "    $INSTALL_DATA/web/"

# Record the installed commit SHA so the UI can detect new releases.
if [ -d "$SRC_DIR/.git" ] && command -v git >/dev/null 2>&1; then
  SHA="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || true)"
else
  # Remote install — query GitHub for current main SHA via git ls-remote (no API quota cost).
  SHA="$(git ls-remote "https://github.com/${REPO}.git" "refs/heads/${REF}" 2>/dev/null | cut -f1)"
fi
if [ -n "$SHA" ]; then
  printf '%s\n' "$SHA" > "$INSTALL_DATA/VERSION"
  echo "    $INSTALL_DATA/VERSION ($SHA)"
fi

# 3) Merge hook registration into ~/.claude/settings.json (idempotent).
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
python3 - "$CLAUDE_SETTINGS" <<'PY'
import json, os, sys
from pathlib import Path

settings_path = Path(sys.argv[1])
data = {}
if settings_path.exists():
    try:
        data = json.loads(settings_path.read_text())
    except Exception:
        # Back up unreadable file rather than clobber it.
        backup = settings_path.with_suffix(settings_path.suffix + ".broken")
        settings_path.rename(backup)
        print(f"    backed up unparseable settings.json -> {backup}", file=sys.stderr)
        data = {}

data.setdefault("hooks", {})

def add_hook(event, command):
    arr = data["hooks"].setdefault(event, [])
    for entry in arr:
        for h in entry.get("hooks", []) or []:
            if h.get("command") == command:
                return False
    arr.append({"matcher": "", "hooks": [{"type": "command", "command": command}]})
    return True

added = []
if add_hook("UserPromptSubmit", "ckpt --hook save-prompt"): added.append("UserPromptSubmit")
if add_hook("Stop",             "ckpt --hook checkpoint"):  added.append("Stop")

settings_path.write_text(json.dumps(data, indent=2) + "\n")
if added:
    print(f"    registered: {' + '.join(added)} -> {settings_path}")
else:
    print(f"    already registered in {settings_path}")
PY

# 4) PATH sanity check.
case ":$PATH:" in
  *":$INSTALL_BIN:"*) ;;
  *) echo
     echo "WARN: $INSTALL_BIN is not in your PATH."
     echo "      add to your shell rc (~/.zshrc or ~/.bashrc):"
     echo "          export PATH=\"\$HOME/.local/bin:\$PATH\""
     ;;
esac

echo
echo "==> Done."
echo
echo "Try it:"
echo "    ckpt --help          # CLI reference"
echo "    ckpt projects        # list known projects (empty until first hook fires)"
echo "    ckpt ui              # open the web UI"
echo
echo "Already using the old in-repo .claude/ setup?"
echo "    cd <project> && ckpt migrate     # move it over (keeps your snapshots)"
