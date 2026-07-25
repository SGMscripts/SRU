#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir" || exit 1

npm_bin=""
for candidate in /usr/local/bin/npm /opt/homebrew/bin/npm; do
  if [[ -x "$candidate" ]]; then
    npm_bin="$candidate"
    break
  fi
done
if [[ -z "$npm_bin" ]]; then
  npm_bin="$(command -v npm 2>/dev/null)"
fi
if [[ -z "$npm_bin" ]]; then
  echo "Node.js 22.13 or newer is required."
  echo "Install Node.js, then double-click this launcher again."
  read -k 1 "?Press any key to close..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing the companion dependency once..."
  "$npm_bin" install || {
    read -k 1 "?Installation failed. Press any key to close..."
    exit 1
  }
fi

echo "Starting a private REAPER guest demo..."
echo "A fresh expiring invite will be copied to this Mac's clipboard."
"$npm_bin" run demo
exit_code=$?
echo
echo "Remote demo stopped."
read -k 1 "?Press any key to close..."
exit "$exit_code"
