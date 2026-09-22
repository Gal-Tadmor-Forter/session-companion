import { describe, expect, it } from "vitest";
import { AttachmentStore } from "../attachments";

describe("AttachmentStore.stageFromBase64", () => {
  it("stages a small image by its extension", () => {
    const store = new AttachmentStore();
    const base64Data = Buffer.from("fake-png-bytes").toString("base64");
    const result = store.stageFromBase64("photo.png", base64Data);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.summary).toMatchObject({ fileName: "photo.png", kind: "image" });
      expect(result.attachment).toMatchObject({ kind: "image", mediaType: "image/png", base64Data });
    }
  });

  it("includes the full preview payload on the summary for an image", () => {
    const store = new AttachmentStore();
    const base64Data = Buffer.from("fake-png-bytes").toString("base64");
    const result = store.stageFromBase64("photo.png", base64Data);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.summary.mediaType).toBe("image/png");
    expect(result.summary.previewBase64).toBe(base64Data);
    expect(result.summary.previewText).toBeUndefined();
  });

  it("includes the full preview text on the summary for a text attachment", () => {
    const store = new AttachmentStore();
    const result = store.stageFromBase64("notes.txt", Buffer.from("hello world").toString("base64"));
    if ("error" in result) throw new Error("unexpected error");
    expect(result.summary.previewText).toBe("hello world");
    expect(result.summary.mediaType).toBeUndefined();
    expect(result.summary.previewBase64).toBeUndefined();
  });

  it("stages a non-image file as text, decoding UTF-8", () => {
    const store = new AttachmentStore();
    const base64Data = Buffer.from("hello world").toString("base64");
    const result = store.stageFromBase64("notes.txt", base64Data);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.summary).toMatchObject({ fileName: "notes.txt", kind: "text" });
      expect(result.attachment).toMatchObject({ kind: "text", textContent: "hello world" });
    }
  });

  it("treats an extensionless file as text", () => {
    const store = new AttachmentStore();
    const result = store.stageFromBase64("README", Buffer.from("readme content").toString("base64"));
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.summary.kind).toBe("text");
    }
  });

  it("rejects a text attachment over the 256KB cap", () => {
    const store = new AttachmentStore();
    const big = "x".repeat(256 * 1024 + 1);
    const result = store.stageFromBase64("big.txt", Buffer.from(big).toString("base64"));
    expect(result).toEqual({ error: "big.txt is too large: text attachments are capped at 256KB." });
  });

  it("rejects an image over the 10MB base64 cap", () => {
    const store = new AttachmentStore();
    // Bytes chosen so the base64 *encoding* (not the raw size) exceeds the 10MB cap.
    const big = Buffer.alloc(8 * 1024 * 1024, 1);
    const result = store.stageFromBase64("huge.png", big.toString("base64"));
    expect(result).toEqual({
      error: "huge.png is too large: images must be under 10MB (base64-encoded) per the Claude API's image size limit.",
    });
  });

  it("assigns each staged attachment a unique id", () => {
    const store = new AttachmentStore();
    const a = store.stageFromBase64("a.txt", Buffer.from("a").toString("base64"));
    const b = store.stageFromBase64("b.txt", Buffer.from("b").toString("base64"));
    if ("error" in a || "error" in b) throw new Error("unexpected error");
    expect(a.summary.id).not.toBe(b.summary.id);
  });
});

describe("AttachmentStore.take/remove", () => {
  it("take() returns and consumes staged attachments in the requested order", () => {
    const store = new AttachmentStore();
    const a = store.stageFromBase64("a.txt", Buffer.from("A").toString("base64"));
    const b = store.stageFromBase64("b.txt", Buffer.from("B").toString("base64"));
    if ("error" in a || "error" in b) throw new Error("unexpected error");

    const taken = store.take([b.summary.id, a.summary.id]);
    expect(taken.map((t) => (t as { textContent: string }).textContent)).toEqual(["B", "A"]);

    // Consumed — a second take() of the same ids finds nothing.
    expect(store.take([a.summary.id, b.summary.id])).toEqual([]);
  });

  it("take() silently skips unknown ids", () => {
    const store = new AttachmentStore();
    expect(store.take(["does-not-exist"])).toEqual([]);
  });

  it("remove() drops a staged attachment without returning it", () => {
    const store = new AttachmentStore();
    const a = store.stageFromBase64("a.txt", Buffer.from("A").toString("base64"));
    if ("error" in a) throw new Error("unexpected error");
    store.remove(a.summary.id);
    expect(store.take([a.summary.id])).toEqual([]);
  });
});
