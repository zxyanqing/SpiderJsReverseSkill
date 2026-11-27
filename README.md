# SpiderJsReverseSkill

[English](README.md) | [简体中文](README.zh-CN.md)

Agent skills for understanding JavaScript and reproducing the browser behavior it depends on. The repository provides task instructions, local tools, reference material, examples, and regression checks for Cursor, Codex, and compatible agent hosts.

Maintainer: [John zxy](https://github.com/zxyanqing)

Current version: **v1.6.0**.

## What this project does

The repository contains two skills that can be used independently or together:

| Skill | Purpose | Typical deliverables |
| --- | --- | --- |
| [`web-js-env-patcher`](web-js-env-patcher/SKILL.md) | Run original JavaScript locally, identify the browser contracts it actually uses, repair the relevant environment, and validate the result against its consumer. | A local entry point, environment implementation, fixtures, and evidence of the behavior tested. |
| [`js-ast-deobfuscate`](js-ast-deobfuscate/SKILL.md) | Use Babel AST transformations to make authorized JavaScript samples easier to inspect, with evidence and guards for each transformation. | Recovered source, transformation reports, residual analysis, and a sample-specific runner when justified. |

`web-js-env-patcher` starts from a task that already requires environment repair. It preserves the original target logic and works on dependencies such as DOM state, descriptors, prototypes, Cookies, Storage, asynchronous completion, Realm identity, Worker messages, and Wasm loading. The implementation depth follows the target's observed dependencies.

`js-ast-deobfuscate` starts with registered general transformations, examines what remains, and may then use a guarded runner scoped to the sample. It records unsupported shapes and remaining uncertainty. The two skills do not require disabling each other, and environment repair does not require deobfuscation first.

## Application scenarios

Use these skills with self-built code, explicitly authorized samples, or public practice targets, following each skill's scope.

| Situation | How the repository helps |
| --- | --- |
| An SDK runs in the browser but fails locally or produces different results. | Locate the environment reads, state transitions, and consumer boundary, then implement and check the relevant contracts. |
| APIs exist, but descriptors, prototypes, DOM state, or iframe object identity differ. | Investigate observable object behavior and ownership across Realms, and verify the integrated environment. |
| Promise, timer, event, Worker, or Wasm behavior affects completion. | Observe the actual completion boundary and repair the dependency used by the target. |
| A script, fixture, backend, or environment patch changes during maintenance. | Associate resource hashes with runtime, fixture, configuration, and patch identities to make experiments traceable. |
| An authorized sample is difficult to inspect because of obfuscated expressions or control flow. | Apply supported AST passes, review residuals, and produce source and reports for further analysis. |
| A maintainer needs regression evidence or wants to compare skill revisions. | Use fixed-source SDK cases and environment-repair evaluation assets, keeping tool correctness and Agent effectiveness as separate measurements. |

## Getting started

### Choose an entry point

Make the desired skill directory available through your agent host's skill-loading mechanism. The entry points are:

- Environment repair: [`web-js-env-patcher/SKILL.md`](web-js-env-patcher/SKILL.md). Read **Agent 安装 / 首次使用前置** before using its tools.
- AST deobfuscation: [`js-ast-deobfuscate/SKILL.md`](js-ast-deobfuscate/SKILL.md). Read **Agent install / first-use gate** before running a pipeline.

Provide the available script or sample, the entry point if known, the observed difference, the intended consumer or output, and the verification conditions. Unknown items can remain explicitly unknown while work continues on the available evidence.

For example, an environment-repair task can state:

> This authorized SDK works in the browser but fails locally. Run the original script, identify and repair its DOM, Cookie, and asynchronous dependencies, and verify the output with the supplied test consumer. Record what was tested and what remains unverified.

### Install dependencies as needed

`node_modules` is not committed. The Agent should install the packages required by the selected skill. `web-js-env-patcher` declares Node.js 18 or later; the AST runtime uses Node.js ESM and Babel dependencies.

```bash
REPO="/absolute/path/to/SpiderJsReverseSkill"

# Required before AST pipelines, detection, or fixture runs
cd "$REPO/js-ast-deobfuscate/tools/deobfuscator"
npm install

# Required for DOM/jsdom examples, SDK cases, or environment tool tests
cd "$REPO/web-js-env-patcher"
npm ci --ignore-scripts
```

Missing `node_modules`, `Cannot find module 'jsdom'`, or Babel resolution errors are setup problems to resolve before diagnosing the target. A non-DOM environment task may skip jsdom installation. Native addons and xbs assets are selected according to the task, platform, and ABI; they are not prerequisites for every task.

### Local examples and checks

Run environment tool regressions from the skill directory:

```bash
cd "$REPO/web-js-env-patcher"
npm test
```

For the fixed-source SDK case, choose a new absolute output directory whose parent already exists. Preparation downloads and checks pinned public assets; the local case does not require an external MCP service.

```bash
node cases/fingerprintjs-local/prepare.mjs --output /absolute/work/fp-assets-001
node cases/fingerprintjs-local/run-local.mjs --assets /absolute/work/fp-assets-001
```

See the [case instructions](web-js-env-patcher/cases/fingerprintjs-local/README.md) for dependencies, failure injections, and the simulation boundary. For AST usage and regression commands, see the [AST README](js-ast-deobfuscate/README.md) and [command reference](js-ast-deobfuscate/references/commands.md).

## Repository layout

```text
SpiderJsReverseSkill/
├── README.md / README.zh-CN.md
├── web-js-env-patcher/
│   ├── SKILL.md                 Environment-repair workflow
│   ├── references/              Contracts, evidence, validation, and delivery
│   ├── scripts/                 Diagnosis, preparation, and verification tools
│   ├── assets/                  Runtime backends, examples, and optional addons
│   ├── cases/                   Fixed-source real SDK cases
│   ├── evals/                   Environment-repair Agent evaluation assets
│   └── tests/                   Tool and behavior regressions
└── js-ast-deobfuscate/
    ├── SKILL.md                 AST workflow and transformation rules
    ├── references/              Capability matrix and morphology references
    ├── scripts/                 Round runner, analysis, and narrow-runner scaffold
    ├── evals/                   AST skill evaluation definitions
    └── tools/deobfuscator/      Babel runtime, registered passes, and fixtures
```

## Cases, evaluations, and open-source distribution

[`cases/`](web-js-env-patcher/cases/README.md) checks environment combinations using a small number of fixed-source real SDKs. The current case pins FingerprintJS 5.2.0 by source commit and archive hashes, loads it in a jsdom page Realm, and checks asynchronous completion, component errors, iframe function/object ownership, and host cleanup. The case includes local shims; its result describes that local simulation.

[`evals/`](web-js-env-patcher/evals/README.md) supports maintenance-time evaluation of whether an Agent can diagnose, repair, and verify environment defects. It includes seven scenarios, runnable workspaces, scorer-side fault information, versioned scoring rules, and a revision-comparison protocol. It is not a prerequisite for ordinary environment-repair tasks, and a complete automated Agent execution and scheduling system is not part of this delivery.

For evaluation runs, use the documented [isolated launcher](web-js-env-patcher/evals/isolation.md). The current launcher uses macOS Seatbelt through `sandbox-exec`; staging files or changing the working directory alone does not establish isolation. Other platforms need a separately implemented and verified isolation path.

Keep case and evaluation source assets, their supporting scripts, tests, and reference documents in Git. Downloaded upstream archives, vendor trees, `node_modules`, caches, and run outputs should stay outside the repository or under explicit ignore rules. A reduced installation package may omit maintenance assets if its references and advertised capabilities are adjusted accordingly.

`evals/hidden/` means scorer-only during an evaluation run. When committed to a public repository, it is public regression material. A separate private holdout set is appropriate when an evaluation needs questions and answers that have not been published.

## Version history

### v1.6.0 — 2026-11-27: environment reproducibility and evaluation

This release focuses on `web-js-env-patcher`. The comparison baseline is the previous committed revision, `4144462` dated 2026-11-24. The repository version and Git tag are `v1.6.0`; `js-ast-deobfuscate` has no code changes in this release.

| Area | Previous revision | Improvements in this update |
| --- | --- | --- |
| Reproduction identity | Resource hashes, fixture sources, and change records already existed. | Extend the existing resource manifest with separate runtime, fixture, configuration, and environment-patch identities. New case templates include this structure; old cases remain compatible. |
| Real SDK coverage | Validation primarily used tool tests and synthetic examples. | Add the fixed-source FingerprintJS case, preparation and hash checks, page-Realm execution, and meaningful failure injections. |
| Agent evaluation assets | Evaluation principles existed without a comparable reusable environment-repair scenario package. | Add seven scenarios, process/formal-path scoring gates, scorer-side materials, and a protocol for comparing revisions. |
| Evaluation preparation and isolation | No equivalent evaluation preparation and isolation toolchain was included. | Add separate Agent/skill copies, byte-based content identity and rebuild checks, and a macOS launcher tested against answer reads through main processes, children, and symlinks, including external temporary directories. |
| Evidence validity | Browser evidence and Hook lifecycle rules were mainly documented. | Add programmable lifecycle checks. Unknown context, count, window, or truncation state cannot prove absence of calls; cross-context reuse requires explicit structured permission. |
| Realm and cleanup regressions | Hook and integration checks existed. | Add page/child Realm function and object checks, host-pollution counterexamples, incomplete-control rejection, and actual per-Realm Hook uninstall verification. |

Validation recorded for this update: **162/162 environment tool tests passed**, plus **11/11 independent acceptance tests**, including the previous six counterexamples. The independent checks also exercised 1,458 structured-permission combinations and content rebuilds. These figures describe the verified implementation; an old/new Agent effectiveness comparison has not yet been performed.

### 2026-11-24 — initial open-source baseline

The initial release, `20fcb28`, provided the two skills, the environment tools and reference material, and the bundled AST runtime and regression fixtures. Subsequent README updates led to baseline `4144462`.

## Interpreting results

- A tool test or SDK simulation passing proves only the behavior covered by that check. Consumer acceptance, stability, and data authenticity are reported separately under the environment skill's [validation rules](web-js-env-patcher/references/validation.md).
- jsdom provides supported DOM semantics; layout, graphics, device readings, and other capabilities need task-specific implementations or evidence.
- An AST transformation report describes supported transformations and residuals. A successful run does not promise complete recovery of every obfuscation scheme.
- Follow the authorization and online-operation rules in each skill. Missing evidence remains unverified in the final delivery.

## Acknowledgements and license

`web-js-env-patcher` is derived/adapted from [lwjjike/xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill). Fixed-source cases record upstream identity and notices alongside their preparation instructions.

MIT © John zxy — see [LICENSE](LICENSE).
