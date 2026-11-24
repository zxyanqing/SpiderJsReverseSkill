/**
 * C8 · 确定性顺序数组分发器还原插件
 *
 * 功能：把严格白名单内的 `while (true) + switch (order[cursor++])`
 * 按静态 order 顺序还原为顺序语句。
 * 不做：动态顺序、条件状态机、case 贯穿、case 内声明、嵌套控制转移、label、try/finally。
 */

import { createStats, skip } from '../lib/stats.js';

/**
 * 给字符串/数字字面量生成保留类型的 case 键，防止字符串 "1" 与数字 1 混淆。
 * @param {import('@babel/types').Node | null} node 顺序项或 case 标签节点
 * @returns {string | null} 可比较键；不支持的动态节点返回 null
 */
function literalKey(node) {
  // 字符串 case 与数字 case 在 JavaScript 的严格相等比较中不同，键必须带类型前缀。
  if (node?.type === 'StringLiteral') return `string:${node.value}`;

  // 本插件只把有限数字视为稳定标签，NaN/Infinity 等表达式不进入白名单。
  if (node?.type === 'NumericLiteral' && Number.isFinite(node.value)) {
    return `number:${node.value}`;
  }

  // 其它节点依赖运行期求值，不能作为静态分发证据。
  return null;
}

/**
 * 识别静态 `'a,b'.split(',')` / `"a,b"['split'](',')` 形态。
 * @param {import('@babel/traverse').NodePath} initPath
 * @returns {string[] | null} 带 string: 前缀的顺序键；不匹配返回 null
 */
function readOrderFromSplitCall(initPath) {
  if (!initPath.isCallExpression()) return null;

  const callee = initPath.get('callee');
  const args = initPath.get('arguments');
  if (!callee.isMemberExpression()) return null;
  if (args.length !== 1 || !args[0].isStringLiteral()) return null;

  const property = callee.get('property');
  const isSplitName =
    (!callee.node.computed && property.isIdentifier({ name: 'split' })) ||
    (callee.node.computed && property.isStringLiteral({ value: 'split' }));
  if (!isSplitName) return null;

  const object = callee.get('object');
  if (!object.isStringLiteral()) return null;

  const parts = object.node.value.split(args[0].node.value);
  // 空串 split 可能得到 ['']；仍可作为单元素顺序表。完全无项则拒绝。
  if (parts.length === 0) return null;

  return parts.map((part) => `string:${part}`);
}

/**
 * 从数组字面量或静态 split 调用读取顺序；空洞、展开元素和动态表达式都会导致失败关闭。
 * @param {import('@babel/traverse').NodePath} initPath order 声明的初始化 Path
 * @returns {string[] | null} 带类型的顺序键列表
 */
function readStaticOrder(initPath) {
  // 常见混淆：'3,4,0,5'['split'](',') → 字符串顺序表。
  const fromSplit = readOrderFromSplitCall(initPath);
  if (fromSplit) return fromSplit;

  if (!initPath.isArrayExpression()) return null;

  const keys = [];

  // 逐项验证是为了保证整个 order 可静态读取；任一动态项都会否决整次改写。
  for (const element of initPath.node.elements) {
    // 数组空洞没有 case 值，SpreadElement 也不是静态单值，统一失败关闭。
    if (!element || element.type === 'SpreadElement') return null;

    const key = literalKey(element);

    // 非字符串/有限数字意味着顺序依赖运行期计算，不能猜测。
    if (key === null) return null;

    keys.push(key);
  }

  // 空顺序表不是有意义的还原目标，保留原结构更便于分析。
  return keys.length > 0 ? keys : null;
}

/**
 * 判断 case 主体在移出 switch 后是否仍可安全执行。
 * @param {import('@babel/types')} t Babel types 工具
 * @param {import('@babel/types').Statement[]} statements 不含末尾分发终止语句的主体
 * @returns {boolean} true 表示未发现本插件拒绝的声明或控制转移
 */
