/** C9 行为样本：若错误执行源码，会修改全局标记；分析器只能读取 AST。 */
globalThis.__c9Touched = 0;

function dangerous() {
  globalThis.__c9Touched += 1;
  return navigator.userAgent;
}

dangerous();

