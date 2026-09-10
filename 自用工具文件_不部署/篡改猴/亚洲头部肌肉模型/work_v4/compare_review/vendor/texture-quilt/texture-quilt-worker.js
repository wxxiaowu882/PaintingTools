/**
 * Web Worker: island texture quilting synthesis.
 */
import { synthIslandJob } from "./island-synth-job.js";

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "synth") return;
  try {
    const result = synthIslandJob(msg.job);
    self.postMessage(
      {
        type: "done",
        id: msg.id,
        token: msg.token,
        ok: true,
        ...result,
      },
      [result.outRgba.buffer]
    );
  } catch (e) {
    self.postMessage({
      type: "done",
      id: msg.id,
      token: msg.token,
      ok: false,
      error: e?.message || String(e),
    });
  }
};
