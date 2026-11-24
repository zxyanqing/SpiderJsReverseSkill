/** C8 split 正例：字符串 split 得到静态 order */
function sample() {
  const result = [];
  const order = "2,0,1".split(",");
  let cursor = 0;
  while (true) {
    switch (order[cursor++]) {
      case "0":
        result.push("token");
        continue;
      case "1":
        return result.join(":");
      case "2":
        result.push("start");
        continue;
    }
    break;
  }
}
