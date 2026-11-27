#!/usr/bin/env bash
# Mac 用のアプリ（electron-builder --mac --dir で作った mokkan.app）に ad-hoc 署名をして、zip にする。
# 実行：npm run build:mac（Mac の上でだけ動く。CI の macos でも使う）
#
# 証明書での署名と公証（notarization）はしない。
# electron-builder は証明書がないと署名を飛ばすが、Fuses（electron-builder.yml の electronFuses）を
# 書き込むと Electron の本体の署名が壊れ、Apple シリコンの Mac では起動できなくなる。
# そこで、作ったアプリ全体に ad-hoc 署名（証明書のない署名）をし直し、署名が正しいことと起動できることを確かめる。
#
# 環境変数
#   MOKKAN_SMOKE_TEST=1  作ったアプリを実際に起動して、すぐに落ちないかを確かめる（CI で使う）

set -euo pipefail

cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
found=0

# electron-builder --dir の出力先：Apple シリコン用は dist/mac-arm64、Intel 用は dist/mac
for dir in dist/mac-arm64 dist/mac; do
  app="$dir/mokkan.app"
  [ -d "$app" ] || continue
  found=1
  if [ "$dir" = dist/mac-arm64 ]; then arch=arm64; else arch=x64; fi

  echo "== ${app}（${arch}）に ad-hoc 署名をする"
  codesign --force --deep --sign - "$app"

  echo "== 署名を確かめる"
  codesign --verify --deep --strict --verbose=2 "$app"
  identifier=$(codesign -dv "$app" 2>&1 | sed -n 's/^Identifier=//p')
  if [ "$identifier" != "com.kanjiyamamoto66.mokkan" ]; then
    echo "署名の識別子が違います：${identifier}" >&2
    exit 1
  fi

  if [ "${MOKKAN_SMOKE_TEST:-}" = 1 ]; then
    # この Mac で動かせる種類だけ（Intel 用は Rosetta があるときだけ）を起動してみる
    if [ "$arch" = arm64 ] && [ "$(uname -m)" != arm64 ]; then
      echo "== この Mac では Apple シリコン用を起動できないので、起動の確認は飛ばす"
    elif [ "$arch" = x64 ] && [ "$(uname -m)" = arm64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
      echo "== Rosetta がないので、Intel 用の起動の確認は飛ばす"
    else
      echo "== 起動して、すぐに落ちないかを確かめる"
      tasks=$(mktemp -d)
      MOKKAN_TASKS_DIR="$tasks" "$app/Contents/MacOS/mokkan" &
      pid=$!
      sleep 15
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid" || true
        echo "起動して 15 秒のうちに終わってしまいました（署名や Fuses の問題の見込み）" >&2
        exit 1
      fi
      echo "== 15 秒たっても動いているので、起動は大丈夫。終わらせる"
      # SIGTERM で終わるのを最大 10 秒待ち、終わらなければ強制的に止める（ここで待ち続けないように）
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "::warning::SIGTERM で 10 秒のうちに終わらなかったので、強制的に止めた（⌘Q で終わるかは実機で確かめる）"
        pkill -KILL -P "$pid" 2>/dev/null || true
        kill -KILL "$pid" 2>/dev/null || true
      fi
      wait "$pid" 2>/dev/null || true
      rm -rf "$tasks"
    fi
  fi

  zip="dist/mokkan-$version-mac-$arch.zip"
  echo "== ${zip} にする"
  rm -f "$zip"
  # Finder の「圧縮」と同じ形（署名や拡張属性を壊さない）
  ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
done

if [ "$found" = 0 ]; then
  echo "dist/mac-arm64/mokkan.app も dist/mac/mokkan.app もありません。先に electron-builder --mac --dir を実行してください" >&2
  exit 1
fi
