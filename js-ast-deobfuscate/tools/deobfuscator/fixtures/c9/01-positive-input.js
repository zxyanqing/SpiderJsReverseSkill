/** C9 正例：静态盘点浏览器属性、时间、随机数、WebCrypto 和 fetch 边界。 */
function buildRequest(token) {
  const body = new TextEncoder().encode(token);
  return {
    userAgent: navigator.userAgent,
    location: window.location.href,
    digest: globalThis.crypto.subtle.digest('SHA-256', body),
    now: Date.now(),
    random: Math.random(),
    request: fetch('/sign', {method: 'POST', body}),
  };
}

