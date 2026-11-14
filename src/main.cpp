// OS Memory Engine: replays one alloc/free workload against three placement
// strategies (first fit, best fit, segregated fit) and against malloc/free,
// then writes metrics and final heap layouts for the web dashboard.
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <random>
#include <set>
#include <string>
#include <unordered_map>
#include <vector>

using namespace std;

enum class Strategy { FirstFit, BestFit, Segregated };
const vector<pair<Strategy, string>> STRATEGIES = {
    {Strategy::FirstFit, "First Fit"},
    {Strategy::BestFit, "Best Fit"},
    {Strategy::Segregated, "Segregated Fit"},
};

constexpr size_t ALIGN = 8;       // every block is a multiple of 8 bytes
constexpr size_t MIN_SPLIT = 16;  // smaller leftovers stay inside the block (internal fragmentation)
constexpr int NUM_CLASSES = 32;   // segregated size classes: [2^k, 2^(k+1))

size_t alignUp(size_t n) { return (n + ALIGN - 1) & ~(ALIGN - 1); }
int sizeClass(size_t n) { int c = 0; while (c < NUM_CLASSES - 1 && (size_t(2) << c) <= n) c++; return c; }

struct Block {
    size_t size;
    size_t requested;  // bytes the caller asked for (0 when free)
    bool free;
};

// A simulated heap: blocks keyed by address so neighbors are cheap to find,
// plus per-size-class free lists used by segregated fit.
class Heap {
    size_t total;
    map<size_t, Block> blocks;               // address -> block, contiguous, covers [0, total)
    vector<set<size_t>> freeLists;           // size class -> addresses of free blocks
    unordered_map<int, size_t> live;         // allocation id -> address
    int nextId = 1;

    void addFree(size_t addr) { freeLists[sizeClass(blocks[addr].size)].insert(addr); }
    void removeFree(size_t addr) { freeLists[sizeClass(blocks[addr].size)].erase(addr); }

    long findFirst(size_t need) {
        for (auto& [addr, b] : blocks) if (b.free && b.size >= need) return long(addr);
        return -1;
    }
    long findBest(size_t need) {
        long best = -1;
        for (auto& [addr, b] : blocks)
            if (b.free && b.size >= need && (best < 0 || b.size < blocks[size_t(best)].size)) best = long(addr);
        return best;
    }
    // Look only in the request's size class and up, so small requests never walk large blocks.
    long findSegregated(size_t need) {
        for (int c = sizeClass(need); c < NUM_CLASSES; c++)
            for (size_t addr : freeLists[c]) if (blocks[addr].size >= need) return long(addr);
        return -1;
    }

public:
    explicit Heap(size_t bytes) : total(bytes), freeLists(NUM_CLASSES) {
        blocks[0] = {total, 0, true};
        addFree(0);
    }

    // Returns an allocation id, or -1 when no free block is large enough.
    int allocate(size_t request, Strategy s) {
        if (request == 0) return -1;
        size_t need = alignUp(request);
        long found = s == Strategy::FirstFit ? findFirst(need)
                   : s == Strategy::BestFit  ? findBest(need)
                                             : findSegregated(need);
        if (found < 0) return -1;
        size_t addr = size_t(found);
        removeFree(addr);
        Block& b = blocks[addr];
        if (b.size - need >= MIN_SPLIT) {
            blocks[addr + need] = {b.size - need, 0, true};
            addFree(addr + need);
            b.size = need;
        }
        b.free = false;
        b.requested = request;
        live[nextId] = addr;
        return nextId++;
    }

    // Frees an allocation and merges it with free neighbors. Unknown ids are ignored.
    void release(int id) {
        auto it = live.find(id);
        if (it == live.end()) return;
        size_t addr = it->second;
        live.erase(it);
        blocks[addr].free = true;
        blocks[addr].requested = 0;

        auto next = blocks.find(addr + blocks[addr].size);
        if (next != blocks.end() && next->second.free) {
            removeFree(next->first);
            blocks[addr].size += next->second.size;
            blocks.erase(next);
        }
        auto cur = blocks.find(addr);
        if (cur != blocks.begin()) {
            auto prev = std::prev(cur);
            if (prev->second.free) {
                removeFree(prev->first);
                prev->second.size += cur->second.size;
                blocks.erase(cur);
                addr = prev->first;
            }
        }
        addFree(addr);
    }

    double utilization() const {  // share of the heap handed out to callers
        size_t used = 0;
        for (auto& [a, b] : blocks) if (!b.free) used += b.requested;
        return double(used) / double(total);
    }
    double internalFragmentation() const {  // share of allocated bytes lost to alignment/unsplit tails
        size_t alloc = 0, wasted = 0;
        for (auto& [a, b] : blocks) if (!b.free) { alloc += b.size; wasted += b.size - b.requested; }
        return alloc ? double(wasted) / double(alloc) : 0.0;
    }
    double externalFragmentation() const {  // 1 - largest free block / all free memory
        size_t freeTotal = 0, largest = 0;
        for (auto& [a, b] : blocks) if (b.free) { freeTotal += b.size; largest = max(largest, b.size); }
        return freeTotal ? 1.0 - double(largest) / double(freeTotal) : 0.0;
    }
    size_t blockCount() const { return blocks.size(); }
    const map<size_t, Block>& layout() const { return blocks; }

