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
let trackerData = [];
let weeklyBudget = 0;
let subscriptions = [];
let hasChangesSinceLastSave = false;

function setHasChangesSinceLastSave(val) {
    hasChangesSinceLastSave = val;
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        if (val) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 Save';
        } else {
            saveBtn.disabled = true;
            saveBtn.textContent = '✓ Saved';
        }
    }
}

// Load user-specific cached data immediately on load if user is logged in
const initialUser = JSON.parse(localStorage.getItem('currentUser'));
if (initialUser && initialUser.phone) {
    trackerData = JSON.parse(localStorage.getItem(`trackerData_${initialUser.phone}`)) || [];
    weeklyBudget = parseFloat(localStorage.getItem(`weeklyBudget_${initialUser.phone}`)) || 0;
    subscriptions = JSON.parse(localStorage.getItem(`subscriptions_${initialUser.phone}`)) || [];
} else {
    trackerData = JSON.parse(localStorage.getItem('trackerData')) || [];
    weeklyBudget = parseFloat(localStorage.getItem('weeklyBudget')) || 0;
    subscriptions = JSON.parse(localStorage.getItem('subscriptions')) || [];
}

// Chart management
let weeklyChart = null;

// Confetti Gamification - Premium Dual-Cannon Burst
function fireConfetti() {
    if (typeof confetti === 'function') {
        // First burst
        confetti({
            particleCount: 50,
            angle: 60,
            spread: 60,
            origin: { x: 0, y: 0.9 },
            colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
        });
        confetti({
            particleCount: 50,
            angle: 120,
            spread: 60,
            origin: { x: 1, y: 0.9 },
            colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
        });
        
        // Second quick burst for a layered effect
        setTimeout(() => {
            confetti({
                particleCount: 30,
                angle: 65,
                spread: 50,
                origin: { x: 0, y: 0.9 },
                colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
            });
            confetti({
                particleCount: 30,
                angle: 115,
                spread: 50,
                origin: { x: 1, y: 0.9 },
                colors: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7']
            });
        }, 150);
    }
}

// Initialize the app
async function init() {
    // 1. Instantly process and display data from the local cache
    autoAddMissingDays();
    checkAutoLogSubscriptions(); // Process due subscription bills on startup
    renderTable();
    updateChart();
    updateBudgetStatus();
    if (budgetInput) {
        budgetInput.value = weeklyBudget || '';
    }

    // 2. Show reminder popup & send notification for upcoming subscriptions
    setTimeout(() => checkAndShowReminders(), 2000);

    // 3. Perform database checks and synchronization in the background without blocking render
    recoverUserDocument().then(() => {
        return fetchCloudData();
    }).then(() => {
        checkRecoveryEmail();
    }).catch(err => {
        console.error("Background sync error in init:", err);
    });

    setHasChangesSinceLastSave(false);
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

    // If we have unsynced changes from offline mode, push them instead of overwriting
    if (localStorage.getItem(`unsynced_${user.phone}`) === 'true') {
        try {
            await syncToCloud();
            return;
        } catch (e) {
            console.warn("Could not sync offline data on fetch, keeping offline state.");
            return;
        }
    }

    try {
        const docRef = doc(db, "tracker_data", user.phone);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            let hasChanges = false;
            
            if (data.trackerData) {
                const localStr = JSON.stringify(trackerData);
                const remoteStr = JSON.stringify(data.trackerData);
                const localBudget = weeklyBudget;
                const remoteBudget = data.weeklyBudget || 0;
                
                if (localStr !== remoteStr || localBudget !== remoteBudget) {
                    trackerData = data.trackerData;
                    weeklyBudget = remoteBudget;
                    hasChanges = true;
                }
            }

            if (data.subscriptions) {
                const localSubsStr = JSON.stringify(subscriptions);
                const remoteSubsStr = JSON.stringify(data.subscriptions);
                if (localSubsStr !== remoteSubsStr) {
                    subscriptions = data.subscriptions;
                    hasChanges = true;
                }
            }
            
            if (hasChanges) {
                saveData(false); // Update local cache only
                renderTable();
                updateChart();
                updateBudgetStatus();
                if (budgetInput) budgetInput.value = weeklyBudget || '';
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
            subscriptions,
            updatedAt: new Date().toISOString()
        });
        localStorage.removeItem(`unsynced_${user.phone}`);
    } catch (err) {
        console.error("Firebase sync failed:", err);
        throw err; // Propagate error so local cache knows to mark it as unsynced
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
    saveData();
    updateBudgetStatus();
    setHasChangesSinceLastSave(true);
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
    setHasChangesSinceLastSave(true);

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
    setHasChangesSinceLastSave(true);
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
        setHasChangesSinceLastSave(true);
    }
}

function clearAll() {
    if (confirm('This will delete ALL entries. Proceed?')) {
        trackerData = [];
        subscriptions = [];
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (user && user.phone) {
            localStorage.removeItem(`trackerData_${user.phone}`);
            localStorage.removeItem(`weeklyBudget_${user.phone}`);
            localStorage.removeItem(`subscriptions_${user.phone}`);
            localStorage.setItem(`unsynced_${user.phone}`, 'true');
        } else {
            localStorage.removeItem('trackerData');
            localStorage.removeItem('weeklyBudget');
            localStorage.removeItem('subscriptions');
        }
        init();
    }
}

