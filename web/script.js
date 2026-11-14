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
    ["malloc/free", ms(d.malloc_time_ms), `${(fastest.time_ms / d.malloc_time_ms).toFixed(1)}× faster than ${fastest.name}`],
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

function renderCharts(d) {
  const names = d.strategies.map((s) => s.name);
  const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } };

  new Chart(document.getElementById("time"), {
    type: "bar",
    data: {
      labels: [...names, "malloc/free"],
      datasets: [{
        label: "Time (ms)",
        data: [...d.strategies.map((s) => s.time_ms), d.malloc_time_ms],
        backgroundColor: [...names.map((n) => COLORS[n]), color("--malloc")],
        borderRadius: 6,
      }],
    },
    options: { ...options, plugins: { legend: { display: false } }, scales: { y: { type: "logarithmic", title: { display: true, text: "ms (log scale)" } } } },
  });

  new Chart(document.getElementById("frag"), {
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
  const draw = () => rows.forEach((r) => drawHeap(r.canvas, r.layout, heapBytes));
  draw();
  window.addEventListener("resize", draw);
}

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
  const mallocRow = el("tr");
  mallocRow.append(el("td", "malloc/free"), el("td", ms(d.malloc_time_ms)), ...Array.from({ length: 5 }, () => el("td", "—")));
  tbody.append(mallocRow);
  table.replaceChildren(thead, tbody);
}

// Relative path so the page works both locally and on GitHub Pages.
fetch("../data/results.json")
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((d) => {
    renderMeta(d);
    renderKpis(d);
    renderCharts(d);
    renderHeaps(d);
    renderTable(d);
  })
  .catch((err) => {
    console.error("Failed to load results:", err);
    document.getElementById("error").style.display = "block";
    document.getElementById("meta").replaceChildren();
  });
