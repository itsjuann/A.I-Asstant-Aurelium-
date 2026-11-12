#!/usr/bin/env bash
# Launches AURELIUM on macOS / Linux. Installs dependencies the first time.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download it from https://nodejs.org (LTS) and run this again."
  read -r -p "Press Enter to close."
  exit 1
fi
if [ ! -d node_modules/electron ]; then
  echo "First run: installing AURELIUM dependencies..."
  npm install
fi
npm start
# On macOS, npm start hands off to the app and returns; this window can be closed.
