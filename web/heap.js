async function renderHeap() {
    const res = await fetch('../data/heap_snapshot.json');
    const data = await res.json();

    const heap = document.getElementById('heap');
    heap.innerHTML = "";

    const total = data.reduce((a, b) => a + b.size, 0);

    data.forEach(block => {
        const div = document.createElement('div');

        div.className = "block " + (block.free ? "free" : "used");

        div.style.width = (block.size / total * 100) + "%";
        div.innerText = block.free ? "FREE" : "USED";

        heap.appendChild(div);
    });
}

// refresh every 500ms (LIVE)
setInterval(renderHeap, 500);
renderHeap();