function saveData(cloudSync = true) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    const cacheKey = user && user.phone ? `trackerData_${user.phone}` : 'trackerData';
    const budgetKey = user && user.phone ? `weeklyBudget_${user.phone}` : 'weeklyBudget';
    const subKey = user && user.phone ? `subscriptions_${user.phone}` : 'subscriptions';

    localStorage.setItem(cacheKey, JSON.stringify(trackerData));
    localStorage.setItem(budgetKey, weeklyBudget.toString());
    localStorage.setItem(subKey, JSON.stringify(subscriptions));

    if (cloudSync && user && user.phone) {
        if (navigator.onLine) {
            syncToCloud().catch(err => {
                console.warn("Could not sync online, marking cache as unsynced:", err);
                localStorage.setItem(`unsynced_${user.phone}`, 'true');
            });
        } else {
            localStorage.setItem(`unsynced_${user.phone}`, 'true');
        }
    }
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
    if (!hasChangesSinceLastSave) return;

    saveData();
    updateChart();

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saved! 💾';
    }

    // Milestone Check: Positive Balance
    let totalEarns = 0, totalSpends = 0;
    trackerData.forEach(r => { totalEarns += (r.earns || 0) + (r.other || 0); totalSpends += (r.spends || 0); });
    if (totalEarns > 0 && totalEarns > totalSpends) {
        fireConfetti();
    }

    setTimeout(() => {
        setHasChangesSinceLastSave(false);
    }, 1000);
}



saveBtn.addEventListener('click', manualSave);
clearAllBtn.addEventListener('click', clearAll);
tableSearch?.addEventListener('input', renderTable);

const notifBanner = document.getElementById('notif-banner');
const notifAllowBtn = document.getElementById('notif-allow-btn');
const notifCloseBtn = document.getElementById('notif-close-btn');

async function checkNotificationPermission() {
    if (localStorage.getItem('notif_banner_dismissed') === 'true') return;
    if (Notification.permission === 'default') {
        if (notifBanner) notifBanner.style.display = 'flex';
    }
}

function hideBanner() {
    if (notifBanner) {
        localStorage.setItem('notif_banner_dismissed', 'true');
        notifBanner.classList.add('hide');
        setTimeout(() => { notifBanner.style.display = 'none'; }, 400);
    }
}

if (notifAllowBtn) {
    notifAllowBtn.addEventListener('click', async () => {
        localStorage.setItem('notif_banner_dismissed', 'true');
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const registration = await navigator.serviceWorker.ready;
                const token = await getToken(messaging, { 
                    vapidKey: vapidKey,
                    serviceWorkerRegistration: registration
                });
                if (token) console.log('FCM Token generated');
                checkAndShowReminders();
            }
        } catch (err) { console.error("Permission/Token error:", err); }
        hideBanner();
    });
}
if (notifCloseBtn) {
    notifCloseBtn.addEventListener('click', () => {
        localStorage.setItem('notif_banner_dismissed', 'true');
        hideBanner();
    });
}

onMessage(messaging, (payload) => {
    if (Notification.permission === "granted") {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(payload.notification.title, {
                    body: payload.notification.body,
                    icon: "/icon-192.png"
                });
            }).catch(err => {
                console.error("onMessage showNotification error:", err);
                try {
                    new Notification(payload.notification.title, { body: payload.notification.body, icon: "/icon-192.png" });
                } catch (e) {
                    alert(`${payload.notification.title}\n\n${payload.notification.body}`);
                }
            });
        } else {
            try {
                new Notification(payload.notification.title, { body: payload.notification.body, icon: "/icon-192.png" });
            } catch (e) {
                alert(`${payload.notification.title}\n\n${payload.notification.body}`);
            }
        }
    } else {
        alert(`${payload.notification.title}\n\n${payload.notification.body}`);
    }
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

// Profile Drawer Item Navigation & Actions
const drawerSettingsBtn = document.getElementById('drawer-settings-btn');
if (drawerSettingsBtn) {
    drawerSettingsBtn.addEventListener('click', () => {
        if (profileDrawer) profileDrawer.style.display = 'none';

        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(i => i.classList.remove('active'));

        const appViews = document.querySelectorAll('.app-view');
        appViews.forEach(v => v.classList.remove('active'));
        
        const settingsView = document.getElementById('settings-view');
        if (settingsView) settingsView.classList.add('active');

        const summaryStrip = document.getElementById('summary-strip');
        if (summaryStrip) summaryStrip.style.display = 'none';

        const fabBtn = document.getElementById('fab-add-btn');
        if (fabBtn) fabBtn.style.display = 'none';

        // Toggle header back button visibility
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn && profileTrigger) {
            backBtn.style.display = 'flex';
            profileTrigger.style.display = 'none';
        }

        initSettings();
    });
}

const drawerSecurityBtn = document.getElementById('drawer-security-btn');
if (drawerSecurityBtn) {
    drawerSecurityBtn.addEventListener('click', () => {
        if (profileDrawer) profileDrawer.style.display = 'none';
        const modal = document.getElementById('security-modal');
        if (modal) modal.style.display = 'flex';
    });
}

const drawerHelpBtn = document.getElementById('drawer-help-btn');
if (drawerHelpBtn) {
    drawerHelpBtn.addEventListener('click', () => {
        if (profileDrawer) profileDrawer.style.display = 'none';
        const modal = document.getElementById('feedback-modal');
        if (modal) modal.style.display = 'flex';
    });
}

// Settings Back Button Action (Go back to tracker and open profile drawer)
const settingsBackBtn = document.getElementById('settings-back-btn');
if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
        const trackerTab = document.getElementById('nav-tracker');
        if (trackerTab) {
            trackerTab.click();
        }
        if (profileDrawer) {
            profileDrawer.style.display = 'block';
        }
    });
}

// --- APP LOCK SECURITY MODULE ---
async function checkAppLock() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    // Skip if already verified in this session
    if (sessionStorage.getItem('app_verified') === 'true') return;

    // Try loading lock configuration from cache instantly
    const cacheKey = `userSettings_${user.phone}`;
    const cachedSettings = JSON.parse(localStorage.getItem(cacheKey));
    if (cachedSettings && cachedSettings.isLockActive && cachedSettings.appPin) {
        showLockOverlay(cachedSettings.appPin);
    }

    // Fetch latest security configurations from Firestore in the background
    try {
        const userRef = doc(db, "users", user.phone);
        getDoc(userRef).then(userSnap => {
            if (userSnap.exists()) {
                const userData = userSnap.data();
                localStorage.setItem(cacheKey, JSON.stringify(userData));
                // If lock wasn't active in cache, trigger lock instantly
                if (userData.isLockActive && userData.appPin && (!cachedSettings || !cachedSettings.isLockActive)) {
                    showLockOverlay(userData.appPin);
                }
            }
        }).catch(err => {
            console.warn("Background lock check failed:", err);
        });
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

// =============================================
// CONSOLIDATED SINGLE PAGE APPLICATION (SPA) MODULE
// =============================================

// --- Analytics & Insights State & DOM Selectors ---
let weekOffset = 0;
let currentYearForChart = new Date().getFullYear();
let monthlyEarnChartInstance = null;
let monthlySpendChartInstance = null;
let categoryEarnChartInstance = null;
let categorySpendChartInstance = null;

function getWeekRange(offset) {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    
    const monday = new Date(now.setDate(diffToMonday));
    monday.setDate(monday.getDate() + (offset * 7));
    monday.setHours(0,0,0,0);
    
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23,59,59,999);
    
    return { monday, sunday };
}

