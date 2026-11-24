/** dead-branch 字面量比较正例 */
function sample() {
  var out = [];
  if (1 === 1) {
    out.push("live");
  } else {
    out.push("dead");
  }
  if ("a" !== "a") {
    out.push("never");
  }
  var flag = 2 == 2 ? "yes" : "no";
  out.push(flag);
  return out.join(",");
}
