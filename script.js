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
    if (trackerData.length === 0) {
        addNewRow();
    }
    
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

function updateBudgetStatus() {
    if (!budgetSpentEl) return;
    
    const monday = getMonday(new Date());
    monday.setHours(0, 0, 0, 0);
    
    const weekSpends = trackerData.reduce((total, row) => {
        const d = new Date(row.date);
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
    if (typeof date === 'string') date = new Date(date);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getMonday(d) {
    d = new Date(d);
    const day = d.getDay(), diff = d.getDate() - day + (day == 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function updateChart() {
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const weeklyData = {};
    trackerData.forEach(row => {
        if (!row.date) return;
        const monday = getLocalDateString(getMonday(row.date));
        if (!weeklyData[monday]) weeklyData[monday] = { earns: 0, spends: 0 };
        weeklyData[monday].earns += (row.earns || 0) + (row.other || 0);
        weeklyData[monday].spends += (row.spends || 0);
    });
    const sortedWeeks = Object.keys(weeklyData).sort((a, b) => new Date(a) - new Date(b));
    const labels = sortedWeeks.map(w => new Date(w).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const earns = sortedWeeks.map(w => weeklyData[w].earns);
    const spends = sortedWeeks.map(w => weeklyData[w].spends);
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Earn', data: earns, backgroundColor: '#10b381', borderRadius: 4 },
                { label: 'Spend', data: spends, backgroundColor: '#ef4444', borderRadius: 4 }
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
        trackerData.sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstEntryDate = new Date(trackerData[0].date);
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
    const displayData = [...trackerData].sort((a, b) => new Date(b.date) - new Date(a.date));
    tableBody.innerHTML = '';
    displayData.forEach((row) => {
        const actualIndex = trackerData.findIndex(d => d.date === row.date);
        createRowUI(row, actualIndex);
    });
    updateGrandTotals();
}

function createRowUI(row, index) {
    const tr = document.createElement('tr');
    const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
    const balanceClass = balance >= 0 ? 'positive' : 'negative';
    tr.innerHTML = `
        <td><input type="date" value="${row.date || ''}" onchange="updateData(${index}, 'date', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.earns || ''}" onfocus="this.select()" oninput="updateData(${index}, 'earns', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.other || ''}" onfocus="this.select()" oninput="updateData(${index}, 'other', this.value)"></td>
        <td><input type="number" placeholder="0" value="${row.spends || ''}" onfocus="this.select()" oninput="updateData(${index}, 'spends', this.value)"></td>
        <td><span class="balance-cell ${balanceClass}">${balance >= 0 ? '+' : ''}${Math.round(balance)}</span></td>
        <td class="action-col">
            <button class="delete-btn" onclick="deleteRow(${index})" title="Del">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </td>
    `;
    tableBody.appendChild(tr);
}

function addNewRow() {
    const today = getLocalDateString(new Date());
    trackerData.push({ date: today, earns: null, other: null, spends: null });
    saveData();
    renderTable();
}

function updateData(index, field, value) {
    if (field === 'date') trackerData[index][field] = value;
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

function updateGrandTotals() {
    let tEarns = 0, tOther = 0, tSpends = 0;
    trackerData.forEach(row => {
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

addRowBtn.addEventListener('click', addNewRow);
saveBtn.addEventListener('click', manualSave);
clearAllBtn.addEventListener('click', clearAll);

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
    if (user) {
        const initial = user.username.charAt(0).toUpperCase();
        userInitial.textContent = initial;
        drawerInitial.textContent = initial;
        displayName.textContent = user.username;
        displayPhone.textContent = user.phone;
    }
}

profileTrigger?.addEventListener('click', () => { profileDrawer.style.display = 'block'; });
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
