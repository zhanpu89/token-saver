#!/usr/bin/env bash
# token-saver installer
# Usage:
#   bash install.sh                    # install into current directory
#   bash install.sh /path/to/project   # install into specific project
#   curl -fsSL https://... | bash      # remote install (TBD)
#
# Installs: plugin, /trim command, config, SDK batch scripts

set -euo pipefail

TARGET_DIR="$(cd "${1:-.}" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR"

# ── helpers ──────────────────────────────────────────────────────────
red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
dim()   { printf "\033[2m%s\033[0m\n" "$*"; }
bold()  { printf "\033[1m%s\033[0m\n" "$*"; }

merge_json() {
  # merge JSON object from stdin into $1 at $2, using node
  # usage: echo '{"key":"val"}' | merge_json file.json '.path'
  local file="$1" key="$2"
  local tmp
  tmp=$(mktemp)
  node -e "
    const fs = require('fs');
    const base = JSON.parse(fs.readFileSync('$file','utf8'));
    const override = JSON.parse(fs.readFileSync('/dev/stdin','utf8'));
    const merge = (a,b) => { for(const k of Object.keys(b)) { if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])) { a[k]=a[k]||{}; merge(a[k],b[k]); } else a[k]=b[k]; } };
    merge(base, override);
    fs.writeFileSync('$tmp', JSON.stringify(base, null, 2) + '\n');
  "
  mv "$tmp" "$file"
}

merge_json_array() {
  # merge unique items into a JSON array; create array if missing
  local file="$1" key="$2" item="$3"
  local tmp
  tmp=$(mktemp)
  node -e "
    const fs = require('fs');
    const base = JSON.parse(fs.readFileSync('$file','utf8'));
    const path = '$key'.split('.').filter(Boolean);
    let cur = base;
    for (let i = 0; i < path.length - 1; i++) {
      cur[path[i]] = cur[path[i]] || {};
      cur = cur[path[i]];
    }
    const last = path[path.length - 1];
    if (!Array.isArray(cur[last])) cur[last] = [];
    if (!cur[last].includes('$item')) cur[last].push('$item');
    fs.writeFileSync('$tmp', JSON.stringify(base, null, 2) + '\n');
  "
  mv "$tmp" "$file"
}

# ── checks ───────────────────────────────────────────────────────────
if [ ! -d "$TARGET_DIR/.opencode" ]; then
  red "✖ $TARGET_DIR/.opencode/ not found."
  echo "  Run this script from an opencode project root, or pass the project path as argument."
  echo "  Usage: bash install.sh /path/to/your/project"
  exit 1
fi

if ! command -v node &>/dev/null; then
  red "✖ node is required for JSON merging."
  exit 1
fi

bold ""
bold "┌─────────────────────────────┐"
bold "│   token-saver installer     │"
bold "└─────────────────────────────┘"
echo ""
echo "  Target: $(green "$TARGET_DIR")"
echo ""

# ── 1. Plugin ────────────────────────────────────────────────────────
mkdir -p "$TARGET_DIR/.opencode/plugins"
cp "$SRC_DIR/.opencode/plugins/token-saver.ts" "$TARGET_DIR/.opencode/plugins/token-saver.ts"
green "  ✅  Plugin: .opencode/plugins/token-saver.ts"

# ── 2. /trim command ─────────────────────────────────────────────────
mkdir -p "$TARGET_DIR/.opencode/commands"
cp "$SRC_DIR/.opencode/commands/trim.md" "$TARGET_DIR/.opencode/commands/trim.md"
green "  ✅  Command: .opencode/commands/trim.md"

# ── 3. Config (don't overwrite existing) ──────────────────────────────
if [ -f "$TARGET_DIR/.opencode/token-saver.json" ]; then
  dim "  ⏭  Config: .opencode/token-saver.json (already exists, keeping yours)"
else
  cp "$SRC_DIR/.opencode/token-saver.json" "$TARGET_DIR/.opencode/token-saver.json"
  green "  ✅  Config: .opencode/token-saver.json"
