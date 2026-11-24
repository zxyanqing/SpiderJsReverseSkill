import traverseMod from '@babel/traverse';
import t from '@babel/types';
import normalizeStructure from './plugins/normalize-structure.js';
import literalString from './plugins/literal-string.js';
import constantFold from './plugins/constant-fold.js';
import constPropagate from './plugins/const-propagate.js';
import inlineLiterals from './plugins/inline-literals.js';
import staticArray from './plugins/static-array.js';
import objectMap from './plugins/object-map.js';
import inlineDispatchers from './plugins/inline-dispatchers.js';
import deadBranch from './plugins/dead-branch.js';
import restoreSequentialDispatcher from './plugins/restore-sequential-dispatcher.js';
import restoreExplicitStateMachine from './plugins/restore-explicit-state-machine.js';
import restoreForSwitchState from './plugins/restore-for-switch-state.js';
import flattenArrayControlFlow from './plugins/flatten-array-control-flow.js';
import ifChainToSwitch from './plugins/if-chain-to-switch.js';
import normalizeObjectRefState from './plugins/normalize-object-ref-state.js';
import cleanupConcatDecoy from './plugins/cleanup-concat-decoy.js';
import stringDecryptChain from './plugins/string-decrypt-chain.js';
import unusedBinding from './plugins/unused-binding.js';
import memberSimplify from './plugins/member-simplify.js';
import removeDebugger from './plugins/remove-debugger.js';
import renameIdentifiers from './plugins/rename-identifiers.js';

const traverse = traverseMod.default ?? traverseMod;

/**
 * 全量注册表（含可选插件）。键顺序 ≈ 推荐默认链；可选插件见 OPTIONAL_PLUGINS。
 */
const REGISTRY = {
  'normalize-structure': normalizeStructure,
  'literal-string': literalString,
  'constant-fold': constantFold,
  'const-propagate': constPropagate,
  'inline-literals': inlineLiterals,
  'static-array': staticArray,
  'object-map': objectMap,
  'inline-dispatchers': inlineDispatchers,
  'dead-branch': deadBranch,
  'string-decrypt-chain': stringDecryptChain,
  'normalize-object-ref-state': normalizeObjectRefState,
  'unused-binding': unusedBinding,
  'cleanup-concat-decoy': cleanupConcatDecoy,
  'member-simplify': memberSimplify,
  'if-chain-to-switch': ifChainToSwitch,
  'flatten-array-control-flow': flattenArrayControlFlow,
  'restore-sequential-dispatcher': restoreSequentialDispatcher,
  'restore-explicit-state-machine': restoreExplicitStateMachine,
  'restore-for-switch-state': restoreForSwitchState,
  'remove-debugger': removeDebugger,
  'rename-identifiers': renameIdentifiers,
};

/** 可选：不进 DEFAULT 全量安全链；显式 --plugins 才跑 */
export const OPTIONAL_PLUGINS = new Set(['rename-identifiers']);

/** 默认插件列表：REGISTRY 键序去掉可选插件 */
export const DEFAULT_PLUGINS = Object.keys(REGISTRY).filter((name) => !OPTIONAL_PLUGINS.has(name));

/**
 * 按顺序对 AST 跑插件。每个插件返回 Babel 风格 { visitor }。
 */
export function transform(ast, pluginNames = DEFAULT_PLUGINS) {
  const names = pluginNames && pluginNames.length ? pluginNames : DEFAULT_PLUGINS;
  for (const name of names) {
    const factory = REGISTRY[name];
    if (!factory) {
      throw new Error(`未知插件: ${name}；可用: ${Object.keys(REGISTRY).join(', ')}`);
    }
    const plugin = factory({ types: t });
    traverse(ast, plugin.visitor);
  }
  return ast;
}

export function listPlugins() {
  return Object.keys(REGISTRY);
}

export function listDefaultPlugins() {
  return [...DEFAULT_PLUGINS];
}

export function listOptionalPlugins() {
  return [...OPTIONAL_PLUGINS];
}
