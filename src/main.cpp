#include <iostream>
#include <vector>
#include <cstdlib>
#include <ctime>
#include <chrono>
#include <fstream>
#include <algorithm>

using namespace std;

// ==============================
// BLOCK STRUCTURE
// ==============================
struct Block {
    size_t size;
    bool free;
    int id;
};

// ==============================
// HEAP SIMULATOR
// ==============================
class Heap {
private:
    vector<Block> blocks;
    int nextId = 1;
    size_t totalHeapSize = 0;

public:
    Heap(size_t heapSizeMB) {
        totalHeapSize = heapSizeMB * 1024 * 1024;
        blocks.push_back({totalHeapSize, true, 0});
    }

    // ==========================
    // COALESCE (KEY IMPROVEMENT)
    // ==========================
    void coalesce() {
        for (size_t i = 0; i < blocks.size() - 1; i++) {
            if (blocks[i].free && blocks[i + 1].free) {
                blocks[i].size += blocks[i + 1].size;
                blocks.erase(blocks.begin() + i + 1);
                i--;
            }
        }
    }

    // ==========================
    // UTILIZATION
    // ==========================
    double utilization() {
        size_t used = 0;
        for (auto &b : blocks)
            if (!b.free) used += b.size;
        return (double)used / totalHeapSize;
    }

    // ==========================
    // FRAGMENTATION
    // ==========================
    double fragmentation() {
        size_t freeTotal = 0, largest = 0;

        for (auto &b : blocks) {
            if (b.free) {
                freeTotal += b.size;
                largest = max(largest, b.size);
            }
        }

        if (freeTotal == 0) return 0;
        return 1.0 - ((double)largest / freeTotal);
    }


// -----------------------------
// INTERNAL FRAGMENTATION
// -----------------------------
double internalFragmentation() {
    size_t wasted = 0;

    for (auto &b : blocks) {
        if (!b.free) {
            // assume allocation granularity (request rounding effect)
            size_t allocated_unit = 256;
            if (b.size < allocated_unit) {
                wasted += (allocated_unit - b.size);
            }
        }
    }

    if (totalHeapSize == 0) return 0;
    return (double)wasted / totalHeapSize;
}

// -----------------------------
// EXTERNAL FRAGMENTATION
// -----------------------------
double externalFragmentation() {
    size_t freeTotal = 0;
    size_t largestFree = 0;

    for (auto &b : blocks) {
        if (b.free) {
            freeTotal += b.size;
            if (b.size > largestFree)
                largestFree = b.size;
        }
    }

    if (freeTotal == 0) return 0;

    return 1.0 - ((double)largestFree / freeTotal);
}

    // ==========================
    // FIRST FIT
    // ==========================
    int firstFit(size_t size) {
        for (size_t i = 0; i < blocks.size(); i++) {
            if (blocks[i].free && blocks[i].size >= size) {

                size_t rem = blocks[i].size - size;
                blocks[i] = {size, false, nextId++};

                if (rem > 0)
                    blocks.insert(blocks.begin() + i + 1, {rem, true, 0});

                coalesce();  // improvement
                return blocks[i].id;
            }
        }
        return -1;
    }

    // ==========================
    // BEST FIT
    // ==========================
    int bestFit(size_t size) {
        int best = -1;

        for (size_t i = 0; i < blocks.size(); i++) {
            if (blocks[i].free && blocks[i].size >= size) {
                if (best == -1 || blocks[i].size < blocks[best].size)
                    best = i;
            }
        }

        if (best == -1) return -1;

        size_t rem = blocks[best].size - size;
        blocks[best] = {size, false, nextId++};

        if (rem > 0)
            blocks.insert(blocks.begin() + best + 1, {rem, true, 0});

        coalesce();
        return blocks[best].id;
    }

