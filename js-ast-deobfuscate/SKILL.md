---
name: js-ast-deobfuscate
description: >-
  Deobfuscates JavaScript via Babel AST: run the bundled REGISTRY (scheme A)
  including structure normalize, dispatcher inline, if-chain→switch, proven
  array-order flatten, object-ref state normalization, concat-decoy cleanup,
  and for/while linear state restore; F1 family detect+docs+recipes (no auto
  site passes); analyze morphology; when A hits gaps generate a sample-scoped
  narrow runner (scheme B) with child-process eval and fail-closed guards.
  Optional rename-identifiers is never default. Use whenever the user asks to
  deobfuscate JS, restore obfuscated code, run AST passes, flatten control
  flow, decode string arrays, normalize Dd()/object-identity state tables,
  clean decrypt shells, fold constants, detect geetest4/dingxiang/yidun-like
  families, analyze obfuscation shape, or generate a specialized
  deobfuscation script—even if they only paste obfuscated.js without saying
  "skill".
compatibility: >-
  Requires Node.js ESM. Runtime is bundled at tools/deobfuscator.
  Agent must run npm install once under tools/deobfuscator before any
  pipeline; node_modules is not shipped in the repo.
---

# JS AST Deobfuscate

Authorize/self-built samples only.

## Agent install / first-use gate

Repo does **not** ship `node_modules`. Once this skill is available to the agent, before **any** scheme A/B run, detect, or fixture pipeline:

1. `cd` to this skill’s `tools/deobfuscator`.
2. If `node_modules` is missing, run `npm install` (agent does this; do not ask the user to do it first).
3. Only then invoke REGISTRY / scripts. Treat `Cannot find module` from this runtime as a setup miss, not a deobfuscation failure.

**Skill root:** this repository.  
**Runtime A:** `tools/deobfuscator` REGISTRY.  
**Evidence:** `references/capability-matrix.md`  
**A→B playbook:** `references/morphology-to-narrow.md`  
**Narrow scaffold:** `scripts/scaffold-narrow-runner.mjs`

## Goal

1. Reach the best **safely** recoverable source under **scheme A** (registered plugins).
2. If residuals remain, **analyze the sample’s dominant morphology** with evidence.
3. When morphology is clear and A cannot close it, **generate and run a sample-scoped scheme B narrow script** (not a one-off Visitor pasted into chat), then produce `best.js` + report.

**Optimal** means: A converged **and** either residuals are closed by B, or B is refused with an evidence-backed stop. Not “rename until pretty.”

## Two schemes (why both)

| Scheme | What | When |
|--------|------|------|
| **A · 通用** | REGISTRY plugins only | Always run first |
| **B · 窄形态** | Sample-scoped runner under `narrow/<id>/` | After A: dominant gap morphology proven; user wants further restore |

B **references A’s safety ideas** (Binding evidence, child-process eval, type whitelist, fail-closed, no browser fabrication). B does **not** copy unsafe in-process `eval` from third-party gist scripts.

## Hard rules

1. **Compliance first**: only self-built, explicitly authorized, or public practice targets. Otherwise stop.
2. **A rounds: no live REGISTRY codegen**: do not invent new plugins into `src/plugins` each round. Compose from the matrix.
3. **B is allowed only after A**: generate a **narrow runner file** (see playbook), not an anonymous Visitor in the chat transcript.
4. **Evidence or skip**: features and morphologies need path/shape/binding notes.
5. **Failure-close**: no guessing env values; **no main-process `eval`** of decryptors (use `evaluate-in-child` / spawn).
6. **Do not auto-promote B into REGISTRY** unless the user explicitly asks to generalize it.

## Pipeline (follow exactly)

```text
input: obfuscated.js
  → [0] compliance → else STOP
  → [A] scheme-A loop (maxRounds default 5):
       identify → select REGISTRY plugins → run-round → converge / residuals
  → [M] morphology analysis on best-so-far + original
       write morphology.json (dominant shapes + evidence + mapped gaps)
  → [F] family reference (F1): detect-family → docs/recipe only
       write family.json；不自动跑站点 pass；配方指导 A 重跑或 B
  → [B] if residuals block the user’s goal AND morphology is actionable:
       scaffold/generate narrow/<id>/runner.mjs (+ notes.md；优先参考 F1 hints)
       run narrow runner → merge into best.js
       if B cannot be proven → STOP with gaps (do not fake success)
  → output: best.js + total report (A + morphology + family + metrics + B if any)
```

## Step details

### [0] Compliance

