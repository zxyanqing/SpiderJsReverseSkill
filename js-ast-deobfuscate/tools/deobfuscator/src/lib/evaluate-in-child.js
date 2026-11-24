/**
 * Stage 7 · 独立进程受控求值（同步版）
 *
 * 供 Babel Visitor 插件调用：超时、类型白名单、失败关闭。
 * Node 子进程不是恶意代码完整沙箱；仅用于自建/授权闭包。
 */

import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 4096;

/**
 * 主进程二次校验：只允许可安全回写 AST 的基础类型。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isWhitelistedValue(value) {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return false;
}

/**
 * 在独立 Node 子进程中执行函数体并回传 JSON。
 * @param {string} bodySource 形如 `return dec(1);` 的函数体（依赖已拼入）
 * @param {{timeoutMs?: number, maxOutputBytes?: number}} [options]
 * @returns {{ok: true, value: unknown} | {ok: false, reason: string, message?: string}}
 */
export function evaluateInChildSync(bodySource, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // 子进程内：new Function(body)；拒绝非白名单值后再 JSON 序列化。
  const workerCode = `
    const body = ${JSON.stringify(bodySource)};
    function isWorkerValueAllowed(value) {
      if (value === null) return true;
      if (typeof value === 'string') return true;
      if (typeof value === 'boolean') return true;
      if (typeof value !== 'number') return false;
      return Number.isFinite(value);
    }
    try {
      const value = new Function(body)();
      if (!isWorkerValueAllowed(value)) {
        process.stdout.write(JSON.stringify({ ok: false, reason: 'type-rejected' }));
      } else {
        process.stdout.write(JSON.stringify({ ok: true, value }));
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({
        ok: false,
        reason: 'exception',
        message: String(err && err.message ? err.message : err),
      }));
    }
  `;

  const result = spawnSync(process.execPath, ['-e', workerCode], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: maxOutputBytes,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    // spawnSync 超时通常带 code ETIMEDOUT；也可能被 signal 杀掉。
    if (result.error.code === 'ETIMEDOUT' || result.signal) {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'spawn-error', message: String(result.error.message) };
  }

  if (result.signal) {
    return { ok: false, reason: 'timeout' };
  }

  const stdout = (result.stdout ?? '').trim();
  if (!stdout) {
    return { ok: false, reason: 'empty-output' };
  }

  if (Buffer.byteLength(stdout, 'utf8') > maxOutputBytes) {
    return { ok: false, reason: 'output-too-large' };
  }

  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || parsed.ok !== true) {
      return {
        ok: false,
        reason: parsed?.reason ?? 'child-reported-failure',
        message: parsed?.message,
      };
    }
    if (!isWhitelistedValue(parsed.value)) {
      return { ok: false, reason: 'type-rejected' };
    }
    return { ok: true, value: parsed.value };
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
}
