import { describe, it, expect } from "vitest";
import { chunk, selectInChunks, IN_CHUNK } from "./chunk";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("chunk", () => {
  it("splits at the batch size", () => {
    expect(chunk(ids(250)).map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("returns nothing for an empty list", () => {
    // A caller must not fire one request for zero ids.
    expect(chunk([])).toEqual([]);
  });

  it("keeps a short list whole", () => {
    expect(chunk(ids(7))).toHaveLength(1);
  });

  it("loses nothing and reorders nothing", () => {
    const input = ids(274); // round 57's actual row count
    expect(chunk(input).flat()).toEqual(input);
  });

  it("keeps a batch's URL well under the cap it exists for", () => {
    // The whole point: ~37 characters an id, against the ~8KB limit proxies
    // commonly enforce. 242 ids in one request is ~9KB and fails; a batch must
    // not approach that.
    const worst = IN_CHUNK * 37;
    expect(worst).toBeLessThan(4096);
  });
});

describe("selectInChunks", () => {
  it("concatenates every batch's rows", async () => {
    const input = ids(250);
    const { rows, error } = await selectInChunks<{ id: string }, string>(
      input,
      async (batch) => ({ data: batch.map((id) => ({ id })), error: null })
    );
    expect(error).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(input);
  });

  it("issues one request per batch, not one per id", async () => {
    let calls = 0;
    await selectInChunks<{ id: string }, string>(ids(250), async (batch) => {
      calls++;
      return { data: batch.map((id) => ({ id })), error: null };
    });
    expect(calls).toBe(3);
  });

  it("issues no request at all for an empty list", async () => {
    let calls = 0;
    const { rows } = await selectInChunks<{ id: string }, string>(
      [],
      async () => {
        calls++;
        return { data: [], error: null };
      }
    );
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it("STOPS at the first error and surfaces it", async () => {
    // The behaviour that matters. A partial result is indistinguishable from a
    // complete one at the call site — which is precisely how a half-finished
    // cleanup would have looked finished. The caller must be told.
    let calls = 0;
    const { rows, error } = await selectInChunks<{ id: string }, string>(
      ids(250),
      async (batch) => {
        calls++;
        if (calls === 2) return { data: null, error: { message: "414" } };
        return { data: batch.map((id) => ({ id })), error: null };
      }
    );
    expect(error).toBe("414");
    expect(calls).toBe(2);
    // Rows from the first batch are returned, but ONLY alongside the error —
    // a caller that ignores the error is the bug this guards against, and it
    // cannot be prevented here, only made visible.
    expect(rows).toHaveLength(100);
  });

  it("never reports success on a partial read", async () => {
    const { error } = await selectInChunks<{ id: string }, string>(
      ids(150),
      async () => ({ data: null, error: { message: "boom" } })
    );
    expect(error).not.toBeNull();
  });
});
