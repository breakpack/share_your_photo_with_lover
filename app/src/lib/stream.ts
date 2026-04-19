// Convert Node readable streams to Web streams without using Readable.toWeb,
// which can throw ERR_INVALID_STATE on client-abort races in some runtimes.
export function toWebReadableSafe(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  const asyncStream = stream as NodeJS.ReadableStream & AsyncIterable<unknown>;
  const iterator = asyncStream[Symbol.asyncIterator]?.();
  if (!iterator) {
    throw new Error('stream is not async-iterable');
  }

  let canceled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (canceled) return;
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(normalizeChunk(value));
      } catch (err) {
        if (canceled) return;
        try {
          controller.error(err);
        } catch {
          // ignore
        }
      }
    },
    async cancel() {
      canceled = true;
      if (typeof iterator.return === 'function') {
        try {
          await iterator.return();
        } catch {
          // ignore
        }
      }
      if (typeof (stream as any).destroy === 'function') {
        try {
          (stream as any).destroy();
        } catch {
          // ignore
        }
      }
    },
  });
}

function normalizeChunk(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new TextEncoder().encode(String(value ?? ''));
}