function initAnalytics() {
    const { monday, sunday } = getWeekRange(weekOffset);
    
    const fmt = { month: 'short', day: 'numeric' };
    const weekDisplay = document.getElementById('week-display');
    if (weekDisplay) {
        weekDisplay.textContent = `${monday.toLocaleDateString(undefined, fmt)} - ${sunday.toLocaleDateString(undefined, fmt)}`;
    }

    const thisWeekData = trackerData.filter(d => {
        const dDate = new Date(d.date);
        return dDate >= monday && dDate <= sunday;
    });

    const weekEarn = thisWeekData.reduce((s, r) => s + (r.earns || 0) + (r.other || 0), 0);
    const weekSpend = thisWeekData.reduce((s, r) => s + (r.spends || 0), 0);

    const weekEarnVal = document.getElementById('week-earn-val');
    const weekSpendVal = document.getElementById('week-spend-val');
    if (weekEarnVal) weekEarnVal.textContent = `₹${Math.round(weekEarn).toLocaleString()}`;
    if (weekSpendVal) weekSpendVal.textContent = `₹${Math.round(weekSpend).toLocaleString()}`;

    const max = Math.max(weekEarn, weekSpend, 5000);
    const earnProg = document.getElementById('earn-prog');
    const spendProg = document.getElementById('spend-prog');
    if (earnProg) earnProg.style.width = (weekEarn/max * 100) + '%';
    if (spendProg) spendProg.style.width = (weekSpend/max * 100) + '%';

    renderCategoryCharts(thisWeekData);

    // Monthly Summary Logic
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const monthNameSummary = document.getElementById('month-name-summary');
    if (monthNameSummary) monthNameSummary.textContent = `${monthNames[currentMonth]} Summary`;

    const thisMonthData = trackerData.filter(d => {
        const dObj = new Date(d.date);
        return dObj.getMonth() === currentMonth && dObj.getFullYear() === currentYear;
    });

    const monthEarn = thisMonthData.reduce((s, r) => s + (r.earns || 0) + (r.other || 0), 0);
    const monthSpend = thisMonthData.reduce((s, r) => s + (r.spends || 0), 0);

    const monthEarnVal = document.getElementById('month-earn-val');
    const monthSpendVal = document.getElementById('month-spend-val');
    if (monthEarnVal) monthEarnVal.textContent = `₹${Math.round(monthEarn).toLocaleString()}`;
    if (monthSpendVal) monthSpendVal.textContent = `₹${Math.round(monthSpend).toLocaleString()}`;
    
    calculateTrophies();
    initMonthlyChart();
}

function calculateTrophies() {
    const trophies = [
        { id: 'first_save', icon: '💰', title: 'First Save', desc: 'Saved first ₹1,000' },
        { id: 'streak_7', icon: '🔥', title: '7-Day Streak', desc: 'Logged 7 days in a row' },
        { id: 'big_earner', icon: '👑', title: 'Big Earner', desc: 'Earned ₹10k in a month' }
    ];

    let unlocked = { first_save: false, streak_7: false, big_earner: false };

    const totalEarn = trackerData.reduce((s, r) => s + (r.earns || 0) + (r.other || 0), 0);
    const totalSpend = trackerData.reduce((s, r) => s + (r.spends || 0), 0);
    if (totalEarn - totalSpend >= 1000) unlocked.first_save = true;

    const uniqueDates = [...new Set(trackerData.map(d => d.date))].sort((a,b) => new Date(a) - new Date(b));
    let maxStreak = 0, currentStreak = 0;
    for(let i=0; i<uniqueDates.length; i++) {
        if(i===0) { currentStreak = 1; }
        else {
            const prev = new Date(uniqueDates[i-1]);
            const curr = new Date(uniqueDates[i]);
            const diff = (curr - prev) / (1000 * 60 * 60 * 24);
            if(diff === 1) currentStreak++;
            else currentStreak = 1;
        }
        if(currentStreak > maxStreak) maxStreak = currentStreak;
    }
    if (maxStreak >= 7) unlocked.streak_7 = true;

    const monthMap = {};
    trackerData.forEach(d => {
        const ym = d.date.substring(0, 7);
        if(!monthMap[ym]) monthMap[ym] = 0;
        monthMap[ym] += (d.earns || 0) + (d.other || 0);
    });
    if (Object.values(monthMap).some(v => v >= 10000)) unlocked.big_earner = true;

    const grid = document.getElementById('trophy-room');
    if (grid) {
        grid.innerHTML = '';
        let count = 0;
        
        trophies.forEach(t => {
            const isUnlocked = unlocked[t.id];
            if (isUnlocked) count++;
            
            grid.innerHTML += `
                <div class="trophy-card ${isUnlocked ? '' : 'locked'}">
                    <div class="trophy-icon">${t.icon}</div>
                    <div class="trophy-title">${t.title}</div>
                    <div class="trophy-desc">${t.desc}</div>
                </div>
            `;
        });
        
        const trophyCount = document.getElementById('trophy-count');
        if (trophyCount) trophyCount.textContent = `${count}/${trophies.length}`;
    }
}

