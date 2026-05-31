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

// Confetti Gamification
function fireConfetti() {
    if (typeof confetti === 'function') {
        const duration = 2500;
        const end = Date.now() + duration;

        (function frame() {
            confetti({
                particleCount: 5,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
            });
            confetti({
                particleCount: 5,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    }
}

// Initialize the app
async function init() {
    autoAddMissingDays();
    
    // Recover user to the new database if they are an old user
    await recoverUserDocument();
    
    // Sync with Firebase if logged in
    await fetchCloudData();
    checkRecoveryEmail(); // Check if old user needs to set recovery email
    
    renderTable();
    updateChart();
    updateBudgetStatus();
    budgetInput.value = weeklyBudget || '';
}

async function recoverUserDocument() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    try {
        const userRef = doc(db, "users", user.phone);
        const userSnap = await getDoc(userRef);
        
        // If the user is in localStorage but missing from the new database, recreate them!
        if (!userSnap.exists()) {
            await setDoc(userRef, {
                username: user.username,
                phone: user.phone,
                password: "recovered_user", // Placeholder since we don't know their old password
                createdAt: new Date().toISOString(),
                status: "active"
            });
            // Force sync their local tracker data to the new database
            await syncToCloud();
        }
    } catch (err) {
        console.error("Error recovering user:", err);
    }
}

async function checkRecoveryEmail() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    try {
        const userRef = doc(db, "users", user.phone);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            // If user exists but has no email, show the mandatory modal
            if (!userData.email) {
                const modal = document.getElementById('email-required-modal');
                const emailInput = document.getElementById('update-email-input');
                const submitBtn = document.getElementById('submit-update-email');
                
                modal.style.display = 'flex';

                submitBtn.onclick = async () => {
                    const email = emailInput.value.trim();
                    if (!email || !email.includes('@')) {
                        return alert("Please enter a valid email address.");
                    }
                    
                    submitBtn.textContent = "Securing Account...";
                    submitBtn.disabled = true;
                    
                    try {
                        await setDoc(userRef, { email: email }, { merge: true });
                        alert("Recovery email set successfully! Your account is now secure.");
                        modal.style.display = 'none';
                    } catch (err) {
                        alert("Error saving email. Please try again.");
                    } finally {
                        submitBtn.textContent = "Secure My Account";
                        submitBtn.disabled = false;
                    }
                };
            }
        }
    } catch (err) {
        console.error("Error checking recovery email:", err);
    }
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
    
    // ── Desktop table ──
    if (tableBody) {
        tableBody.innerHTML = '';
        if (displayData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-muted);">No records found.</td></tr>';
        } else {
            displayData.forEach((row) => {
                const actualIndex = trackerData.findIndex(d => d.date === row.date);
                createRowUI(row, actualIndex);
            });
        }
    }

    // ── Mobile card list ──
    const cardList = document.getElementById('card-list');
    if (cardList) {
        cardList.innerHTML = '';
        if (displayData.length === 0) {
            cardList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;font-weight:600;">No records found.</p>';
        } else {
            displayData.forEach((row) => {
                const actualIndex = trackerData.findIndex(d => d.date === row.date);
                createCardUI(row, actualIndex, cardList);
            });
        }
    }

    updateGrandTotals(filteredData);
}

