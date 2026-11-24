/** flatten-array-control-flow 负例：动态 order */
function sample(order) {
  var out = [];
  for (var i = 0;;) {
    switch (order[i++]) {
      case "0":
        out.push("a");
        continue;
      case "1":
        out.push("b");
        continue;
    }
    break;
  }
  return out.join("");
}
