#!/usr/bin/env bash
# Linux 用の deb（npm run build:linux で作ったもの）を入れて起動し、すぐに落ちないかを確かめる。
# 実行：bash scripts/smoke-linux.sh（CI の ubuntu で使う。sudo で deb を入れ、画面がないので xvfb-run で動かす）
#
# Ubuntu 24.04 以降は AppArmor の制限で、そのままでは Chromium の sandbox が動かない。
# deb（electron-builder の postinst）は入れるときに、AppArmor が有効なら mokkan 用のプロファイルを
# /etc/apparmor.d/mokkan に置き、user namespace が使えない環境では chrome-sandbox を root の setuid にする。
# そのどちらかになっていることも確かめる。

set -euo pipefail

cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
deb="dist/mokkan-$version-linux-amd64.deb"

if [ ! -f "$deb" ]; then
  echo "${deb} がありません。先に npm run build:linux を実行してください" >&2
  exit 1
fi

echo "== ${deb} の情報"
dpkg-deb --info "$deb"

echo "== deb を入れる（足りないライブラリも一緒に入る）"
sudo apt-get install -y "./$deb"

echo "== sandbox を動かす用意（AppArmor のプロファイルか、setuid の chrome-sandbox）を確かめる"
sandbox=/opt/mokkan/chrome-sandbox
ls -l "$sandbox"
if sudo apparmor_status --enabled 2>/dev/null; then
  if [ ! -f /etc/apparmor.d/mokkan ]; then
    echo "AppArmor が有効なのに、/etc/apparmor.d/mokkan が置かれていません" >&2
    exit 1
  fi
  echo "AppArmor のプロファイルがある：/etc/apparmor.d/mokkan"
elif [ "$(stat -c '%u %a' "$sandbox")" = "0 4755" ]; then
  echo "chrome-sandbox が root の setuid になっている"
else
  echo "AppArmor は使われておらず、chrome-sandbox は setuid ではない（user namespace で sandbox が動く環境）"
fi

echo "== 起動して、15 秒のうちに落ちないかを確かめる"
tasks=$(mktemp -d)
status=0
# 15 秒たったら止める。止められた（124）なら、それまで動き続けていたので大丈夫
MOKKAN_TASKS_DIR="$tasks" timeout --kill-after=10 15 xvfb-run -a mokkan || status=$?
rm -rf "$tasks"
if [ "$status" != 124 ]; then
  echo "起動して 15 秒のうちに終わってしまいました（終了コード ${status}）" >&2
  exit 1
fi
echo "== 15 秒たっても動いていたので、起動は大丈夫"
