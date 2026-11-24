import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_PROJECT_ID,
  resolveFirebaseRuntimeConfig,
  STAGING_PROJECT_ID
} from '../../src/lib/firebaseConfig';
import { verifyDeployTarget } from '../../scripts/verify-deploy-target.mjs';

describe('Phase 6A — Environment Isolation & Fail-Closed Deployment Guard', () => {
  it('prevents production builds from using emulators or staging project IDs', () => {
    const prod = resolveFirebaseRuntimeConfig({
      PROD: true,
      VITE_USE_EMULATORS: 'true', // MUST be ignored in PROD build!
      VITE_FIREBASE_ENV: 'production',
      VITE_FIREBASE_API_KEY: 'prod-key'
    });
    expect(prod.useEmulators).toBe(false);
    expect(prod.targetEnv).toBe('production');
    expect(prod.config.projectId).toBe(PRODUCTION_PROJECT_ID);

    expect(() =>
      resolveFirebaseRuntimeConfig({
        PROD: true,
        VITE_FIREBASE_ENV: 'production',
        VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT_ID,
        VITE_FIREBASE_API_KEY: 'key'
      })
    ).toThrow(/cannot target non-production project/i);

    expect(() =>
      resolveFirebaseRuntimeConfig({
        PROD: true,
        VITE_FIREBASE_ENV: 'staging',
        VITE_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID,
        VITE_FIREBASE_API_KEY: 'key'
      })
    ).toThrow(/Staging build cannot target production/i);
  });

  it('requires demo-* projectId for emulator mode and isolates staging cleanly', () => {
    const emu = resolveFirebaseRuntimeConfig({
      PROD: false,
      VITE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-khadma'
    });
    expect(emu.useEmulators).toBe(true);
    expect(emu.targetEnv).toBe('emulator');
    expect(emu.config.projectId).toBe('demo-khadma');

    expect(() =>
      resolveFirebaseRuntimeConfig({
        PROD: false,
        VITE_USE_EMULATORS: 'true',
        VITE_FIREBASE_PROJECT_ID: PRODUCTION_PROJECT_ID
      })
    ).toThrow(/requires a demo-\* projectId/i);

    const staging = resolveFirebaseRuntimeConfig({
      PROD: true,
      VITE_FIREBASE_ENV: 'staging',
      VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT_ID,
      VITE_FIREBASE_API_KEY: 'staging-key',
      VITE_FIREBASE_APP_ID: '1:999:web:staging'
    });
    expect(staging.targetEnv).toBe('staging');
    expect(staging.config.projectId).toBe(STAGING_PROJECT_ID);
  });

  it('enforces fail-closed deploy target guard and removes accidental .firebaserc default alias', () => {
    const rc = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), '.firebaserc'), 'utf8')
    ) as { projects: Record<string, string> };

    // No accidental default alias that could trigger bare `firebase deploy` to production
    expect(rc.projects.default).toBeUndefined();
    expect(rc.projects.staging).toBe(STAGING_PROJECT_ID);
    expect(rc.projects.production).toBe(PRODUCTION_PROJECT_ID);

    // Valid staging & production checks
    expect(
      verifyDeployTarget({
        target: 'staging',
        projectId: STAGING_PROJECT_ID,
        firebasercProjects: rc.projects,
        env: { VITE_FIREBASE_ENV: 'staging' }
      }).ok
    ).toBe(true);

    expect(
      verifyDeployTarget({
        target: 'production',
        projectId: PRODUCTION_PROJECT_ID,
        firebasercProjects: rc.projects,
        env: { VITE_FIREBASE_ENV: 'production' }
      }).ok
    ).toBe(true);

    // Missing / mismatched / emulator / cross-env checks MUST fail closed
    expect(
      verifyDeployTarget({ target: '', projectId: PRODUCTION_PROJECT_ID, firebasercProjects: rc.projects }).ok
    ).toBe(false);
    expect(
      verifyDeployTarget({
        target: 'staging',
        projectId: PRODUCTION_PROJECT_ID,
        firebasercProjects: rc.projects
      }).ok
    ).toBe(false);
    expect(
      verifyDeployTarget({
        target: 'production',
        projectId: PRODUCTION_PROJECT_ID,
        firebasercProjects: rc.projects,
        env: { VITE_USE_EMULATORS: 'true' }
      }).ok
    ).toBe(false);
    expect(
      verifyDeployTarget({
        target: 'production',
        projectId: PRODUCTION_PROJECT_ID,
        firebasercProjects: rc.projects,
        env: { VITE_FIREBASE_PROJECT_ID: STAGING_PROJECT_ID }
      }).ok
    ).toBe(false);

    // CI workflow must never contain automated deployment commands
    const ciSrc = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    );
    expect(ciSrc).not.toMatch(/firebase\s+deploy/i);
  });
});
