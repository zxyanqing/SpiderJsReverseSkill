'use strict';

// CLI protocol is separate from each evidence schema so existing readers retain their fields.
const HELP = '\n检查模式：默认诊断；--strict 对已选差异/证据不足返回 1，执行或证据完整性错误返回 2。JSON 的 checkProtocolVersion 标记退出码协议，网站接受另行验证。';

function decorate(result, args) {
  const invalidEvidence = result.executionFailed === true || result.integrityFailed === true
    || [result.browser, result.nodeAudit].some(source =>
      source?.integrityFailed === true || (source?.exists === true && source.parseOk === false));
  const emptySource = result.filesChecked === 0
    || (Array.isArray(result.scannedFiles) && result.scannedFiles.length === 0);
  const missingPair = (result.requireArtifacts || result.requireMatrix)
    && [result.browser, result.nodeAudit].some(source => source?.exists === false);
  const clean = result.clean ?? result.passed ?? result.ok;
  const status = invalidEvidence ? 'execution-failed'
    : result.status || (emptySource || missingPair ? 'insufficient-evidence'
      : clean === true ? 'passed' : 'differences');
  result.checkProtocolVersion = 'env-check-cli/v2';
  result.mode = args.strict ? 'strict' : 'diagnostic';
  result.status = status;
  if ('clean' in result) result.clean = status === 'passed';
  if ('passed' in result) result.passed = status === 'passed';
  if ('ok' in result) result.ok = status === 'passed';
  result.websiteAccepted = null;
  return result;
}

function exitCode(result, args) {
  if (result.status === 'execution-failed') return 2;
  return (args.strict || args.warningsAsErrors) && !['passed', 'not-applicable'].includes(result.status) ? 1 : 0;
}

module.exports = { decorate, exitCode, HELP };
