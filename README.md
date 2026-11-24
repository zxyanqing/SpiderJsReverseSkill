# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

Agent skills for Web/JS reverse workflows (Cursor / Codex / compatible hosts). Pick skills per task; do not require disabling others.

Maintainer: [John zxy](https://github.com/zxyanqing)

## Skills

### 1. `web-js-env-patcher`

Run original site JS locally, patch browser-environment gaps, validate against the real consumer.

- Entry: `web-js-env-patcher/SKILL.md` (agents: read **Agent 安装 / 首次使用前置** first)
- Derived/adapted from: https://github.com/lwjjike/xbsReverseSkill

### 2. `js-ast-deobfuscate`

Babel AST deobfuscation (scheme A REGISTRY + optional sample-scoped scheme B).

- Entry: `js-ast-deobfuscate/SKILL.md` (agents: read **Agent install / first-use gate** first)
- Runtime: `js-ast-deobfuscate/tools/deobfuscator`

## Agent: runtime deps (do this yourselves)

`node_modules` is **not** in git. After this repo is available to the agent host, install packages when the skill requires them.

```bash
REPO="<path-to-this-repo>"

# 1) js-ast-deobfuscate — REQUIRED before any pipeline
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator" && npm install

# 2) web-js-env-patcher — when DOM/jsdom examples or npm test are needed
cd "$REPO/web-js-env-patcher" && npm ci --ignore-scripts
```

Rules for agents:

- Missing `node_modules` / `Cannot find module 'jsdom'` / Babel resolve errors → install as above; do not treat as target-site failures.
- `web-js-env-patcher` without DOM may skip step 2; any jsdom example, milestone, or `npm test` must do step 2 first.
- Native addon / xbs binaries under `web-js-env-patcher/assets/` are optional per task/platform.

## Notes

- Research/engineering skills; follow each skill’s auth and online-guard rules.
- Tool green ≠ site acceptance.

## License

MIT © John zxy — see [LICENSE](./LICENSE).

`web-js-env-patcher` is adapted from https://github.com/lwjjike/xbsReverseSkill.