function renderCategoryCharts(data) {
    const earnMap = {}, spendMap = {};
    const colors = {
        'Salary': '#10b981', 'Gift': '#34d399', 'Food': '#ef4444', 
        'Shop': '#f59e0b', 'Travel': '#3b82f6', 'Rent': '#6366f1', 
        'Bills': '#ec4899', 'Other': '#94a3b8', '-': '#e2e8f0'
    };

    data.forEach(r => {
        const cat = r.category || '-';
        if (r.earns) earnMap['Salary'] = (earnMap['Salary'] || 0) + r.earns;
        if (r.other) earnMap['Other Income'] = (earnMap['Other Income'] || 0) + r.other;
        if (r.spends) spendMap[cat] = (spendMap[cat] || 0) + r.spends;
    });

    const drawDoughnut = (ctxId, map, centerId, chartInstanceVar) => {
        const canvas = document.getElementById(ctxId);
        if (!canvas) return { labels: [], values: [], bg: [] };
        
        const labels = Object.keys(map);
        const values = Object.values(map);
        const bg = labels.map(l => colors[l] || colors['Other']);
        
        if (chartInstanceVar === 'earn' && categoryEarnChartInstance) {
            categoryEarnChartInstance.destroy();
        } else if (chartInstanceVar === 'spend' && categorySpendChartInstance) {
            categorySpendChartInstance.destroy();
        }

        const newChart = new Chart(canvas, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: bg, borderWidth: 0, cutout: '75%' }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });

        if (chartInstanceVar === 'earn') categoryEarnChartInstance = newChart;
        else categorySpendChartInstance = newChart;

        const top = labels.reduce((a, b) => map[a] > map[b] ? a : b, '-');
        const topEl = document.getElementById(centerId);
        if (topEl) topEl.textContent = top === '-' ? 'None' : top;
        return { labels, values, bg };
    };

    const eData = drawDoughnut('earn-chart', earnMap, 'top-earn-name', 'earn');
    const sData = drawDoughnut('spend-chart', spendMap, 'top-spend-name', 'spend');

    const createLegend = (elId, data) => {
        const el = document.getElementById(elId);
        if (el) {
            el.innerHTML = data.labels.map((l, i) => `
                <div class="legend-item" style="display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 2px 0;">
                    <div class="legend-left" style="display: flex; align-items: center; gap: 8px;">
                        <div class="dot" style="width: 8px; height: 8px; border-radius: 2px; background:${data.bg[i]}"></div>
                        <span class="name" style="font-weight: 600; color: #475569;">${l}</span>
                    </div>
                    <span class="amt" style="font-weight: 700; color: #1e293b;">₹${Math.round(data.values[i])}</span>
                </div>
            `).join('');
        }
    };

    createLegend('earn-legend', eData);
    createLegend('spend-legend', sData);
}

function initMonthlyChart() {
    const yearDisplay = document.getElementById('year-display');
    if (yearDisplay) yearDisplay.textContent = currentYearForChart;
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyEarns = new Array(12).fill(0);
    const monthlySpends = new Array(12).fill(0);

    trackerData.forEach(d => {
        const dDate = new Date(d.date);
        if (dDate.getFullYear() === currentYearForChart) {
            const m = dDate.getMonth();
            monthlyEarns[m] += (d.earns || 0) + (d.other || 0);
            monthlySpends[m] += (d.spends || 0);
        }
    });

    const topLabelsPlugin = {
        id: 'topLabelsPlugin',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                meta.data.forEach((bar, index) => {
                    const data = dataset.data[index];
                    if (data > 0) {
                        ctx.fillStyle = dataset.backgroundColor;
                        ctx.font = 'bold 9px Inter, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        let text = data >= 1000 ? (data/1000).toFixed(1).replace('.0','') + 'k' : data;
                        ctx.fillText('₹' + text, bar.x, bar.y - 3);
                    }
                });
            });
        }
    };

    const earnCtx = document.getElementById('monthly-earn-chart');
    if (earnCtx) {
        if (monthlyEarnChartInstance) {
            monthlyEarnChartInstance.data.datasets[0].data = monthlyEarns;
            monthlyEarnChartInstance.update();
        } else {
            monthlyEarnChartInstance = new Chart(earnCtx, {
                type: 'bar',
                data: {
                    labels: monthNames,
                    datasets: [{
                        label: 'Earnings',
                        data: monthlyEarns,
                        backgroundColor: '#10b981',
                        borderRadius: 4,
                        barPercentage: 0.6
                    }]
                },
                options: {
                    layout: { padding: { top: 15 } },
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: function(context) { return ' ₹' + context.parsed.y; } } }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#64748b', maxTicksLimit: 6 }, grid: { color: '#f1f5f9' }, border: { display: false } },
                        x: { ticks: { font: { size: 10 }, color: '#64748b' }, grid: { display: false }, border: { display: false } }
                    }
                },
                plugins: [topLabelsPlugin]
            });
        }
    }

    const spendCtx = document.getElementById('monthly-spend-chart');
    if (spendCtx) {
        if (monthlySpendChartInstance) {
            monthlySpendChartInstance.data.datasets[0].data = monthlySpends;
            monthlySpendChartInstance.update();
        } else {
            monthlySpendChartInstance = new Chart(spendCtx, {
                type: 'bar',
                data: {
                    labels: monthNames,
                    datasets: [{
                        label: 'Spends',
                        data: monthlySpends,
                        backgroundColor: '#ef4444',
                        borderRadius: 4,
                        barPercentage: 0.6
                    }]
                },
                options: {
                    layout: { padding: { top: 15 } },
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: function(context) { return ' ₹' + context.parsed.y; } } }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#64748b', maxTicksLimit: 6 }, grid: { color: '#f1f5f9' }, border: { display: false } },
                        x: { ticks: { font: { size: 10 }, color: '#64748b' }, grid: { display: false }, border: { display: false } }
                    }
                },
                plugins: [topLabelsPlugin]
            });
        }
    }
}

