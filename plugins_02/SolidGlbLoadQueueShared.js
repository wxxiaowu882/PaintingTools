// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：GLB 有限并发加载队列。

export function getSolidGlbLoadMaxConcurrent(isMobile) {
  return isMobile ? 2 : 4;
}

export function createSolidGlbLoadQueue({ maxConcurrent }) {
  const limit = Math.max(1, Number(maxConcurrent) || 4);
  let active = 0;
  const waiting = [];

  function drain() {
    while (active < limit && waiting.length) {
      const entry = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(entry.task)
        .then((result) => {
          active -= 1;
          entry.resolve(result);
          drain();
        })
        .catch((err) => {
          active -= 1;
          entry.reject(err);
          drain();
        });
    }
  }

  return {
    enqueue(task) {
      return new Promise((resolve, reject) => {
        waiting.push({ task, resolve, reject });
        drain();
      });
    },
    reset() {
      while (waiting.length) {
        const entry = waiting.shift();
        try { entry.resolve(undefined); } catch (_e) {}
      }
    },
    get pendingCount() { return waiting.length; },
    get activeCount() { return active; },
  };
}
