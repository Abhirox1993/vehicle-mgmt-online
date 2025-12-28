
let currentVehicle = null;
let currentTab = 'maintenance';
let mainChart = null;

// Initialize
const urlParams = new URLSearchParams(window.location.search);
const vehicleId = urlParams.get('id');

if (!vehicleId) {
    location.href = 'index.html';
}

async function loadData() {
    try {
        const res = await fetch(`/api/vehicles/${vehicleId}/details`);
        const data = await res.json();

        if (res.ok) {
            currentVehicle = data;
            renderAll();
        } else {
            alert('Failed to load vehicle details');
            location.href = 'index.html';
        }
    } catch (err) {
        console.error(err);
    }
}

function renderAll() {
    const v = currentVehicle.vehicle;
    document.getElementById('vehicleTitle').textContent = v.vehicleName;
    document.getElementById('vehiclePlate').textContent = v.plateNumber;

    // Summary Sidebar
    document.getElementById('vehicleDetailsSummary').innerHTML = `
        <div class="detail-row"><span class="label">Owner</span><span>${v.ownerName}</span></div>
        <div class="detail-row"><span class="label">ID Number</span><span>${v.idNumber}</span></div>
        <div class="detail-row"><span class="label">Model Year</span><span>${v.modelYear}</span></div>
        <div class="detail-row"><span class="label">Category</span><span>${v.category}</span></div>
        <div class="detail-row"><span class="label">Status</span><span style="color: ${v.status === 'Valid' ? 'var(--success)' : 'var(--danger)'}">${v.status}</span></div>
        <div class="detail-row"><span class="label">Expiry</span><span>${v.permitExpiryDate}</span></div>
    `;

    // Stats
    const totalMaintenanceCost = currentVehicle.maintenance.reduce((sum, item) => sum + (item.cost || 0), 0);
    const totalServiceCost = currentVehicle.service.reduce((sum, item) => sum + (item.cost || 0), 0);
    const totalCost = totalMaintenanceCost + totalServiceCost;
    document.getElementById('stat-cost').textContent = `QAR ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

    const latestKm = currentVehicle.mileage.length > 0 ? currentVehicle.mileage[0].mileage : 0;
    const latestFuelKm = currentVehicle.fuel.length > 0 ? currentVehicle.fuel[0].mileage : 0;
    const currentKm = Math.max(latestKm, latestFuelKm);
    document.getElementById('stat-mileage').textContent = `${currentKm.toLocaleString()} KM`;

    // Avg Fuel (Simple calc: Total L / Total KM in logs)
    if (currentVehicle.fuel.length > 1) {
        const lastFuel = currentVehicle.fuel[0].mileage;
        const firstFuel = currentVehicle.fuel[currentVehicle.fuel.length - 1].mileage;
        const totalLiters = currentVehicle.fuel.reduce((sum, f) => sum + f.liters, 0) - currentVehicle.fuel[currentVehicle.fuel.length - 1].liters;
        const dist = lastFuel - firstFuel;
        if (dist > 0) {
            const avg = (totalLiters / dist) * 100;
            document.getElementById('stat-fuel').textContent = `${avg.toFixed(2)} L/100km`;
        }
    }

    // Tables
    renderTables();
    renderChart();
}

function renderTables() {
    // Maintenance
    document.querySelector('#maintenanceTable tbody').innerHTML = currentVehicle.maintenance.map(m => `
        <tr>
            <td>${m.service_date}</td>
            <td>${m.description}</td>
            <td>${m.provider}</td>
            <td>QAR ${m.cost.toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary)">No logs yet</td></tr>';

    // Service
    document.querySelector('#serviceTable tbody').innerHTML = currentVehicle.service.map(s => `
        <tr>
            <td>${s.service_date}</td>
            <td>${s.description}</td>
            <td>${s.provider}</td>
            <td>QAR ${s.cost.toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary)">No logs yet</td></tr>';

    // Fuel
    document.querySelector('#fuelTable tbody').innerHTML = currentVehicle.fuel.map(f => `
        <tr>
            <td>${f.date}</td>
            <td>${f.liters} L</td>
            <td>QAR ${f.total_cost.toFixed(2)}</td>
            <td>${f.mileage} KM</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary)">No logs yet</td></tr>';

    // KM
    document.querySelector('#kmTable tbody').innerHTML = currentVehicle.mileage.map(k => `
        <tr>
            <td>${k.date}</td>
            <td>${k.mileage} KM</td>
        </tr>
    `).join('') || '<tr><td colspan="2" style="text-align:center; color: var(--text-secondary)">No logs yet</td></tr>';
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.getAttribute('onclick').includes(`'${tab}'`));
    if (activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    document.getElementById(`${tab === 'km' ? 'km' : tab}-tab`).style.display = 'block';
}