// Wire up Analytics button events
document.getElementById('prev-week')?.addEventListener('click', () => { weekOffset--; initAnalytics(); });
document.getElementById('next-week')?.addEventListener('click', () => { if(weekOffset < 0) weekOffset++; initAnalytics(); });
document.getElementById('prev-year')?.addEventListener('click', () => { currentYearForChart--; initMonthlyChart(); });
document.getElementById('next-year')?.addEventListener('click', () => { currentYearForChart++; initMonthlyChart(); });


// --- Settings Logic & Modals ---
async function initSettings() {
    // Dark Mode Initialization
    const themeToggle = document.getElementById('theme-toggle-settings');
    if (themeToggle) {
        if (localStorage.getItem('theme') === 'dark') {
            themeToggle.checked = true;
            document.documentElement.classList.add('dark-theme');
        }
        
        // Dark Mode Event Listener
        const themeBtn = document.getElementById('theme-btn-settings');
        if (themeBtn) {
            themeBtn.onclick = (e) => {
                if (e.target !== themeToggle) {
                    themeToggle.checked = !themeToggle.checked;
                }
                
                if (themeToggle.checked) {
                    document.documentElement.classList.add('dark-theme');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.classList.remove('dark-theme');
                    localStorage.setItem('theme', 'light');
                }
            };
        }
    }

    // Populate static profile details
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        const pName = document.getElementById('p-name');
        const pPhone = document.getElementById('p-phone');
        const pAvatar = document.getElementById('p-avatar');
        const newName = document.getElementById('new-name');
        if (pName) pName.textContent = user.username;
        if (pPhone) pPhone.textContent = user.phone;
        if (pAvatar) pAvatar.textContent = user.username.charAt(0).toUpperCase();
        if (newName) newName.value = user.username;
        
        const cacheKey = `userSettings_${user.phone}`;
        const cachedSettings = JSON.parse(localStorage.getItem(cacheKey));
        
        const applySettings = (userData) => {
            const pEmail = document.getElementById('p-email');
            const lockStatus = document.getElementById('lock-status-settings');
            const lockToggle = document.getElementById('lock-toggle');
            
            if (userData.email && pEmail) {
                pEmail.textContent = userData.email;
                pEmail.style.color = '#6366f1';
            }
            if (lockStatus) {
                if (userData.isLockActive) {
                    lockStatus.textContent = "Active";
                    lockStatus.style.color = "#10b981";
                    if (lockToggle) lockToggle.checked = true;
                } else {
                    lockStatus.textContent = "Inactive";
                    lockStatus.style.color = "var(--text-muted)";
                    if (lockToggle) lockToggle.checked = false;
                }
            }
        };

        // Render instantly from local cache if available
        if (cachedSettings) {
            applySettings(cachedSettings);
        }

        // Fetch Firestore in the background non-blockingly
        const userRef = doc(db, "users", user.phone);
        getDoc(userRef).then(userSnap => {
            if (userSnap.exists()) {
                const userData = userSnap.data();
                localStorage.setItem(cacheKey, JSON.stringify(userData));
                applySettings(userData);
            }
        }).catch(err => {
            console.warn("Background settings update failed:", err);
        });
    }
}

// --- Modals Logic Wires ---
const editModal = document.getElementById('edit-modal');
const securityModal = document.getElementById('security-modal');
const emailModal = document.getElementById('email-modal');
const feedbackModal = document.getElementById('feedback-modal');
const referModal = document.getElementById('refer-modal');

document.getElementById('edit-profile-btn')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'flex'; });
document.getElementById('close-modal')?.addEventListener('click', () => { if (editModal) editModal.style.display = 'none'; });

document.getElementById('close-security-modal')?.addEventListener('click', () => { if (securityModal) securityModal.style.display = 'none'; });

document.getElementById('edit-email-btn')?.addEventListener('click', () => { if (emailModal) emailModal.style.display = 'flex'; });
document.getElementById('close-email-modal')?.addEventListener('click', () => { if (emailModal) emailModal.style.display = 'none'; });

document.getElementById('close-feedback-modal')?.addEventListener('click', () => { if (feedbackModal) feedbackModal.style.display = 'none'; });

// --- Profile Update ---
document.getElementById('save-profile')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-profile');
    const newName = document.getElementById('new-name')?.value;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (newName && user) {
        btn.textContent = "Syncing...";
        btn.disabled = true;
        try {
            await updateDoc(doc(db, "users", user.phone), { username: newName });
            user.username = newName;
            localStorage.setItem('currentUser', JSON.stringify(user));
            if (editModal) editModal.style.display = 'none';
            initSettings();
            initUser();
        } catch (err) {
            alert("Sync failed.");
        } finally {
            btn.textContent = "Save Changes";
            btn.disabled = false;
        }
    }
});

// --- Recovery Email Update ---
document.getElementById('save-email')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-email');
    const newEmail = document.getElementById('recovery-email-input')?.value;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (newEmail && newEmail.includes('@') && user) {
        btn.textContent = "Updating...";
        btn.disabled = true;
        try {
            await updateDoc(doc(db, "users", user.phone), { email: newEmail });
            alert("Recovery email updated!");
            if (emailModal) emailModal.style.display = 'none';
            initSettings();
        } catch (err) {
            alert("Update failed.");
        } finally {
            btn.textContent = "Update Email";
            btn.disabled = false;
        }
    } else { alert("Please enter a valid email."); }
});

