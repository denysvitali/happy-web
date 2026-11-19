#!/bin/sh
# Gets `pnpm screenshots` / `pnpm test:e2e` running on a fresh checkout, without
# root. Idempotent and ~1 s once done (both scripts call it first).
#
# 0. Generates src/gen if it is missing (the build needs it).
# 1. Downloads chromium-headless-shell for the pinned Playwright.
# 2. If the binary misses shared libs (agent containers: no apt, no root), it
#    fetches the Debian packages with an unprivileged apt (private lists/cache)
#    and unpacks them, plus fonts, into $DEPS. playwright.config.ts points
#    LD_LIBRARY_PATH / FONTCONFIG_FILE there when the directory exists.
# Keep DEPS in sync with browserDeps in playwright.config.ts.
set -eu
cd "$(dirname "$0")/.."
[ -d src/gen ] || sh scripts/generate.sh
DEPS="${XDG_CACHE_HOME:-$HOME/.cache}/happy-web/chromium-deps"
LIBS="$DEPS/lib"

pnpm exec playwright install chromium-headless-shell >/dev/null
loc=$(pnpm exec playwright install --dry-run chromium-headless-shell | sed -n 's/^ *Install location: *//p' | head -n 1)
bin=$(ls "$loc"/*/chrome-headless-shell)

missing() { LD_LIBRARY_PATH="$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$bin" | awk '/not found/ {print $1}'; }
[ -z "$(missing)" ] && exit 0

command -v apt-get >/dev/null && command -v dpkg-deb >/dev/null || {
  echo "e2e-setup: Chromium misses libs ($(missing | tr '\n' ' ')) and there is no apt here." >&2
  echo "Run: pnpm exec playwright install-deps chromium-headless-shell (needs root)" >&2
  exit 1
}

echo "e2e-setup: fetching Chromium system libs into $DEPS (no root needed)…" >&2
rm -rf "$DEPS"
mkdir -p "$DEPS/apt/lists/partial" "$DEPS/apt/archives/partial" "$DEPS/root"
apt() { "$@" -o Dir::State::Lists="$DEPS/apt/lists" -o Dir::Cache="$DEPS/apt" -o Dir::Cache::archives="$DEPS/apt/archives" -o Debug::NoLocking=1 -q; }
# Quiet: Docker images' apt hooks complain about root-owned caches. Retry loudly.
apt apt-get update >/dev/null 2>&1 || apt apt-get update

# Direct deps of chrome-headless-shell on Debian bookworm, plus fonts that
# match CI's rendering (Arial metrics, colour emoji).
want="libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libdbus-1-3
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libasound2
  fonts-liberation fonts-noto-color-emoji"
# Whole dependency closure minus what the system already has.
pkgs=$(apt apt-cache depends --recurse --no-recommends --no-suggests --no-conflicts \
    --no-breaks --no-replaces --no-enhances $want | grep -E '^[a-z0-9]' | sort -u |
  while read -r p; do
    dpkg-query -W -f '${Status}\n' "$p" 2>/dev/null | grep -q 'install ok installed' || echo "$p"
  done)
(cd "$DEPS/apt/archives" && apt apt-get download $pkgs >/dev/null)
for deb in "$DEPS"/apt/archives/*.deb; do dpkg-deb -x "$deb" "$DEPS/root"; done
rm -rf "$DEPS/apt"
# One flat, arch-agnostic dir for LD_LIBRARY_PATH (debs split /lib and /usr/lib).
mkdir -p "$LIBS"
find "$DEPS/root" -path '*/lib/*' -name '*.so*' \( -type f -o -type l \) -exec ln -sf {} "$LIBS/" \;

cat >"$DEPS/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>$DEPS/root/usr/share/fonts</dir>
  <cachedir>$DEPS/fontconfig-cache</cachedir>
</fontconfig>
EOF

left=$(missing)
[ -z "$left" ] || { echo "e2e-setup: still missing: $left" >&2; exit 1; }
echo "e2e-setup: Chromium ready." >&2
