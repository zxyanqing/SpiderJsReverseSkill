/** dead-branch 正例：静态真/假 if 与三元 */
function sample() {
  var out = [];
  if (true) {
    out.push("live");
  } else {
    out.push("dead");
  }
  if (false) {
    out.push("never");
  }
  var flag = true ? "yes" : "no";
  out.push(flag);
  return out.join(",");
}