function renderChart() {
    const ctx = document.getElementById('mainChart').getContext('2d');

    if (mainChart) mainChart.destroy();

    // Prepare combined data (Fuel and Maintenance costs over time)
    const combinedData = [
        ...currentVehicle.maintenance.map(m => ({ date: m.service_date, cost: m.cost, type: 'Maintenance' })),
        ...currentVehicle.service.map(s => ({ date: s.service_date, cost: s.cost, type: 'Service' })),
        ...currentVehicle.fuel.map(f => ({ date: f.date, cost: f.total_cost, type: 'Fuel' }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    const labels = combinedData.map(d => d.date);
    const costs = combinedData.map(d => d.cost);

    // Mileage trend
    const kmData = [...currentVehicle.mileage, ...currentVehicle.fuel]
        .map(i => ({ date: i.date || i.service_date, km: i.mileage }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    mainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Expenses (QAR)',
                    data: costs,
                    borderColor: '#38bdf8',
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f1f5f9' } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'Cost (QAR)', color: '#94a3b8' }
                }
            }
        }
    });
}

function openModal(type) {
    const modal = document.getElementById('logModal');
    const fields = document.getElementById('formFields');
    const title = document.getElementById('modalTitle');

    modal.dataset.type = type;
    fields.innerHTML = '';

    if (type === 'maintenance') {
        title.textContent = 'Add Maintenance Log';
        fields.innerHTML = `
            <div class="form-group"><label>Date</label><input type="date" id="m_date" required></div>
            <div class="form-group"><label>Description</label><textarea id="m_desc" required></textarea></div>
            <div class="form-group"><label>Provider / Shop</label><input type="text" id="m_provider"></div>
            <div class="form-group"><label>Cost (QAR)</label><input type="number" step="0.01" id="m_cost" required></div>
        `;
    } else if (type === 'service') {
        title.textContent = 'Add Service Log';
        fields.innerHTML = `
            <div class="form-group"><label>Date</label><input type="date" id="s_date" required></div>
            <div class="form-group"><label>Service Type / Details</label><textarea id="s_desc" required></textarea></div>
            <div class="form-group"><label>Provider / Shop</label><input type="text" id="s_provider"></div>
            <div class="form-group"><label>Cost (QAR)</label><input type="number" step="0.01" id="s_cost" required></div>
        `;
    } else if (type === 'fuel') {
        title.textContent = 'Add Fuel Log';
        fields.innerHTML = `
            <div class="form-group"><label>Date</label><input type="date" id="f_date" required></div>
            <div class="form-group"><label>Liters</label><input type="number" step="0.01" id="f_liters" required></div>
            <div class="form-group"><label>Total Cost (QAR)</label><input type="number" step="0.01" id="f_cost" required></div>
            <div class="form-group"><label>Mileage (KM)</label><input type="number" id="f_mileage" required></div>
        `;
    } else if (type === 'km') {
        title.textContent = 'Add Mileage Log';
        fields.innerHTML = `
            <div class="form-group"><label>Date</label><input type="date" id="k_date" required></div>
            <div class="form-group"><label>Mileage (KM)</label><input type="number" id="k_mileage" required></div>
        `;
    }

    modal.classList.add('active');
}

function closeModal() {
    document.getElementById('logModal').classList.remove('active');
}

document.getElementById('logForm').onsubmit = async (e) => {
    e.preventDefault();
    const type = document.getElementById('logModal').dataset.type;
    let payload = {};
    let endpoint = '';

    if (type === 'maintenance') {
        payload = {
            service_date: document.getElementById('m_date').value,
            description: document.getElementById('m_desc').value,
            provider: document.getElementById('m_provider').value,
            cost: parseFloat(document.getElementById('m_cost').value)
        };
        endpoint = 'maintenance';
    } else if (type === 'service') {
        payload = {
            service_date: document.getElementById('s_date').value,
            description: document.getElementById('s_desc').value,
            provider: document.getElementById('s_provider').value,
            cost: parseFloat(document.getElementById('s_cost').value)
        };
        endpoint = 'service';
    } else if (type === 'fuel') {
        payload = {
            date: document.getElementById('f_date').value,
            liters: parseFloat(document.getElementById('f_liters').value),
            total_cost: parseFloat(document.getElementById('f_cost').value),
            mileage: parseInt(document.getElementById('f_mileage').value)
        };
        endpoint = 'fuel';
    } else if (type === 'km') {
        payload = {
            date: document.getElementById('k_date').value,
            mileage: parseInt(document.getElementById('k_mileage').value)
        };
        endpoint = 'mileage';
    }

    try {
        const res = await fetch(`/api/vehicles/${vehicleId}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            closeModal();
            loadData();
        } else {
            alert('Failed to save log');
        }
    } catch (err) {
        console.error(err);
    }
};

// Start
loadData();
