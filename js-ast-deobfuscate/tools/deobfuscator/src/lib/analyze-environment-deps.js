/**
 * 第 9 阶段 · 环境依赖只读分析器。
 *
 * 功能：盘点未绑定全局、静态属性链、调用形状和动态环境风险。
 * 边界：只读取 AST，不执行源码，不创建浏览器伪对象，也不注册为 AST 改写插件。
 */

import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';

const traverse = traverseModule.default ?? traverseModule;
const generate = generatorModule.default ?? generatorModule;

/**
 * 读取 MemberExpression 的稳定属性名。
 * @param {import('@babel/traverse').NodePath} memberPath 成员表达式 Path
 * @returns {string | null} 点属性或字符串计算属性；动态属性返回 null
 */
function readStaticProperty(memberPath) {
  // 点属性的 Identifier 是语法名，不是需要读取的独立 Binding。
  if (!memberPath.node.computed && memberPath.get('property').isIdentifier()) {
    return memberPath.get('property').node.name;
  }

  // 字符串计算属性的 key 已经是静态值，可以安全纳入路径。
  if (memberPath.node.computed && memberPath.get('property').isStringLiteral()) {
    return memberPath.get('property').node.value;
  }

  // 数字、标识符、调用和模板表达式等计算属性依赖运行期，不能猜测名称。
  return null;
}

/**
 * 从一个未绑定 Identifier 沿成员访问方向建立属性链。
 * @param {import('@babel/traverse').NodePath} identifierPath 根标识符 Path
 * @returns {{path: string, root: string, dynamic: boolean, outerPath: import('@babel/traverse').NodePath}}
 */
function readAccessChain(identifierPath) {
  const parts = [identifierPath.node.name];
  let current = identifierPath;
  let dynamic = false;

  // 只有当前节点位于 MemberExpression.object 时，才继续向外读取属性。
  while (current.parentPath?.isMemberExpression()) {
    const memberPath = current.parentPath;

    // 防止把 property 字段或调用参数误当成当前链的下一段。
    if (memberPath.get('object').node !== current.node) break;
    const property = readStaticProperty(memberPath);

    // 动态 key 只保留“未知”标记，不能继续伪造后续属性。
    if (property === null) {
      parts.push('[dynamic]');
      dynamic = true;
      current = memberPath;
      break;
    }

    // 静态属性继续向外拼接，支持 window.location.href 这种链。
    parts.push(property);
    current = memberPath;
  }

  let suffix = '';

  // 用显式循环拼接后缀，避免把动态标记误写成普通点属性。
  for (const part of parts.slice(1)) {
    suffix += part === '[dynamic]' ? part : `.${part}`;
  }
  const path = parts[0] + suffix;

  return {
    path,
    root: parts[0],
    dynamic,
    outerPath: current,
  };
}

/**
 * 识别属性链最终参与的操作类型。
 * @param {import('@babel/traverse').NodePath} outerPath 链最外层 Path
 * @returns {string} read/call/construct/write/update/delete
 */
function readAccessKind(outerPath) {
  const parent = outerPath.parentPath;

  // callee 位置表示读取后立即调用，后续 Hook 需要保留调用边界。
  if (parent?.isCallExpression() && parent.get('callee').node === outerPath.node) return 'call';

  // NewExpression 需要关注构造器原型和 brand（品牌）检查。
  if (parent?.isNewExpression() && parent.get('callee').node === outerPath.node) return 'construct';

  // AssignmentExpression 左值会直接写环境对象，必须与普通读取分开。
  if (parent?.isAssignmentExpression() && parent.get('left').node === outerPath.node) return 'write';

  // UpdateExpression 会读后再写，不能沿用只读访问的处理策略。
  if (parent?.isUpdateExpression() && parent.get('argument').node === outerPath.node) return 'update';

  // delete 会改变属性存在性，补环境阶段必须单独审查该副作用。
  if (parent?.isUnaryExpression({operator: 'delete'}) && parent.get('argument').node === outerPath.node) {
    return 'delete';
  }

  // 其它访问默认记录为 read，实际用途由分类器和人工证据决定。
  return 'read';
}

/**
 * 判断名称是否由当前 AST 的本地作用域链声明，而不是 Babel 记录的宿主全局。
 * @param {import('@babel/traverse').NodePath} path 当前引用 Path
 * @param {string} name 待判断名称
 * @returns {boolean} 是否存在本地 Binding
 */
function hasLocalBinding(path, name) {
  let scope = path.scope;

  // 逐层检查 hasOwnBinding，避免把 Date/Math/globalThis/eval 等宿主名称误当作本地变量。
  while (scope) {
    // 任一父层 Scope 自身声明该名称时，当前引用都属于源码本地 Binding。
    if (scope.hasOwnBinding(name)) return true;
    scope = scope.parent;
  }

  return false;
}

