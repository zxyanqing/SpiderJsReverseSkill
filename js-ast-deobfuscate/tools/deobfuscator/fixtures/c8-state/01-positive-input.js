/** C8 state · 正例：线性显式状态机 */
function sample() {
  let state = "a";
  while (true) {
    switch (state) {
      case "a":
        state = "b";
        continue;
      case "b":
        return 42;
    }
  }
}
