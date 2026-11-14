# OS Memory Engine

A heap allocator simulator in C++17 that compares three classic placement strategies, **first fit**, **best fit** and **segregated fit**, against the system's `malloc`/`free`, with a web dashboard for the results.

All three strategies replay the **same seeded workload** of mixed allocations and frees, so differences in speed and fragmentation come from the strategy alone.

![CI](https://github.com/nmeko/OS-Memory-Allocation-/actions/workflows/ci.yml/badge.svg)

**Live dashboard:** https://nmeko.github.io/OS-Memory-Allocation-/ (free, in the browser, nothing to install)

## Sample results

10 MB heap, 50,000 operations, seed 42:

| Strategy | Time | External frag | Internal frag |
|---|---:|---:|---:|
| First fit | 1227 ms | 29.2% | 0.5% |
| Best fit | 2083 ms | 7.7% | 0.5% |
| Segregated fit | 56 ms | 15.4% | 0.5% |
| malloc/free | 3 ms | n/a | n/a |

Best fit packs memory tightest but scans every free block; segregated fit only searches the request's size class and up, which makes it about 20× faster than first fit. Times vary by machine.

## How it works

- **Heap model:** blocks are kept in address order (`std::map`), so freeing a block merges it with free neighbors in O(log n). Every block is 8-byte aligned; leftovers under 16 bytes stay inside the block and count as internal fragmentation.
- **First fit:** the lowest-address free block that fits.
- **Best fit:** the smallest free block that fits.
- **Segregated fit:** free blocks are also indexed in 32 power-of-two size classes; a request searches its own class first, then larger ones.
- **Workload:** about 60% allocations (90% of them 1–256 bytes, 10% up to 16 KB) and 40% frees of random live blocks.
- **Metrics:** utilization (requested bytes ÷ heap), external fragmentation (1 − largest free block ÷ all free memory), internal fragmentation (wasted bytes ÷ allocated bytes), failed allocations and final block count.

## Run it

Requirements: `g++` with C++17 and Python 3 (only to serve the dashboard). On Windows, use WSL.

```bash
g++ -std=c++17 -O2 src/main.cpp -o allocator
./allocator                                 # 10 MB heap, 50,000 ops, seed 42
./allocator --heap 64 --ops 200000 --seed 7 # custom run
./allocator --self-test                     # check heap invariants for every strategy
```

Results go to `data/results.json`. To view the dashboard:

```bash
python3 -m http.server 8000
# open http://localhost:8000/web/
```

The repository includes a sample `data/results.json`, so the dashboard also works on GitHub Pages without compiling anything. To publish it: **Settings → Pages → Deploy from a branch → `main` / root**.

## Project structure

```text
src/main.cpp       simulator, benchmark and self-test
web/index.html     dashboard page
web/script.js      charts, heap layout strips and metrics table
data/results.json  latest run (committed sample)
```

## Testing

`--self-test` runs 20,000 mixed operations per strategy and checks that blocks always tile the heap exactly, no two free blocks are adjacent, the free lists match the heap, and freeing everything coalesces back to a single block. CI builds with AddressSanitizer and UBSan and runs it on every push.
