#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.py']);
const SAMPLE_EXT = new Set(['.json', '.txt', '.md', '.har', '.curl']);
const PARAM_RE = /(?:sign|signature|token|nonce|verify|encrypt|cipher|h5st|bogus|x-s|x-t)/i;

function parseArgs(argv) {
  const args = {
    caseDir: '',
    file: '',
    sources: [],
    requireFinalSummary: false,
    strict: false,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--case-dir' || arg === '--dir' || arg === '-d') args.caseDir = argv[++i] || '';
    else if (arg === '--file' || arg === '-f') args.file = argv[++i] || '';
    else if (arg === '--source' || arg === '--sources') {
      const raw = argv[++i] || '';
      for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) args.sources.push(part);
    }
    else if (arg === '--require-final-summary') args.requireFinalSummary = true;
    else if (arg === '--no-require-final-summary' || arg === '--allow-no-final-summary') args.requireFinalSummary = false;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_final_artifact.js --case-dir case --json
  node scripts/check_final_artifact.js --case-dir case --file case/result/run.mjs --strict --json
  node scripts/check_final_artifact.js --case-dir case --file case/run.js --source case/lib/a.js,case/lib/b.js --json

检查本地执行入口和样本值直接复用。
--file / 显式入口会纳入样本动态值扫描集合（不仅检查存在性）。
--source/--sources 可追加授权范围内的正式源码清单。
零个可扫描源码文件不得 status=passed（insufficient-evidence）。
默认仅诊断，--strict 使所选交付差异返回 1；执行错误返回 2。工具不判断网站接受。`;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

function addValue(out, name, value, source) {
  if (!PARAM_RE.test(name) || typeof value !== 'string' || value.length < 8 || /^(?:unknown|placeholder|待填写)$/i.test(value)) return;
  out.push({ name, value, source });
}

function extractSampleCryptoValuesFromText(text, source = '') {
  const out = [];
  try {
    const data = JSON.parse(text);
    const visit = (value, depth = 0) => {
      if (depth > 12 || !value || typeof value !== 'object') return;
      for (const [name, item] of Object.entries(value)) {
        if (typeof item === 'string') addValue(out, name, item, source);
        else visit(item, depth + 1);
      }
    };
    visit(data);
  } catch {}
  for (const match of text.matchAll(/https?:\/\/[^\s'"<>]+/g)) {
    try {
      for (const [name, value] of new URL(match[0]).searchParams) addValue(out, name, value, source);
    } catch {}
  }
  for (const match of text.matchAll(/(?:^|[?&\s])([A-Za-z_$][\w$-]{0,80})=([^&\s'"<>]{8,})/g)) {
    addValue(out, match[1], decodeURIComponent(match[2]), source);
  }
  return out;
}

function uniqueResolved(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function check(args) {
  if (!args.caseDir && !args.file) throw new Error('需要 --case-dir 或 --file');
  const caseDir = path.resolve(args.caseDir || path.dirname(path.dirname(path.resolve(args.file))));
  if (!fs.existsSync(caseDir) || !fs.statSync(caseDir).isDirectory()) throw new Error(`case 目录不存在：${caseDir}`);
  const resultDir = path.join(caseDir, 'result');
  const resultCodeFiles = walk(resultDir).filter((f) => SOURCE_EXT.has(path.extname(f).toLowerCase()));
  const entryCandidates = resultCodeFiles.filter((f) => path.dirname(f) === resultDir);
  const entryFile = args.file ? path.resolve(args.file) : entryCandidates.length === 1 ? entryCandidates[0] : '';
  const problems = [];
  const warnings = [];

  const entryExists = !!(entryFile && fs.existsSync(entryFile));
  let entryIsSource = false;
  if (!entryFile) {
    problems.push(entryCandidates.length ? '多个顶层入口，请用 --file 指定本地执行入口' : '未找到本地执行入口');
  } else if (!entryExists) {
    problems.push(`入口不存在：${entryFile}`);
  } else if (!SOURCE_EXT.has(path.extname(entryFile).toLowerCase())) {
    problems.push(`入口不是 JS/Python 源码：${entryFile}`);
  } else {
    entryIsSource = true;
  }

  const explicitSources = (args.sources || []).map((s) => path.resolve(caseDir, s));
  const scanFiles = uniqueResolved([
    ...resultCodeFiles,
    ...(entryIsSource ? [entryFile] : []),
    ...explicitSources.filter((f) => fs.existsSync(f) && SOURCE_EXT.has(path.extname(f).toLowerCase())),
  ]);

  const sampleValues = [];
  for (const folder of ['requests', 'fixtures']) {
    for (const file of walk(path.join(caseDir, folder)).filter((f) => SAMPLE_EXT.has(path.extname(f).toLowerCase()))) {
      sampleValues.push(...extractSampleCryptoValuesFromText(fs.readFileSync(file, 'utf8'), path.relative(caseDir, file)));
    }
  }

  const reused = [];
  const contentCheckedFiles = [];
  for (const file of scanFiles) {
    if (!fs.existsSync(file)) continue;
    contentCheckedFiles.push(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const sample of sampleValues) {
      if (source.includes(sample.value)) {
        reused.push({
          file: path.relative(caseDir, file),
          name: sample.name,
          source: sample.source,
          valuePreview: `${sample.value.slice(0, 4)}...${sample.value.slice(-4)}`,
        });
      }
    }
  }
  if (reused.length) {
    problems.push(`源码含样本动态值：${reused.length} 处；检查是否直接复用而非运行原始 JS 生成`);
  }

  const summary = path.join(resultDir, '最终项目总结.md');
  if (args.requireFinalSummary && !fs.existsSync(summary)) {
    problems.push('已选择总结检查，但未找到 result/最终项目总结.md');
  }
  if (!fs.existsSync(summary)) {
    warnings.push('尚无最终总结；交付时说明入口、验证范围与网站反馈');
  }

  const zeroCoverage = contentCheckedFiles.length === 0;
  if (zeroCoverage) {
    problems.push('零个源码文件纳入内容扫描；不能将产物检查标为通过');
  }

  let status;
  if (zeroCoverage && !entryExists) status = 'insufficient-evidence';
  else if (zeroCoverage) status = 'insufficient-evidence';
  else if (problems.length) status = 'differences';
  else if (entryFile) status = 'passed';
  else status = 'insufficient-evidence';

  // Zero coverage must never report passed even if somehow problems cleared.
  if (zeroCoverage && status === 'passed') status = 'insufficient-evidence';

  const clean = problems.length === 0 && status === 'passed';

  return {
    schemaVersion: 'final-artifact-check/v3',
    caseDir,
    resultDir,
    entryFile: entryFile || null,
    entryExists,
    entryContentChecked: !!(entryIsSource && contentCheckedFiles.some((f) => path.resolve(f) === path.resolve(entryFile))),
    clean,
    status,
    problems,
    warnings,
    reusedCryptoCheck: { sampleValues: sampleValues.length, reused },
    scannedFiles: contentCheckedFiles.map((f) => path.relative(caseDir, f)),
    finalSummary: { required: !!args.requireFinalSummary, present: fs.existsSync(summary), file: summary },
    websiteAccepted: null,
    resultFiles: resultCodeFiles.map((f) => path.relative(caseDir, f)),
  };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) console.log(usage());
    else {
      const result = check(args);
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) {
        process.stdout.write(
          `# 最终产物检查\n\n- 结果：${result.status}\n- 入口：${result.entryFile || '待指定'}（存在=${result.entryExists}；内容已检=${result.entryContentChecked}）\n- 扫描文件：${result.scannedFiles.join(', ') || '无'}\n- 网站接受：未由本工具判断\n${result.problems.map((p) => `- ${p}`).join('\n')}\n`
        );
      }
      process.exitCode = args.strict && !result.clean ? 1 : 0;
    }
  } catch (err) {
    console.error(err.message || String(err));
    process.exitCode = 2;
  }
}

module.exports = { check, extractSampleCryptoValuesFromText, parseArgs };
