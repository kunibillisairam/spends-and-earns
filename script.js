import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
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
function init() {
    autoAddMissingDays();
    if (trackerData.length === 0) {
        addNewRow();
    }
    renderTable();
    updateChart();
    updateBudgetStatus();
    budgetInput.value = weeklyBudget || '';
}

function updateBudgetStatus() {
    if (!budgetSpentEl) return;
    
    // Get start of current week (Monday)
    const monday = getMonday(new Date());
    monday.setHours(0, 0, 0, 0);
    
    // Calculate spending for current week
    const weekSpends = trackerData.reduce((total, row) => {
        const d = new Date(row.date);
        if (d >= monday) {
            return total + (row.spends || 0);
        }
        return total;
    }, 0);
    
    budgetSpentEl.textContent = `Spent: ${Math.round(weekSpends)}`;
    
    if (weeklyBudget > 0) {
        const percent = Math.min((weekSpends / weeklyBudget) * 100, 100);
        budgetPercentEl.textContent = `${Math.round(percent)}%`;
        progressFill.style.width = `${percent}%`;
        
        // Color transition Green -> Yellow -> Red
        if (percent < 50) progressFill.style.backgroundColor = '#10b981';
        else if (percent < 85) progressFill.style.backgroundColor = '#f59e0b';
        else progressFill.style.backgroundColor = '#ef4444';
    } else {
        budgetPercentEl.textContent = '0%';
        progressFill.style.width = '0%';
    }
}

// Budget Input Event
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

// Helper to get Monday of the week for a given date
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay(),
        diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function updateChart() {
    const canvas = document.getElementById('weekly-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Group data by week
    const weeklyData = {};
    
    trackerData.forEach(row => {
        if (!row.date) return;
        const monday = getLocalDateString(getMonday(row.date));
        if (!weeklyData[monday]) {
            weeklyData[monday] = { earns: 0, spends: 0 };
        }
        weeklyData[monday].earns += (row.earns || 0) + (row.other || 0);
        weeklyData[monday].spends += (row.spends || 0);
    });

    // Sort weeks
    const sortedWeeks = Object.keys(weeklyData).sort((a, b) => new Date(a) - new Date(b));
    
    const labels = sortedWeeks.map(w => {
        const d = new Date(w);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const earns = sortedWeeks.map(w => weeklyData[w].earns);
    const spends = sortedWeeks.map(w => weeklyData[w].spends);

    if (weeklyChart) {
        weeklyChart.destroy();
    }

    weeklyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Earn',
                    data: earns,
                    backgroundColor: '#10b381',
                    borderRadius: 4
                },
                {
                    label: 'Spend',
                    data: spends,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: '#e2e8f0' },
                    ticks: { font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 } }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 10, font: { size: 10, weight: 'bold' } }
                }
            }
        }
    });
}

// Automatically add rows for days that haven't been logged yet up to today
function autoAddMissingDays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (trackerData.length === 0) {
        trackerData.push({ date: getLocalDateString(today), earns: null, other: null, spends: null });
    } else {
        // Find existing dates to avoid duplicates
        const existingDates = new Set(trackerData.map(d => d.date));
        
        // Sort to find the oldest entry
        trackerData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const firstEntryDate = new Date(trackerData[0].date);
        firstEntryDate.setHours(0, 0, 0, 0);

        // Iterate from first recorded date to today
        let currentDate = new Date(firstEntryDate);
        while (currentDate <= today) {
            const dateStr = getLocalDateString(currentDate);
            if (!existingDates.has(dateStr)) {
                trackerData.push({ date: dateStr, earns: null, other: null, spends: null });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    
    // Final sort before saving (ascending for logic, descending for render)
    trackerData.sort((a, b) => new Date(a.date) - new Date(b.date));
    saveData();
}

// Render the entire table from trackerData
function renderTable() {
    // Sort descending for display (most recent at top)
    const displayData = [...trackerData].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    tableBody.innerHTML = '';
    displayData.forEach((row) => {
        // Find actual index in trackerData for the update function
        const actualIndex = trackerData.findIndex(d => d.date === row.date);
        createRowUI(row, actualIndex);
    });
    updateGrandTotals();
}

// Create UI for a single row
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

// Manual Add Button (Still useful)
function addNewRow() {
    const today = getLocalDateString(new Date());
    trackerData.push({ date: today, earns: null, other: null, spends: null });
    saveData();
    renderTable();
}

// Update data in the state
function updateData(index, field, value) {
    if (field === 'date') {
        trackerData[index][field] = value;
    } else {
        trackerData[index][field] = value === '' ? null : parseFloat(value);
    }
    
    saveData();
    
    // Surgical Update to prevent focus loss:
    // 1. Update the balance cell in the current row
    const row = trackerData[index];
    const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
    
    // Find the row in the UI. Note: display order is descending (newest top)
    // but the inputs are bound to the 'actualIndex' from trackerData.
    // We can reach the specific row using the event target in the future,
    // but for now, we'll find the element with the matching date (assuming unique)
    // or just find the row that contains the active element.
    const activeEl = document.activeElement;
    const tr = activeEl ? activeEl.closest('tr') : null;
    
    if (tr) {
        const balanceEl = tr.querySelector('.balance-cell');
        if (balanceEl) {
            const prefix = balance >= 0 ? '+' : '';
            balanceEl.textContent = `${prefix}${Math.round(balance)}`;
            balanceEl.className = `balance-cell ${balance >= 0 ? 'positive' : 'negative'}`;
        }
    }
    
    // 2. Update the footer totals
    updateGrandTotals();
    updateChart();
    updateBudgetStatus();
}

// Delete a row
function deleteRow(index) {
    if (confirm('Are you sure you want to delete this entry?')) {
        trackerData.splice(index, 1);
        saveData();
        renderTable();
        updateChart();
        updateBudgetStatus();
    }
}

// Clear all data
function clearAll() {
    if (confirm('This will delete ALL entries. Proceed?')) {
        trackerData = [];
        localStorage.removeItem('trackerData');
        init();
    }
}

// Save to Local Storage
function saveData() {
    localStorage.setItem('trackerData', JSON.stringify(trackerData));
}

// Update the footer totals
function updateGrandTotals() {
    let tEarns = 0, tOther = 0, tSpends = 0;
    
    trackerData.forEach(row => {
        tEarns += (row.earns || 0);
        tOther += (row.other || 0);
        tSpends += (row.spends || 0);
    });
    
    const tBalance = tEarns + tOther - tSpends;
    
    grandEarnsEl.textContent = `+${Math.round(tEarns)}`;
    grandOtherEl.textContent = `+${Math.round(tOther)}`;
    grandSpendsEl.textContent = `-${Math.round(tSpends)}`;
    
    const bPrefix = tBalance >= 0 ? '+' : '';
    grandBalanceEl.textContent = `${bPrefix}${Math.round(tBalance)}`;
    
    grandBalanceEl.style.color = tBalance >= 0 ? 'var(--success-color)' : 'var(--error-color)';
}

const saveBtn = document.getElementById('save-btn');

// Manual save handler with feedback
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

// View Switching Logic
const navItems = document.querySelectorAll('.nav-item');
const appViews = document.querySelectorAll('.app-view');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const viewId = item.getAttribute('data-view');
        
        // Update Nav UI
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update View Display
        appViews.forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        // Refresh chart if switching to insights
        if (viewId === 'insights-view') {
            updateChart();
        }
    });
});

