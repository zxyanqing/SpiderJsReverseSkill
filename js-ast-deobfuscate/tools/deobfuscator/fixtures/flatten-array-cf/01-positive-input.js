/** flatten-array-control-flow 正例：for + 静态 order */
function sample() {
  var out = [];
  for (var order = ["0", "1", "2"], i = 0;;) {
    switch (order[i++]) {
      case "0":
        out.push("a");
        continue;
      case "1":
        out.push("b");
        continue;
      case "2":
        out.push("c");
        continue;
    }
    break;
  }
  return out.join("");
}
