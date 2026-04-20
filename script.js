import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);
const db = getFirestore(app);

// DOM Elements
const tableBody = document.getElementById('table-body');
const addRowBtn = document.getElementById('add-row-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const tableSearch = document.getElementById('table-search');

// Grand Totals Elements
const grandEarnsEl = document.getElementById('grand-earns');
const grandOtherEl = document.getElementById('grand-other');
const grandSpendsEl = document.getElementById('grand-spends');
const grandBalanceEl = document.getElementById('grand-balance');

// Budget Elements
const budgetInput = document.getElementById('budget-input');
const budgetSpentEl = document.getElementById('budget-spent');
const budgetPercentEl = document.getElementById('budget-percent');
const progressFill = document.getElementById('progress-fill');

// State
let trackerData = JSON.parse(localStorage.getItem('trackerData')) || [];
let weeklyBudget = parseFloat(localStorage.getItem('weeklyBudget')) || 0;

// Chart management
let weeklyChart = null;

// Initialize the app
async function init() {
    autoAddMissingDays();
    
    // Sync with Firebase if logged in
    await fetchCloudData();
    
    renderTable();
    updateChart();
    updateBudgetStatus();
    budgetInput.value = weeklyBudget || '';
}

async function fetchCloudData() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    try {
        const docRef = doc(db, "tracker_data", user.phone);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.trackerData) {
                trackerData = data.trackerData;
                weeklyBudget = data.weeklyBudget || 0;
                saveData(false); // Update local cache
                renderTable();
            }
        }
    } catch (err) {
        console.error("Firebase fetch failed:", err);
    }
}