/**
 * 根据路径给出保守的用途和策略初值。
 * @param {{path: string, root: string, dynamic: boolean, access: string}} chain 属性链信息
 * @returns {{purpose: string, strategy: string, status: string, reason: string}} 分类结果
 */
function classifyChain(chain) {
  const {path, root, dynamic, access} = chain;

  // 动态属性无法确定真实 key，因此不能进入自动补环境路径。
  if (dynamic) {
    return {
      purpose: 'unknown',
      strategy: 'stop',
      status: 'unknown',
      reason: 'dynamic-property',
    };
  }

  // write 表示 AssignmentExpression 直接写入环境属性。
  const writesEnvironment = access === 'write';

  // update 表示自增/自减等读后写操作。
  const updatesEnvironment = access === 'update';

  // delete 表示删除属性并改变其存在性。
  const deletesEnvironment = access === 'delete';

  // 三类操作都会改变环境状态，统一停止自动补环境并保留具体原因。
  // 任一环境变更操作命中时，都返回 unknown/stop 而不继续用途分类。
  if (writesEnvironment || updatesEnvironment || deletesEnvironment) {
    return {
      purpose: 'unknown',
      strategy: 'stop',
      status: 'unknown',
      reason: `environment-${access}`,
    };
  }

  // webdriver 是明确的环境检测字段，默认只报告而不伪造布尔结果。
  const isWebdriverCheck = path === 'navigator.webdriver';

  // userAgent 参与比较时常用于环境识别，仍需数据流证据才能升级策略。
  const readsUserAgent = path.includes('navigator.userAgent');

  // visibilityState 依赖页面生命周期，Node 桩不能无证据给出固定状态。
  const readsVisibilityState = path.includes('document.visibilityState');

  // 任一检测路径命中时都只进入报告候选，不自动生成检测伪值。
  if (isWebdriverCheck || readsUserAgent || readsVisibilityState) {
    return {
      purpose: 'detection',
      strategy: 'report-only',
      status: 'candidate',
      reason: 'environment-detection-needs-evidence',
    };
  }

  // Date.now 是墙上时间输入，需要记录后注入回放。
  const readsDateNow = path === 'Date.now';

  // Math.random 是随机输入，需要记录完整消费序列。
  const readsMathRandom = path.startsWith('Math.random');

  // performance.now 是性能计时输入，不能与 Date.now 混成同一来源。
  const readsPerformanceNow = path.startsWith('performance.now');

  // 任一非确定性来源命中时都转入确定性回放候选。
  if (readsDateNow || readsMathRandom || readsPerformanceNow) {
    return {
      purpose: 'nondeterministic',
      strategy: 'deterministic-replay',
      status: 'candidate',
      reason: 'external-time-or-random-input',
    };
  }

  // fetch 函数是现代请求边界，需要保留参数、返回、异常和异步状态。
  const callsFetch = path === 'fetch';

  // XMLHttpRequest 是有状态请求对象，仍只记录为 Hook 候选。
  const usesXmlHttpRequest = path.startsWith('XMLHttpRequest');

  // 任一网络入口命中时都保留为 Hook 边界，不创建固定网络响应。
  if (callsFetch || usesXmlHttpRequest) {
    return {
      purpose: 'network-boundary',
      strategy: 'hook-boundary',
      status: 'handoff',
      reason: 'request-boundary-needs-observation',
    };
  }

  // 全局 crypto.subtle 可能属于算法依赖，但仍需确认输入和输出。
  const usesGlobalWebCrypto = path.startsWith('crypto.subtle');

  // 对象属性链中的 crypto.subtle 同样需要检查是否来自真实 WebCrypto。
  const usesNestedWebCrypto = path.includes('.crypto.subtle');

  // 任一 WebCrypto 路径命中时都保留算法候选和输入输出确认要求。
  if (usesGlobalWebCrypto || usesNestedWebCrypto) {
    return {
      purpose: 'algorithm',
      strategy: 'static-or-isolated-eval',
      status: 'candidate',
      reason: 'pure-input-and-output-need-confirmation',
    };
  }

  // 这些浏览器或宿主根对象先进入矩阵，不直接生成桩。
  const browserRoots = ['window', 'document', 'navigator', 'location', 'globalThis'];

  // 根名称属于浏览器集合时，只标记待审查，不推断具体页面语义。
  if (browserRoots.includes(root)) {
    return {
      purpose: 'browser-api',
      strategy: 'matrix-review',
      status: 'candidate',
      reason: 'browser-semantics-not-yet-proven',
    };
  }

  // 常用 ECMAScript/Node 全局只记录为 runtime-standard，仍不承诺浏览器等价。
  if (['Object', 'String', 'Array', 'JSON', 'console', 'Buffer'].includes(root)) {
    return {
      purpose: 'runtime-standard',
      strategy: 'static-or-node',
      status: 'candidate',
      reason: 'runtime-availability-must-be-checked',
    };
  }

  // 未知根对象不允许自动推断用途，统一失败关闭。
  return {
    purpose: 'unknown',
    strategy: 'stop',
    status: 'unknown',
    reason: 'unclassified-environment-root',
  };
}

