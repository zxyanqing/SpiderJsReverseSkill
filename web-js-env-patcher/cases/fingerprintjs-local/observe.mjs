'use strict';

/**
 * Declared consumer observations for fingerprintjs-local.
 * Passing here is a LOCAL simulation signal only — never website acceptance.
 *
 * Declared env contracts (this case):
 * - SDK load/get functions must belong to the jsdom page Realm (not Node host).
 * - Media-query / matchMedia-backed components must not silently succeed with errors;
 *   component error name+message must be retained and fail observation.
 */

import { evaluateE09Problems } from './lib/e09-iframe-realm.mjs';

export const EXPECTED_VERSION = '5.2.0';

/** Components whose errors are covered by this case's consumer contract. */
export const COVERED_COMPONENT_ERROR_HINTS = [
  'matchMedia',
  'screen',
];

/**
 * @param {object} input
 * @param {string|null} input.loadedVersion
 * @param {object|null} input.result
 * @param {boolean} input.completionReached
 * @param {string|null} input.error
 * @param {string} [input.mode]
 * @param {string} [input.loadPath]
 * @param {object} [input.realm]
 * @param {Array<{component:string,name?:string,message?:string}>} [input.componentErrors]
 */
export function observeConsumer(input) {
  const problems = [];
  const mode = input.mode || 'baseline';

  if (!input.completionReached) {
    problems.push({
      code: 'callback-incomplete',
      detail: 'load()/get() completion signal not reached',
    });
  }

  if (input.loadedVersion != null || input.completionReached) {
    if (input.loadedVersion !== EXPECTED_VERSION) {
      problems.push({
        code: 'resource-version-mismatch',
        detail: `expected SDK version ${EXPECTED_VERSION}, got ${JSON.stringify(input.loadedVersion)}`,
      });
    }
  }

  if (input.error) {
    problems.push({
      code: 'runtime-error',
      detail: String(input.error),
    });
  }

  const result = input.result;
  if (input.completionReached && !input.error) {
    if (!result || typeof result !== 'object') {
      problems.push({ code: 'missing-result', detail: 'no agent result object' });
    } else {
      if (typeof result.visitorId !== 'string' || result.visitorId.length === 0) {
        problems.push({ code: 'missing-visitorId', detail: 'visitorId missing or empty' });
      }
      if (!result.components || typeof result.components !== 'object') {
        problems.push({ code: 'missing-components', detail: 'components missing' });
      }
      // Must retain error/capability detail — name-only lists are not enough.
      if (
        result.componentDetails == null &&
        Array.isArray(input.componentErrors) === false
      ) {
        problems.push({
          code: 'component-details-missing',
          detail: 'component error/capability details were not retained',
        });
      }
    }
  }

  // Realm contract: page-script path must show page Realm for BOTH load() and get().
  const loadRealm = input.realm && input.realm.load;
  const getRealm = input.realm && input.realm.get;
  const loadPath = input.loadPath || 'page-script';
  if (mode === 'host-require-realm' || loadPath === 'host-require') {
    problems.push({
      code: 'realm-mismatch',
      detail: 'SDK loaded via host require; functions are not page-Realm',
    });
  } else if (input.completionReached && !input.error) {
    if (!loadRealm) {
      problems.push({
        code: 'realm-evidence-missing',
        detail: 'no realm.load probe on completed run',
      });
    } else if (loadRealm.inPageRealm !== true || loadRealm.inHostRealm === true) {
      problems.push({
        code: 'realm-mismatch',
        detail: `SDK load not in page Realm (inPage=${loadRealm.inPageRealm}, inHost=${loadRealm.inHostRealm})`,
      });
    }
    if (!getRealm) {
      problems.push({
        code: 'realm-get-evidence-missing',
        detail: 'no realm.get probe on completed run',
      });
    } else if (getRealm.inPageRealm !== true || getRealm.inHostRealm === true) {
      problems.push({
        code: 'realm-get-mismatch',
        detail: `SDK get not in page Realm (inPage=${getRealm.inPageRealm}, inHost=${getRealm.inHostRealm})`,
      });
    }
  } else if (input.completionReached && mode !== 'incomplete-callback' && input.error) {
    // Error path: load probe helpful if present; get may be absent.
    if (loadRealm && (loadRealm.inPageRealm !== true || loadRealm.inHostRealm === true)) {
      problems.push({
        code: 'realm-mismatch',
        detail: `SDK load not in page Realm (inPage=${loadRealm.inPageRealm}, inHost=${loadRealm.inHostRealm})`,
      });
    }
  }

  // Component errors: never silently ok.
  const compErrors = Array.isArray(input.componentErrors)
    ? input.componentErrors
    : result && result.componentDetails
      ? Object.entries(result.componentDetails)
          .filter(([, d]) => d && d.status === 'error')
          .map(([component, d]) => ({
            component,
            name: d.error && d.error.name,
            message: d.error && d.error.message,
          }))
      : [];

  for (const ce of compErrors) {
    const msg = ce.message != null ? String(ce.message) : '';
    const covered = COVERED_COMPONENT_ERROR_HINTS.some((h) => msg.includes(h));
    // Always record; covered env gaps must fail. Unknown component errors also fail
    // so they cannot be collapsed into a silent name list.
    problems.push({
      code: 'component-error',
      detail: `${ce.component}: ${ce.name || 'Error'}: ${msg}`,
      component: ce.component,
      covered,
    });
  }

  // E09: iframe + cross-Frame Realm (completed page-script / collapse injection).
  if (input.completionReached && !input.error) {
    const skipE09 =
      mode === 'incomplete-callback' ||
      mode === 'wrong-resource-version' ||
      mode === 'wrong-prototype';
    if (!skipE09) {
      problems.push(...evaluateE09Problems(input.e09, input.host, input.loadPath || 'page-script'));
    }
  }

  if (input.websiteAccepted === true) {
    problems.push({
      code: 'forbidden-website-accepted',
      detail: 'local simulation must not set websiteAccepted=true',
    });
  }

  return {
    mode,
    ok: problems.length === 0,
    problems,
    localSimulationOnly: true,
    websiteAccepted: false,
    note: '本地模拟通过 ≠ 真实网站接受；不得推导风控绕过率',
  };
}