async function syncToCloud() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    try {
        const docRef = doc(db, "tracker_data", user.phone);
        await setDoc(docRef, {
            trackerData,
            weeklyBudget,
            updatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Firebase sync failed:", err);
    }
}

function parseDate(str) {
    if (!str) return new Date();
    if (str instanceof Date) return new Date(str);
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function updateBudgetStatus() {
    if (!budgetSpentEl) return;
    
    const now = new Date();
    const monday = getMonday(now);
    
    const weekSpends = trackerData.reduce((total, row) => {
        const d = parseDate(row.date);
        if (d >= monday) return total + (row.spends || 0);
        return total;
    }, 0);
    
    budgetSpentEl.textContent = `Spent: ${Math.round(weekSpends)}`;
    
    if (weeklyBudget > 0) {
        const percent = Math.min((weekSpends / weeklyBudget) * 100, 100);
        budgetPercentEl.textContent = `${Math.round(percent)}%`;
        progressFill.style.width = `${percent}%`;
        if (percent < 50) progressFill.style.backgroundColor = '#10b981';
        else if (percent < 85) progressFill.style.backgroundColor = '#f59e0b';
        else progressFill.style.backgroundColor = '#ef4444';
    } else {
        budgetPercentEl.textContent = '0%';
        progressFill.style.width = '0%';
    }
}

budgetInput.addEventListener('input', (e) => {
    weeklyBudget = parseFloat(e.target.value) || 0;
    localStorage.setItem('weeklyBudget', weeklyBudget);
    updateBudgetStatus();
});

function getLocalDateString(date) {
    const d = parseDate(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getMonday(d) {
    const date = parseDate(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function updateChart() {
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Show last 30 days of daily data
    const dailyData = {};
    trackerData.forEach(row => {
        if (!row.date) return;
        const dateKey = row.date;
        if (!dailyData[dateKey]) dailyData[dateKey] = { earns: 0, spends: 0 };
        dailyData[dateKey].earns += (row.earns || 0) + (row.other || 0);
        dailyData[dateKey].spends += (row.spends || 0);
    });

    const sortedDates = Object.keys(dailyData).sort().slice(-14); // Last 14 days
    const labels = sortedDates.map(d => {
        const dateObj = parseDate(d);
        return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const earns = sortedDates.map(d => dailyData[d].earns);
    const spends = sortedDates.map(d => dailyData[d].spends);
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Earn', data: earns, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.3, borderWidth: 2, pointBackgroundColor: '#10b981', pointRadius: 4 },
                { label: 'Spend', data: spends, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.3, borderWidth: 2, pointBackgroundColor: '#ef4444', pointRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            },
            plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10, weight: 'bold' } } } }
        }
    });
}

function autoAddMissingDays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (trackerData.length === 0) {
        trackerData.push({ date: getLocalDateString(today), earns: null, other: null, spends: null });
    } else {
        const existingDates = new Set(trackerData.map(d => d.date));
        trackerData.sort((a, b) => a.date.localeCompare(b.date));
        const firstEntryDate = parseDate(trackerData[0].date);
        firstEntryDate.setHours(0, 0, 0, 0);
        let currentDate = new Date(firstEntryDate);
        while (currentDate <= today) {
            const dateStr = getLocalDateString(currentDate);
            if (!existingDates.has(dateStr)) {
                trackerData.push({ date: dateStr, earns: null, other: null, spends: null });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    trackerData.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveData(false);
}

function renderTable() {
    const searchTerm = tableSearch ? tableSearch.value.toLowerCase() : '';
    const filteredData = trackerData.filter(row => {
        return (row.date || '').toLowerCase().includes(searchTerm);
    });
    const displayData = [...filteredData].sort((a, b) => b.date.localeCompare(a.date));
    
    tableBody.innerHTML = '';
    
    if (displayData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No records found.</td></tr>';
    } else {
        displayData.forEach((row) => {
            const actualIndex = trackerData.findIndex(d => d.date === row.date);
            createRowUI(row, actualIndex);
        });
    }
    updateGrandTotals(filteredData);
}

function createRowUI(row, index) {
    const tr = document.createElement('tr');
    const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
    const balanceClass = balance >= 0 ? 'positive' : 'negative';
    const categories = ['-','Food','Shop','Travel','Rent','Bills','Salary','Gift','Other'];
    
    let catOptions = categories.map(c => 
        `<option value="${c}" ${row.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    tr.innerHTML = `
        <td><input type="date" value="${row.date || ''}" onchange="updateData(${index}, 'date', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.earns || ''}" onfocus="this.select()" oninput="updateData(${index}, 'earns', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.other || ''}" onfocus="this.select()" oninput="updateData(${index}, 'other', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.spends || ''}" onfocus="this.select()" oninput="updateData(${index}, 'spends', this.value)"></td>
        <td>
            <select class="cat-select" onchange="updateData(${index}, 'category', this.value)">
                ${catOptions}
            </select>
        </td>
        <td><span class="balance-cell ${balanceClass}">${balance >= 0 ? '+' : ''}${Math.round(balance)}</span></td>
        <td class="action-col">
            <button class="delete-btn" onclick="deleteRow(${index})" title="Del">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </td>
    `;
    tableBody.appendChild(tr);
}

// Add Row Logic (Modal Based)
const addEntryModal = document.getElementById('add-entry-modal');
const submitEntryBtn = document.getElementById('submit-new-entry');

addRowBtn.addEventListener('click', () => {
    // Set default date to today in local timezone
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISODate = new Date(now - offset).toISOString().split('T')[0];
    document.getElementById('new-date').value = localISODate;
    
    // Clear other fields
    document.getElementById('new-earns').value = '';
    document.getElementById('new-other').value = '';
    document.getElementById('new-spends').value = '';
    document.getElementById('new-category').value = '-';
    
    addEntryModal.style.display = 'flex';
});

submitEntryBtn.addEventListener('click', () => {
    const date = document.getElementById('new-date').value;
    const earns = parseFloat(document.getElementById('new-earns').value) || null;
    const other = parseFloat(document.getElementById('new-other').value) || null;
    const spends = parseFloat(document.getElementById('new-spends').value) || null;
    const category = document.getElementById('new-category').value;

    if (!date) return alert("Please select a date.");

    const newRow = {
        date,
        earns,
        other,
        spends,
        category
    };

    trackerData.unshift(newRow); // Add to beginning of list
    trackerData.sort((a, b) => b.date.localeCompare(a.date)); // Keep sorted
    saveData();
    renderTable();
    addEntryModal.style.display = 'none';
});

// Close modal when clicking outside the card
window.addEventListener('click', (e) => {
    if (e.target === addEntryModal) {
        addEntryModal.style.display = 'none';
    }
});

function updateData(index, field, value) {
    if (field === 'date' || field === 'category') trackerData[index][field] = value;
    else trackerData[index][field] = value === '' ? null : parseFloat(value);
    saveData();
    const activeEl = document.activeElement;
    const tr = activeEl ? activeEl.closest('tr') : null;
    if (tr) {
        const balance = (trackerData[index].earns || 0) + (trackerData[index].other || 0) - (trackerData[index].spends || 0);
        const balanceEl = tr.querySelector('.balance-cell');
        if (balanceEl) {
            balanceEl.textContent = `${balance >= 0 ? '+' : ''}${Math.round(balance)}`;
            balanceEl.className = `balance-cell ${balance >= 0 ? 'positive' : 'negative'}`;
        }
    }
    updateGrandTotals();
    updateChart();
    updateBudgetStatus();
    if (field === 'date') {
        renderTable();
    }
}

function deleteRow(index) {
    if (confirm('Are you sure you want to delete this entry?')) {
        trackerData.splice(index, 1);
        saveData();
        renderTable();
        updateChart();
        updateBudgetStatus();
    }
}

function clearAll() {
    if (confirm('This will delete ALL entries. Proceed?')) {
        trackerData = [];
        localStorage.removeItem('trackerData');
        init();
    }
}

function saveData(cloudSync = true) {
    localStorage.setItem('trackerData', JSON.stringify(trackerData));
    if (cloudSync) syncToCloud();
}

function updateGrandTotals(dataToCalculate = trackerData) {
    let tEarns = 0, tOther = 0, tSpends = 0;
    dataToCalculate.forEach(row => {
        tEarns += (row.earns || 0); tOther += (row.other || 0); tSpends += (row.spends || 0);
    });
    const tBalance = tEarns + tOther - tSpends;
    grandEarnsEl.textContent = `+${Math.round(tEarns)}`;
    grandOtherEl.textContent = `+${Math.round(tOther)}`;
    grandSpendsEl.textContent = `-${Math.round(tSpends)}`;
    grandBalanceEl.textContent = `${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
    grandBalanceEl.style.color = tBalance >= 0 ? 'var(--success-color)' : 'var(--error-color)';
}

const saveBtn = document.getElementById('save-btn');
function manualSave() {
    saveData();
    updateChart();
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved!';
    saveBtn.style.opacity = '0.7';
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.opacity = '1';
    }, 1000);
}

const navItems = document.querySelectorAll('.nav-item');
const appViews = document.querySelectorAll('.app-view');
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const viewId = item.getAttribute('data-view');
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        appViews.forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        if (viewId === 'insights-view') updateChart();
    });
});