function hasUnsafeCaseBody(t, statements) {
  let unsafe = false;

  // 扫描每条主体语句及其子树；发现一项高风险结构即停止继续收集证据。
  for (const statement of statements) {
    t.traverseFast(statement, (node) => {
      // 前一个节点已判定风险后无需覆盖原因；布尔结果保持 true。
      if (unsafe) return;

      // 声明移出 switch 会改变 case 共享作用域、TDZ 或提升语义，本插件全部拒绝。
      if (
        t.isVariableDeclaration(node) ||
        t.isFunctionDeclaration(node) ||
        t.isClassDeclaration(node)
      ) {
        unsafe = true;
        return;
      }

      // 这些控制转移的目标依赖原 while/switch 嵌套关系，不能在顺序拼接时照搬。
      if (
        t.isBreakStatement(node) ||
        t.isContinueStatement(node) ||
        t.isReturnStatement(node) ||
        t.isThrowStatement(node) ||
        t.isLabeledStatement(node)
      ) {
        unsafe = true;
        return;
      }

      // 异常边、嵌套循环/分发器和函数边界需要更完整 CFG，本阶段正式插件失败关闭。
      if (
        t.isTryStatement(node) ||
        t.isSwitchStatement(node) ||
        t.isWhileStatement(node) ||
        t.isDoWhileStatement(node) ||
        t.isForStatement(node) ||
        t.isForInStatement(node) ||
        t.isForOfStatement(node) ||
        t.isFunction(node)
      ) {
        unsafe = true;
      }
    });

    // 已发现风险时不再扫描后续语句，避免无意义遍历。
    if (unsafe) break;
  }

  return unsafe;
}

const SAFE_UNBOUND_IDENTIFIERS = new Set(['undefined', 'NaN', 'Infinity', 'arguments']);

// 终止语句（return/throw）内额外拦截的未绑定名；其它未绑定（如 Error）暂放行。
const TERMINAL_UNBOUND_BLACKLIST = new Set(['eval', 'process']);

/**
 * 检查语句中的特殊动态语义。
 * - body：局部直线副作用可保留；direct eval、with、未绑定全局读写失败关闭。
 * - terminal：仅拦 with、direct eval，以及黑名单未绑定名（如 process）；允许 Error 等构造。
 * @param {import('@babel/traverse').NodePath[]} statementPaths 要扫描的语句 Path 列表
 * @param {'body' | 'terminal'} mode 扫描强度
 * @returns {string | null} 停止原因；null 表示未发现本策略拒绝的动态语义
 */
function findUnsafeDynamicSemantics(statementPaths, mode = 'body') {
  for (const statementPath of statementPaths) {
    let reason = null;

    // NodePath.traverse 只遍历子节点；语句根就是 with 时要先检查。
    if (statementPath.isWithStatement()) return 'with-unsupported';

    // 使用 Path 访问 scope，区分 direct eval 与被本地 Binding 遮蔽的同名函数。
    statementPath.traverse({
      WithStatement(path) {
        reason = 'with-unsupported';
        path.stop();
      },
      CallExpression(path) {
        const callee = path.get('callee');
        if (callee.isIdentifier({name: 'eval'}) && !path.scope.getBinding('eval')) {
          reason = 'direct-eval-unsupported';
          path.stop();
        }
      },
      AssignmentExpression(path) {
        // 终止句模式不扫全局赋值：return/throw 表达式内极少出现左值写入。
        if (mode !== 'body') return;
        const left = path.get('left');
        if (left.isIdentifier() && !left.scope.getBinding(left.node.name)) {
          reason = 'dynamic-global-write';
          path.stop();
        }
      },
      ReferencedIdentifier(path) {
        if (reason || !path.isReferencedIdentifier()) return;
        if (path.scope.getBinding(path.node.name)) return;

        // 终止句：只拦黑名单未绑定名，放行 Error 等常见构造器。
        if (mode === 'terminal') {
          if (TERMINAL_UNBOUND_BLACKLIST.has(path.node.name)) {
            reason = 'dynamic-global-reference';
            path.stop();
          }
          return;
        }

        // 主体：除白名单外的未绑定标识符一律失败关闭。
        if (SAFE_UNBOUND_IDENTIFIERS.has(path.node.name)) return;
        reason = 'dynamic-global-reference';
        path.stop();
      },
    });

    if (reason) return reason;
  }

  return null;
}