Ask or infer provenance. Unauthorized third-party production JS: **stop**.

### [A] Scheme A (REGISTRY)

Identify features (matrix ids). Write `pipeline.roundN.json`. Execute:

```bash
node scripts/run-round.mjs \
  --in <input.js> --out <output.js> \
  --plugins a,b,c --report <roundN.report.json>
```

Only **implemented** registry names. Details: `references/commands.md`.

Default safe list when user asks for “full A” (`DEFAULT_PLUGINS`，**不含** `rename-identifiers`)：

`normalize-structure,literal-string,constant-fold,const-propagate,inline-literals,static-array,object-map,inline-dispatchers,dead-branch,string-decrypt-chain,normalize-object-ref-state,unused-binding,cleanup-concat-decoy,member-simplify,if-chain-to-switch,flatten-array-control-flow,restore-sequential-dispatcher,restore-explicit-state-machine,restore-for-switch-state,remove-debugger`

可选（显式加入 `--plugins`）：`rename-identifiers`。大样本可按家族配方跳过 `inline-literals`。

### [M] Morphology analysis (always after A if residuals)

Read `references/morphology-to-narrow.md`. Emit `morphology.json`:

```json
{
  "sample_id": "gcaptcha4",
  "dominant": [
    {
      "morphology_id": "encoded-bootstrap-dispatcher",
      "evidence": ["Program prologue decodeURI/XOR", "for(;state;) switch(state)", "$_fn(n) call sites ~10k"],
      "a_gap": "geetest-like-xor-string",
      "b_actionable": true,
      "confidence": "high"
    }
  ],
  "secondary": [],
  "recommend": "generate-narrow"
}
```

Classify using playbook table. Prefer **one dominant** B target per iteration.

### [F] Family reference (F1)

After M (or in parallel when path/hint already known):

```bash
node scripts/detect-family.mjs <input-or-best.js> [hint] family.json
```

- Reads `scripts/family-registry.mjs` + `references/families/*.md`
- Outputs `bestId` / scores / recommended `a_plugins` / `b_scaffold_hints`
- **Does not** auto-run site-specific passes
- If family recipe differs from the A plugins already used, optionally re-run A with `a_plugins` before B

### [B] Narrow runner generation

When `recommend` is `generate-narrow` (or user asks to continue past A gaps):

1. Create `narrow/<sample_id>/` (next to outputs or under Skill root `narrow/`).
2. Prefer scaffolding:

```bash
node scripts/scaffold-narrow-runner.mjs \
  --id <sample_id> --morphology <morphology_id> --out-dir narrow/<sample_id>
```

3. Fill `runner.mjs` using playbook template for that `morphology_id`, **adapting only proven bindings/shapes from this sample**.
4. Hard requirements for every B runner:
   - ESM; reads `--in` / `--out` CLI args
   - Uses `@babel/*` like A
   - Decrypt / table init via **child process** (reuse `tools/deobfuscator/src/lib/evaluate-in-child.js` when possible)
   - Skip / exit non-zero on failed guards; never silent wrong rewrite
5. Run B → write `best.js`. Record `narrow/<id>/notes.md` (what was assumed).
6. If morphology confidence is low: **do not generate B**; list what evidence is missing.

### Report structure

```markdown
# Deobfuscation report
## Compliance
## Scheme A
### Round N
- features + evidence
- plugins + reasons
- changed / gaps
## Morphology
- dominant / secondary + evidence
- recommend: stop | generate-narrow
## Scheme B (if any)
- morphology_id, runner path, guards
- changed / failures
## Residuals
## Outputs
- best.js
- morphology.json
- narrow/... (optional)
```

## Decision order

1. A static plugins  
2. A `string-decrypt-chain` (numeric array + child eval)  
3. A `normalize-object-ref-state`（对象身份表 → 数字 id）  
4. A `cleanup-concat-decoy`（解密后死壳）  
5. A sequential / linear state restore（含 `restore-for-switch-state`）  
6. Morphology → B narrow runner if actionable（如仍需样本专用 XOR 引导表）  
7. Env stub / browser → stop or handoff (stage 9); do not fabricate  

## Do not

- Claim full browser/`fetch`/Cookie replay from Node AST passes  
- Treat identifier renaming as success  
- Enable personal REGISTRY plugins not in the matrix without user ask  
- Unlimited A rounds (`maxRounds = 5` default)  
- Paste third-party `eval`-heavy scripts into the main tool process  
- Generate B that only works by ignoring guards “to match an ideal file”