saveBtn.addEventListener('click', manualSave);
clearAllBtn.addEventListener('click', clearAll);
tableSearch?.addEventListener('input', renderTable);

const notifBanner = document.getElementById('notif-banner');
const notifAllowBtn = document.getElementById('notif-allow-btn');
const notifCloseBtn = document.getElementById('notif-close-btn');

async function checkNotificationPermission() {
    if (Notification.permission === 'default') notifBanner.style.display = 'flex';
}

function hideBanner() {
    if (notifBanner) {
        notifBanner.classList.add('hide');
        setTimeout(() => { notifBanner.style.display = 'none'; }, 400);
    }
}

if (notifAllowBtn) {
    notifAllowBtn.addEventListener('click', async () => {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const token = await getToken(messaging, { vapidKey: vapidKey });
                if (token) console.log('FCM Token generated');
            }
        } catch (err) { console.error("Permission/Token error:", err); }
        hideBanner();
    });
}
if (notifCloseBtn) notifCloseBtn.addEventListener('click', hideBanner);

onMessage(messaging, (payload) => {
    if (Notification.permission === "granted") {
        new Notification(payload.notification.title, { body: payload.notification.body, icon: "/icon-192.png" });
    } else alert(`${payload.notification.title}\n\n${payload.notification.body}`);
});

