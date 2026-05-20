#!/usr/bin/env bash
set -euo pipefail

repo_root="/Users/andriilitvinov/projects/MYPROJECTS/finance"

if command -v cursor >/dev/null 2>&1; then
  exec cursor "$repo_root"
fi

exec open -a Cursor "$repo_root"
