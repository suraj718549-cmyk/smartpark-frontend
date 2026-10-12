/**
 * SmartPark Client Application
 * Communicates with Spring Boot REST Backend (Local or Render)
 */

// Version-bump to automatically clear stale localStorage configs from previous versions
const CURRENT_APP_VERSION = 'v2.2-stable';
if (localStorage.getItem('smartpark_version') !== CURRENT_APP_VERSION) {
    localStorage.removeItem('smartpark_api_base');
    localStorage.setItem('smartpark_version', CURRENT_APP_VERSION);
}

// In local development -> default to http://localhost:8080/api
// In production on Vercel -> default to same-origin /api (proxied via vercel.json rewrite)
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DEFAULT_API_BASE = isLocalDev ? 'http://localhost:8080/api' : '/api';

// Helper to normalize any entered URL into a valid API endpoint
function normalizeApiUrl(raw) {
    if (!raw || !raw.trim()) {
        return DEFAULT_API_BASE;
    }
    let url = raw.trim().replace(/\/+$/, '');

    // Allow same-origin relative paths like /api
    if (url === '/api' || url.startsWith('/api/')) {
        return url;
    }

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.startsWith('localhost') || url.startsWith('127.0.0.1')) {
            url = 'http://' + url;
        } else {
            url = 'https://' + url;
        }
    }

    // Prevent Mixed Content on HTTPS pages
    if (window.location.protocol === 'https:' && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        url = url.replace('http://', 'https://');
    }

    // Ensure path ends with /api
    if (!url.endsWith('/api')) {
        url = url + '/api';
    }

    return url;
}

let API_BASE = localStorage.getItem('smartpark_api_base') || DEFAULT_API_BASE;
let currentUser = JSON.parse(localStorage.getItem('smartpark_user') || 'null');
let charts = {};

document.addEventListener('DOMContentLoaded', () => {
    initApiConfig();
    updateAuthUI();
    showView('home');
    testBackendConnectionQuietly();
    loadHomeStats();
});

function initApiConfig() {
    const input = document.getElementById('apiBaseInput');
    if (input) {
        input.value = API_BASE;
    }
}

function setApiTarget(url) {
    const input = document.getElementById('apiBaseInput');
    if (input) {
        input.value = normalizeApiUrl(url);
    }
}

function resetToDefaultApi() {
    localStorage.removeItem('smartpark_api_base');
    API_BASE = DEFAULT_API_BASE;
    const input = document.getElementById('apiBaseInput');
    if (input) input.value = API_BASE;
    showToast('Reset to default API: ' + API_BASE, 'info');
    testBackendConnection();
    loadHomeStats();
}

function saveApiConfig() {
    const input = document.getElementById('apiBaseInput');
    if (input && input.value.trim()) {
        API_BASE = normalizeApiUrl(input.value);
        input.value = API_BASE;
        localStorage.setItem('smartpark_api_base', API_BASE);
        showToast('Backend endpoint set to: ' + API_BASE, 'success');
        testBackendConnection();
        loadHomeStats();
    }
}

// Test Connection Helper
async function testBackendConnection() {
    const statusDiv = document.getElementById('apiTestResult');
    const input = document.getElementById('apiBaseInput');
    const targetUrl = normalizeApiUrl(input ? input.value : API_BASE);
    if (input) input.value = targetUrl;

    if (statusDiv) {
        statusDiv.classList.remove('d-none');
        statusDiv.className = 'alert alert-info py-2 small mb-3';
        statusDiv.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Connecting to <code>' + targetUrl + '</code>... (If Render is sleeping, this may take ~30-45s)';
    }

    const startTime = Date.now();
    try {
        const res = await fetch(`${targetUrl}/health`, {
            headers: { 'Accept': 'application/json' }
        });
        const latency = Date.now() - startTime;
        if (res.ok) {
            const data = await res.json();
            API_BASE = targetUrl;
            localStorage.setItem('smartpark_api_base', API_BASE);
            updateApiStatusBadge(true);
            if (statusDiv) {
                statusDiv.className = 'alert alert-success py-2 small mb-3';
                statusDiv.innerHTML = `<strong>Connected!</strong> Backend is ONLINE (${data.service || 'SmartPark'}, ${latency}ms latency).`;
            }
            loadHomeStats();
        } else {
            throw new Error(`Server returned HTTP ${res.status}`);
        }
    } catch (err) {
        updateApiStatusBadge(false);
        if (statusDiv) {
            statusDiv.className = 'alert alert-danger py-2 small mb-3';
            statusDiv.innerHTML = `<strong>Connection Failed:</strong> ${err.message}<br><small class="text-muted">Ensure your Render service is active and finished deploying.</small>`;
        }
    }
}