const broadcastModal = document.getElementById('broadcast-modal');
const bcTitle = document.getElementById('bc-title');
const bcMessage = document.getElementById('bc-message');
const bcCloseBtn = document.getElementById('bc-close-btn');
bcCloseBtn?.addEventListener('click', () => { broadcastModal.style.display = 'none'; });

onSnapshot(doc(db, "notifications", "broadcast"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        const msgId = data.timestamp ? data.timestamp.toMillis() : null;
        const lastRead = localStorage.getItem('lastReadMessage');
        if (data.active && data.message && msgId && msgId.toString() !== lastRead) {
            const title = data.title || "Admin Announcement";
            const message = data.message;
            if (broadcastModal) { bcTitle.textContent = title.toUpperCase(); bcMessage.textContent = message; broadcastModal.style.display = 'flex'; }
            localStorage.setItem('lastReadMessage', msgId.toString());
            if (Notification.permission === "granted") {
                if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body: message, icon: "/icon-192.png" }));
                else new Notification(title, { body: message, icon: "/icon-192.png" });
            }
        }
    }
});

const profileTrigger = document.getElementById('profile-trigger');
const profileDrawer = document.getElementById('profile-drawer');
const logoutBtn = document.getElementById('logout-btn');
const userInitial = document.getElementById('user-initial');
const drawerInitial = document.getElementById('drawer-initial');
const displayName = document.getElementById('display-name');
const displayPhone = document.getElementById('display-phone');

function initUser() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user && user.username) {
        const initial = user.username.charAt(0).toUpperCase();
        if (userInitial) userInitial.textContent = initial;
        if (drawerInitial) drawerInitial.textContent = initial;
        if (displayName) displayName.textContent = user.username;
        if (displayPhone) displayPhone.textContent = user.phone;
    }
}

profileTrigger?.addEventListener('click', () => { if (profileDrawer) profileDrawer.style.display = 'block'; });
profileDrawer?.addEventListener('click', (e) => { if (e.target === profileDrawer) profileDrawer.style.display = 'none'; });
logoutBtn?.addEventListener('click', () => { 
    localStorage.removeItem('currentUser'); 
    localStorage.removeItem('trackerData');
    localStorage.removeItem('weeklyBudget');
    window.location.replace('auth.html'); 
});

// CSV Export Logic
const exportCsvBtn = document.getElementById('export-csv-btn');
exportCsvBtn?.addEventListener('click', () => {
    if (trackerData.length === 0) {
        alert("No data to export!");
        return;
    }

    const headers = ["Date", "Earnings", "Other Income", "Spends", "Balance"];
    const rows = trackerData.map(row => {
        const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
        return [
            row.date,
            row.earns || 0,
            row.other || 0,
            row.spends || 0,
            balance
        ];
    });

    let csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = `Expense_Report_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

init();
initUser();
setTimeout(checkNotificationPermission, 8000);

window.updateData = updateData;
window.deleteRow = deleteRow;

let deferredPrompt;
const installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    if (installBtn) installBtn.style.display = 'block';
});
if (installBtn) {
    if (window.matchMedia('(display-mode: standalone)').matches) installBtn.style.display = 'none';
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            installBtn.style.display = 'none';
        } else {
            const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isiOS) alert('To install on iPhone/iPad:\n1. Tap the "Share" button at the bottom.\n2. Scroll down and tap "Add to Home Screen".');
            else alert('To install this app:\n1. Click the "Install" icon in your browser address bar (top right).\nOR\n2. Open your browser menu (3 dots) and select "Install App" or "Add to Home Screen".');
        }
    });
}
