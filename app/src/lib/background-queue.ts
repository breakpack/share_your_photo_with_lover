type Job = () => Promise<void>;

const MAX_CONCURRENCY = clamp(
  parseInt(process.env.BACKGROUND_JOB_CONCURRENCY || '2', 10) || 2,
  1,
  6,
);

const queue: Job[] = [];
let active = 0;

export function enqueueBackgroundJob(job: Job) {
  queue.push(job);
  drain();
}

function drain() {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    void job()
      .catch((err) => {
        console.error('background job failed', err);
      })
      .finally(() => {
        active -= 1;
        drain();
      });
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
