// Browser port of src/main.cpp: the same heap model, strategies, workload shape and metrics,
// so the dashboard can run a simulation from the visitor's own inputs.
// Exposed as window.OSAllocator (and module.exports for the Node self-test).
(function (root) {
  const ALIGN = 8;
  const MIN_SPLIT = 16;
  const NUM_CLASSES = 32;
  const STRATEGIES = ["First Fit", "Best Fit", "Segregated Fit"];

  const alignUp = (n) => Math.ceil(n / ALIGN) * ALIGN;
  function sizeClass(n) {
    let c = 0;
    while (c < NUM_CLASSES - 1 && 2 ** (c + 1) <= n) c++;
    return c;
  }

  // Seeded PRNG (mulberry32) so a seed always produces the same workload.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Blocks are kept sorted by address; neighbors are found by binary search.
  class Heap {
    constructor(bytes) {
      this.total = bytes;
      this.blocks = [{ addr: 0, size: bytes, requested: 0, free: true }];
      this.freeLists = Array.from({ length: NUM_CLASSES }, () => new Set());
      this.live = new Map();
      this.nextId = 1;
      this.freeLists[sizeClass(bytes)].add(0);
    }
    indexOf(addr) {
      let lo = 0, hi = this.blocks.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const a = this.blocks[mid].addr;
        if (a === addr) return mid;
        if (a < addr) lo = mid + 1; else hi = mid - 1;
      }
      return -1;
    }
    addFree(b) { this.freeLists[sizeClass(b.size)].add(b.addr); }
    removeFree(b) { this.freeLists[sizeClass(b.size)].delete(b.addr); }

    find(need, strategy) {
      if (strategy === "First Fit") {
        return this.blocks.findIndex((b) => b.free && b.size >= need);
      }
      if (strategy === "Best Fit") {
        let best = -1;
        this.blocks.forEach((b, i) => {
          if (b.free && b.size >= need && (best < 0 || b.size < this.blocks[best].size)) best = i;
        });
        return best;
      }
      // Segregated fit: search the request's size class and up only.
      for (let c = sizeClass(need); c < NUM_CLASSES; c++) {
        for (const addr of this.freeLists[c]) {
          const i = this.indexOf(addr);
          if (this.blocks[i].size >= need) return i;
        }
      }
      return -1;
    }

    allocate(request, strategy) {
      if (request <= 0) return -1;
      const need = alignUp(request);
      const i = this.find(need, strategy);
      if (i < 0) return -1;
      const b = this.blocks[i];
      this.removeFree(b);
      if (b.size - need >= MIN_SPLIT) {
        const rest = { addr: b.addr + need, size: b.size - need, requested: 0, free: true };
        this.blocks.splice(i + 1, 0, rest);
        this.addFree(rest);
        b.size = need;
      }
      b.free = false;
      b.requested = request;
      this.live.set(this.nextId, b.addr);
      return this.nextId++;
    }

    release(id) {
      if (!this.live.has(id)) return;
      let i = this.indexOf(this.live.get(id));
      this.live.delete(id);
      const b = this.blocks[i];
      b.free = true;
      b.requested = 0;
      const next = this.blocks[i + 1];
      if (next && next.free) {
        this.removeFree(next);
        b.size += next.size;
        this.blocks.splice(i + 1, 1);
      }
      const prev = this.blocks[i - 1];
      if (prev && prev.free) {
        this.removeFree(prev);
        prev.size += b.size;
        this.blocks.splice(i, 1);
        i -= 1;
      }
      this.addFree(this.blocks[i]);
    }

    metrics() {
      let used = 0, alloc = 0, wasted = 0, freeTotal = 0, largest = 0;
      for (const b of this.blocks) {
        if (b.free) { freeTotal += b.size; largest = Math.max(largest, b.size); }
        else { used += b.requested; alloc += b.size; wasted += b.size - b.requested; }
      }
      return {
        utilization: used / this.total,
        internal_frag: alloc ? wasted / alloc : 0,
        external_frag: freeTotal ? 1 - largest / freeTotal : 0,
      };
    }

    // Invariants: blocks tile the heap, no two free blocks touch, free lists match.
    check() {
      let expect = 0, prevFree = false, freeBlocks = 0;
      for (const b of this.blocks) {
        if (b.addr !== expect || b.size <= 0 || b.size % ALIGN) throw new Error("blocks do not tile the heap");
        if (b.free && prevFree) throw new Error("adjacent free blocks");
        if (b.free) freeBlocks++;
        expect += b.size;
        prevFree = b.free;
      }
      if (expect !== this.total) throw new Error("heap size mismatch");
      const indexed = this.freeLists.reduce((n, s) => n + s.size, 0);
      if (indexed !== freeBlocks) throw new Error("free lists out of sync");
    }
  }

  // Same shape as the C++ workload: ~40% frees of live blocks, 90% of requests 1-256 B, 10% up to 16 KB.
  function makeWorkload(count, seed) {
    const r = rng(seed);
    const ops = [];
    const liveSteps = [];
    for (let i = 0; i < count; i++) {
      if (liveSteps.length && r() < 0.4) {
        const pick = Math.floor(r() * liveSteps.length);
        ops.push({ alloc: false, target: liveSteps[pick] });
        liveSteps[pick] = liveSteps[liveSteps.length - 1];
        liveSteps.pop();
      } else {
        const size = r() < 0.9 ? 1 + Math.floor(r() * 256) : 257 + Math.floor(r() * (16384 - 257 + 1));
        ops.push({ alloc: true, size });
        liveSteps.push(i);
      }
    }
    return ops;
  }

  function runStrategy(strategy, heapBytes, ops) {
    const heap = new Heap(heapBytes);
    const idAtStep = new Array(ops.length).fill(-1);
    let failed = 0;
    const start = performance.now();
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.alloc) { idAtStep[i] = heap.allocate(op.size, strategy); if (idAtStep[i] < 0) failed++; }
      else heap.release(idAtStep[op.target]);
    }
    const time_ms = performance.now() - start;
    return {
      name: strategy, time_ms, ...heap.metrics(), failed_allocs: failed, blocks: heap.blocks.length,
      layout: heap.blocks.map((b) => [b.addr, b.size, b.free ? 0 : 1]),
    };
  }

  // Returns the same structure as data/results.json, minus malloc (not available in a browser).
  function simulate({ heapMb, operations, seed }) {
    const ops = makeWorkload(operations, seed);
    return {
      heap_mb: heapMb, operations, seed, malloc_time_ms: null, source: "browser",
      strategies: STRATEGIES.map((s) => runStrategy(s, heapMb * 1024 * 1024, ops)),
    };
  }

  const api = { simulate, Heap, makeWorkload, STRATEGIES, alignUp };
  if (typeof module !== "undefined") module.exports = api;
  else root.OSAllocator = api;
})(typeof window !== "undefined" ? window : globalThis);
