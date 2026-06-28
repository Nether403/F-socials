// A counting semaphore: at most `cap` holders concurrently. acquire() resolves when a
// slot is free; release() hands the freed slot directly to the longest-waiting acquirer
// (FIFO), so no scheduled lookup is starved (Req 5.4). run() is the ergonomic wrapper
// the call sites use: acquire → task → release-in-finally (release even if task throws).
//
// This is the Bounded_Scheduler for parallel-evidence-lookups: one instance per report,
// shared by the claim loop (pipeline/stages.ts) and the variant loop (router/index.ts),
// so the global count of in-flight Provider_Chain submissions is `≤ cap` by construction
// (Req 1.3, 5.1) regardless of how work splits across the two levels. No dependency, no
// abstraction beyond what the two call sites need (ponytail: ~30-LOC in-house semaphore
// beats adding p-limit/p-map to the tree).
export class Semaphore {
  private avail: number;
  private readonly waiters: Array<() => void> = [];

  constructor(cap: number) {
    // cap is already validated by config (Req 2.2/2.3); floor+max is belt-and-suspenders
    // so a stray non-positive value can never deadlock the scheduler.
    this.avail = Math.max(1, Math.floor(cap));
  }

  private acquire(): Promise<void> {
    if (this.avail > 0) {
      this.avail--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();        // hand the slot straight to the next waiter (count stays "taken")
    else this.avail++;       // nobody waiting → return the slot to the pool
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();        // released on success AND on throw, so a failing lookup frees its slot (Req 4.6)
    }
  }
}

// ponytail: one runnable self-check (run `node --import tsx src/concurrency.ts`),
// matching the index.ts/runner.ts convention. Full property coverage is tasks 2.6/2.7;
// this only fails fast if the core scheduler guarantees regress — cap=1 serializes,
// cap=2 lets two overlap, and run() frees its slot even when the task throws. Uses a
// deferred-task harness so the in-flight count is observed deterministically without
// relying on wall-clock timing. ESM top-level await runs only when invoked directly.
if (process.argv[1] && process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url)) {
  const assert: typeof import('node:assert').strict = (await import('node:assert/strict')).default;

  // Drain all pending microtasks (acquire→task→release chains) before observing state.
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  // A controllable task: resolves only when its `release` is called. Records max
  // concurrently in-flight tasks so we can assert the cap held at every instant.
  function makeHarness() {
    let inFlight = 0;
    let maxInFlight = 0;
    let startedCount = 0;
    const gates: Array<() => void> = [];
    const task = () => {
      inFlight++;
      startedCount++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve) => {
        gates.push(() => {
          inFlight--;
          resolve();
        });
      });
    };
    return {
      task,
      get maxInFlight() {
        return maxInFlight;
      },
      get started() {
        return startedCount;
      },
      // let the oldest started task finish
      releaseOne() {
        const g = gates.shift();
        if (g) g();
      },
    };
  }

  // 1) cap=1 serializes: only one task is ever in flight, the next waits.
  {
    const sem = new Semaphore(1);
    const h = makeHarness();
    const p1 = sem.run(h.task);
    const p2 = sem.run(h.task);
    await tick(); // let scheduling settle
    assert.equal(h.started, 1, 'cap=1: second task must wait for the first');
    h.releaseOne();
    await p1;
    await tick();
    assert.equal(h.started, 2, 'cap=1: second task starts after the first releases');
    h.releaseOne();
    await p2;
    assert.equal(h.maxInFlight, 1, 'cap=1: max in-flight must be 1');
  }

  // 2) cap=2 lets two overlap: both tasks run concurrently.
  {
    const sem = new Semaphore(2);
    const h = makeHarness();
    const p1 = sem.run(h.task);
    const p2 = sem.run(h.task);
    await tick();
    assert.equal(h.started, 2, 'cap=2: both tasks start concurrently');
    assert.equal(h.maxInFlight, 2, 'cap=2: max in-flight reaches 2');
    h.releaseOne();
    h.releaseOne();
    await Promise.all([p1, p2]);
  }

  // 3) run() releases its slot when the task throws (Req 4.6): a failing task must
  // not deadlock the scheduler — a subsequent acquire still succeeds.
  {
    const sem = new Semaphore(1);
    await assert.rejects(
      sem.run(async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    assert.equal(ran, true, 'slot must be freed after a throw');
  }

  console.log('concurrency.ts self-check passed');
}
