/** One hover owns one generation. Async replies from earlier owners cannot open a preview. */
export class HoverIntent {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private epoch = 0;
  constructor(private readonly delay = 280) {}
  enter(begin: () => Promise<number>, present: (generation: number) => void) {
    this.cancel();
    const epoch = this.epoch;
    const generation = begin().catch((error: unknown) => {
      console.error("Mac capsule hover", error);
      return null;
    });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void generation
        .then((value) => {
          if (this.epoch === epoch && value !== null) present(value);
        })
        .catch((error: unknown) => console.error("Mac capsule hover", error));
    }, this.delay);
  }
  cancel() {
    this.epoch++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
