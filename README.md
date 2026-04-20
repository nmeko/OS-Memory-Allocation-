# OS-Memory-Allocation-
OS Memory Engine (Allocator Simulator)

A C++ memory allocator simulator that compares:

First Fit
Best Fit
Segregated Fit
and benchmarks them against:
malloc() / free()

It also provides a live web dashboard with graphs showing:

Execution time
Memory utilization
Internal fragmentation
External fragmentation

Project Structure
OS-Memory-Allocation/
│
├── src/
│   └── main.cpp
│
├── web/
│   ├── index.html
│   └── script.js
│
├── data/
│   └── results.json   (auto-generated)
│
└── allocator          (compiled program)

Requirements

You need:

Linux / Chrome OS / macOS
g++ (C++17 or later)
Python 3
Windows
MinGW or WSL (recommended)
Python 3

1.INSTALLATION
 Linux / Chrome OS (Crostini)
sudo apt update
sudo apt install g++ python3 -y

macOS

Install Xcode tools:

xcode-select --install
Check compiler:

g++ --version

Windows (Recommended: WSL)

Inside WSL (Ubuntu):

sudo apt update
sudo apt install g++ python3 -y

OR install:

MinGW-w64
Python 3 from python.org

2.COMPILE THE PROGRAM

From project root:

g++ -std=c++17 src/main.cpp -o allocator

3.RUN THE MEMORY SIMULATOR
./allocator

You will be prompted:

Enter heap size (MB):
Select strategy (1=FirstFit, 2=BestFit, 3=Segregated):
Number of operations:

Run ./allocator three times to compare all three alogorithms on the chart

4. START THE GRAPH DASHBOARD

Inside project folder:

python3 -m http.server 8000

Then open in browser:

http://localhost:8000/web/index.html

5. WHAT YOU WILL SEE

The dashboard includes real-time graphs:

 Graph 1

Execution Time (First / Best / Segregated Fit)

 Graph 2

Memory Utilization (%)

 Graph 3

External Fragmentation (%)

 Graph 4

Internal Fragmentation (%)

 Graph 5

Allocator vs malloc/free performance

6. FULL WORKFLOW (IMPORTANT)
Step 1 — Run allocator
./allocator
Step 2 — Generate data

Automatically writes:

data/results.json
Step 3 — Start server
python3 -m http.server 8000
Step 4 — View dashboard

Open:

http://localhost:8000/web/index.html
 TROUBLESHOOTING
 Blank white screen

Fix:

Ctrl + Shift + R (hard refresh)
 Graph not showing

Check:

cat data/results.json

If empty → run allocator again

 JSON error

Make sure file looks like:

{"strategy":1,"custom_time":12.3,...}
{"strategy":2,"custom_time":14.5,...}

NOT:

missing commas
broken { $ ... } format
 “Chart is not defined”

Make sure internet is on (Chart.js CDN):

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
