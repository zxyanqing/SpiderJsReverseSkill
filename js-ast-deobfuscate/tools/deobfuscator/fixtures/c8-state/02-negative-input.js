/** C8 state · 反例：条件边不得自动展开 */
function sample(token) {
  let state = "entry";
  while (true) {
    switch (state) {
      case "entry":
        state = "check";
        continue;
      case "check":
        state = token ? "ok" : "error";
        continue;
      case "ok":
        return "accepted";
      case "error":
        return "rejected";
    }
  }
}
