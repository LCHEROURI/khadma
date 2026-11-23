import type { Gig } from './types';

export interface AdminQueueData {
  latest: Gig[];
  flagged: Gig[];
}

export interface AdminQueueDeps {
  fetchQueue: () => Promise<AdminQueueData>;
  fetchHasSamples: () => Promise<boolean>;
  onLatest: (latest: Gig[] | null) => void;
  onFlagged: (flagged: Gig[] | null) => void;
  onSamples: (hasSamples: boolean) => void;
  onNotice: (notice: string) => void;
  onBusy: (busy: boolean) => void;
  getErrorMessage: () => string;
}

export interface AdminQueueController {
  refresh(): Promise<void>;
  invalidate(): void;
  runAction(fn: () => Promise<void>): Promise<void>;
  dispose(): void;
}

/**
 * Monotonic sequence-guarded lifecycle controller for the Admin moderation queue.
 * Prevents stale error banners, out-of-order async overwrites, post-logout data leaks,
 * and state updates after component unmount.
 */
export function createAdminQueueController(deps: AdminQueueDeps): AdminQueueController {
  let seq = 0;
  let mounted = true;

  const isCurrent = (reqId: number) => mounted && reqId === seq;

  const refresh = async (): Promise<void> => {
    if (!mounted) return;
    const reqId = ++seq;
    deps.onNotice('');

    const queuePromise = deps
      .fetchQueue()
      .then(({ latest, flagged }) => {
        if (!isCurrent(reqId)) return;
        deps.onLatest(latest);
        deps.onFlagged(flagged);
        deps.onNotice('');
      })
      .catch(() => {
        if (!isCurrent(reqId)) return;
        deps.onNotice(deps.getErrorMessage());
      });

    const samplesPromise = deps
      .fetchHasSamples()
      .then((value) => {
        if (!isCurrent(reqId)) return;
        deps.onSamples(value);
      })
      .catch(() => {
        // Non-critical sample indicator; ignore errors.
      });

    await Promise.all([queuePromise, samplesPromise]);
  };

  const invalidate = (): void => {
    seq += 1;
    if (!mounted) return;
    deps.onLatest(null);
    deps.onFlagged(null);
    deps.onSamples(false);
    deps.onNotice('');
  };

  const runAction = async (fn: () => Promise<void>): Promise<void> => {
    if (!mounted) return;
    const actionSeq = ++seq;
    deps.onBusy(true);
    try {
      await fn();
      if (!isCurrent(actionSeq)) return;
      deps.onNotice('');
      void refresh();
    } catch {
      if (!isCurrent(actionSeq)) return;
      deps.onNotice(deps.getErrorMessage());
    } finally {
      if (mounted) {
        deps.onBusy(false);
      }
    }
  };

  const dispose = (): void => {
    mounted = false;
    seq += 1;
  };

  return { refresh, invalidate, runAction, dispose };
}
