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

## Agent: install skill + deps (do this yourselves)

`node_modules` is **not** in git. Symlink/copy is only discovery; run package installs when the skill requires them.

```bash
REPO="<path-to-this-repo>"

# 1) Discoverable install (host skills dir)
ln -sfn "$REPO/web-js-env-patcher" "$HOME/.cursor/skills/web-js-env-patcher"
ln -sfn "$REPO/js-ast-deobfuscate" "$HOME/.cursor/skills/js-ast-deobfuscate"
# Codex example:
# ln -sfn "$REPO/web-js-env-patcher" "$HOME/.codex/skills/web-js-env-patcher"
# ln -sfn "$REPO/js-ast-deobfuscate" "$HOME/.codex/skills/js-ast-deobfuscate"

# 2) js-ast-deobfuscate — REQUIRED before any pipeline
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator" && npm install

# 3) web-js-env-patcher — when DOM/jsdom examples or npm test are needed
cd "$REPO/web-js-env-patcher" && npm ci --ignore-scripts
```

Rules for agents:

- Softlink alone ≠ runtime ready.
- Missing `node_modules` / `Cannot find module 'jsdom'` / Babel resolve errors → install as above; do not treat as target-site failures.
- `web-js-env-patcher` without DOM may skip step 3; any jsdom example, milestone, or `npm test` must do step 3 first.
- Native addon / xbs binaries under `web-js-env-patcher/assets/` are optional per task/platform.

## Notes

- Research/engineering skills; follow each skill’s auth and online-guard rules.
- Tool green ≠ site acceptance.

## License

MIT © John zxy — see [LICENSE](./LICENSE).

`web-js-env-patcher` is adapted from https://github.com/lwjjike/xbsReverseSkill.
