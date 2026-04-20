console.log("Dashboard script loaded");

fetch('/data/results.json')
    .then(res => res.text())
    .then(text => {

        const lines = text.trim().split('\n');
        const data = lines.map(l => JSON.parse(l));

        // Take last 3 runs (First, Best, Seg)
        const last3 = data.slice(-3);

        const labels = ["First Fit", "Best Fit", "Segregated Fit"];

        // ---------------------------
        // GRAPH 1: Execution Time
        // ---------------------------
        new Chart(document.getElementById("chart1"), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: "Custom Allocator (ms)",
                    data: last3.map(d => d.custom_time),
                    backgroundColor: "#4CAF50"
                }]
            }
        });

        // ---------------------------
        // GRAPH 2: Utilization
        // ---------------------------
        new Chart(document.getElementById("chart2"), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: "Utilization %",
                    data: last3.map(d => d.utilization * 100),
                    backgroundColor: "#2196F3"
                }]
            }
        });

        // ---------------------------
        // GRAPH 3: External Fragmentation
        // ---------------------------
        new Chart(document.getElementById("chart3"), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: "External Fragmentation %",
                    data: last3.map(d => d.external_frag * 100),
                    backgroundColor: "#F44336"
                }]
            }
        });

        // ---------------------------
        // GRAPH 4: Internal Fragmentation
        // ---------------------------
        new Chart(document.getElementById("chart4"), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: "Internal Fragmentation %",
                    data: last3.map(d => d.internal_frag * 100),
                    backgroundColor: "#FF9800"
                }]
            }
        });

        // ---------------------------
        // GRAPH 5: malloc vs custom
        // ---------------------------
        new Chart(document.getElementById("chart5"), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: "Custom Allocator",
                        data: last3.map(d => d.custom_time),
                        backgroundColor: "#8E44AD"
                    },
                    {
                        label: "malloc/free",
                        data: last3.map(d => d.malloc_time),
                        backgroundColor: "#607D8B"
                    }
                ]
            }
        });

    })
    .catch(err => {
        console.error("FAILED TO LOAD DATA:", err);
    });