async function testBackendConnectionQuietly() {
    try {
        const res = await fetch(`${API_BASE}/health`, {
            headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
            updateApiStatusBadge(true);
        } else {
            updateApiStatusBadge(false);
        }
    } catch (e) {
        updateApiStatusBadge(false);
    }
}

function updateApiStatusBadge(isOnline) {
    const badge = document.getElementById('apiStatusBadge');
    if (badge) {
        if (isOnline) {
            badge.className = 'badge bg-success';
            badge.textContent = '● Online';
        } else {
            badge.className = 'badge bg-danger';
            badge.textContent = '● Offline';
        }
    }
}

// Robust API Fetch Wrapper with intelligent retries during Render cold sleep
async function apiFetch(endpoint, options = {}, retries = 3, delayMs = 2500) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const fullUrl = `${API_BASE}${cleanEndpoint}`;

    const defaultHeaders = {
        'Accept': 'application/json'
    };
    if (options.body && typeof options.body === 'string') {
        defaultHeaders['Content-Type'] = 'application/json';
    }

    const merged = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...(options.headers || {})
        }
    };

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(fullUrl, merged);

            // Cold-start HTTP codes from edge proxies
            if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
                showToast(`Waking up server from cold sleep (attempt ${attempt}/${retries})... please wait`, 'info');
                await new Promise(r => setTimeout(r, delayMs * attempt));
                continue;
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await res.text();
                if (res.status === 404) {
                    throw new Error(`Endpoint not found (404) at ${fullUrl}.`);
                }
                if (res.status === 403 || res.status === 401) {
                    throw new Error(`Access Denied (${res.status}).`);
                }
                throw new Error(`Server returned HTML instead of JSON. Ensure your API endpoint is reachable.`);
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || data.message || `Request failed with status ${res.status}`);
            }
            updateApiStatusBadge(true);
            return data;
        } catch (netErr) {
            console.warn(`Fetch error for ${fullUrl} (attempt ${attempt}/${retries}):`, netErr);
            if (attempt < retries && (netErr.name === 'TypeError' || (netErr.message && (netErr.message.includes('Failed to fetch') || netErr.message.includes('NetworkError'))))) {
                showToast(`Waking up server (attempt ${attempt}/${retries}, waiting ${delayMs / 1000 * attempt}s)...`, 'warning');
                await new Promise(r => setTimeout(r, delayMs * attempt));
            } else {
                updateApiStatusBadge(false);
                throw new Error(
                    `Unable to connect to backend at ${API_BASE}. ` +
                    `If Render was idle, it may take 30-50s to wake up from free-tier sleep. Please retry in a moment.`
                );
            }
        }
    }
}

// Navigation View Switcher
function showView(viewId) {
    document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) {
        target.classList.add('active');
        window.scrollTo(0, 0);
    }

    if (viewId === 'home') loadHomeStats();
    if (viewId === 'driver-search') loadSearchZones();
    if (viewId === 'driver-bookings') loadDriverBookings();
    if (viewId === 'driver-vehicles') loadDriverVehicles();
    if (viewId === 'operator-grid') loadOperatorGrid();
    if (viewId === 'operator-bookings') loadOperatorBookings();
    if (viewId === 'admin-dashboard') loadAdminStats();
    if (viewId === 'admin-users') loadAdminUsers();
    if (viewId === 'admin-pricing') loadAdminPricing();
}

