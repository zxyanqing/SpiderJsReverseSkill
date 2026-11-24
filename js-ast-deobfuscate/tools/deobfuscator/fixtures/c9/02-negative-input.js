/** C9 反例：局部同名应忽略，动态属性、with 和 direct eval 必须停止。 */
function shadowed(navigator, window) {
  const dynamicKey = getKey();
  return navigator.userAgent + globalThis[dynamicKey];
}

function legacy(value) {
  with (value) {
    return hidden;
  }
}

eval(code);
