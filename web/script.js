const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const COLORS = { "First Fit": color("--first"), "Best Fit": color("--best"), "Segregated Fit": color("--seg") };
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const ms = (x) => `${x.toFixed(2)} ms`;

Chart.defaults.color = color("--muted");
Chart.defaults.borderColor = color("--line");
Chart.defaults.font.family = "Inter, system-ui, sans-serif";

// Builds an element with text content only (never innerHTML), so data can't inject markup.
function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  Object.assign(node, attrs);
  return node;
}

function renderMeta(d) {
  const meta = document.getElementById("meta");
  meta.replaceChildren(
    ...[["heap", `${d.heap_mb} MB`], ["ops", d.operations.toLocaleString()], ["seed", d.seed]].map(([k, v]) => {
      const chip = el("span", `${k} `, { className: "chip" });
      chip.append(el("b", String(v)));
      return chip;
    }),
  );
}

function renderKpis(d) {
  const s = d.strategies;
  const fastest = s.reduce((a, b) => (b.time_ms < a.time_ms ? b : a));
  const leastFrag = s.reduce((a, b) => (b.external_frag < a.external_frag ? b : a));
  const cards = [
    ["Fastest strategy", fastest.name, ms(fastest.time_ms)],
    ["Least external fragmentation", leastFrag.name, pct(leastFrag.external_frag)],
    d.malloc_time_ms == null
      ? ["malloc/free", "Terminal only", "Browsers can't call malloc; run ./allocator to compare"]
      : ["malloc/free", ms(d.malloc_time_ms), `${(fastest.time_ms / d.malloc_time_ms).toFixed(1)}× faster than ${fastest.name}`],
    ["Heap utilization", pct(s[0].utilization), "Same for all strategies: same workload"],
  ];
  document.getElementById("kpis").replaceChildren(
    ...cards.map(([label, value, note]) => {
      const card = el("div", undefined, { className: "kpi" });
      card.append(el("div", label, { className: "label" }), el("div", value, { className: "value" }), el("div", note, { className: "note" }));
      return card;
    }),
  );
}

let charts = [];
function renderCharts(d) {
  charts.forEach((c) => c.destroy());
  const names = d.strategies.map((s) => s.name);
  const withMalloc = d.malloc_time_ms != null;
  const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } };

  const timeChart = new Chart(document.getElementById("time"), {
    type: "bar",
    data: {
      labels: withMalloc ? [...names, "malloc/free"] : names,
      datasets: [{
        label: "Time (ms)",
        data: [...d.strategies.map((s) => s.time_ms), ...(withMalloc ? [d.malloc_time_ms] : [])],
        backgroundColor: [...names.map((n) => COLORS[n]), color("--malloc")],
        borderRadius: 6,
      }],
    },
    options: { ...options, plugins: { legend: { display: false } }, scales: { y: { type: "logarithmic", title: { display: true, text: "ms (log scale)" } } } },
  });

  const fragChart = new Chart(document.getElementById("frag"), {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        { label: "External", data: d.strategies.map((s) => s.external_frag * 100), backgroundColor: color("--used"), borderRadius: 6 },
        { label: "Internal", data: d.strategies.map((s) => s.internal_frag * 100), backgroundColor: color("--muted"), borderRadius: 6 },
      ],
    },
    options: { ...options, scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${v}%` } } } },
  });
  charts = [timeChart, fragChart];
}

// Draws the heap as one strip; each allocated block is a red span at its true address and size.
function drawHeap(canvas, layout, heapBytes) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(34 * ratio);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color("--used");
  for (const [addr, size, used] of layout) {
    if (!used) continue;
    const x = (addr / heapBytes) * canvas.width;
    ctx.fillRect(x, 0, Math.max((size / heapBytes) * canvas.width, 0.5), canvas.height);
  }
}

function renderHeaps(d) {
  const heapBytes = d.heap_mb * 1024 * 1024;
  const container = document.getElementById("heaps");
  const rows = d.strategies.map((s) => {
    const row = el("div", undefined, { className: "heap-row" });
    const name = el("div", undefined, { className: "name" });
    name.append(el("b", s.name), el("span", `${s.blocks.toLocaleString()} blocks · ${pct(s.external_frag)} external fragmentation`));
    const canvas = el("canvas", undefined, { className: "heap" });
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${s.name} heap layout, ${s.blocks} blocks`);
    row.append(name, canvas);
    return { row, canvas, layout: s.layout };
  });
  container.replaceChildren(...rows.map((r) => r.row));
  redrawHeaps = () => rows.forEach((r) => drawHeap(r.canvas, r.layout, heapBytes));
  redrawHeaps();
}
let redrawHeaps = () => {};
window.addEventListener("resize", () => redrawHeaps());

function renderTable(d) {
  const head = ["Strategy", "Time", "Utilization", "External frag", "Internal frag", "Failed allocs", "Blocks"];
  const table = document.getElementById("table");
  const thead = el("thead");
  thead.append(el("tr"));
  head.forEach((h) => thead.firstChild.append(el("th", h, { scope: "col" })));
  const tbody = el("tbody");
  for (const s of d.strategies) {
    const tr = el("tr");
    const first = el("td");
    const dot = el("span", undefined, { className: "dot" });
    dot.style.background = COLORS[s.name];
    first.append(dot, s.name);
    tr.append(first, ...[ms(s.time_ms), pct(s.utilization), pct(s.external_frag), pct(s.internal_frag), s.failed_allocs, s.blocks.toLocaleString()].map((v) => el("td", String(v))));
    tbody.append(tr);
  }
  if (d.malloc_time_ms != null) {
    const mallocRow = el("tr");
    mallocRow.append(el("td", "malloc/free"), el("td", ms(d.malloc_time_ms)), ...Array.from({ length: 5 }, () => el("td", "—")));
    tbody.append(mallocRow);
  }
  table.replaceChildren(thead, tbody);
}

function render(d) {
  document.getElementById("error").style.display = "none";
  renderMeta(d);
  renderKpis(d);
  renderCharts(d);
  renderHeaps(d);
  renderTable(d);
}

const form = document.getElementById("run-form");
const status = document.getElementById("run-status");
const runButton = document.getElementById("run-button");

// Run the simulation in the page with the visitor's own inputs.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const input = {
    heapMb: Number(form.heap.value),
    operations: Number(form.ops.value),
    seed: Number(form.seed.value),
  };
  runButton.disabled = true;
  status.textContent = `Running ${input.operations.toLocaleString()} operations on a ${input.heapMb} MB heap…`;
  // Let the status message paint before the (synchronous) simulation starts.
  setTimeout(() => {
    const started = performance.now();
    render(OSAllocator.simulate(input));
    status.textContent = `Simulated in your browser in ${Math.round(performance.now() - started)} ms. Change the inputs and run again to compare.`;
    runButton.disabled = false;
  }, 30);
});

form.seed.nextElementSibling.addEventListener("click", () => {
  form.seed.value = Math.floor(Math.random() * 100000);
});

// Show results written by the C++ program (./allocator writes data/results.json).
document.getElementById("load-terminal").addEventListener("click", () => {
  fetch("../data/results.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((d) => {
      render(d);
      status.textContent = "Showing data/results.json from the C++ program, including real malloc/free timing.";
    })
    .catch((err) => {
      console.error("Failed to load results:", err);
      document.getElementById("error").style.display = "block";
    });
});

form.requestSubmit();
