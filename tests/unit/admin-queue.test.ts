import { describe, expect, it } from 'vitest';
import { createAdminQueueController, type AdminQueueData } from '../../src/lib/adminQueue';
import type { Gig } from '../../src/lib/types';

function makeGig(id: string, flags = 0): Gig {
  return {
    id,
    title: `Gig ${id}`,
    description: 'Test description',
    category: 'digital',
    payMin: 1000,
    payMax: 1500,
    neighborhood: 'Bir El Djir',
    posterUid: 'uid-1',
    flags,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: null
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(
  fetchQueue: () => Promise<AdminQueueData>,
  fetchHasSamples: () => Promise<boolean> = async () => false
) {
  const state = {
    latest: null as Gig[] | null,
    flagged: null as Gig[] | null,
    samples: false,
    notice: '',
    busy: false,
    writes: 0
  };

  const controller = createAdminQueueController({
    fetchQueue,
    fetchHasSamples,
    onLatest: (v) => {
      state.latest = v;
      state.writes += 1;
    },
    onFlagged: (v) => {
      state.flagged = v;
      state.writes += 1;
    },
    onSamples: (v) => {
      state.samples = v;
      state.writes += 1;
    },
    onNotice: (v) => {
      state.notice = v;
      state.writes += 1;
    },
    onBusy: (v) => {
      state.busy = v;
      state.writes += 1;
    },
    getErrorMessage: () => 'Sar mochkil. Jarreb men 9bel.'
  });

  return { state, controller };
}

describe('Admin queue refresh lifecycle & race protection', () => {
  it('clears a previous error message when a subsequent refresh succeeds', async () => {
    let shouldFail = true;
    const g1 = makeGig('g1', 1);
    const { state, controller } = createHarness(async () => {
      if (shouldFail) throw new Error('transient failure');
      return { latest: [g1], flagged: [g1] };
    });

    await controller.refresh();
    expect(state.notice).toBe('Sar mochkil. Jarreb men 9bel.');

    shouldFail = false;
    await controller.refresh();
    expect(state.notice).toBe('');
    expect(state.flagged?.map((g) => g.id)).toEqual(['g1']);
    expect(state.latest?.map((g) => g.id)).toEqual(['g1']);
  });

  it('displays an error message when the latest refresh genuinely fails', async () => {
    const { state, controller } = createHarness(async () => {
      throw new Error('network error');
    });

    await controller.refresh();
    expect(state.notice).toBe('Sar mochkil. Jarreb men 9bel.');
  });

  it('prevents an older failed request from overwriting newer successful results', async () => {
    const first = deferred<AdminQueueData>();
    const second = deferred<AdminQueueData>();
    const calls = [first.promise, second.promise];
    let idx = 0;

    const { state, controller } = createHarness(() => calls[idx++]!);

    const p1 = controller.refresh();
    const p2 = controller.refresh();

    const gNew = makeGig('g-new', 1);
    second.resolve({ latest: [gNew], flagged: [gNew] });
    await p2;

    expect(state.notice).toBe('');
    expect(state.flagged?.map((g) => g.id)).toEqual(['g-new']);

    first.reject(new Error('stale failure'));
    await p1;

    expect(state.notice).toBe('');
    expect(state.flagged?.map((g) => g.id)).toEqual(['g-new']);
  });

  it('prevents an older successful request from overwriting newer results', async () => {
    const first = deferred<AdminQueueData>();
    const second = deferred<AdminQueueData>();
    const calls = [first.promise, second.promise];
    let idx = 0;

    const { state, controller } = createHarness(() => calls[idx++]!);

    const p1 = controller.refresh();
    const p2 = controller.refresh();

    const gNew = makeGig('g-new', 2);
    const gOld = makeGig('g-old', 1);

    second.resolve({ latest: [gNew], flagged: [gNew] });
    await p2;

    first.resolve({ latest: [gOld], flagged: [gOld] });
    await p1;

    expect(state.flagged?.map((g) => g.id)).toEqual(['g-new']);
    expect(state.latest?.map((g) => g.id)).toEqual(['g-new']);
  });

  it('invalidates pending requests and clears stale data and errors on logout/auth transition', async () => {
    const pending = deferred<AdminQueueData>();
    const pendingSamples = deferred<boolean>();

    const { state, controller } = createHarness(
      () => pending.promise,
      () => pendingSamples.promise
    );

    const p = controller.refresh();
    controller.invalidate();

    expect(state.latest).toBeNull();
    expect(state.flagged).toBeNull();
    expect(state.samples).toBe(false);
    expect(state.notice).toBe('');

    const gSecret = makeGig('g-secret', 1);
    pending.resolve({ latest: [gSecret], flagged: [gSecret] });
    pendingSamples.resolve(true);
    await p;

    expect(state.latest).toBeNull();
    expect(state.flagged).toBeNull();
    expect(state.samples).toBe(false);
    expect(state.notice).toBe('');
  });

  it('prevents late state updates after component unmount (dispose)', async () => {
    const pending = deferred<AdminQueueData>();
    const { state, controller } = createHarness(() => pending.promise);

    const p = controller.refresh();
    controller.dispose();
    const writesAfterDispose = state.writes;

    pending.reject(new Error('late error after unmount'));
    await p;

    expect(state.writes).toBe(writesAfterDispose);
    expect(state.notice).toBe('');
  });

  it('preserves moderation action workflow: clears notice, runs action, refreshes queue, and surfaces action failure', async () => {
    let removed = false;
    const g1 = makeGig('g1', 1);
    const { state, controller } = createHarness(async () => ({
      latest: removed ? [] : [g1],
      flagged: removed ? [] : [g1]
    }));

    // Successful moderation action refreshes queue and clears errors
    await controller.runAction(async () => {
      removed = true;
    });
    // Allow triggered refresh microtasks to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(state.busy).toBe(false);
    expect(state.notice).toBe('');
    expect(state.flagged).toEqual([]);
    expect(state.latest).toEqual([]);

    // Failed moderation action sets visible error
    await controller.runAction(async () => {
      throw new Error('permission-denied');
    });
    expect(state.busy).toBe(false);
    expect(state.notice).toBe('Sar mochkil. Jarreb men 9bel.');
  });
});
