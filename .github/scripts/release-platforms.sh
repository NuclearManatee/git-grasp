#!/usr/bin/env bash
# Resolve Release binary matrix from RELEASE_PLATFORMS secret / workflow input.
# Slugs: linux-x64, darwin-arm64, darwin-x64, windows-x64
set -euo pipefail

DEFAULT='linux-x64,darwin-arm64,darwin-x64,windows-x64'
RAW="${DISPATCH_PLATFORMS:-${RELEASE_PLATFORMS:-$DEFAULT}}"
RAW="$(echo "$RAW" | tr -d ' ')"

slug_to_os() {
  case "$1" in
    linux-x64) echo 'ubuntu-latest' ;;
    darwin-arm64) echo 'macos-latest' ;;
    darwin-x64) echo 'macos-13' ;;
    windows-x64) echo 'windows-latest' ;;
    *)
      echo "Unknown RELEASE_PLATFORMS slug: $1 (allowed: linux-x64, darwin-arm64, darwin-x64, windows-x64)" >&2
      exit 1
      ;;
  esac
}

json='['
first=1
IFS=',' read -ra SLUGS <<< "$RAW"
for slug in "${SLUGS[@]}"; do
  [ -z "$slug" ] && continue
  os="$(slug_to_os "$slug")"
  if [ "$first" -eq 0 ]; then
    json+=','
  fi
  first=0
  json+="{\"os\":\"$os\",\"slug\":\"$slug\"}"
done
json+=']'

if [ "$json" = '[]' ]; then
  echo 'Release platform list is empty' >&2
  exit 1
fi

echo "Selected platforms: $RAW"
{
  echo 'platforms<<EOF'
  echo "$json"
  echo 'EOF'
} >> "$GITHUB_OUTPUT"