// User Authentication State
function updateAuthUI() {
    const authNav = document.getElementById('authNav');
    const roleBadge = document.getElementById('userRoleBadge');
    const userNameSpan = document.getElementById('userNameSpan');

    if (currentUser) {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.remove('d-none'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.add('d-none'));
        if (roleBadge) roleBadge.textContent = currentUser.role.replace('ROLE_', '');
        if (userNameSpan) userNameSpan.textContent = currentUser.name;

        // Role-based visibility
        document.querySelectorAll('.role-driver').forEach(el => {
            el.classList.toggle('d-none', currentUser.role !== 'ROLE_DRIVER');
        });
        document.querySelectorAll('.role-operator').forEach(el => {
            el.classList.toggle('d-none', currentUser.role !== 'ROLE_OPERATOR');
        });
        document.querySelectorAll('.role-admin').forEach(el => {
            el.classList.toggle('d-none', currentUser.role !== 'ROLE_ADMIN');
        });
    } else {
        document.querySelectorAll('.auth-only').forEach(el => el.classList.add('d-none'));
        document.querySelectorAll('.guest-only').forEach(el => el.classList.remove('d-none'));
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const data = await apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        currentUser = data;
        localStorage.setItem('smartpark_user', JSON.stringify(currentUser));
        updateAuthUI();
        showToast('Signed in successfully as ' + data.name, 'success');

        if (data.role === 'ROLE_DRIVER') showView('driver-dashboard');
        else if (data.role === 'ROLE_OPERATOR') showView('operator-grid');
        else if (data.role === 'ROLE_ADMIN') showView('admin-dashboard');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

function quickFill(email, pass) {
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = pass;
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('smartpark_user');
    updateAuthUI();
    showToast('Signed out', 'info');
    showView('home');
}

async function handleRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    try {
        await apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, phone, password, confirmPassword })
        });

        showToast('Registration successful! Please sign in.', 'success');
        showView('login');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