// --- Support ticket submission ---
import { collection, addDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
document.getElementById('submit-ticket')?.addEventListener('click', async () => {
    const type = document.getElementById('ticket-type').value;
    const message = document.getElementById('ticket-message').value;
    const btn = document.getElementById('submit-ticket');
    const successOverlay = document.getElementById('success-overlay-settings');
    const user = JSON.parse(localStorage.getItem('currentUser'));

    if (!message.trim()) return alert("Please type a message.");
    if (!user) return alert("You must be logged in.");

    btn.textContent = "Sending...";
    btn.disabled = true;

    try {
        await addDoc(collection(db, "support_tickets"), {
            userId: user.phone,
            username: user.username,
            type: type,
            message: message,
            status: 'open',
            createdAt: serverTimestamp()
        });

        if (feedbackModal) feedbackModal.style.display = 'none';
        document.getElementById('ticket-message').value = "";
        
        if (successOverlay) successOverlay.style.display = 'flex';
    } catch (err) {
        console.error(err);
        alert("Failed to send message. Please try again.");
    } finally {
        btn.textContent = "Submit Ticket";
        btn.disabled = false;
    }
});

document.getElementById('success-close-settings')?.addEventListener('click', () => {
    const overlay = document.getElementById('success-overlay-settings');
    if (overlay) overlay.style.display = 'none';
});

// --- Security PIN Logic ---
let settingsPin = "";
const settingsPinDots = document.querySelectorAll('#security-modal .pin-dot');
const settingsPinButtons = document.querySelectorAll('#security-modal .pin-btn');

settingsPinButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const val = btn.textContent;
        if (val === "⌫" || val === "←" || val.trim() === '') {
            settingsPin = settingsPin.slice(0, -1);
        } else if (settingsPin.length < 4) {
            settingsPin += val;
        }
        updateSettingsPinUI();
    });
});

function updateSettingsPinUI() {
    settingsPinDots.forEach((dot, i) => {
        if (i < settingsPin.length) dot.classList.add('filled');
        else dot.classList.remove('filled');
    });
}

document.getElementById('save-security')?.addEventListener('click', async () => {
    const isLockActive = document.getElementById('lock-toggle').checked;
    const btn = document.getElementById('save-security');
    const user = JSON.parse(localStorage.getItem('currentUser'));

    if (isLockActive && settingsPin.length !== 4) {
        return alert("Please set a 4-digit PIN to enable App Lock.");
    }

    btn.textContent = "Updating...";
    btn.disabled = true;

    try {
        const userRef = doc(db, "users", user.phone);
        const updates = { isLockActive: isLockActive };
        if (settingsPin.length === 4) updates.appPin = settingsPin;

        await updateDoc(userRef, updates);
        alert("Security settings updated successfully!");
        if (securityModal) securityModal.style.display = 'none';
        initSettings();
    } catch (err) {
        alert("Failed to update security.");
    } finally {
        btn.textContent = "Save Security Rules";
        btn.disabled = false;
    }
});

// Logout in settings
document.getElementById('logout-btn-settings')?.addEventListener('click', () => {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem('currentUser');
        localStorage.removeItem('trackerData');
        localStorage.removeItem('weeklyBudget');
        window.location.replace('auth.html');
    }
});




// =============================================
// NAV ROUTING & DYNAMIC VIEWS INTEGRATION
// =============================================
const navItems = document.querySelectorAll('.nav-item');
const appViews = document.querySelectorAll('.app-view');
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const viewId = item.getAttribute('data-view');
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        appViews.forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        // Hide settings back button and show profile trigger when returning to bottom nav tabs
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn) backBtn.style.display = 'none';
        if (profileTrigger) profileTrigger.style.display = 'flex';
        
        // Show the summary strip only on the Tracker page
        const summaryStrip = document.getElementById('summary-strip');
        if (summaryStrip) {
            if (viewId === 'tracker-view') {
                summaryStrip.style.display = 'flex';
            } else {
                summaryStrip.style.display = 'none';
            }
        }

        // Show the floating quick-add button only on the Tracker page
        const fabBtn = document.getElementById('fab-add-btn');
        if (fabBtn) {
            if (viewId === 'tracker-view') {
                fabBtn.style.display = 'flex';
            } else {
                fabBtn.style.display = 'none';
            }
        }
        
        if (viewId === 'tracker-view') {
            renderTable();
        } else if (viewId === 'analytics-view') {
            updateChart();
            initAnalytics();
        } else if (viewId === 'bills-view') {
            initBillsView();
        } else if (viewId === 'settings-view') {
            initSettings();
        }
    });
});

// Window online restoration sync event listener
window.addEventListener('online', () => {
    console.log("Internet connection restored. Synchronizing offline data...");
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user && user.phone && localStorage.getItem(`unsynced_${user.phone}`) === 'true') {
        syncToCloud().then(() => {
            console.log("Offline changes successfully synchronized with the cloud database.");
        }).catch(err => {
            console.error("Failed to sync offline changes on reconnection:", err);
        });
    }
});

// Initial boot logic
initUser();
initSettings();

// ===== BILLS & SUBSCRIPTION CALENDAR LOGIC =====
let calendarDate = new Date(); // tracks current month viewed in calendar

// ─── Send notification via Service Worker (works on mobile PWA) ───
function sendLocalNotification(title, body, tag) {
    if (Notification.permission !== 'granted') {
        console.warn("sendLocalNotification called, but permission is not granted. Current permission:", Notification.permission);
        return;
    }
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, {
                body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: tag || 'sub-reminder-' + Date.now(),
                vibrate: [200, 100, 200],
                data: { url: '/' }
            });
        }).catch(err => {
            console.error("Failed to show notification via service worker ready:", err);
            try {
                new Notification(title, { body, icon: '/icon-192.png' });
            } catch (e) {
                console.error("Fallback notification constructor failed:", e);
            }
        });
    } else {
        try {
            new Notification(title, { body, icon: '/icon-192.png' });
        } catch (e) {
            console.error("Fallback notification constructor failed:", e);
        }
    }
}

// ─── Request notification permission properly ───
async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

function checkAutoLogSubscriptions() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;
    
    let dateChanged = false;
    const todayStr = getLocalDateString(new Date());
    
    subscriptions.forEach(sub => {
        if (!sub.nextBillingDate) return;
        
        let nextBill = new Date(sub.nextBillingDate);
        nextBill.setHours(0,0,0,0);
        
        let today = new Date();
        today.setHours(0,0,0,0);
        
        // Loop to log missed billing cycles
        while (nextBill <= today) {
            const loggedDate = getLocalDateString(nextBill);
            trackerData.unshift({
                date: loggedDate,
                earns: null,
                other: null,
                spends: sub.price,
                category: sub.category || 'Bills'
            });
            
            if (sub.cycle === 'weekly') {
                nextBill.setDate(nextBill.getDate() + 7);
            } else if (sub.cycle === 'yearly') {
                nextBill.setFullYear(nextBill.getFullYear() + 1);
            } else {
                nextBill.setMonth(nextBill.getMonth() + 1);
            }
            dateChanged = true;
        }
        
        sub.nextBillingDate = getLocalDateString(nextBill);
    });
    
    if (dateChanged) {
        trackerData.sort((a, b) => b.date.localeCompare(a.date));
        saveData();
        renderTable();
        updateChart();
        updateBudgetStatus();
    }
}

