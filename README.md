# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

**Agent skills for crawler engineers and learners of JavaScript reverse engineering.**  
For Cursor, Codex, and compatible hosts: run the site’s original JS that produces **Cookies, signatures, encrypted parameters, and dynamic tokens** under a **local Node environment patch**, and validate against the real consumer. When needed, use **AST deobfuscation** to make obfuscated samples inspectable.

Maintainer: [John zxy](https://github.com/zxyanqing)  
Current version: **v1.6.0**

---

## Why crawlers / JS reverse work need this

In Web crawling, the hard part is often not sending HTTP:

- Cookies, signs, and tokens are **computed in browser JS**
- Scripts check **DOM / fingerprint / async / Realm** — raw Node runs crash or diverge
- Heavy **obfuscation** hides entry points and call chains
- “A value was generated locally” ≠ **the API accepts it**

This repo ships two Agent-ready skills:

| You are stuck on… | Use | What it does |
| --- | --- | --- |
| Works in the browser; local run of original JS fails or is rejected | [`web-js-env-patcher`](web-js-env-patcher/SKILL.md) | **Environment patching**: keep original logic; repair DOM, Cookie, Storage, fingerprint reads, Realm, async, Worker, Wasm, etc.; accept only with consumer feedback |
| Obfuscation blocks reading structure / control flow / strings | [`js-ast-deobfuscate`](js-ast-deobfuscate/SKILL.md) | **AST deobfuscation**: Babel pipeline with evidence and guards; optional sample-scoped narrow runner |

Use them alone or together: **deobfuscate to find the entry → patch the environment → reproduce and verify locally**. You do not have to fully reverse an algorithm when a repeatable local path is enough.

---

## Keywords (search / match your task)

`crawler` · `web scraping` · `JavaScript reverse engineering` · `JS reverse` · `environment patching` · `jsdom` · `Cookie` · `signature` · `encrypted parameters` · `dynamic parameters` · `token` · `fingerprint` · `deobfuscation` · `AST` · `control-flow flattening` · `local reproduction` · `consumer acceptance`

Task types (analyze each sample; no promise that a fixed site/version passes out of the box):

| Scenario | How this repo helps |
| --- | --- |
| Env repair for **“某数”** generation 3 / 4 / 5 / 6–style scripts | Reproduce load, entry, browser checks, Cookie/state, async deps; run original JS locally and verify outputs |
| Env repair for **“某验”** encryption / parameter scripts | Locate DOM, fingerprint, object behavior, time/random deps; implement and re-verify |
| Env repair for **“某里”** encryption / parameter scripts | Trace init, env reads, event/async chains, Cookie/Storage and parameter consumption into a repeatable local path |
| Other browser-dependent Cookie / sign / token / request-parameter generators | Keep generation logic; fix env gaps; link inputs → env → output → consumer |
| SDK OK in browser, wrong or broken locally | Align env reads, state changes, and the consumer boundary |
| Obfuscation hides entry / call chain | Apply supported AST passes; deliver recovered source and residual reports |

> Names above describe **task types**, not a guarantee to bypass any commercial product. Completion follows the task’s acceptance criteria and real feedback.

---

## What’s in the repo

```text
SpiderJsReverseSkill/
├── web-js-env-patcher/     # Environment-patching skill (workflow, contracts, tools, runtimes, tests)
└── js-ast-deobfuscate/     # AST deobfuscation skill (REGISTRY, morphology, narrow-runner scaffold)
```

`web-js-env-patcher` is derived/adapted from [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill), with a stronger focus on general env-repair method, validation, and engineering assets.

---

## Getting started

### 1. Choose an entry

Expose the skill directory through your agent host’s normal skill-loading mechanism.

- Environment patching → [`web-js-env-patcher/SKILL.md`](web-js-env-patcher/SKILL.md) (read **Agent 安装 / 首次使用前置** first)
- AST deobfuscation → [`js-ast-deobfuscate/SKILL.md`](js-ast-deobfuscate/SKILL.md) (read **Agent install / first-use gate** first)

Provide: original JS/sample, known entry, browser-side observations, intended product & consumer, authorization scope. Unknowns can stay labeled unknown.

Example prompt:

> Use web-js-env-patcher on this authorized “某数” gen-6 sample. Original JS, entry, and browser request samples are provided. Run the original script locally, locate DOM / Cookie / fingerprint / async dependencies, produce the target output, verify under the given consumer conditions, and record what is verified vs unverified.

### 2. Install runtime deps as needed (Agent does this)

`node_modules` is **not** in git. Install before diagnosing the target when packages are missing.

```bash
REPO="/absolute/path/to/SpiderJsReverseSkill"

# Required before AST pipelines
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator" && npm install

# When DOM/jsdom paths or npm test are needed
cd "$REPO/web-js-env-patcher" && npm ci --ignore-scripts
```

- `Cannot find module 'jsdom'` / Babel resolve errors → setup issues, not “missing site APIs”.
- Non-DOM env tasks may skip jsdom.
- Native addon / xbs: optional per task and platform.

### 3. Optional local tool regressions

```bash
cd "$REPO/web-js-env-patcher" && npm test
```

Tool green ≠ site acceptance. Tasks still need the original script and consumer feedback. AST usage: [js-ast-deobfuscate/README.md](js-ast-deobfuscate/README.md).

---

## Interpreting results

- **Env patching**: report consumer acceptance / stability / authenticity separately; defaults in [`validation.md`](web-js-env-patcher/references/validation.md).
- **jsdom** covers supported DOM semantics; layout/graphics/device readings need task-specific work.
- **AST**: reports supported transforms and residuals; one run does not claim every obfuscation family.
- Use only on owned, explicitly authorized, or public practice targets; follow each skill’s online guards.

---

## Version history

### v1.6.0 — 2026-11-27: env reproducibility & evidence checks

Baseline `4144462` (2026-11-24). Focused on `web-js-env-patcher` (reproduction identity, integrated behavior, evidence lifecycle, Realm/Hook cleanup). Recorded: **162/162** tool tests, **11/11** independent acceptance tests. Scenario examples do not mean every site/version was accepted in this release.

### 2026-11-24: initial open-source baseline

First release of both skills, env tooling, and the bundled AST runtime.

---

## Acknowledgements and license

`web-js-env-patcher` is derived/adapted from [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill).

MIT © John zxy — see [LICENSE](LICENSE).