/**
 * 生成一个带源码位置的依赖矩阵记录。
 * @param {import('@babel/traverse').NodePath} path 未绑定 Identifier Path
 * @returns {object} 依赖矩阵记录
 */
function createDependency(path) {
  const chain = readAccessChain(path);
  const access = readAccessKind(chain.outerPath);
  const classification = classifyChain({...chain, access});

  // source 字段固定为 line:column，供 runner 稳定比较和人工回到 AST 位置。
  const start = path.node.loc?.start;
  return {
    source: start ? `${start.line}:${start.column}` : 'unknown-location',
    path: chain.path,
    access,
    evidence: 'static-ast',
    ...classification,
  };
}

/**
 * 创建去重后的未知风险记录。
 * @param {Map<string, object>} issues 已有风险映射
 * @param {object} issue 风险记录
 * @returns {void}
 */
function addIssue(issues, issue) {
  const key = `${issue.reason}|${issue.path}`;

  // 同一风险可能由 ReferencedIdentifier 和专门 Visitor 各发现一次，只保留一条。
  if (!issues.has(key)) issues.set(key, issue);
}

/**
 * 按依赖属性路径稳定排序报告。
 * @param {object} left 左侧依赖记录
 * @param {object} right 右侧依赖记录
 * @returns {number} localeCompare 排序值
 */
function compareDependencyPath(left, right) {
  return left.path.localeCompare(right.path);
}

/**
 * 按未知风险原因稳定排序报告。
 * @param {object} left 左侧风险记录
 * @param {object} right 右侧风险记录
 * @returns {number} localeCompare 排序值
 */
function compareUnknownReason(left, right) {
  return left.reason.localeCompare(right.reason);
}

/**
 * 分析 Babel AST 并返回只读环境依赖报告。
 * @param {object} ast Babel File AST
 * @returns {{version: number, dependencies: object[], unknowns: object[], summary: object}} 环境报告
 */
export function analyzeEnvironmentDependencies(ast) {
  const dependencies = new Map();
  const unknowns = new Map();

  // 只扫描真正引用的 Identifier；Scope/Binding 会排除局部声明、参数和函数名。
  traverse(ast, {
    /**
     * 收集未绑定 Identifier 的属性链、访问类型和保守用途分类。
     * @param {import('@babel/traverse').NodePath} path 引用路径
     * @returns {void}
     */
    ReferencedIdentifier(path) {
      // 当前作用域已有 Binding 时，不将同名局部值误报为宿主依赖。
      if (hasLocalBinding(path, path.node.name)) return;
      const dependency = createDependency(path);
      const key = `${dependency.path}|${dependency.access}`;

      // 同一路径同一操作只保留一项，避免多次读取让矩阵失真。
      if (!dependencies.has(key)) dependencies.set(key, dependency);
    },

    /**
     * 记录直接 eval 造成的动态代码边界。
     * @param {import('@babel/traverse').NodePath} path 调用路径
     * @returns {void}
     */
    CallExpression(path) {
      // callee 必须是直接名称 eval；obj.eval() 不属于直接 eval 语义。
      const callsEvalName = path.get('callee').isIdentifier({name: 'eval'});

      // 同名本地 Binding 会遮蔽宿主 eval，只有未绑定名称才形成动态代码边界。
      const callsDirectEval = callsEvalName && !hasLocalBinding(path, 'eval');

      // 只有直接且未绑定的 eval 调用才写入动态代码停止记录。
      if (callsDirectEval) {
        addIssue(unknowns, {
          path: generate(path.node, {compact: true}).code,
          reason: 'direct-eval',
          action: 'stop',
        });
      }
    },

    /**
     * 记录 with 造成的动态作用域边界。
     * @param {import('@babel/traverse').NodePath} path with 语句路径
     * @returns {void}
     */
    WithStatement(path) {
      // with 让名称解析依赖运行期对象，当前分析器不跨越该边界。
      addIssue(unknowns, {
        path: generate(path.node, {compact: true}).code,
        reason: 'with-scope',
        action: 'stop',
      });
    },
  });

  const result = {
    version: 1,
    dependencies: [...dependencies.values()].sort(compareDependencyPath),
    unknowns: [...unknowns.values()].sort(compareUnknownReason),
    summary: {
      dependencyCount: dependencies.size,
      unknownCount: unknowns.size,
      status: unknowns.size > 0 ? 'analyzed-with-stops' : 'analyzed',
    },
  };

  // 输出对象只来自 AST 结构，不读取或执行待分析源码中的值。
  return result;
}