// ─── Check and show in-app popup + send daily notification ───
function checkAndShowReminders() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || subscriptions.length === 0) return;

    const todayStr = getLocalDateString(new Date());
    const lastReminderDay = localStorage.getItem(`lastReminderDay_${user.phone}`);

    const today = new Date();
    today.setHours(0,0,0,0);

    // Find subscriptions due in 1 or 2 days
    const upcomingSubs = subscriptions.filter(sub => {
        if (!sub.nextBillingDate) return false;
        const billingDate = new Date(sub.nextBillingDate);
        billingDate.setHours(0,0,0,0);
        const diffDays = Math.round((billingDate - today) / (1000 * 60 * 60 * 24));
        return diffDays === 1 || diffDays === 2;
    });

    if (upcomingSubs.length === 0) return;

    // ── Show in-app popup (always on app open if there are reminders) ──
    const container = document.getElementById('reminder-list-container');
    const modal = document.getElementById('sub-reminder-modal');
    if (container && modal) {
        container.innerHTML = '';
        upcomingSubs.forEach(sub => {
            const billingDate = new Date(sub.nextBillingDate);
            billingDate.setHours(0,0,0,0);
            const diffDays = Math.round((billingDate - today) / (1000 * 60 * 60 * 24));
            const urgencyColor = diffDays === 1 ? '#ef4444' : '#f59e0b';
            const urgencyText = diffDays === 1 ? 'Tomorrow!' : 'In 2 days';
            const catEmojis = { 'Bills': '⚡', 'Food': '🍔', 'Shop': '🛍️', 'Travel': '🚌', 'Rent': '🏠', 'Other': '📦' };
            const emoji = catEmojis[sub.category] || '📅';

            const item = document.createElement('div');
            item.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;`;
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="font-size:22px;">${emoji}</div>
                    <div>
                        <div style="font-size:12px; font-weight:800; color:#1e293b;">${sub.name}</div>
                        <div style="font-size:10px; color:#64748b; font-weight:600;">Due: ${sub.nextBillingDate}</div>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:13px; font-weight:800; color:#ef4444;">₹${sub.price}</div>
                    <div style="font-size:9px; font-weight:800; color:${urgencyColor}; background:${urgencyColor}22; padding:2px 6px; border-radius:8px;">${urgencyText}</div>
                </div>
            `;
            container.appendChild(item);
        });

        // Show popup with a slight delay so app feels ready
        setTimeout(() => { modal.style.display = 'flex'; }, 1500);
    }

    // ── Send push notification once per day ──
    if (lastReminderDay === todayStr) return; // Already sent today
    localStorage.setItem(`lastReminderDay_${user.phone}`, todayStr);

    // Request permission if not yet granted, then notify
    requestNotificationPermission().then(granted => {
        if (!granted) return;
        upcomingSubs.forEach((sub, i) => {
            const billingDate = new Date(sub.nextBillingDate);
            billingDate.setHours(0,0,0,0);
            const diffDays = Math.round((billingDate - today) / (1000 * 60 * 60 * 24));
            const dueText = diffDays === 1 ? 'tomorrow' : 'in 2 days';
            setTimeout(() => {
                sendLocalNotification(
                    `💳 ${sub.name} renews ${dueText}!`,
                    `₹${sub.price} will be charged on ${sub.nextBillingDate}. Be prepared!`,
                    `sub-reminder-${sub.id || sub.name}`
                );
            }, i * 1500); // stagger notifications
        });
    });
}



