#!/bin/sh
# Stop hook: UI changes must be looked at, not just type-checked. Blocks the
# agent from finishing while any UI source is newer than the last screenshot
# run (`pnpm screenshots` writes screenshots/*.png).
input=$(cat)
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

newest=$(ls -t screenshots/*.png 2>/dev/null | head -n 1)
if [ -n "$newest" ]; then
  stale=$(find src e2e -newer "$newest" \( -name '*.tsx' -o -name '*.css' -o -name 'fixtures.ts' -o -name 'mock.ts' \) 2>/dev/null | head -n 5)
else
  stale=$(git status --porcelain -- 'src/*.tsx' 'src/*.css' 2>/dev/null | head -n 5)
fi
[ -z "$stale" ] && exit 0

cat >&2 <<MSG
UI sources changed after the last screenshots:
$stale
Visual inspection is required before finishing: run \`pnpm screenshots\`
(add --grep mobile for a quick pass) and Read the relevant screenshots/*.png,
phone and desktop, light and dark. Fix what looks off, then stop.
MSG
exit 2