    // Invariants: blocks tile the heap exactly, no two free blocks touch, free lists match.
    void check() const {
        size_t expect = 0, freeIndexed = 0, freeBlocks = 0;
        bool prevFree = false;
        for (auto& [addr, b] : blocks) {
            assert(addr == expect && b.size > 0 && b.size % ALIGN == 0);
            assert(!(b.free && prevFree));
            if (b.free) freeBlocks++;
            expect += b.size;
            prevFree = b.free;
        }
        assert(expect == total);
        for (auto& l : freeLists) freeIndexed += l.size();
        assert(freeIndexed == freeBlocks);
        (void)freeIndexed; (void)freeBlocks;
    }
};

// One step of the workload: allocate `size` bytes, or free the allocation made at step `target`.
struct Op { bool alloc; size_t size; size_t target; };

// Mixed workload: mostly small requests with occasional large ones, ~40% frees of live blocks.
vector<Op> makeWorkload(size_t count, unsigned seed) {
    mt19937 rng(seed);
    uniform_real_distribution<double> coin(0, 1);
    uniform_int_distribution<size_t> small(1, 256), large(257, 16384);
    vector<Op> ops;
    vector<size_t> liveSteps;
    ops.reserve(count);
    for (size_t i = 0; i < count; i++) {
        if (!liveSteps.empty() && coin(rng) < 0.4) {
            size_t pick = uniform_int_distribution<size_t>(0, liveSteps.size() - 1)(rng);
            ops.push_back({false, 0, liveSteps[pick]});
            liveSteps[pick] = liveSteps.back();
            liveSteps.pop_back();
        } else {
            ops.push_back({true, coin(rng) < 0.9 ? small(rng) : large(rng), 0});
            liveSteps.push_back(i);
        }
    }
    return ops;
}

struct Result { string name; double ms; double util, extFrag, intFrag; size_t failed, blocks; Heap heap; };

Result runStrategy(Strategy s, const string& name, size_t heapBytes, const vector<Op>& ops) {
    Heap heap(heapBytes);
    vector<int> idAtStep(ops.size(), -1);
    size_t failed = 0;
    auto start = chrono::steady_clock::now();
    for (size_t i = 0; i < ops.size(); i++) {
        if (ops[i].alloc) { idAtStep[i] = heap.allocate(ops[i].size, s); if (idAtStep[i] < 0) failed++; }
        else heap.release(idAtStep[ops[i].target]);
    }
    double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - start).count();
    return {name, ms, heap.utilization(), heap.externalFragmentation(), heap.internalFragmentation(),
            failed, heap.blockCount(), heap};
}

double runMalloc(const vector<Op>& ops) {
    vector<void*> ptrAtStep(ops.size(), nullptr);
    auto start = chrono::steady_clock::now();
    for (size_t i = 0; i < ops.size(); i++) {
        if (ops[i].alloc) ptrAtStep[i] = malloc(ops[i].size);
        else { free(ptrAtStep[ops[i].target]); ptrAtStep[ops[i].target] = nullptr; }
    }
    double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - start).count();
    for (void* p : ptrAtStep) free(p);  // release whatever the workload left allocated
    return ms;
}

void writeJson(const string& dir, size_t heapMb, size_t opCount, unsigned seed,
               const vector<Result>& results, double mallocMs) {
    filesystem::create_directories(dir);
    ofstream out(dir + "/results.json");
    out << "{\n  \"heap_mb\": " << heapMb << ", \"operations\": " << opCount << ", \"seed\": " << seed
        << ",\n  \"malloc_time_ms\": " << mallocMs << ",\n  \"strategies\": [\n";
    for (size_t i = 0; i < results.size(); i++) {
        const Result& r = results[i];
        out << "    {\"name\": \"" << r.name << "\", \"time_ms\": " << r.ms << ", \"utilization\": " << r.util
            << ", \"external_frag\": " << r.extFrag << ", \"internal_frag\": " << r.intFrag
            << ", \"failed_allocs\": " << r.failed << ", \"blocks\": " << r.blocks << ",\n     \"layout\": [";
        bool first = true;
        for (auto& [addr, b] : r.heap.layout()) {
            out << (first ? "" : ",") << "[" << addr << "," << b.size << "," << (b.free ? 0 : 1) << "]";
            first = false;
        }
        out << "]}" << (i + 1 < results.size() ? "," : "") << "\n";
    }
    out << "  ]\n}\n";
    if (!out) { cerr << "error: could not write " << dir << "/results.json\n"; exit(1); }
}