function initBillsView() {
    renderCalendar();
    renderSubscriptionsList();
    
    // Set default date input value to today in local timezone
    const defaultDateInput = document.getElementById('sub-billing-date');
    if (defaultDateInput && !defaultDateInput.value) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        defaultDateInput.value = new Date(now - offset).toISOString().split('T')[0];
    }

    // --- Subscription Autocomplete Recommendations ---
    const subNameInput = document.getElementById('sub-name');
    const suggestionsBox = document.getElementById('sub-name-suggestions');
    
    const subRecommendations = [
        { name: "Netflix", price: 199, cycle: "monthly", category: "Bills" },
        { name: "Spotify", price: 119, cycle: "monthly", category: "Bills" },
        { name: "YouTube Premium", price: 149, cycle: "monthly", category: "Bills" },
        { name: "Mobile Recharge", price: 299, cycle: "monthly", category: "Bills" },
        { name: "Gym Membership", price: 1000, cycle: "monthly", category: "Other" },
        { name: "Amazon Prime", price: 179, cycle: "monthly", category: "Shop" },
        { name: "Disney+ Hotstar", price: 299, cycle: "monthly", category: "Bills" },
        { name: "iCloud Storage", price: 75, cycle: "monthly", category: "Bills" },
        { name: "Rent", price: 10000, cycle: "monthly", category: "Rent" },
        { name: "Broadband / WiFi", price: 799, cycle: "monthly", category: "Bills" },
        { name: "GitHub Copilot", price: 900, cycle: "monthly", category: "Other" },
        { name: "Microsoft 365", price: 489, cycle: "monthly", category: "Bills" },
        { name: "Zomato Gold", price: 150, cycle: "monthly", category: "Food" },
        { name: "Swiggy One", price: 150, cycle: "monthly", category: "Food" }
    ];

    if (subNameInput && suggestionsBox) {
        subNameInput.addEventListener('input', () => {
            const val = subNameInput.value.trim().toLowerCase();
            if (!val) {
                suggestionsBox.style.display = 'none';
                return;
            }

            const matches = subRecommendations.filter(item => 
                item.name.toLowerCase().includes(val)
            );

            if (matches.length === 0) {
                suggestionsBox.style.display = 'none';
                return;
            }

            suggestionsBox.innerHTML = '';
            matches.forEach(item => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `
                    <span>${item.name}</span>
                    <span class="suggestion-item-price">₹${item.price} • ${item.cycle}</span>
                `;
                div.addEventListener('click', () => {
                    subNameInput.value = item.name;
                    document.getElementById('sub-price').value = item.price;
                    document.getElementById('sub-cycle').value = item.cycle;
                    document.getElementById('sub-category').value = item.category;
                    suggestionsBox.style.display = 'none';
                });
                suggestionsBox.appendChild(div);
            });
            suggestionsBox.style.display = 'block';
        });

        // Hide suggestions when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target !== subNameInput && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
                suggestionsBox.style.display = 'none';
            }
        });
    }
    
    // Wire up Add Subscription button
    const addSubBtn = document.getElementById('add-sub-btn');
    if (addSubBtn) {
        const newAddBtn = addSubBtn.cloneNode(true);
        addSubBtn.parentNode.replaceChild(newAddBtn, addSubBtn);
        
        newAddBtn.addEventListener('click', () => {
            const name = document.getElementById('sub-name').value.trim();
            const price = parseFloat(document.getElementById('sub-price').value) || 0;
            const cycle = document.getElementById('sub-cycle').value;
            const dateStr = document.getElementById('sub-billing-date').value;
            const category = document.getElementById('sub-category').value;
            
            if (!name || price <= 0 || !dateStr) {
                return alert("Please fill all subscription fields with valid values.");
            }
            
            subscriptions.push({
                id: Date.now().toString(),
                name,
                price,
                cycle,
                nextBillingDate: dateStr,
                category
            });
            
            saveData();
            renderCalendar();
            renderSubscriptionsList();
            setHasChangesSinceLastSave(true);
            
            // Clear inputs
            document.getElementById('sub-name').value = '';
            document.getElementById('sub-price').value = '';
            if (suggestionsBox) suggestionsBox.style.display = 'none';
        });
    }
    
    // Wire up Calendar navigation month controls
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');
    if (prevMonthBtn) {
        prevMonthBtn.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            renderCalendar();
        };
    }
    if (nextMonthBtn) {
        nextMonthBtn.onclick = () => {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            renderCalendar();
        };
    }
}

function renderCalendar() {
    const daysGrid = document.getElementById('calendar-days-grid');
    const titleEl = document.getElementById('calendar-title');
    if (!daysGrid || !titleEl) return;
    
    daysGrid.innerHTML = '';
    
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    titleEl.textContent = `${monthNames[month]} ${year}`;
    
    // Align starting day of the week with Monday as 0 index
    const firstDay = new Date(year, month, 1);
    let startDayIndex = firstDay.getDay(); // 0 = Sunday, 1 = Monday
    startDayIndex = startDayIndex === 0 ? 6 : startDayIndex - 1;
    
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    // Render blank spacing offsets
    for (let i = 0; i < startDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        daysGrid.appendChild(emptyCell);
    }
    
    const today = new Date();
    
    // Render monthly calendar days
    for (let day = 1; day <= totalDays; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        dayCell.textContent = day;
        
        const cellDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // Highlight active today cell
        if (today.getFullYear() === year && today.getMonth() === month && today.getDate() === day) {
            dayCell.classList.add('today');
        }
        
        // Check if there are active subscriptions due on this calendar cell
        const dueSubs = subscriptions.filter(sub => sub.nextBillingDate === cellDateStr);
        
        if (dueSubs.length > 0) {
            const dotsContainer = document.createElement('div');
            dotsContainer.className = 'calendar-day-dots';
            
            dueSubs.slice(0, 3).forEach(sub => {
                const dot = document.createElement('div');
                dot.className = `calendar-dot ${sub.category.toLowerCase()}`;
                dotsContainer.appendChild(dot);
            });
            
            dayCell.appendChild(dotsContainer);
            
            // Add dynamic tap descriptions for subscriptions
            dayCell.addEventListener('click', () => {
                const subNames = dueSubs.map(s => `• ${s.name} (₹${s.price})`).join('\n');
                alert(`📅 Subscriptions due on ${cellDateStr}:\n${subNames}`);
            });
        }
        
        daysGrid.appendChild(dayCell);
    }
}

function renderSubscriptionsList() {
    const container = document.getElementById('subs-list-container');
    if (!container) return;
    
    container.innerHTML = '';
    if (subscriptions.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 11px; padding: 15px 0;">No active subscriptions tracked.</p>';
        return;
    }
    
    const catEmojis = { 'Bills': '⚡', 'Food': '🍔', 'Shop': '🛍️', 'Travel': '🚌', 'Rent': '🏠', 'Other': '📦' };
    
    subscriptions.forEach((sub, idx) => {
        const card = document.createElement('div');
        card.className = 'sub-item-card';
        card.innerHTML = `
            <div class="sub-item-left">
                <div class="sub-item-icon">${catEmojis[sub.category] || '📅'}</div>
                <div class="sub-item-details">
                    <span class="sub-item-name">${sub.name}</span>
                    <span class="sub-item-meta">${sub.cycle.toUpperCase()} • Next: ${sub.nextBillingDate}</span>
                </div>
            </div>
            <div class="sub-item-right">
                <span class="sub-item-price">₹${sub.price}</span>
                <button class="sub-delete-btn" onclick="deleteSubscription(${idx})">✕</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.deleteSubscription = function(idx) {
    if (confirm(`Stop tracking ${subscriptions[idx].name}?`)) {
        subscriptions.splice(idx, 1);
        saveData();
        renderCalendar();
        renderSubscriptionsList();
        setHasChangesSinceLastSave(true);
    }
};

window.checkAutoLogSubscriptions = checkAutoLogSubscriptions;
window.checkAndShowReminders = checkAndShowReminders;
window.initBillsView = initBillsView;

