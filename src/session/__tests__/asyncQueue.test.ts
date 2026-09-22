import { describe, expect, it } from "vitest";
import { AsyncQueue } from "../asyncQueue";

async function nextValue<T>(queue: AsyncQueue<T>): Promise<IteratorResult<T>> {
  return queue[Symbol.asyncIterator]().next();
}

describe("AsyncQueue", () => {
  it("yields items in the order they were pushed", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
  });

  it("resolves a pending next() as soon as an item is pushed", async () => {
    const queue = new AsyncQueue<string>();
    const pending = nextValue(queue);
    queue.push("late");
    expect(await pending).toEqual({ value: "late", done: false });
  });

  it("signals done to consumers waiting on an empty queue when closed", async () => {
    const queue = new AsyncQueue<number>();
    const pending = nextValue(queue);
    queue.close();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it("signals done immediately once closed, even with no pending consumer", async () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    expect(await nextValue(queue)).toEqual({ value: undefined, done: true });
  });

  it("still drains items pushed before close, before signaling done", async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.close();
    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