function createCardUI(row, index, container) {
    const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
    const balanceClass = balance >= 0 ? 'positive' : 'negative';
    const balanceSign = balance >= 0 ? '+' : '';
    const catEmojis = { '-': '—', 'Food': '🍔', 'Shop': '🛍️', 'Travel': '🚌', 'Rent': '🏠', 'Bills': '⚡', 'Other': '📦' };
    const categories = ['-','Food','Shop','Travel','Rent','Bills','Other'];
    const catOptions = categories.map(c =>
        `<option value="${c}" ${row.category === c ? 'selected' : ''}>${catEmojis[c] || ''} ${c}</option>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'expense-card';
    card.dataset.index = index;
    card.innerHTML = `
        <div class="card-header">
            <input type="date" class="card-date-input" value="${row.date || ''}" 
                onchange="updateData(${index}, 'date', this.value)">
            <div class="card-badge">
                <span class="card-balance ${balanceClass}">₹${balanceSign}${Math.round(balance)}</span>
                <button class="card-delete-btn" onclick="deleteRow(${index})" title="Delete">✕</button>
            </div>
        </div>
        <div class="card-body">
            <div class="card-field">
                <span class="card-field-label">💰 Earns</span>
                <input type="number" class="card-field-input earn-input" 
                    placeholder="0" value="${row.earns || ''}" inputmode="decimal"
                    onfocus="this.select()" 
                    oninput="updateData(${index}, 'earns', this.value); updateCardBalance(this, ${index});">
            </div>
            <div class="card-field">
                <span class="card-field-label">🎁 Other</span>
                <input type="number" class="card-field-input earn-input" 
                    placeholder="0" value="${row.other || ''}" inputmode="decimal"
                    onfocus="this.select()" 
                    oninput="updateData(${index}, 'other', this.value); updateCardBalance(this, ${index});">
            </div>
            <div class="card-field">
                <span class="card-field-label">💸 Spend</span>
                <input type="number" class="card-field-input spend-input" 
                    placeholder="0" value="${row.spends || ''}" inputmode="decimal"
                    onfocus="this.select()" 
                    oninput="updateData(${index}, 'spends', this.value); updateCardBalance(this, ${index});">
            </div>
        </div>
        <div class="card-footer">
            <select class="card-cat-select" onchange="updateData(${index}, 'category', this.value)">
                ${catOptions}
            </select>
        </div>
    `;
    container.appendChild(card);
}

function updateCardBalance(inputEl, index) {
    const card = inputEl.closest('.expense-card');
    if (!card) return;
    const bal = (trackerData[index].earns || 0) + (trackerData[index].other || 0) - (trackerData[index].spends || 0);
    const balEl = card.querySelector('.card-balance');
    if (balEl) {
        balEl.textContent = `₹${bal >= 0 ? '+' : ''}${Math.round(bal)}`;
        balEl.className = `card-balance ${bal >= 0 ? 'positive' : 'negative'}`;
    }
}

function createRowUI(row, index) {
    const tr = document.createElement('tr');
    const balance = (row.earns || 0) + (row.other || 0) - (row.spends || 0);
    const balanceClass = balance >= 0 ? 'positive' : 'negative';
    const categories = ['-','Food','Shop','Travel','Rent','Bills','Other'];
    
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

    // Gamification Milestone
    if (((earns || 0) + (other || 0)) > (spends || 0) * 1.5) {
        // High savings for this transaction
        fireConfetti();
    }
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
    const totalIncome = tEarns + tOther;

    // ── Desktop table totals ──
    if (grandEarnsEl)   grandEarnsEl.textContent   = `₹${Math.round(tEarns)}`;
    if (grandOtherEl)   grandOtherEl.textContent   = `₹${Math.round(tOther)}`;
    if (grandSpendsEl)  grandSpendsEl.textContent  = `₹${Math.round(tSpends)}`;
    if (grandBalanceEl) {
        grandBalanceEl.textContent = `₹${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
        grandBalanceEl.style.color = tBalance >= 0 ? '#059669' : '#dc2626';
    }

    // ── Mobile totals bar ──
    const mEarns   = document.getElementById('m-grand-earns');
    const mOther   = document.getElementById('m-grand-other');
    const mSpends  = document.getElementById('m-grand-spends');
    const mBalance = document.getElementById('m-grand-balance');
    if (mEarns)   mEarns.textContent   = `₹${Math.round(tEarns)}`;
    if (mOther)   mOther.textContent   = `₹${Math.round(tOther)}`;
    if (mSpends)  mSpends.textContent  = `₹${Math.round(tSpends)}`;
    if (mBalance) {
        mBalance.textContent = `₹${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
        mBalance.style.color = tBalance >= 0 ? '#6366f1' : '#dc2626';
    }

    // ── Summary Strip ──
    const ssEarn    = document.getElementById('ss-earn');
    const ssOther   = document.getElementById('ss-other');
    const ssSpend   = document.getElementById('ss-spend');
    const ssBalance = document.getElementById('ss-balance');
    if (ssEarn)  ssEarn.textContent  = `₹${Math.round(tEarns)}`;
    if (ssOther) ssOther.textContent = `₹${Math.round(tOther)}`;
    if (ssSpend) ssSpend.textContent = `₹${Math.round(tSpends)}`;
    if (ssBalance) {
        ssBalance.textContent = `₹${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
        ssBalance.style.color = tBalance >= 0 ? '#059669' : '#dc2626';
    }
}

const saveBtn = document.getElementById('save-btn');
function manualSave() {
    saveData();
    updateChart();
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saved!';
    saveBtn.style.opacity = '0.7';

    // Milestone Check: Positive Balance
    let totalEarns = 0, totalSpends = 0;
    trackerData.forEach(r => { totalEarns += (r.earns || 0) + (r.other || 0); totalSpends += (r.spends || 0); });
    if (totalEarns > 0 && totalEarns > totalSpends) {
        fireConfetti();
    }

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

// Personal Notifications Listener (Admin Replies)
const user = JSON.parse(localStorage.getItem('currentUser'));
if (user && user.phone) {
    onSnapshot(doc(db, "notifications", user.phone), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            const msgId = data.timestamp ? data.timestamp.toMillis() : null;
            const lastRead = localStorage.getItem(`lastReadPersonal_${user.phone}`);
            
            if (data.active && data.message && msgId && msgId.toString() !== lastRead) {
                const title = data.title || "Admin Reply";
                const message = data.message;
                
                if (broadcastModal) { 
                    bcTitle.textContent = title.toUpperCase(); 
                    bcMessage.textContent = message; 
                    broadcastModal.style.display = 'flex'; 
                }
                
                localStorage.setItem(`lastReadPersonal_${user.phone}`, msgId.toString());
                
                if (Notification.permission === "granted") {
                    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body: message, icon: "/icon-192.png" }));
                    else new Notification(title, { body: message, icon: "/icon-192.png" });
                }
            }
        }
    });
}

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

