function outer() {
  var x = tableRef;
  var arr = ['$_Decoy'].concat(x);
  var a = arr[1];
  arr.shift();
  var b = arr[0];
  // 仍被当作解码调用 → 不得删除
  return a(3) + b(4);
}
