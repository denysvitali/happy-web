#!/bin/sh
# `buf generate`, tolerant of git config passed via GIT_CONFIG_COUNT/KEY_n/VALUE_n
# (agent containers): buf drops empty env values such as a `credential.helper=`
# reset, which makes every git call fail. Fold those entries into a temp global
# config (which includes the real one) instead.
set -eu
if [ -n "${GIT_CONFIG_COUNT:-}" ]; then
  cfg=$(mktemp)
  trap 'rm -f "$cfg"' EXIT
  [ -n "${GIT_CONFIG_GLOBAL:-}" ] && git config -f "$cfg" include.path "$GIT_CONFIG_GLOBAL" ||
    git config -f "$cfg" include.path "$HOME/.gitconfig"
  i=0
  while [ "$i" -lt "$GIT_CONFIG_COUNT" ]; do
    eval "k=\$GIT_CONFIG_KEY_$i v=\${GIT_CONFIG_VALUE_$i-}"
    env -u GIT_CONFIG_COUNT git config -f "$cfg" --add "$k" "$v"
    unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"
    i=$((i + 1))
  done
  unset GIT_CONFIG_COUNT
  export GIT_CONFIG_GLOBAL="$cfg"
fi
pnpm exec buf generate "$@"