/**
 * 显式检查 order 数组是否通过成员方法调用、下标赋值、更新或 delete 被改写。
 * 引用封闭（referencePaths 唯一）已能间接挡住多数情况；本检查给出更精确的失败原因。
 * @param {object} orderBinding order 的 Binding
 * @returns {string | null} `order-member-mutation` 或 null
 */
function findOrderMemberMutation(orderBinding) {
  for (const reference of orderBinding.referencePaths) {
    const member = reference.parentPath;

    // 非成员访问（如把 order 传给函数）由后续 exclusivity 检查处理。
    if (!member?.isMemberExpression() || member.node.object !== reference.node) continue;

    const container = member.parentPath;

    // `order.push(...)` / `order.shift()` 等：成员表达式作为调用 callee。
    if (container?.isCallExpression() && container.node.callee === member.node) {
      return 'order-member-mutation';
    }

    // `order[i] = ...` 或 `order[i] += ...`。
    if (container?.isAssignmentExpression({left: member.node})) {
      return 'order-member-mutation';
    }

    // `order[i]++` / `++order[i]`。
    if (container?.isUpdateExpression() && container.node.argument === member.node) {
      return 'order-member-mutation';
    }

    // `delete order[i]`。
    if (
      container?.isUnaryExpression({operator: 'delete'}) &&
      container.node.argument === member.node
    ) {
      return 'order-member-mutation';
    }
  }

  return null;
}

/**
 * 收集唯一 case 及其可搬移语句，并验证每个 case 有明确终止方式。
 * @param {import('@babel/types')} t Babel types 工具
 * @param {import('@babel/traverse').NodePath} switchPath 分发 switch 的 Path
 * @returns {{cases: Map<string, {statements: import('@babel/types').Statement[], terminal: string}>} | {reason: string}}
 */
function collectCases(t, switchPath) {
  const cases = new Map();

  // 每个 case 都单独验证标签、主体和终止语义；任何失败都会否决整个 dispatcher。
  for (const caseNode of switchPath.node.cases) {
    // default 没有静态标签，可能改变未知顺序项的行为，本插件不接受。
    if (caseNode.test === null) return { reason: 'default-case-unsupported' };

    const key = literalKey(caseNode.test);

    // 动态 case 标签或同类型重复标签都无法形成一一映射。
    if (key === null) return { reason: 'dynamic-case-label' };
    if (cases.has(key)) return { reason: 'duplicate-case-label' };

    // 空 case 会贯穿到下一个 case；源码排列参与语义，不能按 order 单独克隆。
    if (caseNode.consequent.length === 0) return { reason: 'dangerous-fallthrough' };

    const terminalNode = caseNode.consequent.at(-1);
    let terminal = '';

    // 无标签 continue 明确回到当前 dispatcher while；还原后应移除该控制语句。
    if (t.isContinueStatement(terminalNode) && terminalNode.label === null) {
      terminal = 'continue';
    // return 在原函数边界内终止；克隆后保留，并停止追加后续 order 项。
    } else if (t.isReturnStatement(terminalNode)) {
      terminal = 'return';
    // throw 保持同一异常完成语义；克隆后保留，并停止追加后续 order 项。
    } else if (t.isThrowStatement(terminalNode)) {
      terminal = 'throw';
    // break、带标签 continue 或普通语句结尾都可能贯穿/改变目标，统一拒绝。
    } else {
      return { reason: 'ambiguous-case-terminator' };
    }

    // case 主体 AST 节点：去掉最后一条终止语句，只留下可克隆的业务语句。
    const body = caseNode.consequent.slice(0, -1);
    // 拿到当前 case 的 consequent Path 列表（与上面节点一一对应，供后续动态语义检查）。
    const consequentPaths = switchPath
      .get('cases')
      [switchPath.node.cases.indexOf(caseNode)]
      .get('consequent');
    // 主体对应的 Path：同样去掉最后一项，与 body 对齐。
    const bodyPaths = consequentPaths.slice(0, -1);
    // 终止语句 Path：最后一项，用于单独检查 return/throw/continue 的动态语义。
    const terminalPath = consequentPaths.at(-1);

    // case 主体中出现声明、异常边或嵌套控制转移时，移动语句可能改变语义。
    if (hasUnsafeCaseBody(t, body)) return { reason: 'unsafe-case-body' };

    // 主体：局部直线副作用可保留；eval / with / 未绑定全局必须失败关闭。
    const bodyDynamicReason = findUnsafeDynamicSemantics(bodyPaths, 'body');
    if (bodyDynamicReason) return { reason: bodyDynamicReason };

    // 终止句：只拦 eval / with / process 等黑名单；允许 throw new Error(...) 等常见形态。
    if (terminalPath) {
      const terminalDynamicReason = findUnsafeDynamicSemantics([terminalPath], 'terminal');
      if (terminalDynamicReason) return { reason: terminalDynamicReason };
    }

    const statements = body.map((statement) => t.cloneNode(statement, true));

    // return/throw 是业务终止语句，必须保留；continue 只是分发器噪声，应删除。
    if (terminal !== 'continue') {
      statements.push(t.cloneNode(terminalNode, true));
    }

    cases.set(key, { statements, terminal });
  }

  return { cases };
}

