export interface LatestOperationToken {
  id: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

/** Coordinates async UI intents using latest-started-wins semantics. */
export class LatestOperation {
  private id = 0;
  private controller: AbortController | null = null;

  begin(): LatestOperationToken {
    this.controller?.abort();
    const id = ++this.id;
    const controller = new AbortController();
    this.controller = controller;
    return { id, signal: controller.signal, isCurrent: () => this.id === id && !controller.signal.aborted };
  }

  isCurrent(id: number): boolean { return this.id === id && !this.controller?.signal.aborted; }

  invalidate(): void {
    this.controller?.abort();
    this.controller = null;
    this.id += 1;
  }
}
