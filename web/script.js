fetch('../data/results.json')
.then(res => res.json())
.then(data => {

    new Chart(document.getElementById('chart1'), {
        type: 'bar',
        data: {
            labels: ['Utilization','External','Internal'],
            datasets: [{
                label: 'Heap',
                data: [
                    data.utilization,
                    data.external_frag,
                    data.internal_frag
                ]
            }]
        }
    });

    new Chart(document.getElementById('chart2'), {
        type: 'bar',
        data: {
            labels: ['Custom','malloc'],
            datasets: [{
                label: 'Time (ms)',
                data: [
                    data.custom_time,
                    data.malloc_time
                ]
            }]
        }
    });

});