int selfTest() {
    for (auto& [s, name] : STRATEGIES) {
        Heap h(1 << 20);
        vector<Op> ops = makeWorkload(20000, 7);
        vector<int> ids(ops.size(), -1);
        for (size_t i = 0; i < ops.size(); i++) {
            if (ops[i].alloc) ids[i] = h.allocate(ops[i].size, s); else h.release(ids[ops[i].target]);
            if (i % 997 == 0) h.check();
        }
        for (int id : ids) h.release(id);
        h.check();
        assert(h.blockCount() == 1 && h.utilization() == 0.0);  // everything coalesced back
        Heap tiny(64);
        assert(tiny.allocate(100, s) == -1);                   // too large fails cleanly
        assert(tiny.allocate(0, s) == -1);
        cout << "ok  " << name << "\n";
    }
    assert(alignUp(1) == 8 && alignUp(8) == 8 && alignUp(9) == 16);
    cout << "self-test passed\n";
    return 0;
}

// Asks for a number in [lo, hi]; Enter keeps the default, anything invalid is asked again.
size_t ask(const string& prompt, size_t def, size_t lo, size_t hi) {
    while (true) {
        cout << prompt << " [" << def << "]: " << flush;
        string line;
        if (!getline(cin, line)) return def;  // end of input: keep the default
        line.erase(0, line.find_first_not_of(" \t"));
        line.erase(line.find_last_not_of(" \t\r") + 1);
        if (line.empty()) return def;
        try {
            size_t pos = 0;
            if (line[0] == '-') throw invalid_argument(line);
            unsigned long long v = stoull(line, &pos);
            if (pos == line.size() && v >= lo && v <= hi) return size_t(v);
        } catch (const exception&) {}
        cout << "  Please enter a whole number from " << lo << " to " << hi << ".\n";
    }
}

void usage() {
    cerr << "usage: allocator [--heap MB] [--ops N] [--seed S] [--out DIR] [--self-test]\n"
            "  defaults: --heap 10 --ops 50000 --seed 42 --out data\n";
}

int main(int argc, char** argv) {
    size_t heapMb = 10, opCount = 50000;
    unsigned seed = 42;
    string outDir = "data";
    for (int i = 1; i < argc; i++) {
        string a = argv[i];
        if (a == "--self-test") return selfTest();
        if (a == "-h" || a == "--help") { usage(); return 0; }
        if (i + 1 >= argc) { usage(); return 2; }
        string v = argv[++i];
        try {
            if (v.empty() || v[0] == '-') throw invalid_argument(v);
            if (a == "--heap") heapMb = stoul(v);
            else if (a == "--ops") opCount = stoul(v);
            else if (a == "--seed") seed = unsigned(stoul(v));
            else if (a == "--out") outDir = v;
            else { usage(); return 2; }
        } catch (const exception&) { cerr << "error: invalid value for " << a << ": " << v << "\n"; return 2; }
    }
    if (argc == 1) {  // no options: ask, like the original interactive version
        cout << "OS Memory Engine: press Enter to keep a default.\n";
        heapMb = ask("Heap size in MB (1-4096)", heapMb, 1, 4096);
        opCount = ask("Number of operations (1-10000000)", opCount, 1, 10000000);
        seed = unsigned(ask("Random seed (same seed = same workload)", seed, 0, 4294967295u));
    }
    if (heapMb < 1 || heapMb > 4096 || opCount < 1 || opCount > 10000000) {
        cerr << "error: --heap must be 1-4096 MB and --ops 1-10000000\n";
        return 2;
    }

    vector<Op> ops = makeWorkload(opCount, seed);
    vector<Result> results;
    for (auto& [s, name] : STRATEGIES) results.push_back(runStrategy(s, name, heapMb << 20, ops));
    double mallocMs = runMalloc(ops);
    writeJson(outDir, heapMb, opCount, seed, results, mallocMs);

    printf("\nOS Memory Engine  |  heap %zu MB  |  %zu operations  |  seed %u\n\n", heapMb, opCount, seed);
    printf("%-15s %10s %8s %10s %10s %8s\n", "Strategy", "Time (ms)", "Util", "Ext frag", "Int frag", "Failed");
    for (auto& r : results)
        printf("%-15s %10.2f %7.1f%% %9.1f%% %9.1f%% %8zu\n", r.name.c_str(), r.ms, r.util * 100,
               r.extFrag * 100, r.intFrag * 100, r.failed);
    printf("%-15s %10.2f\n\nWrote %s/results.json\n", "malloc/free", mallocMs, outDir.c_str());
    printf("To view it: python3 -m http.server 8000, open http://localhost:8000/web/ and click \"Load my terminal run\".\n");
    return 0;
}
