/** C9 幂等样本：分析器只读 AST，重复分析应得到相同 JSON。 */
function readEnvironment() {
  return navigator.userAgent + window.location.href;
}