// Event Listeners
addRowBtn.addEventListener('click', addNewRow);
saveBtn.addEventListener('click', manualSave);
clearAllBtn.addEventListener('click', clearAll);

// Notification Logic
const notifBanner = document.getElementById('notif-banner');
const notifAllowBtn = document.getElementById('notif-allow-btn');
const notifCloseBtn = document.getElementById('notif-close-btn');

async function checkNotificationPermission() {
    // Only show the banner if permission is not yet decided (default)
    // and if the user has already installed the app (optional, but requested)
    if (Notification.permission === 'default') {
        notifBanner.style.display = 'flex';
    }
}

function hideBanner() {
    if (notifBanner) {
        notifBanner.classList.add('hide');
        setTimeout(() => {
            notifBanner.style.display = 'none';
        }, 400); // Match animation duration
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
        } catch (err) {
            console.error("Permission/Token error:", err);
        }
        hideBanner();
    });
}

if (notifCloseBtn) {
    notifCloseBtn.addEventListener('click', () => {
        hideBanner();
    });
}

// Foreground Message Listener
onMessage(messaging, (payload) => {
    console.log('Message received. ', payload);
    if (Notification.permission === "granted") {
        new Notification(payload.notification.title, {
            body: payload.notification.body,
            icon: "/icon-192.png"
        });
    } else {
        alert(`${payload.notification.title}\n\n${payload.notification.body}`);
    }
});

// Broadcast listener: Listen for a document named 'broadcast' in 'notifications' collection
const broadcastModal = document.getElementById('broadcast-modal');
const bcTitle = document.getElementById('bc-title');
const bcMessage = document.getElementById('bc-message');
const bcCloseBtn = document.getElementById('bc-close-btn');

bcCloseBtn?.addEventListener('click', () => {
    broadcastModal.style.display = 'none';
});

onSnapshot(doc(db, "notifications", "broadcast"), (snapshot) => {
    if (snapshot.exists()) {
        const data = snapshot.data();
        const msgId = data.timestamp ? data.timestamp.toMillis() : null;
        const lastRead = localStorage.getItem('lastReadMessage');

        // Only show if it's a new message we haven't seen in this session
        if (data.active && data.message && msgId && msgId.toString() !== lastRead) {
            const title = data.title || "Admin Announcement";
            const message = data.message;
            const options = {
                body: message,
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                vibrate: [200, 100, 200]
            };

            // 1. Show the Premium UI Modal
            if (broadcastModal) {
                bcTitle.textContent = title.toUpperCase();
                bcMessage.textContent = message;
                broadcastModal.style.display = 'flex';
            }

            // 2. Mark as read immediately
            localStorage.setItem('lastReadMessage', msgId.toString());

            // 3. Try showing a real system notification
            if (Notification.permission === "granted") {
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(registration => {
                        registration.showNotification(title, options);
                    });
                } else {
                    new Notification(title, options);
                }
            }
        }
    }
});

// Start
init();
// Check for notification permission after 8 seconds (to let user settle in)
setTimeout(checkNotificationPermission, 8000);

// Expose functions to window for onclick/onchange in dynamic HTML (since we're using type="module")
window.updateData = updateData;
window.deleteRow = deleteRow;

// PWA Install Logic
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI notify the user they can install the PWA
    if (installBtn) {
        installBtn.style.display = 'block';
    }
});

if (installBtn) {
    // Hide button if already in standalone mode (already installed)
    if (window.matchMedia('(display-mode: standalone)').matches) {
        installBtn.style.display = 'none';
    }

    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
            installBtn.style.display = 'none';
        } else {
            // Fallback for devices/browsers that don't support beforeinstallprompt
            const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (isiOS) {
                alert('To install on iPhone/iPad:\n1. Tap the "Share" button at the bottom.\n2. Scroll down and tap "Add to Home Screen".');
            } else {
                alert('To install this app:\n1. Click the "Install" icon in your browser address bar (top right).\nOR\n2. Open your browser menu (3 dots) and select "Install App" or "Add to Home Screen".');
            }
        }
    });
}
