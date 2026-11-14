// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const { Heap, makeWorkload, STRATEGIES, alignUp, simulate } = require("../web/allocator.js");

for (const strategy of STRATEGIES) {
  test(`${strategy}: heap invariants hold through a mixed workload`, () => {
    const heap = new Heap(1 << 20);
    const ops = makeWorkload(20000, 7);
    const ids = new Array(ops.length).fill(-1);
    ops.forEach((op, i) => {
      if (op.alloc) ids[i] = heap.allocate(op.size, strategy); else heap.release(ids[op.target]);
      if (i % 997 === 0) heap.check();
    });
    ids.forEach((id) => heap.release(id));
    heap.check();
    assert.strictEqual(heap.blocks.length, 1, "freeing everything coalesces to one block");
    assert.strictEqual(heap.metrics().utilization, 0);
  });

  test(`${strategy}: impossible requests fail cleanly`, () => {
    const tiny = new Heap(64);
    assert.strictEqual(tiny.allocate(100, strategy), -1);
    assert.strictEqual(tiny.allocate(0, strategy), -1);
  });
}

test("alignment rounds up to 8 bytes", () => {
  assert.deepStrictEqual([alignUp(1), alignUp(8), alignUp(9)], [8, 8, 16]);
});

test("the same seed gives the same results; a different seed differs", () => {
  const strip = (d) => d.strategies.map(({ time_ms, ...rest }) => rest);
  const a = simulate({ heapMb: 2, operations: 3000, seed: 42 });
  const b = simulate({ heapMb: 2, operations: 3000, seed: 42 });
  const c = simulate({ heapMb: 2, operations: 3000, seed: 43 });
  assert.deepStrictEqual(strip(a), strip(b));
  assert.notDeepStrictEqual(strip(a), strip(c));
});

test("best fit fragments no worse than first fit on a long run", () => {
  const d = simulate({ heapMb: 4, operations: 20000, seed: 1 });
  const ext = Object.fromEntries(d.strategies.map((s) => [s.name, s.external_frag]));
  assert.ok(ext["Best Fit"] <= ext["First Fit"] + 0.02, JSON.stringify(ext));
});