/**
 * 验证 order 与 cursor 的 Binding 只服务于当前 switch 判别式。
 * @param {import('@babel/traverse').NodePath} whilePath 候选 while Path
 * @param {import('@babel/traverse').NodePath} switchPath 候选 switch Path
 * @returns {{order: string[], start: number} | {reason: string}}
 */
function inspectDispatcherBindings(whilePath, switchPath) {
  const discriminant = switchPath.get('discriminant');

  // 判别式必须精确是 order[cursor++]，其它访问方式需要不同的运行顺序证明。
  if (!discriminant.isMemberExpression({ computed: true })) {
    return { reason: 'unsupported-discriminant' };
  }

  const orderRef = discriminant.get('object');
  const updatePath = discriminant.get('property');

  // order 必须是标识符，cursor 必须是后置自增；前置自增会改变首项索引。
  if (!orderRef.isIdentifier()) return { reason: 'order-not-identifier' };
  if (!updatePath.isUpdateExpression({ operator: '++', prefix: false })) {
    return { reason: 'cursor-not-post-increment' };
  }

  const cursorRef = updatePath.get('argument');

  // 复杂属性表达式无法绑定到唯一游标声明，本插件不处理。
  if (!cursorRef.isIdentifier()) return { reason: 'cursor-not-identifier' };

  const orderBinding = whilePath.scope.getBinding(orderRef.node.name);
  const cursorBinding = whilePath.scope.getBinding(cursorRef.node.name);

  // 两个 Binding 都必须存在且由简单变量声明建立，防止同名遮蔽或全局读取。
  if (!orderBinding?.path?.isVariableDeclarator()) return { reason: 'order-binding-mismatch' };
  if (!cursorBinding?.path?.isVariableDeclarator()) return { reason: 'cursor-binding-mismatch' };

  // 显式拒绝 order 的成员方法写入 / 下标赋值 / delete（给出精确 reason，便于教学对照）。
  const mutationReason = findOrderMemberMutation(orderBinding);
  if (mutationReason) return { reason: mutationReason };

  // order 除当前判别式外不得再被读取或写入，否则删改 dispatcher 可能改变其它行为。
  if (
    !orderBinding.constant ||
    orderBinding.constantViolations.length !== 0 ||
    orderBinding.referencePaths.length !== 1 ||
    orderBinding.referencePaths[0] !== orderRef
  ) {
    return { reason: 'order-binding-not-exclusive' };
  }

  // cursor 的唯一读取必须是当前 update 参数，且唯一写入就是这次 ++。
  if (
    cursorBinding.referencePaths.length !== 1 ||
    cursorBinding.referencePaths[0] !== cursorRef ||
    cursorBinding.constantViolations.length !== 1
  ) {
    return { reason: 'cursor-binding-not-exclusive' };
  }

  const cursorInit = cursorBinding.path.get('init');

  // 游标初值必须是非负整数；小数、负数或动态初值都无法索引静态顺序表。
  if (
    !cursorInit.isNumericLiteral() ||
    !Number.isInteger(cursorInit.node.value) ||
    cursorInit.node.value < 0
  ) {
    return { reason: 'cursor-start-not-static-integer' };
  }

  const order = readStaticOrder(orderBinding.path.get('init'));

  // 整张顺序表必须由字符串/有限数字字面量组成。
  if (order === null) return { reason: 'order-not-static-array' };

  // 初值越过数组末尾虽然可退出原循环，但不是有意义的展平目标。
  if (cursorInit.node.value >= order.length) return { reason: 'cursor-start-out-of-range' };

  return { order, start: cursorInit.node.value };
}