    // ==========================
    // SEGREGATED FIT (IMPROVED)
    // ==========================
    int segregatedFit(size_t size) {
        // simple class buckets
        size_t threshold1 = 32;
        size_t threshold2 = 128;

        for (size_t i = 0; i < blocks.size(); i++) {
            if (!blocks[i].free) continue;

            if ((size <= threshold1 && blocks[i].size >= size) ||
                (size <= threshold2 && blocks[i].size >= size) ||
                (blocks[i].size >= size)) {

                size_t rem = blocks[i].size - size;
                blocks[i] = {size, false, nextId++};

                if (rem > 0)
                    blocks.insert(blocks.begin() + i + 1, {rem, true, 0});

                coalesce();
                return blocks[i].id;
            }
        }
        return -1;
    }
};

// ==============================
// REAL malloc/free BENCHMARK
// ==============================
double benchmarkMalloc(int ops) {
    auto start = chrono::high_resolution_clock::now();

    vector<void*> ptrs;
    ptrs.reserve(ops);

    for (int i = 0; i < ops; i++) {
        void* p = malloc((rand() % 256) + 1);
        if (p) ptrs.push_back(p);
    }

    for (void* p : ptrs)
        free(p);

    auto end = chrono::high_resolution_clock::now();

    return chrono::duration<double, milli>(end - start).count();
}

// ==============================
// TERMINAL REPORT
// ==============================
void printReport(int strategy,
                 double customTime,
                 double mallocTime,
                 double util,
                 double frag) {

    string name = (strategy == 1) ? "First Fit"
                  : (strategy == 2) ? "Best Fit"
                  : "Segregated Fit";

    cout << "\n==============================\n";
    cout << "   OS MEMORY ENGINE REPORT\n";
    cout << "==============================\n\n";

    cout << "Strategy Used: " << name << "\n";
    cout << "Custom Allocator Time : " << customTime << " ms\n";
    cout << "malloc/free Time      : " << mallocTime << " ms\n";
    cout << "Utilization           : " << util * 100 << " %\n";
    cout << "Fragmentation         : " << frag * 100 << " %\n";

    cout << "\nResult: ";
    cout << ((customTime < mallocTime)
            ? "Custom allocator faster"
            : "malloc/free faster");

    cout << "\n==============================\n\n";
}

// ==============================
// MAIN
// ==============================
int main() {
    srand(time(0));

    size_t heapSize;
    int strategy, ops;

    cout << "Enter heap size (MB): ";
    cin >> heapSize;

    cout << "Select strategy (1=First, 2=Best, 3=Segregated): ";
    cin >> strategy;

    cout << "Number of operations: ";
    cin >> ops;

    Heap heap(heapSize);

    auto start = chrono::high_resolution_clock::now();

    for (int i = 0; i < ops; i++) {
        size_t size = (rand() % 256) + 1;

        if (strategy == 1)
            heap.firstFit(size);
        else if (strategy == 2)
            heap.bestFit(size);
        else
            heap.segregatedFit(size);
    }

    auto end = chrono::high_resolution_clock::now();

    double customTime =
        chrono::duration<double, milli>(end - start).count();

    double mallocTime = benchmarkMalloc(ops);

    
    double frag = heap.fragmentation();
    double util = heap.utilization();
    double exFrag = heap.externalFragmentation();
    double intFrag = heap.internalFragmentation();
    // ==========================
    // JSON OUTPUT (DO NOT CHANGE)
    // ==========================
    ofstream out("data/results.json", ios::app);

     

out << "{"
    << "\"strategy\":" << strategy << ","
    << "\"custom_time\":" << customTime << ","
    << "\"malloc_time\":" << mallocTime << ","
    << "\"utilization\":" << util << ","
    << "\"external_frag\":" << exFrag << ","
    << "\"internal_frag\":" << intFrag
    << "}\n";

    out.close();

    // ==========================
    // TERMINAL OUTPUT
    // ==========================
    printReport(strategy, customTime, mallocTime, util, frag);

    return 0;
}
