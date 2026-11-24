#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { input: null, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') args.input = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：\n  node scripts/check_intake.js --input task.md --markdown\n  node scripts/check_intake.js --input task.md --json\n\n不提供 --input 时会从标准输入读取内容。`;
}

function readInput(input) {
  if (input) return fs.readFileSync(input, 'utf8');
  return fs.readFileSync(0, 'utf8');
}

function cleanValue(v) {
  if (!v) return '';
  return v.trim().replace(/^`+|`+$/g, '').trim();
}

function isPlaceholder(v) {
  const s = cleanValue(v).toLowerCase();
  return !s || ['无', '暂无', '未知', '不确定', 'todo', 'tbd', 'n/a', 'na', 'none', 'null', '-', '：', ':'].includes(s) || /^[.。…]+$/.test(s);
}

function lineValue(text, labels) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    for (const label of labels) {
      const pattern = new RegExp(`^(?:[-*+]\\s*)?(?:\\[[ xX]\\]\\s*)?${label}\\s*[：:]\\s*(.+?)\\s*$`, 'i');
      const m = trimmed.match(pattern);
      if (m && !isPlaceholder(m[1])) return cleanValue(m[1]);
    }
  }
  return '';
}

function firstUrlNear(text, labels) {
  const direct = lineValue(text, labels);
  if (direct) {
    const m = direct.match(/https?:\/\/[^\s`'"<>]+/i);
    if (m) return m[0];
    if (/^[\w.-]+\.[a-z]{2,}/i.test(direct)) return direct;
  }
  for (const label of labels) {
    const re = new RegExp(`${label}[^\n\r]*(https?:\\/\\/[^\\s\`'"<>]+)`, 'i');
    const m = text.match(re);
    if (m) return m[1];
  }
  const domain = text.match(/(?:目标网站|目标站点|目标页面|网站|站点|页面|target\s+(?:site|page))[^\n\r]{0,40}?([A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s`'"<>]*)?)/i);
  if (domain) return domain[1];
  return '';
}

function detectMethod(text) {
  const direct = lineValue(text, ['请求方法', 'Method', 'HTTP Method', 'Request Method']);
  const src = direct || text;
  const m = src.match(/\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/i);
  return m ? m[1].toUpperCase() : '';
}

function detectLocation(text) {
  const direct = lineValue(text, ['参数出现位置', '参数位置', '加密参数位置', 'Parameter Location', 'Location']);
  const src = direct || text;
  const locations = ['Query', 'Header', 'Body', 'Cookie'];
  for (const loc of locations) {
    if (new RegExp(`\\b${loc}\\b`, 'i').test(src)) return loc;
  }
  const zh = [ ['query', /查询|URL参数|URL 参数/i], ['header', /请求头|Header/i], ['body', /请求体|Body|表单|JSON/i], ['cookie', /Cookie/i] ];
  for (const [name, re] of zh) if (re.test(src)) return name[0].toUpperCase() + name.slice(1);
  return '';
}

function detectParam(text) {
  const direct = lineValue(text, ['目标加密参数名', '目标加密参数', '加密参数名', '加密参数', '参数名', 'Encrypted Parameter', 'Parameter']);
  if (direct) {
    const m = direct.match(/[A-Za-z_$][\w$-]{0,80}/);
    if (m) return m[0];
    return direct;
  }
  const common = ['__zse_ck', 'zse_ck', 'a_bogus', 'h5st', 'x-s', 'x-t', 'x-sign', 'sign', 'signature', 'token'];
  for (const p of common) {
    if (new RegExp(`(^|[^\\w-])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`, 'i').test(text)) return p;
  }
  return '';
}

function hasRequestSample(text) {
  if (/copy\s+as\s+curl/i.test(text) && /(已提供|提供|粘贴|curl)/i.test(text)) return true;
  if (/\bcurl\b\s+['"]?https?:\/\//i.test(text)) return true;
  if (/\bcurl\b[\s\S]{0,300}https?:\/\//i.test(text)) return true;
  if (/^(GET|POST|PUT|DELETE|PATCH)\s+https?:\/\//im.test(text)) return true;
  const v = lineValue(text, ['成功请求样本', '请求样本', 'Request Sample', 'cURL', 'curl']);
  return !!v && !/未提供|没有|无/.test(v);
}

function hasResponseSample(text) {
  if (/响应样本[：:]\s*(已提供|有|是)/i.test(text)) return true;
  if (/```json[\s\S]*?```/i.test(text) && /响应|response/i.test(text)) return true;
  return false;
}

function hasKnownJs(text) {
  if (/https?:\/\/[^\s`'"<>]+\.js(?:\?[^\s`'"<>]*)?/i.test(text)) return true;
  if (/JS\s*文件[：:]\s*(已提供|有|是)/i.test(text)) return true;
  if (/(?:^|[\s：:])(?:\.{0,2}\/)?[\w./-]+\.(?:js|mjs|cjs)(?:\s|$)/im.test(text)) return true;
  return false;
}

function detectAcquisitionMode(text) {
  const direct = lineValue(text, ['取证模式', '浏览器取证模式', '浏览器模式', '取证工具', '浏览器工具', 'Ruyi 工具选择', 'Ruyi工具选择', 'Acquisition Mode']);
  const checked = text.match(/^\s*[-*+]\s*\[[xX]\]\s*(ruyiPage\s*\+\s*RuyiTrace|仅\s*ruyiPage|只用\s*ruyiPage|Camoufox\s*\+\s*camoufox-reverse-mcp|仅\s*Camoufox|只用\s*Camoufox|CloakBrowser|用户手动取证|手动取证|AI\s*自行决定)[^\n\r]*/im);
  const src = direct || (checked ? checked[1] : '');
  if (/ruyiPage\s*\+\s*RuyiTrace|ruyiPage.*RuyiTrace|如意\s*Trace/i.test(src)) return 'ruyiPage + RuyiTrace';
  if (/仅\s*ruyiPage|只用\s*ruyiPage|ruyiPage/i.test(src)) return '仅 ruyiPage';
  if (/Camoufox\s*\+\s*camoufox-reverse-mcp|Camoufox.*MCP|camoufox-reverse-mcp/i.test(src)) return 'Camoufox + camoufox-reverse-mcp';
  if (/仅\s*Camoufox|只用\s*Camoufox|Camoufox/i.test(src)) return '仅 Camoufox';
  if (/CloakBrowser/i.test(src)) return 'CloakBrowser';
  if (/用户手动取证|手动取证|离线材料|手动提供|手动浏览器/i.test(src)) return '用户手动取证';
  if (/AI\s*自行决定|自行决定|你来决定|自动选择/i.test(src)) return 'AI 自行决定';
  if (/(选择|使用|采用|取证模式是|用)\s*(ruyiPage\s*\+\s*RuyiTrace|ruyiPage.*RuyiTrace)/i.test(text)) return 'ruyiPage + RuyiTrace';
  if (/(选择|使用|采用|取证模式是|用)\s*(仅\s*)?ruyiPage/i.test(text)) return '仅 ruyiPage';
  if (/(选择|使用|采用|取证模式是|用).*(Camoufox\s*\+\s*camoufox-reverse-mcp|Camoufox.*MCP|camoufox-reverse-mcp)/i.test(text)) return 'Camoufox + camoufox-reverse-mcp';
  if (/(选择|使用|采用|取证模式是|用).*(仅\s*)?Camoufox/i.test(text)) return '仅 Camoufox';
  if (/(选择|使用|采用|取证模式是|用)\s*CloakBrowser/i.test(text)) return 'CloakBrowser';
  if (/(选择|使用|采用|取证模式是|用).*(用户手动取证|手动取证|离线材料|手动提供)/i.test(text)) return '用户手动取证';
  if (/(选择|使用|采用|取证模式是|用).*(AI\s*自行决定|自行决定|你来决定|自动选择)/i.test(text)) return 'AI 自行决定';
  return '';
}

function detectTlsClientStrategy(text) {
  const direct = lineValue(text, ['最终请求 TLS 指纹兼容客户端', 'TLS 指纹兼容客户端', 'TLS 请求客户端', '最终请求客户端', '请求客户端', 'TLS Strategy', 'TLS Client']);
  const src = direct || text;
  if (/Node\.?js.*CycleTLS|CycleTLS|cycleTls|cycletls/i.test(src)) return 'Node.js CycleTLS';
  if (/Node\.?js.*impers|\bimpers\b/i.test(src)) return 'Node.js impers';
  if (/Node\.?js.*curl-cffi|curl-cffi-node|curl-cffi/i.test(src)) return 'Node.js curl-cffi';
  if (/Python.*curl_cffi|curl_cffi/i.test(src)) return 'Python curl_cffi';
  if (/Python.*cffi_curl|cffi_curl/i.test(src)) return 'Python cffi_curl';
  if (/Python.*cyCronet|cyCronet|cycronet/i.test(src)) return 'Python cyCronet';
  if (/不发真实请求|不发送真实请求|只输出本地\s*(sign|参数)|仅输出本地\s*(sign|参数)|只做本地验证/i.test(src)) return '不发真实请求，只输出本地 sign / 参数';
  return '';
}

function analyze(text) {
  const fields = {
    targetSiteUrl: firstUrlNear(text, ['目标网站 URL', '目标网站', '目标站点', '目标页面', '网站 URL', 'Target Website', 'Target Site', 'Page URL']),
    apiUrl: firstUrlNear(text, ['目标 API URL', '目标 API', '目标接口 API', '目标接口', '接口 API', '请求 URL', 'API URL', 'Request URL', 'Target API']),
    method: detectMethod(text),
    encryptedParam: detectParam(text),
    paramLocation: detectLocation(text),
    requestSample: hasRequestSample(text),
    responseSample: hasResponseSample(text),
    knownJsAssets: hasKnownJs(text),
    loginRequired: /需要登录[：:]?\s*(是|true|yes)|登录后|已登录|login required/i.test(text),
    authScopeMentioned: /授权|测试权限|permission|authorized/i.test(text),
    acquisitionMode: detectAcquisitionMode(text),
    tlsClientStrategy: detectTlsClientStrategy(text),
  };

  // If API URL duplicated from target site and a more specific URL exists in curl, use the curl URL as apiUrl.
  const curlUrl = (text.match(/\bcurl\b[\s\S]{0,500}?(https?:\/\/[^\s`'"<>]+)/i) || [])[1];
  if (curlUrl && (!fields.apiUrl || fields.apiUrl === fields.targetSiteUrl)) fields.apiUrl = curlUrl;
  if (fields.apiUrl === fields.targetSiteUrl && !/(目标接口|接口\s*(API|URL)|API\s*(URL|地址)?|请求\s*URL|Request URL|Target API)/i.test(text)) fields.apiUrl = '';

  const unknown = [
    ['targetSiteUrl', '目标网站/页面 URL'],
    ['apiUrl', '目标接口 API URL'],
    ['method', '请求方法'],
    ['encryptedParam', '目标产物/参数名'],
    ['paramLocation', '产物消费位置'],
    ['requestSample', '请求样本'],
    ['acquisitionMode', '浏览器采集方式'],
    ['tlsClientStrategy', '最终请求客户端'],
  ].filter(([key]) => !fields[key]).map(([, label]) => label);
  const nextActions = [];
  if (fields.knownJsAssets) nextActions.push('分析并在本地试跑已知 JS，定位触发路径与产物消费点');
  if (fields.targetSiteUrl) nextActions.push('观察目标页面、资源、触发动作和可见响应');
  if (fields.requestSample) nextActions.push('从请求样本定位动态字段与可能的生成路径');
  if (!nextActions.length) nextActions.push('取得目标 URL、原始 JS 或请求样本中的任一项');
  const canStart = !!(fields.targetSiteUrl || fields.knownJsAssets || fields.requestSample);
  return {
    schemaVersion: 'env-intake/v2', complete: canStart, canStart,
    missing: unknown, unknown, nextActions, fields,
  };
}

function renderMarkdown(result) {
  const f = result.fields;
  const yesNo = v => v ? '是' : '否';
  const lines = [];
  lines.push('# Web JS 补环境信息完整性检查结果');
  lines.push('');
  lines.push(`- 已有可独立分析的材料：${result.canStart ? '是' : '否'}`);
  lines.push(`- 目标网站/页面 URL：${f.targetSiteUrl || '未提供'}`);
  lines.push(`- 目标接口 API URL：${f.apiUrl || '未提供'}`);
  lines.push(`- 请求方法：${f.method || '未提供'}`);
  lines.push(`- 目标加密参数：${f.encryptedParam || '未提供'}`);
  lines.push(`- 参数位置：${f.paramLocation || '未提供'}`);
  lines.push(`- 已提供成功请求样本：${yesNo(f.requestSample)}`);
  lines.push(`- 已提供成功响应样本：${yesNo(f.responseSample)}`);
  lines.push(`- 已知 JS 文件：${yesNo(f.knownJsAssets)}`);
  lines.push(`- 是否提到登录：${yesNo(f.loginRequired)}`);
  lines.push(`- 取证模式：${f.acquisitionMode || '未提供'}`);
  lines.push(`- 最终请求 TLS 指纹兼容客户端：${f.tlsClientStrategy || '未提供'}`);
  lines.push('');
  lines.push('## 可立即推进');
  for (const item of result.nextActions) lines.push(`- ${item}`);
  lines.push('', '## 尚未确定（按实际依赖补充）');
  for (const item of result.unknown) lines.push(`- ${item}`);
  if (!result.unknown.length) lines.push('- 无');
  lines.push('', '此检查仅整理输入，不判断网站是否接受，也不构成开工门禁。');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const inputText = readInput(args.input);
      const result = analyze(inputText);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(renderMarkdown(result));
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { analyze, parseArgs };
