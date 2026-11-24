/** dead-branch 字面量比较正例期望 */
function sample() {
  var out = [];
  out.push("live");
  var flag = "yes";
  out.push(flag);
  return out.join(",");
}
