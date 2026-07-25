#!/bin/zsh

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir" || exit 1

if [[ ! -f .env ]]; then
  echo "Missing .env configuration."
  echo "In Story Cue Studio, choose Internet Relay, create a token, then use Download config."
  echo "Move the downloaded .env file into this folder and run this launcher again."
  read -k 1 "?Press any key to close..."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing the companion dependency once..."
  /usr/local/bin/npm install || {
    read -k 1 "?Installation failed. Press any key to close..."
    exit 1
  }
fi

echo "Starting the public WSS tunnel and local REAPER companion..."
/usr/local/bin/npm run demo
exit_code=$?
echo
echo "Remote demo stopped."
read -k 1 "?Press any key to close..."
exit "$exit_code"