/**
 * 按静态顺序克隆 case 主体；遇到 return/throw 后停止，避免制造不可达副本。
 * @param {import('@babel/types')} t Babel types 工具
 * @param {string[]} order 带类型的静态顺序键
 * @param {number} start 游标初始下标
 * @param {Map<string, {statements: import('@babel/types').Statement[], terminal: string}>} cases case 映射
 * @returns {{statements: import('@babel/types').Statement[]} | {reason: string}}
 */
function buildReplacement(t, order, start, cases) {
  const statements = [];

  // 从真实 cursor 初值开始读取顺序；每个顺序项必须能映射到唯一 case。
  for (let index = start; index < order.length; index += 1) {
    const item = cases.get(order[index]);

    // order 指向不存在的 case 时，原代码会走 switch 未命中路径，不能假装该项可忽略。
    if (!item) return { reason: 'order-target-missing' };

    // 每次命中都深克隆，允许 order 合法地重复执行同一个 case。
    for (const statement of item.statements) {
      statements.push(t.cloneNode(statement, true));
    }

    // return/throw 后原函数不会再读取后续顺序项，还原结果也应在此停止。
    if (item.terminal === 'return' || item.terminal === 'throw') break;
  }

  return { statements };
}

/**
 * 插件工厂：创建独立统计对象，并还原严格白名单内的顺序数组分发器。
 * @param {{types: typeof import('@babel/types')}} api Babel types
 * @returns {{name: string, stats: object, visitor: object}}
 */
export default function restoreSequentialDispatcher({ types: t } = {}) {
  const stats = createStats('restore-sequential-dispatcher');

  // 缺失 Babel types 属于插件接线错误，应立即报错而不是静默跳过全部节点。
  if (!t || typeof t.cloneNode !== 'function') {
    throw new Error('restore-sequential-dispatcher 需要 api.types（@babel/types）');
  }

  return {
    name: 'restore-sequential-dispatcher',
    stats,
    visitor: {
      /**
       * 处理候选 while：先完整预检，再一次性替换，预检失败时原 AST 保持不变。
       * @param {import('@babel/traverse').NodePath} path WhileStatement Path
       */
      WhileStatement(path) {
        // 只把 `while (true)` 视为本插件候选；普通业务循环不计 matched。
        if (!path.get('test').isBooleanLiteral({ value: true })) return;

        const bodyPath = path.get('body');

        // 候选必须位于 Program/Block 的语句列表中，确保可合法替换为多条语句。
        if (!path.inList || path.listKey !== 'body') return;

        // 精确骨架为两条：switch 后跟无标签 break，用于 order 耗尽后退出 while。
        if (!bodyPath.isBlockStatement() || bodyPath.node.body.length !== 2) return;

        const [switchPath, exitPath] = bodyPath.get('body');

        // switch 之外存在业务语句，或退出 break 带 label，都会改变循环语义。
        if (!switchPath.isSwitchStatement() || !exitPath.isBreakStatement() || exitPath.node.label) {
          return;
        }

        stats.matched += 1;

        const bindingResult = inspectDispatcherBindings(path, switchPath);

        // Binding 或静态顺序证据不足时保留整个 while，并记录具体停止原因。
        if ('reason' in bindingResult) {
          skip(stats, bindingResult.reason);
          return;
        }

        const caseResult = collectCases(t, switchPath);

        // case 标签、作用域或终止方式不安全时，不进行部分改写。
        if ('reason' in caseResult) {
          skip(stats, caseResult.reason);
          return;
        }

        const replacement = buildReplacement(
          t,
          bindingResult.order,
          bindingResult.start,
          caseResult.cases
        );

        // order 无法完整映射到 case 时保留原结构，防止遗漏真实分支。
        if ('reason' in replacement) {
          skip(stats, replacement.reason);
          return;
        }

        // 完整预检通过后才一次性替换；空结果在当前 guard 下不会出现。
        path.replaceWithMultiple(replacement.statements);
        stats.changed += 1;
      },
    },
  };
}
