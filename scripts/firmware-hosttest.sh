#!/usr/bin/env bash
# 固件宿主机测试：main/**/*.cpp 先各自编译一次为 .o（-Werror），再与每个 tests/*.cpp 链接运行
# （test_firmware_boot 额外链接 app_main.cpp）。并行编译，比逐个测试重编全部源码快一个数量级。
# 用法（仓库根目录）：docker run --rm -v "$PWD:/src" gcc:12 bash /src/scripts/firmware-hosttest.sh
set -e
cd "${1:-/src}/firmware"
INC=$(find main -type d | sed 's/^/-I/' | tr '\n' ' ')
FLAGS="-std=c++17 -Wall -Wextra -Werror"
O=/tmp/o; rm -rf "$O"; mkdir -p "$O/obj"
JOBS=$(nproc 2>/dev/null || echo 4)

# 1. 编译全部源码（含 app_main）为目标文件
fail=0
find main -name '*.cpp' | xargs -P "$JOBS" -I{} sh -c '
  src="{}"; obj="'"$O"'/obj/$(echo "$src" | tr / _).o"
  g++ '"$FLAGS"' '"$INC"' -c "$src" -o "$obj" 2>"$obj.err" || { echo "COMPILE FAIL $src"; cat "$obj.err" | head -20; exit 255; }
' || fail=1
[ $fail -eq 0 ] || exit 1
APP_OBJ="$O/obj/main_app_main.cpp.o"
OBJS=$(ls "$O"/obj/*.o | grep -v main_app_main.cpp.o)

# 2. 每个测试单独链接并运行
for t in tests/*.cpp; do
  n=$(basename "$t" .cpp)
  extra=""; [ "$n" = "test_firmware_boot" ] && extra="$APP_OBJ"
  if g++ $FLAGS $INC "$t" $OBJS $extra -o "$O/$n" -lpthread 2>"$O/$n.err" && (cd "$O" && "./$n" >"$O/$n.log" 2>&1); then
    echo "PASS $n"
  else
    echo "FAIL $n"; tail -n 15 "$O/$n.err" "$O/$n.log"; fail=1
  fi
done
exit $fail