fi

# ── 4. Register plugin in opencode.json ──────────────────────────────
OPCODE_CONFIG="$TARGET_DIR/.opencode/opencode.json"
if [ ! -f "$OPCODE_CONFIG" ]; then
  # create minimal opencode.json
  cat > "$OPCODE_CONFIG" <<-EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["token-saver"]
}
EOF
  green "  ✅  Created: .opencode/opencode.json (plugin registered)"
else
  merge_json_array "$OPCODE_CONFIG" "plugin" "token-saver"
  green "  ✅  Registered: plugin \"token-saver\" in .opencode/opencode.json"
fi

# ── 5. Merge .opencode/package.json dependencies ─────────────────────
PKG_FILE="$TARGET_DIR/.opencode/package.json"
if [ ! -f "$PKG_FILE" ]; then
  # create minimal package.json
  cat > "$PKG_FILE" <<-EOF
{
  "dependencies": {
    "@opencode-ai/plugin": "1.17.7"
  }
}
EOF
  green "  ✅  Created: .opencode/package.json"
else
  cat "$SRC_DIR/.opencode/package.json" | merge_json "$PKG_FILE" ".dependencies"
  green "  ✅  Merged: @opencode-ai/plugin dependency"
fi

# ── 6. SDK scripts ────────────────────────────────────────────────────
if [ -d "$TARGET_DIR/scripts" ] && [ -f "$TARGET_DIR/scripts/package.json" ]; then
  # merge scripts dependencies
  cp "$SRC_DIR/scripts/trim-session.ts" "$TARGET_DIR/scripts/trim-session.ts"
  cat "$SRC_DIR/scripts/package.json" | merge_json "$TARGET_DIR/scripts/package.json" ".dependencies"
  green "  ✅  SDK script: scripts/trim-session.ts"
else
  mkdir -p "$TARGET_DIR/scripts"
  cp "$SRC_DIR/scripts/trim-session.ts" "$TARGET_DIR/scripts/trim-session.ts"
  cp "$SRC_DIR/scripts/package.json" "$TARGET_DIR/scripts/package.json"
  green "  ✅  SDK script: scripts/trim-session.ts + package.json"
fi

# ── 7. Install npm dependencies (optional) ────────────────────────────
if command -v bun &>/dev/null; then
  dim ""
  dim "  Installing .opencode dependencies via bun..."
  (cd "$TARGET_DIR/.opencode" && bun install 2>&1 | sed 's/^/    /')
  green "  ✅  .opencode/ dependencies installed"
  if [ -f "$TARGET_DIR/scripts/package.json" ]; then
    dim "  Installing scripts dependencies via bun..."
    (cd "$TARGET_DIR/scripts" && bun install 2>&1 | sed 's/^/    /')
    green "  ✅  scripts/ dependencies installed"
  fi
elif command -v npm &>/dev/null; then
  dim ""
  dim "  Installing .opencode dependencies via npm..."
  (cd "$TARGET_DIR/.opencode" && npm install --no-audit --no-fund 2>&1 | sed 's/^/    /')
  green "  ✅  .opencode/ dependencies installed"
  if [ -f "$TARGET_DIR/scripts/package.json" ]; then
    dim "  Installing scripts dependencies via npm..."
    (cd "$TARGET_DIR/scripts" && npm install --no-audit --no-fund 2>&1 | sed 's/^/    /')
    green "  ✅  scripts/ dependencies installed"
  fi
else
  dim ""
  dim "  ⚡  Run 'bun install' or 'npm install' in:"
  dim "      $TARGET_DIR/.opencode/"
  dim "      $TARGET_DIR/scripts/"
fi

# ── done ─────────────────────────────────────────────────────────────
echo ""
bold "  🎉  token-saver installed successfully!"
echo ""
echo "  $(green "Next steps:")"
echo "  1. Restart / reload your opencode session"
echo "  2. Type $(bold "/trim") to manually compress the conversation"
echo "  3. Edit $(bold ".opencode/token-saver.json") to tweak thresholds"
echo ""
