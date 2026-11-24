/** dead-branch 字面量比较负例 */
function sample(x) {
  if (x === 1) {
    return "a";
  }
  return "b";
}
