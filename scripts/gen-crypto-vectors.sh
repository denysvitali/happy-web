#!/bin/sh
# Regenerates src/lib/crypto/__fixtures__/go-vectors.json from the real Go
# crypto code in a sibling happy-cli-go checkout (needs Go on PATH).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
go_repo=${HAPPY_CLI_GO:-"$here/../happy-cli-go"}
pkg="$go_repo/internal/api/cryptoutil"
tmp="$pkg/happyweb_vectors_test.go"
ftmp="$go_repo/internal/sessionfolders/happyweb_vectors_test.go"
trap 'rm -f "$tmp" "$ftmp"' EXIT
cp "$here/scripts/cryptovectors_test.go.txt" "$tmp"
cp "$here/scripts/foldervectors_test.go.txt" "$ftmp"
out="$here/src/lib/crypto/__fixtures__/go-vectors.json"
fout="$here/src/lib/crypto/__fixtures__/go-folder-vectors.json"
mkdir -p "$(dirname "$out")"
(cd "$go_repo" && HAPPY_WEB_VECTORS_OUT="$out" go test -tags happyweb_vectors -run TestHappyWebVectors -count=1 ./internal/api/cryptoutil/)
(cd "$go_repo" && HAPPY_WEB_FOLDER_VECTORS_OUT="$fout" go test -tags happyweb_vectors -run TestHappyWebFolderVectors -count=1 ./internal/sessionfolders/)
echo "wrote $out $fout"