// --- APP LOCK SECURITY MODULE ---
async function checkAppLock() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    // Skip if already verified in this session
    if (sessionStorage.getItem('app_verified') === 'true') return;

    try {
        const userRef = doc(db, "users", user.phone);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            if (userData.isLockActive && userData.appPin) {
                showLockOverlay(userData.appPin);
            }
        }
    } catch (e) { console.error("Lock check error:", e); }
}

function showLockOverlay(correctPin) {
    const overlay = document.getElementById('app-lock-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    let inputPin = "";
    const dots = document.querySelectorAll('.pin-dot-lock');
    const btns = document.querySelectorAll('.lock-pin-btn');

    btns.forEach(btn => {
        const newBtn = btn.cloneNode(true); // Remove previous listeners
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', () => {
            const val = newBtn.textContent;
            if (val === "⌫" || val === "←" || val.trim() === '') {
                inputPin = inputPin.slice(0, -1);
            } else if (inputPin.length < 4) {
                inputPin += val;
            }

            // Update UI
            dots.forEach((dot, i) => {
                if (i < inputPin.length) dot.classList.add('filled');
                else dot.classList.remove('filled');
            });

            // Check PIN
            if (inputPin.length === 4) {
                if (inputPin === correctPin) {
                    sessionStorage.setItem('app_verified', 'true');
                    overlay.style.fadeOut = "0.3s";
                    setTimeout(() => overlay.style.display = 'none', 300);
                } else {
                    alert("Incorrect PIN! Try again.");
                    inputPin = "";
                    dots.forEach(dot => dot.classList.remove('filled'));
                }
            }
        });
    });
}

// Update init to include lock check
const oldInit = init;
init = async function() {
    await checkAppLock();
    await oldInit();
}

init();
initUser();
setTimeout(checkNotificationPermission, 8000);

window.updateData = updateData;
window.deleteRow = deleteRow;
window.updateCardBalance = updateCardBalance;

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

// ===== Refer & Share Feature =====
const shareModal = document.getElementById('share-modal');
const referShareBtn = document.getElementById('refer-share-btn');
const shareUrlInput = document.getElementById('share-url-input');

function getAppUrl() {
    // Use the current page URL (works for hosted/local apps)
    return window.location.href.split('?')[0].split('#')[0];
}

if (referShareBtn) {
    referShareBtn.addEventListener('click', () => {
        // Close the profile drawer
        const drawer = document.getElementById('profile-drawer');
        if (drawer) drawer.style.display = 'none';
        // Populate and show the share modal
        if (shareUrlInput) shareUrlInput.value = getAppUrl();
        if (shareModal) shareModal.style.display = 'flex';
    });
}

function copyShareLink() {
    const url = getAppUrl();
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copy-link-btn');
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '&#10003; Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = original;
                btn.classList.remove('copied');
            }, 2000);
        }
    }).catch(() => {
        // Fallback for browsers without clipboard API
        if (shareUrlInput) {
            shareUrlInput.select();
            document.execCommand('copy');
            alert('Link copied!');
        }
    });
}

function shareWhatsApp() {
    const url = encodeURIComponent(getAppUrl());
    const text = encodeURIComponent('Hey! I use this awesome Expense Tracker app to manage my daily finances. Check it out: ');
    window.open(`https://wa.me/?text=${text}${url}`, '_blank');
}

function shareNative() {
    if (navigator.share) {
        navigator.share({
            title: 'Expense Tracker App',
            text: 'Hey! Track your daily expenses easily with this app!',
            url: getAppUrl(),
        }).catch(() => {});
    } else {
        // Fallback: just copy
        copyShareLink();
    }
}

// Close share modal when clicking outside
if (shareModal) {
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) shareModal.style.display = 'none';
    });
}

