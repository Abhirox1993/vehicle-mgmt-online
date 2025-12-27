document.addEventListener('DOMContentLoaded', () => {
    const vehicleList = document.getElementById('vehicleList');
    const vehicleForm = document.getElementById('vehicleForm');
    const vehicleModal = document.getElementById('vehicleModal');
    const addNewBtn = document.getElementById('addNewVehicle');
    const closeModalBtn = document.getElementById('closeModal');
    const smartInput = document.getElementById('smartInput');
    const smartSubmit = document.getElementById('smartSubmit');
    const exportExcelBtn = document.getElementById('exportExcel');
    const downloadBackupBtn = document.getElementById('downloadBackup');
    const uploadBackupBtn = document.getElementById('uploadBackup');
    const restoreFileInput = document.getElementById('restoreFile');
    const importExcelBtn = document.getElementById('importExcel');
    const importExcelFileInput = document.getElementById('importExcelFile');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const statCards = document.querySelectorAll('.stat-card');
    const logoutBtn = document.getElementById('logoutBtn');
    const userMgmtBtn = document.getElementById('userMgmtBtn');
    const userModal = document.getElementById('userModal');
    const closeUserModal = document.getElementById('closeUserModal');
    const changePasswordForm = document.getElementById('changePasswordForm');
    const createUserForm = document.getElementById('createUserForm');

    // User Management Modal
    userMgmtBtn.onclick = () => userModal.style.display = 'flex';
    closeUserModal.onclick = () => userModal.style.display = 'none';

    changePasswordForm.onsubmit = async (e) => {
        e.preventDefault();
        const oldPassword = document.getElementById('oldPassword').value;
        const newPassword = document.getElementById('newPassword').value;

        const res = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword })
        });

        if (res.ok) {
            alert('Password updated successfully!');
            changePasswordForm.reset();
            userModal.style.display = 'none';
        } else {
            const data = await res.json();
            alert('Error: ' + data.error);
        }
    };

    createUserForm.onsubmit = async (e) => {
        e.preventDefault();
        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newUserPassword').value;

        const res = await fetch('/api/users/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            alert('User created successfully!');
            createUserForm.reset();
        } else {
            const data = await res.json();
            alert('Error: ' + data.error);
        }
    };

    // Logout
    logoutBtn.onclick = async () => {
        const res = await fetch('/api/logout');
        if (res.ok) {
            window.location.href = '/login.html';
        }
    };

    let allVehicles = [];
    let currentFilter = 'all';

    // Fetch and Render
    async function fetchVehicles() {
        try {
            const res = await fetch('/api/vehicles');
            allVehicles = await res.json();
            updateStats();
            renderVehicles();
        } catch (err) {
            console.error('Error fetching vehicles:', err);
        }
    }

    function updateStats() {
        const total = allVehicles.length;
        const valid = allVehicles.filter(v => v.status === 'Valid').length;
        const expiring = allVehicles.filter(v => v.status === 'Expiring Soon').length;
        const invalid = allVehicles.filter(v => v.status === 'Invalid').length;

        document.getElementById('count-total').textContent = total;
        document.getElementById('count-valid').textContent = valid;
        document.getElementById('count-expiring').textContent = expiring;
        document.getElementById('count-invalid').textContent = invalid;
    }

    function renderVehicles() {
        const filtered = allVehicles.filter(v => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'expiring') return v.status === 'Expiring Soon';
            if (currentFilter === 'valid') return v.status === 'Valid';
            if (currentFilter === 'invalid') return v.status === 'Invalid';
            if (currentFilter === 'hold') return v.isOnHold === 1;
            return true;
        });

        vehicleList.innerHTML = filtered.map(v => `
            <tr>
                <td>${v.ownerName}</td>
                <td>${v.idNumber}</td>
                <td>${v.plateNumber}</td>
                <td>${v.permitExpiryDate}</td>
                <td>${v.category}</td>
                <td><span class="status-${v.status.toLowerCase().replace(' ', '-')}">${v.status}</span></td>
                <td>
                    <div class="action-btns">
                        <button class="btn-edit" onclick="editVehicle(${v.id})"><i data-lucide="edit-3"></i></button>
                        <button class="btn-delete" onclick="deleteVehicle(${v.id})"><i data-lucide="trash-2"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    }

    // AI Smart Entry Parser
    function parseAiInput(input) {
        const data = {
            ownerName: '',
            idNumber: '',
            plateNumber: '',
            permitExpiryDate: '',
            modelYear: new Date().getFullYear(),
            category: 'Private'
        };

        // Simple Regex Based Parsing (Simulated AI)
        const nameMatch = input.match(/John\s\w+|Jane\s\w+|[\w]+\s[\w]+/i);
        const idMatch = input.match(/ID\s?(\w+)/i);
        const plateMatch = input.match(/Plate\s?([A-Z0-9-]+)/i);
        const dateMatch = input.match(/(\d{4}-\d{2}-\d{2})/);
        const yearMatch = input.match(/Model\s?(\d{4})/i);
        const categoryMatch = input.match(/Private\sTransportation|Private/i);

        if (nameMatch) data.ownerName = nameMatch[0];
        if (idMatch) data.idNumber = idMatch[1];
        if (plateMatch) data.plateNumber = plateMatch[1];
        if (dateMatch) data.permitExpiryDate = dateMatch[1];
        if (yearMatch) data.modelYear = yearMatch[1];
        if (categoryMatch) data.category = categoryMatch[0];

        return data;
    }

    // Create/Update
    vehicleForm.onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('vehicleId').value;
        const data = {
            ownerName: document.getElementById('ownerName').value,
            idNumber: document.getElementById('idNumber').value,
            plateNumber: document.getElementById('plateNumber').value,
            permitExpiryDate: document.getElementById('permitExpiryDate').value,
            modelYear: document.getElementById('modelYear').value,
            category: document.getElementById('category').value,
            isOnHold: document.getElementById('isOnHold').checked
        };

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/vehicles/${id}` : '/api/vehicles';

        await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        closeModal();
        fetchVehicles();
    };

    // Global Functions for Edit/Delete
    window.editVehicle = (id) => {
        const v = allVehicles.find(v => v.id === id);
        document.getElementById('modalTitle').textContent = 'Edit Vehicle Details';
        document.getElementById('vehicleId').value = v.id;
        document.getElementById('ownerName').value = v.ownerName;
        document.getElementById('idNumber').value = v.idNumber;
        document.getElementById('plateNumber').value = v.plateNumber;
        document.getElementById('permitExpiryDate').value = v.permitExpiryDate;
        document.getElementById('modelYear').value = v.modelYear;
        document.getElementById('category').value = v.category;
        document.getElementById('isOnHold').checked = v.isOnHold === 1;
        vehicleModal.classList.add('active');
    };

    window.deleteVehicle = async (id) => {
        if (confirm('Are you sure you want to delete this vehicle?')) {
            await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
            fetchVehicles();
        }
    };

    // UI Interactions
    addNewBtn.onclick = () => {
        vehicleForm.reset();
        document.getElementById('vehicleId').value = '';
        document.getElementById('modalTitle').textContent = 'New Vehicle Entry';
        vehicleModal.classList.add('active');
    };

    function closeModal() {
        vehicleModal.classList.remove('active');
    }

    closeModalBtn.onclick = closeModal;

    smartSubmit.onclick = () => {
        const input = smartInput.value;
        if (!input) return;
        const parsedData = parseAiInput(input);

        // Fill form and open modal
        document.getElementById('ownerName').value = parsedData.ownerName;
        document.getElementById('idNumber').value = parsedData.idNumber;
        document.getElementById('plateNumber').value = parsedData.plateNumber;
        document.getElementById('permitExpiryDate').value = parsedData.permitExpiryDate;
        document.getElementById('modelYear').value = parsedData.modelYear;
        document.getElementById('category').value = parsedData.category;

        document.getElementById('modalTitle').textContent = 'Verify AI Entry';
        vehicleModal.classList.add('active');
    };

    // Excel Export
    exportExcelBtn.onclick = () => {
        const worksheet = XLSX.utils.json_to_sheet(allVehicles);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Vehicles");
        XLSX.writeFile(workbook, "Vehicle_List_Antigravity.xlsx");
    };

    // Backup/Restore
    downloadBackupBtn.onclick = () => {
        window.location.href = '/api/backup';
    };

    uploadBackupBtn.onclick = () => {
        restoreFileInput.click();
    };

    restoreFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (confirm(`Are you sure you want to restore ${data.length} vehicles? This will overwrite the current database.`)) {
                    const res = await fetch('/api/restore', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    if (res.ok) {
                        alert('Restore successful!');
                        fetchVehicles();
                    } else {
                        alert('Failed to restore data.');
                    }
                }
            } catch (err) {
                alert('Invalid file format. Please upload a valid JSON backup.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    };

    // Filters & Stats Clicks
    function setFilter(filter) {
        currentFilter = filter;
        filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderVehicles();
    }

    filterBtns.forEach(btn => {
        btn.onclick = () => setFilter(btn.dataset.filter);
    });

    statCards.forEach(card => {
        card.onclick = () => setFilter(card.dataset.filter);
    });

    // Excel Import
    importExcelBtn.onclick = () => {
        importExcelFileInput.click();
    };

    importExcelFileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                if (confirm(`Do you want to import ${jsonData.length} vehicles from Excel?`)) {
                    let successCount = 0;
                    for (const vehicle of jsonData) {
                        try {
                            const res = await fetch('/api/vehicles', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    ownerName: vehicle.ownerName || vehicle['Owner Name'] || '',
                                    idNumber: vehicle.idNumber || vehicle['ID Number'] || '',
                                    plateNumber: vehicle.plateNumber || vehicle['Plate Number'] || '',
                                    permitExpiryDate: vehicle.permitExpiryDate || vehicle['Permit Expiry'] || '',
                                    modelYear: vehicle.modelYear || vehicle['Model Year'] || new Date().getFullYear(),
                                    category: vehicle.category || vehicle['Category'] || 'Private',
                                    isOnHold: vehicle.isOnHold === 1 || vehicle['On Hold'] === 'Yes' || false
                                })
                            });
                            if (res.ok) successCount++;
                        } catch (err) {
                            console.error('Failed to import vehicle:', vehicle, err);
                        }
                    }
                    alert(`Successfully imported ${successCount} out of ${jsonData.length} vehicles.`);
                    fetchVehicles();
                }
            } catch (err) {
                alert('Failed to parse Excel file. Please ensure it follows the correct format.');
                console.error(err);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // Init
    fetchVehicles();
});
