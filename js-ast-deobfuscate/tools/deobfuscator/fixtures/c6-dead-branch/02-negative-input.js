/** dead-branch 反例：动态条件保留 */
function sample(cond) {
  if (cond) {
    return 1;
  } else {
    return 0;
  }
}
