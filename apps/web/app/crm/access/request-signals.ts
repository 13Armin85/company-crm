export interface CombinedRequestSignal {
  signal: AbortSignal;
  dispose: () => void;
}

export function combineRequestSignals(signals: AbortSignal[]): CombinedRequestSignal {
  if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any(signals), dispose: () => undefined };

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const dispose = () => {
    listeners.forEach((listener, signal) => signal.removeEventListener("abort", listener));
    listeners.clear();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      dispose();
      break;
    }
    const listener = () => {
      controller.abort(signal.reason);
      dispose();
    };
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}
