/**
 * Shared frame stage scheduler (producer/consumer).
 * Purpose: split heavy GPU tasks across multiple animation frames,
 * reducing shader compile / pipeline switch spikes.
 */
export function createSolidFrameStageScheduler(opts = {}) {
  const raf = (typeof opts.raf === 'function') ? opts.raf : (fn) => requestAnimationFrame(fn);
  const now = (typeof opts.now === 'function') ? opts.now : () => (performance && performance.now ? performance.now() : Date.now());
  const log = (typeof opts.log === 'function') ? opts.log : null;
  let token = 0;

  function run(stages = [], reason) {
    const my = ++token;
    let i = 0;
    const runOne = () => {
      if (my !== token) return;
      if (i >= stages.length) return;
      const fn = stages[i++];
      raf(() => {
        if (my !== token) return;
        try { if (log) log('[Stage] ' + (reason || '') + ' #' + (i - 1)); } catch (_e) {}
        try { if (typeof fn === 'function') fn(); } catch (_e2) {}
        runOne();
      });
    };
    runOne();
    return my;
  }

  function cancel() {
    token++;
  }

  return { run, cancel, now: () => now(), getToken: () => token };
}