// ----------------------------------------------------
// Home Metrics & Public Tariffs (Zero Fake Fallbacks)
// ----------------------------------------------------
async function loadHomeStats() {
    const totalEl = document.getElementById('statTotalSlots');
    const availEl = document.getElementById('statAvailableSlots');
    const occEl = document.getElementById('statOccupiedSlots');

    try {
        const data = await apiFetch('/admin/stats', {}, 1);
        if (totalEl) totalEl.textContent = data.totalSlots != null ? data.totalSlots : '—';
        if (availEl) availEl.textContent = data.availableSlots != null ? data.availableSlots : '—';
        if (occEl) occEl.textContent = data.occupiedSlots != null ? data.occupiedSlots : '—';
    } catch (err) {
        console.warn('Stats fetch pending: ' + err.message);
        if (totalEl) totalEl.textContent = '—';
        if (availEl) availEl.textContent = '—';
        if (occEl) occEl.textContent = '—';
    }

    try {
        const rules = await apiFetch('/admin/pricing', {}, 1);
        const container = document.getElementById('publicTariffTable');
        if (container) {
            if (Array.isArray(rules) && rules.length > 0) {
                container.innerHTML = rules.map(r => `
                    <tr>
                        <td><span class="badge bg-secondary">${r.vehicleType}</span></td>
                        <td class="fw-semibold">${r.zoneName || 'Global'}</td>
                        <td class="text-success fw-bold">$${r.ratePerHour} / hr</td>
                        <td>$${r.minCharge}</td>
                        <td>${r.freeMinutes} mins</td>
                    </tr>
                `).join('');
            } else {
                container.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No tariff rules found.</td></tr>`;
            }
        }
    } catch (err) {
        console.warn('Pricing fetch pending: ' + err.message);
        const container = document.getElementById('publicTariffTable');
        if (container) {
            container.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3"><i class="bi bi-cloud-slash me-1"></i>Backend offline or waking up. Click "Backend API" to check connection.</td></tr>`;
        }
    }
}

// ----------------------------------------------------
// Driver Workflows
// ----------------------------------------------------
async function loadSearchZones() {
    try {
        const zones = await apiFetch('/slots/zones');
        const select = document.getElementById('searchZoneSelect');
        select.innerHTML = '<option value="">All Zones</option>' + zones.map(z => `
            <option value="${z.id}">${z.name} (${z.location})</option>
        `).join('');
        searchAvailableSlots();
    } catch (err) {
        console.error(err);
    }
}

async function searchAvailableSlots() {
    const zoneId = document.getElementById('searchZoneSelect').value;
    const vehicleType = document.getElementById('searchTypeSelect').value;
    const duration = document.getElementById('searchDuration').value || 2;

    const query = new URLSearchParams();
    if (zoneId) query.append('zoneId', zoneId);
    if (vehicleType) query.append('vehicleType', vehicleType);
    query.append('durationHours', duration);

    try {
        const slots = await apiFetch(`/slots/search?${query.toString()}`);
        const container = document.getElementById('searchResultsGrid');

        if (!slots || slots.length === 0) {
            container.innerHTML = `<div class="col-12 text-center py-5 text-muted">No vacant slots found for criteria.</div>`;
            return;
        }

        container.innerHTML = slots.map(s => `
            <div class="col-sm-6 col-md-4 col-lg-3">
                <div class="card p-3 text-center card-hover h-100 border-0 shadow-sm">
                    <div class="d-flex justify-content-between mb-2">
                        <span class="badge bg-success-subtle text-success">Vacant</span>
                        <span class="badge bg-light text-dark border">${s.vehicleType}</span>
                    </div>
                    <div class="h3 fw-extrabold text-primary mb-1">${s.slotNumber}</div>
                    <div class="fw-semibold small">${s.zoneName}</div>
                    <small class="text-muted">${s.zoneLocation}</small>
                    <button class="btn btn-accent btn-sm mt-3 w-100" onclick="openReserveModal(${s.id}, '${s.slotNumber}', '${s.zoneName}', '${s.vehicleType}')">
                        Reserve Bay
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast('Error searching slots: ' + err.message, 'danger');
    }
}

async function openReserveModal(slotId, slotNumber, zoneName, vehicleType) {
    if (!currentUser) {
        showToast('Please sign in as a driver first', 'warning');
        showView('login');
        return;
    }

    document.getElementById('modalSlotId').value = slotId;
    document.getElementById('modalSlotDetails').textContent = `${slotNumber} in ${zoneName} (${vehicleType})`;

    // Load user vehicles
    try {
        const vehicles = await apiFetch(`/vehicles/user/${currentUser.id}`);
        const vSelect = document.getElementById('modalVehicleSelect');

        const matching = vehicles.filter(v => v.vehicleType === vehicleType);
        if (matching.length === 0) {
            vSelect.innerHTML = `<option disabled selected>No ${vehicleType} registered in your garage</option>`;
        } else {
            vSelect.innerHTML = matching.map(v => `
                <option value="${v.id}">${v.vehicleNumber} (${v.brand || ''} ${v.model || ''})</option>
            `).join('');
        }

        const modal = new bootstrap.Modal(document.getElementById('reserveSlotModal'));
        modal.show();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function submitReservation() {
    const slotId = document.getElementById('modalSlotId').value;
    const vehicleId = document.getElementById('modalVehicleSelect').value;
    const durationHours = document.getElementById('modalDuration').value || 2;
    const entryTime = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);

    if (!vehicleId) {
        showToast('Please select a matching vehicle', 'warning');
        return;
    }

    try {
        const data = await apiFetch(`/bookings?userId=${currentUser.id}`, {
            method: 'POST',
            body: JSON.stringify({ slotId, vehicleId, durationHours, entryTime })
        });

        bootstrap.Modal.getInstance(document.getElementById('reserveSlotModal')).hide();
        showToast('Reservation confirmed! Code: ' + data.bookingCode, 'success');
        showBookingPass(data);
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

function showBookingPass(booking) {
    document.getElementById('passCode').textContent = booking.bookingCode;
    document.getElementById('passSlot').textContent = booking.slotNumber + ' (' + booking.zoneName + ')';
    document.getElementById('passVehicle').textContent = booking.vehicleNumber;
    document.getElementById('passAmount').textContent = '$' + booking.amount;
    document.getElementById('passStatus').textContent = booking.status;
    document.getElementById('passQrImage').src = booking.qrCode;

    const modal = new bootstrap.Modal(document.getElementById('passModal'));
    modal.show();
}

async function loadDriverBookings() {
    if (!currentUser) return;
    try {
        const bookings = await apiFetch(`/bookings/user/${currentUser.id}`);
        const tbody = document.getElementById('driverBookingsTbody');

        if (!bookings || bookings.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No bookings yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = bookings.map(b => `
            <tr>
                <td class="fw-bold font-monospace text-primary">${b.bookingCode}</td>
                <td>${b.vehicleNumber} <small class="text-muted">(${b.vehicleType})</small></td>
                <td><strong>${b.slotNumber}</strong> (${b.zoneName})</td>
                <td>${b.entryTime || '—'}</td>
                <td class="text-success fw-bold">$${b.amount}</td>
                <td><span class="badge ${b.status === 'ACTIVE' ? 'bg-danger' : (b.status === 'CONFIRMED' ? 'bg-warning text-dark' : 'bg-success')}">${b.status}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function loadDriverVehicles() {
    if (!currentUser) return;
    try {
        const vehicles = await apiFetch(`/vehicles/user/${currentUser.id}`);
        const container = document.getElementById('driverVehiclesGrid');

        if (!vehicles || vehicles.length === 0) {
            container.innerHTML = `<div class="col-12 text-center py-4 text-muted">No vehicles in garage.</div>`;
            return;
        }

        container.innerHTML = vehicles.map(v => `
            <div class="col-md-4">
                <div class="card p-3 border-0 shadow-sm">
                    <div class="d-flex justify-content-between mb-2">
                        <span class="badge bg-primary font-monospace">${v.vehicleNumber}</span>
                        <span class="badge bg-secondary">${v.vehicleType}</span>
                    </div>
                    <div class="fw-bold">${v.brand || ''} ${v.model || ''}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function submitAddVehicle(e) {
    e.preventDefault();
    if (!currentUser) return;

    const vehicleNumber = document.getElementById('vehPlate').value;
    const vehicleType = document.getElementById('vehType').value;
    const brand = document.getElementById('vehBrand').value;
    const model = document.getElementById('vehModel').value;

    try {
        await apiFetch(`/vehicles/user/${currentUser.id}`, {
            method: 'POST',
            body: JSON.stringify({ vehicleNumber, vehicleType, brand, model })
        });

        showToast('Vehicle registered!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('addVehicleModal')).hide();
        loadDriverVehicles();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

// ----------------------------------------------------
// Operator Workflows
// ----------------------------------------------------
async function loadOperatorGrid() {
    try {
        const zones = await apiFetch('/slots/zones');
        const zoneSelect = document.getElementById('opZoneSelect');

        zoneSelect.innerHTML = zones.map(z => `
            <option value="${z.id}">${z.name}</option>
        `).join('');

        if (zones.length > 0) {
            refreshOpSlots(zones[0].id);
        }
    } catch (err) {
        console.error(err);
    }
}

async function refreshOpSlots(zoneId) {
    zoneId = zoneId || document.getElementById('opZoneSelect').value;
    if (!zoneId) return;
    try {
        const slots = await apiFetch(`/slots/zone/${zoneId}`);
        const container = document.getElementById('operatorGridContainer');

        container.innerHTML = slots.map(s => `
            <div class="col">
                <div class="slot-box ${s.status}">
                    <div class="d-flex justify-content-between small mb-1">
                        <span style="font-size:0.65rem;">${s.vehicleType}</span>
                    </div>
                    <div class="h5 fw-bold mb-1">${s.slotNumber}</div>
                    <span class="badge w-100 ${s.status === 'AVAILABLE' ? 'bg-success' : (s.status === 'RESERVED' ? 'bg-warning text-dark' : (s.status === 'OCCUPIED' ? 'bg-danger' : 'bg-secondary'))}" style="font-size:0.65rem;">
                        ${s.status}
                    </span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function loadOperatorBookings() {
    try {
        const bookings = await apiFetch('/bookings');
        const tbody = document.getElementById('opBookingsTbody');

        tbody.innerHTML = bookings.map(b => `
            <tr>
                <td class="fw-bold font-monospace text-primary">${b.bookingCode}</td>
                <td>${b.userName}<br><small class="text-muted">${b.vehicleNumber}</small></td>
                <td><strong>${b.slotNumber}</strong> (${b.zoneName})</td>
                <td><span class="badge ${b.status === 'ACTIVE' ? 'bg-danger' : (b.status === 'CONFIRMED' ? 'bg-warning text-dark' : 'bg-success')}">${b.status}</span></td>
                <td>$${b.amount}</td>
                <td>
                    ${b.status === 'CONFIRMED' ? `<button class="btn btn-sm btn-success py-0" onclick="opCheckIn(${b.id})">Check-In</button>` : ''}
                    ${b.status === 'ACTIVE' ? `<button class="btn btn-sm btn-danger py-0" onclick="opCheckOut(${b.id})">Check-Out</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function opCheckIn(bookingId) {
    try {
        await apiFetch(`/bookings/${bookingId}/check-in`, { method: 'POST' });
        showToast('Check-in confirmed!', 'success');
        loadOperatorBookings();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function opCheckOut(bookingId) {
    try {
        const data = await apiFetch(`/bookings/${bookingId}/check-out`, { method: 'POST' });
        showToast('Check-out completed! Amount: $' + data.booking.amount, 'info');
        loadOperatorBookings();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

// ----------------------------------------------------
// Admin Workflows & Chart.js Analytics
// ----------------------------------------------------
async function loadAdminStats() {
    try {
        const stats = await apiFetch('/admin/stats');

        document.getElementById('adminTotalRev').textContent = '$' + (stats.totalRevenue || 0);
        document.getElementById('adminTodayRev').textContent = '$' + (stats.todayRevenue || 0);
        document.getElementById('adminTodayBookings').textContent = stats.todayBookings || 0;
        document.getElementById('adminTotalUsers').textContent = stats.totalUsers || 0;

        renderAdminCharts(stats);
    } catch (err) {
        showToast('Failed to load admin metrics: ' + err.message, 'danger');
    }
}

function renderAdminCharts(stats) {
    // 1. Revenue Chart
    const revCtx = document.getElementById('chartRevenue');
    if (revCtx) {
        if (charts.rev) charts.rev.destroy();
        charts.rev = new Chart(revCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(stats.revenueLast7Days || {}),
                datasets: [{
                    label: 'Revenue ($)',
                    data: Object.values(stats.revenueLast7Days || {}),
                    backgroundColor: '#10b981',
                    borderRadius: 6
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    }

    // 2. Occupancy Doughnut
    const occCtx = document.getElementById('chartOccupancy');
    if (occCtx) {
        if (charts.occ) charts.occ.destroy();
        charts.occ = new Chart(occCtx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(stats.occupancyByZone || {}),
                datasets: [{
                    data: Object.values(stats.occupancyByZone || {}),
                    backgroundColor: ['#1e3a8a', '#10b981', '#f59e0b', '#8b5cf6']
                }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
    }
}

async function loadAdminUsers() {
    try {
        const users = await apiFetch('/admin/users');
        const tbody = document.getElementById('adminUsersTbody');
        tbody.innerHTML = users.map(u => `
            <tr>
                <td class="fw-bold">${u.name}</td>
                <td>${u.email}</td>
                <td><span class="badge ${u.role === 'ROLE_ADMIN' ? 'bg-danger' : (u.role === 'ROLE_OPERATOR' ? 'bg-warning text-dark' : 'bg-success')}">${u.role}</span></td>
                <td><span class="badge ${u.status === 'ACTIVE' ? 'bg-success' : 'bg-danger'}">${u.status}</span></td>
                <td>
                    ${u.role !== 'ROLE_ADMIN' ? `<button class="btn btn-sm btn-outline-secondary py-0" onclick="toggleUser(${u.id})">${u.status === 'ACTIVE' ? 'Block' : 'Unblock'}</button>` : ''}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function toggleUser(id) {
    try {
        const data = await apiFetch(`/admin/users/${id}/toggle-status`, { method: 'PATCH' });
        showToast('Status updated to ' + data.status, 'success');
        loadAdminUsers();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function downloadCsvReport() {
    window.location.href = `${API_BASE}/admin/reports/csv`;
}

// ----------------------------------------------------
// UI Notification Toast
// ----------------------------------------------------
function showToast(message, type = 'primary') {
    const toastEl = document.getElementById('appToast');
    const toastBody = document.getElementById('toastBody');
    if (toastEl && toastBody) {
        toastEl.className = `toast align-items-center text-bg-${type} border-0`;
        toastBody.textContent = message;
        const toast = new bootstrap.Toast(toastEl);
        toast.show();
    }
}