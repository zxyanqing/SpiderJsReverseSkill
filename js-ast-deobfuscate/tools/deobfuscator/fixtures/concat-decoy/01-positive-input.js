function outer() {
  var x = tableRef;
  var arr = ['$_Decoy'].concat(x);
  var a = arr[1];
  arr.shift();
  var b = arr[0];
  keepMe();
}
