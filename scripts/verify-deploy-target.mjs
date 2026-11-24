/**
 * KHADMA V1.4 — Fail-Closed Deployment Target Guard (Phase 6A)
 *
 * Verifies that any future staging or production deployment explicitly specifies
 * `--target=staging|production` and `--project=<projectId>`, matches `.firebaserc`,
 * and NEVER leaks emulator flags or cross-environment identifiers.
 *
 * Read-only validation script: never executes deployments or mutates cloud resources.
 */
import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_TARGETS = new Set(['staging', 'production']);

export function verifyDeployTarget({ target, projectId, firebasercProjects, env = {} }) {
  const errors = [];

  if (!target || !ALLOWED_TARGETS.has(target)) {
    errors.push(`Invalid or missing --target (expected "staging" or "production", got "${target ?? ''}").`);
  }
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    errors.push('Missing --project identifier.');
  }
  if (projectId && projectId.startsWith('demo-')) {
    errors.push(`Refusing to deploy to demo emulator project "${projectId}".`);
  }

  const expectedProject = target ? firebasercProjects?.[target] : undefined;
  if (target && !expectedProject) {
    errors.push(`Target "${target}" is not defined in .firebaserc.`);
  }
  if (expectedProject && projectId && expectedProject !== projectId) {
    errors.push(
      `Project mismatch: target "${target}" maps to "${expectedProject}" in .firebaserc, but --project="${projectId}" was supplied.`
    );
  }

  if (env.VITE_USE_EMULATORS === 'true') {
    errors.push('Refusing to deploy with VITE_USE_EMULATORS=true.');
  }
  if (target === 'production' && env.VITE_FIREBASE_ENV && env.VITE_FIREBASE_ENV !== 'production') {
    errors.push(`Production deploy cannot use VITE_FIREBASE_ENV="${env.VITE_FIREBASE_ENV}".`);
  }
  if (target === 'staging' && env.VITE_FIREBASE_ENV && env.VITE_FIREBASE_ENV !== 'staging') {
    errors.push(`Staging deploy cannot use VITE_FIREBASE_ENV="${env.VITE_FIREBASE_ENV}".`);
  }
  if (target === 'production' && env.VITE_FIREBASE_PROJECT_ID === firebasercProjects?.staging) {
    errors.push('Production deploy cannot embed staging project ID.');
  }
  if (target === 'staging' && env.VITE_FIREBASE_PROJECT_ID === firebasercProjects?.production) {
    errors.push('Staging deploy cannot embed production project ID.');
  }

  return { ok: errors.length === 0, errors, target, projectId };
}

// CLI entrypoint when invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const idx = a.indexOf('=');
        return idx === -1 ? [a.slice(2), 'true'] : [a.slice(2, idx), a.slice(idx + 1)];
      })
  );
  const rc = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '.firebaserc'), 'utf8'));
  const result = verifyDeployTarget({
    target: args.target,
    projectId: args.project,
    firebasercProjects: rc.projects,
    env: process.env
  });
  if (!result.ok) {
    console.error('DEPLOY GUARD BLOCKED:\n- ' + result.errors.join('\n- '));
    process.exit(1);
  }
  console.log(`DEPLOY GUARD PASSED: target=${result.target} project=${result.projectId}`);
}
