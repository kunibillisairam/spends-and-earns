import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, query, collection, where, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js";

// Polyfill Notification API for unsupported browsers (e.g. mobile Safari, in-app webviews)
if (typeof window !== 'undefined') {
    if (typeof window.Notification === 'undefined') {
        const mockNotif = function(title, options) {
            this.title = title;
            this.options = options;
        };
        mockNotif.permission = 'denied';
        mockNotif.requestPermission = function() {
            return Promise.resolve('denied');
        };
        window.Notification = mockNotif;
        if (typeof global !== 'undefined' && !global.Notification) {
            global.Notification = mockNotif;
        }
        if (typeof self !== 'undefined' && !self.Notification) {
            self.Notification = mockNotif;
        }
    }
}

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

// ── Global Currency System ──
const SUPPORTED_CURRENCIES = {
    'INR': { symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
    'USD': { symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
    'EUR': { symbol: '€', name: 'Euro', flag: '🇪🇺' },
    'GBP': { symbol: '£', name: 'British Pound', flag: '🇬🇧' },
    'AED': { symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' }
};
let selectedCurrency = localStorage.getItem('selectedCurrency') || 'INR';

// Currency Symbol shortcut - used everywhere in the app
function CS() {
    return SUPPORTED_CURRENCIES[selectedCurrency]?.symbol || '₹';
}

function setCurrency(code, syncToCloudVal = true) {
    if (!SUPPORTED_CURRENCIES[code]) return;
    selectedCurrency = code;
    localStorage.setItem('selectedCurrency', code);
    
    // Re-render everything with the new currency symbol
    renderTable();
    updateGrandTotals();
    updateChart();
    updateBudgetStatus();
    
    // Re-render subscription views
    if (typeof renderCalendar === 'function') renderCalendar();
    if (typeof renderSubscriptionsList === 'function') renderSubscriptionsList();
    
    // Update currency display label in settings
    const currLabel = document.getElementById('currency-current-label');
    if (currLabel) {
        currLabel.textContent = `${SUPPORTED_CURRENCIES[code].flag} ${SUPPORTED_CURRENCIES[code].symbol} ${code}`;
    }
    
    // Update Set Limit input placeholder
    const budgetInput = document.getElementById('budget-input');
    if (budgetInput) {
        budgetInput.placeholder = `Set Limit (${SUPPORTED_CURRENCIES[code].symbol})`;
    }
    
    // Update Subscription Price Label
    const subPriceLabel = document.getElementById('sub-price-label');
    if (subPriceLabel) {
        subPriceLabel.textContent = `Price (${SUPPORTED_CURRENCIES[code].symbol})`;
    }
    
    // Update Quick Add Placeholders
    const newEarns = document.getElementById('new-earns');
    const newOther = document.getElementById('new-other');
    const newSpends = document.getElementById('new-spends');
    if (newEarns) newEarns.placeholder = `${SUPPORTED_CURRENCIES[code].symbol}0`;
    if (newOther) newOther.placeholder = `${SUPPORTED_CURRENCIES[code].symbol}0`;
    if (newSpends) newSpends.placeholder = `${SUPPORTED_CURRENCIES[code].symbol}0`;
    
    // Sync to Firebase
    if (syncToCloudVal) {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (user && user.phone) {
            import("https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js").then(({ updateDoc, doc: fbDoc }) => {
                updateDoc(fbDoc(db, "users", user.phone), { currency: code }).catch(e => console.warn("Currency sync failed:", e));
            });
        }
    }
}

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
    // Set active base currency (without syncing to cloud since it's already set)
    setCurrency(selectedCurrency, false);
    
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

function updateBudgetStatus(customBudget) {
    if (!budgetSpentEl) return;
    
    const budgetToUse = customBudget !== undefined ? customBudget : weeklyBudget;
    
    const now = new Date();
    const monday = getMonday(now);
    
    // Calculate Sunday (end of current week)
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    
    const weekSpends = trackerData.reduce((total, row) => {
        const d = parseDate(row.date);
        // Include transaction only if it lies within current Monday to Sunday
        if (d >= monday && d <= sunday) return total + (row.spends || 0);
        return total;
    }, 0);
    
    budgetSpentEl.textContent = `Spent: ${Math.round(weekSpends)}`;
    
    if (budgetToUse > 0) {
        const percent = Math.min((weekSpends / budgetToUse) * 100, 100);
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

if (budgetInput) {
    budgetInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) || 0;
        updateBudgetStatus(val);
    });
}

const setBudgetBtn = document.getElementById('set-budget-btn');
if (setBudgetBtn) {
    setBudgetBtn.addEventListener('click', () => {
        const val = parseFloat(budgetInput.value) || 0;
        weeklyBudget = val;
        saveData(true); // Persist to local cache and sync to Firebase cloud
        updateBudgetStatus();
        setHasChangesSinceLastSave(true);
        
        // Show success confirmation on the button
        const btn = document.getElementById('set-budget-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Set ✓';
        btn.style.background = 'var(--success-gradient)';
        btn.style.color = 'white';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
            btn.style.color = '';
        }, 1500);
    });
}

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
                <span class="card-balance ${balanceClass}">${CS()}${balanceSign}${Math.round(balance)}</span>
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
        balEl.textContent = `${CS()}${bal >= 0 ? '+' : ''}${Math.round(bal)}`;
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
    if (grandEarnsEl)   grandEarnsEl.textContent   = `${CS()}${Math.round(tEarns)}`;
    if (grandOtherEl)   grandOtherEl.textContent   = `${CS()}${Math.round(tOther)}`;
    if (grandSpendsEl)  grandSpendsEl.textContent  = `${CS()}${Math.round(tSpends)}`;
    if (grandBalanceEl) {
        grandBalanceEl.textContent = `${CS()}${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
        grandBalanceEl.style.color = tBalance >= 0 ? '#059669' : '#dc2626';
    }

    // ── Mobile totals bar ──
    const mEarns   = document.getElementById('m-grand-earns');
    const mOther   = document.getElementById('m-grand-other');
    const mSpends  = document.getElementById('m-grand-spends');
    const mBalance = document.getElementById('m-grand-balance');
    if (mEarns)   mEarns.textContent   = `${CS()}${Math.round(tEarns)}`;
    if (mOther)   mOther.textContent   = `${CS()}${Math.round(tOther)}`;
    if (mSpends)  mSpends.textContent  = `${CS()}${Math.round(tSpends)}`;
    if (mBalance) {
        mBalance.textContent = `${CS()}${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
        mBalance.style.color = tBalance >= 0 ? '#6366f1' : '#dc2626';
    }

    // ── Summary Strip ──
    const ssEarn    = document.getElementById('ss-earn');
    const ssOther   = document.getElementById('ss-other');
    const ssSpend   = document.getElementById('ss-spend');
    const ssBalance = document.getElementById('ss-balance');
    if (ssEarn)  ssEarn.textContent  = `${CS()}${Math.round(tEarns)}`;
    if (ssOther) ssOther.textContent = `${CS()}${Math.round(tOther)}`;
    if (ssSpend) ssSpend.textContent = `${CS()}${Math.round(tSpends)}`;
    if (ssBalance) {
        ssBalance.textContent = `${CS()}${tBalance >= 0 ? '+' : ''}${Math.round(tBalance)}`;
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

    // Award XP based on milestones
    checkXPMilestones();

    setTimeout(() => {
        setHasChangesSinceLastSave(false);
    }, 1000);
}



// ===== Comprehensive XP Milestone System =====
function checkXPMilestones() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const today = getLocalDateString(new Date());
    const milestoneKey = `xpMilestones_${user.phone}`;
    const milestones = JSON.parse(localStorage.getItem(milestoneKey)) || {};

    // --- 1. Daily Earns XP: 50 XP when user logs earns today ---
    const todayRow = trackerData.find(r => r.date === today);
    const todayEarns = todayRow ? ((todayRow.earns || 0) + (todayRow.other || 0)) : 0;
    if (todayEarns > 0 && milestones.lastDailyEarnDate !== today) {
        milestones.lastDailyEarnDate = today;
        addXP(50);
        showXPToast('📅 Daily Earns Logged!', 50);
    }

    // --- 2. Weekly Budget Not Reached XP ---
    const monday = getMonday(new Date());
    const weekKey = getLocalDateString(monday);
    if (weeklyBudget > 0 && milestones.lastWeeklyBudgetCheck !== weekKey) {
        const weekEnd = new Date(monday);
        weekEnd.setDate(weekEnd.getDate() + 6);
        let weekSpends = 0;
        trackerData.forEach(r => {
            if (!r.date) return;
            const d = parseDate(r.date);
            if (d >= monday && d <= weekEnd) weekSpends += (r.spends || 0);
        });
        if (weekSpends <= weeklyBudget) {
            let xpReward = 0;
            if (weekSpends <= 300) xpReward = 100;
            else if (weekSpends <= 1000) xpReward = 70;
            else xpReward = 50;
            milestones.lastWeeklyBudgetCheck = weekKey;
            addXP(xpReward);
            showXPToast('🎯 Weekly Budget Kept!', xpReward);
        }
    }

    // --- 3. Balance Milestones: First ₹1000, ₹5000, ₹10000 balance (225 XP each) ---
    let totalBalance = 0;
    trackerData.forEach(r => {
        totalBalance += (r.earns || 0) + (r.other || 0) - (r.spends || 0);
    });
    const balanceMilestones = [1000, 5000, 10000];
    const earnedBalanceMilestones = milestones.balanceMilestones || [];
    balanceMilestones.forEach(milestone => {
        if (totalBalance >= milestone && !earnedBalanceMilestones.includes(milestone)) {
            earnedBalanceMilestones.push(milestone);
            addXP(225);
            showXPToast(`💰 Balance Milestone ₹${milestone.toLocaleString()}!`, 225);
        }
    });
    milestones.balanceMilestones = earnedBalanceMilestones;

    // --- 4. Spend Less Than Last Month (100 XP) ---
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const lastMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const lastMonth = lastMonthDate.getMonth();
    const lastMonthYear = lastMonthDate.getFullYear();
    const monthCheckKey = `${currentYear}-${currentMonth}`;
    if (milestones.lastMonthSpendCheck !== monthCheckKey && currentMonth > 0) {
        let thisMonthSpends = 0, lastMonthSpends = 0;
        trackerData.forEach(r => {
            if (!r.date) return;
            const d = parseDate(r.date);
            const m = d.getMonth(), y = d.getFullYear();
            if (m === currentMonth && y === currentYear) thisMonthSpends += (r.spends || 0);
            if (m === lastMonth && y === lastMonthYear) lastMonthSpends += (r.spends || 0);
        });
        if (lastMonthSpends > 0 && thisMonthSpends < lastMonthSpends) {
            milestones.lastMonthSpendCheck = monthCheckKey;
            addXP(100);
            showXPToast('📉 Spent Less Than Last Month!', 100);
        }
    }

    // Save updated milestones
    localStorage.setItem(milestoneKey, JSON.stringify(milestones));
}

function showXPToast(label, amount) {
    const toast = document.createElement('div');
    toast.innerHTML = `<span style="font-size:14px;">⭐ +${amount} XP</span><br><span style="font-size:10px; opacity:0.85;">${label}</span>`;
    toast.style.cssText = `
        position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
        background: linear-gradient(135deg, #6366f1, #a855f7);
        color:white; padding:10px 18px; border-radius:14px;
        font-weight:800; font-family:inherit; text-align:center;
        box-shadow:0 4px 20px rgba(99,102,241,0.4); z-index:9999;
        transition: opacity 0.4s ease, transform 0.4s ease;
        white-space: nowrap;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => toast.remove(), 400);
    }, 2500);
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

    // --- Real-time XP sync: listen to user's own Firestore doc for admin-given XP ---
    onSnapshot(doc(db, "users", user.phone), (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            const remoteXp = data.xpBalance || 0;

            // Fetch from localStorage for comparison
            const localUser = JSON.parse(localStorage.getItem('currentUser'));
            const localXp = localUser ? (localUser.xpBalance || 0) : 0;

            // Only update if Firebase has a HIGHER value (admin gave XP)
            if (remoteXp > localXp && localUser) {
                const gained = remoteXp - localXp;
                localUser.xpBalance = remoteXp;
                localStorage.setItem('currentUser', JSON.stringify(localUser));
                initUser(); // refresh XP display in header
                
                // Show a toast only if the difference is meaningful (not from own actions)
                if (gained >= 10) {
                    showXPToast(`🎁 Admin Reward!`, gained);
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
        const customIcon = user.profileIcon;
        const customBg = user.profileBg;

        if (userInitial) {
            userInitial.textContent = customIcon || initial;
            userInitial.style.fontSize = customIcon ? '18px' : '';
        }
        const profileTriggerBtn = document.getElementById('profile-trigger');
        if (profileTriggerBtn) {
            profileTriggerBtn.style.background = customBg || '';
        }

        if (drawerInitial) {
            drawerInitial.textContent = customIcon || initial;
            drawerInitial.style.fontSize = customIcon ? '28px' : '';
            const largeAvatarEl = document.querySelector('.large-avatar');
            if (largeAvatarEl) {
                largeAvatarEl.style.background = customBg || '';
            }
        }
        if (displayName) displayName.textContent = user.username;
        if (displayPhone) displayPhone.textContent = user.phone;

        // Render dynamic motto
        const cacheKey = `userSettings_${user.phone}`;
        const cachedSettings = JSON.parse(localStorage.getItem(cacheKey)) || {};
        const mottoText = cachedSettings.motto || '';
        const displayMotto = document.getElementById('display-motto');
        const pMotto = document.getElementById('p-motto');
        if (displayMotto) displayMotto.textContent = mottoText;
        if (pMotto) pMotto.textContent = mottoText;

        const xpAmountEl = document.getElementById('xp-amount');
        if (xpAmountEl) {
            xpAmountEl.textContent = user.xpBalance || 0;
        }

        // Ensure referral code exists for this user (auto-migration)
        if (user && user.phone && !user.referralCode) {
            (async () => {
                try {
                    const userRef = doc(db, "users", user.phone);
                    const snap = await getDoc(userRef);
                    if (snap.exists()) {
                        const dbData = snap.data();
                        if (dbData.referralCode) {
                            user.referralCode = dbData.referralCode;
                            localStorage.setItem('currentUser', JSON.stringify(user));
                        } else {
                            const cleanName = (user.username || 'USER').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                            const generatedCode = (cleanName + user.phone.slice(-4)) || user.phone;
                            await updateDoc(userRef, { referralCode: generatedCode });
                            user.referralCode = generatedCode;
                            localStorage.setItem('currentUser', JSON.stringify(user));
                        }
                    }
                } catch (err) {
                    console.error("Error generating referral code for existing user:", err);
                }
            })();
        }
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

// ===== Advanced CSV & PDF Export Logic with Double Confirmation =====
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportView = document.getElementById('export-view');
const exportBackBtn = document.getElementById('export-back-btn');
const exportOptionCards = document.querySelectorAll('.export-option-card');
const exportCustomDates = document.getElementById('export-custom-dates');
const exportFromInput = document.getElementById('export-from-date');
const exportToInput = document.getElementById('export-to-date');

const exportStep1 = document.getElementById('export-step-1');
const exportStep2 = document.getElementById('export-step-2');
const exportStep3 = document.getElementById('export-step-3');
const exportStepSuccess = document.getElementById('export-step-success');

const btnPrepare = document.getElementById('export-btn-prepare');
const btnBack1 = document.getElementById('export-btn-back-1');
const btnConfirm1 = document.getElementById('export-btn-confirm-1');
const btnCancel = document.getElementById('export-btn-cancel');
const btnConfirm2 = document.getElementById('export-btn-confirm-2');

const summaryRangeText = document.getElementById('export-summary-range');
const summaryCountText = document.getElementById('export-summary-count');

const btnFmtCsv = document.getElementById('export-fmt-csv');
const btnFmtPdf = document.getElementById('export-fmt-pdf');

let filteredExportData = [];
let selectedExportRange = "full";
let selectedExportFormat = "csv"; // default

if (btnFmtCsv) {
    btnFmtCsv.addEventListener('click', () => {
        btnFmtCsv.classList.add('active');
        if (btnFmtPdf) btnFmtPdf.classList.remove('active');
        selectedExportFormat = "csv";
    });
}

if (btnFmtPdf) {
    btnFmtPdf.addEventListener('click', () => {
        btnFmtPdf.classList.add('active');
        if (btnFmtCsv) btnFmtCsv.classList.remove('active');
        selectedExportFormat = "pdf";
    });
}

function resetExportModal() {
    exportStep1.style.display = "block";
    exportStep2.style.display = "none";
    exportStep3.style.display = "none";
    exportStepSuccess.style.display = "none";
    
    // Reset cards to default (full)
    exportOptionCards.forEach(card => card.classList.remove('active'));
    const defaultCard = document.querySelector('.export-option-card[data-range="full"]');
    if (defaultCard) defaultCard.classList.add('active');
    selectedExportRange = "full";
    
    // Reset format selection to default (csv)
    if (btnFmtCsv) btnFmtCsv.classList.add('active');
    if (btnFmtPdf) btnFmtPdf.classList.remove('active');
    selectedExportFormat = "csv";
    
    if (exportCustomDates) exportCustomDates.style.display = "none";
    if (exportFromInput) exportFromInput.value = "";
    if (exportToInput) exportToInput.value = "";
    filteredExportData = [];
}

// Open Export page view
exportCsvBtn?.addEventListener('click', () => {
    // Close the profile drawer
    const drawer = document.getElementById('profile-drawer');
    if (drawer) drawer.style.display = 'none';
    
    if (trackerData.length === 0) {
        alert("No data to export!");
        return;
    }
    
    resetExportModal();
    
    // Router transition: Deactivate all views, activate export view
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    const exportView = document.getElementById('export-view');
    if (exportView) exportView.classList.add('active');

    // Hide quick-add FAB and summary strip
    const summaryStrip = document.getElementById('summary-strip');
    if (summaryStrip) summaryStrip.style.display = 'none';
    const fabBtn = document.getElementById('fab-add-btn');
    if (fabBtn) fabBtn.style.display = 'none';

    // Show settings back button in the header and hide profile trigger
    const backBtn = document.getElementById('settings-back-btn');
    const profileTrigger = document.getElementById('profile-trigger');
    if (backBtn && profileTrigger) {
        backBtn.style.display = 'flex';
        profileTrigger.style.display = 'none';
    }
});

// Back button on page to return from export view
exportBackBtn?.addEventListener('click', () => {
    // Go back to tracker and open profile drawer
    const trackerTab = document.getElementById('nav-tracker');
    if (trackerTab) {
        trackerTab.click();
    }
    const profileDrawer = document.getElementById('profile-drawer');
    if (profileDrawer) {
        profileDrawer.style.display = 'block';
    }
});

// Option card switching
exportOptionCards.forEach(card => {
    card.addEventListener('click', () => {
        exportOptionCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const range = card.getAttribute('data-range');
        selectedExportRange = range;
        
        if (range === 'custom') {
            if (exportCustomDates) exportCustomDates.style.display = 'block';
        } else {
            if (exportCustomDates) exportCustomDates.style.display = 'none';
        }
    });
});

// Step 1: Prepare Report
btnPrepare?.addEventListener('click', () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    let summaryText = "";
    
    if (selectedExportRange === 'full') {
        filteredExportData = [...trackerData];
        summaryText = "All Time Report";
    } else if (selectedExportRange === 'week') {
        const boundary = new Date();
        boundary.setDate(today.getDate() - 7);
        boundary.setHours(0, 0, 0, 0);
        
        filteredExportData = trackerData.filter(row => {
            const rDate = new Date(row.date);
            return rDate >= boundary && rDate <= today;
        });
        summaryText = "Last 7 Days";
    } else if (selectedExportRange === 'month') {
        const boundary = new Date();
        boundary.setDate(today.getDate() - 30);
        boundary.setHours(0, 0, 0, 0);
        
        filteredExportData = trackerData.filter(row => {
            const rDate = new Date(row.date);
            return rDate >= boundary && rDate <= today;
        });
        summaryText = "Last 30 Days";
    } else if (selectedExportRange === 'custom') {
        const fromVal = exportFromInput.value;
        const toVal = exportToInput.value;
        if (!fromVal || !toVal) {
            alert("Please choose both start and end dates.");
            return;
        }
        
        const fromDate = new Date(fromVal);
        fromDate.setHours(0, 0, 0, 0);
        const toDate = new Date(toVal);
        toDate.setHours(23, 59, 59, 999);
        
        if (fromDate > toDate) {
            alert("From Date cannot be after To Date.");
            return;
        }
        
        filteredExportData = trackerData.filter(row => {
            const rDate = new Date(row.date);
            return rDate >= fromDate && rDate <= toDate;
        });
        
        const fmt = { month: 'short', day: 'numeric', year: 'numeric' };
        summaryText = `${fromDate.toLocaleDateString(undefined, fmt)} - ${toDate.toLocaleDateString(undefined, fmt)}`;
    }
    
    if (filteredExportData.length === 0) {
        alert("No transaction records found for the selected period.");
        return;
    }
    
    // Sort chronologically by date
    filteredExportData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Update dynamic text based on format
    const confirmMsg1 = document.getElementById('export-confirm-msg-1');
    const confirmMsg2 = document.getElementById('export-confirm-msg-2');
    const btnConfirm2El = document.getElementById('export-btn-confirm-2');
    
    const fmtLabelName = selectedExportFormat === 'pdf' ? 'PDF bank statement' : 'CSV spreadsheet';
    const fmtFileName = selectedExportFormat === 'pdf' ? 'PDF statement' : 'CSV file';
    const btnActionLabel = 'Yes, Download! 📥';
    
    if (confirmMsg1) {
        confirmMsg1.textContent = `Are you sure you want to generate this financial ${fmtLabelName}?`;
    }
    if (confirmMsg2) {
        confirmMsg2.textContent = `Please confirm once more. Do you really want to download this ${fmtFileName} now?`;
    }
    if (btnConfirm2El) {
        btnConfirm2El.innerHTML = btnActionLabel;
    }
    
    // Go to step 2
    if (summaryRangeText) summaryRangeText.textContent = summaryText;
    if (summaryCountText) summaryCountText.textContent = `${filteredExportData.length} records`;
    
    exportStep1.style.display = "none";
    exportStep2.style.display = "block";
});

// Step 2 controls
btnBack1?.addEventListener('click', () => {
    exportStep2.style.display = "none";
    exportStep1.style.display = "block";
});

btnConfirm1?.addEventListener('click', () => {
    exportStep2.style.display = "none";
    exportStep3.style.display = "block";
});

// Step 3 controls
btnCancel?.addEventListener('click', () => {
    resetExportModal();
});

btnConfirm2?.addEventListener('click', async () => {
    exportStep3.style.display = "none";
    exportStepSuccess.style.display = "block";
    
    const successTitle = document.querySelector('#export-step-success h4');
    const successDesc = document.querySelector('#export-step-success p');
    if (successTitle) {
        successTitle.textContent = selectedExportFormat === 'pdf' ? 'Generating PDF...' : 'Report Ready!';
    }
    if (successDesc) {
        successDesc.textContent = selectedExportFormat === 'pdf' 
            ? 'Please wait, compiling transaction history...' 
            : 'Your CSV file download has started.';
    }
    
    // Fire download based on format
    if (selectedExportFormat === 'pdf') {
        try {
            await downloadPDFData(filteredExportData, summaryRangeText ? summaryRangeText.textContent : "Report");
            if (successTitle) successTitle.textContent = 'Statement Generated!';
            if (successDesc) successDesc.textContent = 'Your PDF statement download has started.';
        } catch (err) {
            if (successTitle) successTitle.textContent = 'Export Failed';
            if (successDesc) successDesc.textContent = 'Could not generate PDF. Please try again.';
        }
    } else {
        downloadCSVData(filteredExportData);
    }
    
    // Auto return to tracker after 2s
    setTimeout(() => {
        const trackerTab = document.getElementById('nav-tracker');
        if (trackerTab) {
            trackerTab.click();
        }
        resetExportModal();
    }, 2000);
});

// CSV Generator
function downloadCSVData(data) {
    const headers = [`Date`, `Earnings (${CS()})`, `Other Income (${CS()})`, `Spends (${CS()})`, `Balance (${CS()})`, `Category`];
    
    let totalEarns = 0;
    let totalOther = 0;
    let totalSpends = 0;
    
    const rows = data.map(row => {
        const earns = row.earns || 0;
        const other = row.other || 0;
        const spends = row.spends || 0;
        
        totalEarns += earns;
        totalOther += other;
        totalSpends += spends;
        
        const balance = earns + other - spends;
        return [
            row.date,
            earns,
            other,
            spends,
            balance,
            row.category || "-"
        ];
    });

    const overallIncome = totalEarns + totalOther;
    const netBalance = overallIncome - totalSpends;

    // Append bank statement style summary rows
    rows.push(["", "", "", "", "", ""]); // Empty spacer row
    rows.push(["", "", "", `Total Income (${CS()})`, overallIncome, ""]);
    rows.push(["", "", "", `Total Spends (${CS()})`, totalSpends, ""]);
    rows.push(["", "", "", `Net Balance (${CS()})`, netBalance, ""]);

    let csvContent = "\ufeff" + headers.join(",") + "\n"
        + rows.map(e => e.map(val => `"${val}"`).join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const encodedUri = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `Expense_Report_${dateStr}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(encodedUri);
}

// PDF Bank Statement Generator (Direct Download via html2pdf)
async function downloadPDFData(data, dateRangeLabel) {
    const user = JSON.parse(localStorage.getItem('currentUser')) || { username: 'Valued User', phone: 'N/A' };
    const username = user.username || 'Valued User';
    const phone = user.phone || 'N/A';
    
    let totalEarns = 0;
    let totalOther = 0;
    let totalSpends = 0;
    
    const rowsHtml = data.map((row, idx) => {
        const earns = row.earns || 0;
        const other = row.other || 0;
        const spends = row.spends || 0;
        const balance = earns + other - spends;
        
        totalEarns += earns;
        totalOther += other;
        totalSpends += spends;
        
        return `
            <tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 12px; font-size: 11px; color: #334155; font-family: monospace;">${row.date}</td>
                <td style="padding: 10px 12px; font-size: 11px; color: #334155; font-weight: 600;">${row.category || '-'}</td>
                <td style="padding: 10px 12px; font-size: 11px; text-align: right; color: ${earns > 0 ? '#10b981' : '#64748b'}; font-weight: 600;">${earns > 0 ? CS() + earns.toLocaleString() : '-'}</td>
                <td style="padding: 10px 12px; font-size: 11px; text-align: right; color: ${other > 0 ? '#10b981' : '#64748b'}; font-weight: 600;">${other > 0 ? CS() + other.toLocaleString() : '-'}</td>
                <td style="padding: 10px 12px; font-size: 11px; text-align: right; color: ${spends > 0 ? '#ef4444' : '#64748b'}; font-weight: 600;">${spends > 0 ? CS() + spends.toLocaleString() : '-'}</td>
                <td style="padding: 10px 12px; font-size: 11px; text-align: right; color: ${balance >= 0 ? '#059669' : '#dc2626'}; font-weight: 700;">${CS()}${balance.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    const overallIncome = totalEarns + totalOther;
    const netBalance = overallIncome - totalSpends;

    const docTitle = `Financial_Statement_${dateRangeLabel.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')}`;

    // Create a temporary hidden layout container that stays in flow to retain width
    const wrapper = document.createElement('div');
    wrapper.id = 'pdf-wrapper';
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = '750px';
    wrapper.style.height = '0';
    wrapper.style.overflow = 'hidden';
    wrapper.style.opacity = '0.01';
    wrapper.style.pointerEvents = 'none';

    const element = document.createElement('div');
    element.id = 'pdf-temp-template';
    element.style.width = '750px';
    element.style.padding = '24px';
    element.style.fontFamily = "'Inter', -apple-system, sans-serif";
    element.style.color = '#1e293b';
    element.style.background = '#ffffff';
    element.style.boxSizing = 'border-box';
    
    element.innerHTML = `
        <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
            <div>
                <h1 style="margin: 0 0 4px; font-size: 22px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px;">SPENDS & EARNS</h1>
                <p style="margin: 0; font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">Personal Finance Ledger</p>
            </div>
            <div style="text-align: right;">
                <h2 style="margin: 0 0 6px; font-size: 16px; font-weight: 800; color: #0f172a; letter-spacing: 0.5px;">FINANCIAL STATEMENT</h2>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b; font-weight: 500;"><strong>Period:</strong> ${dateRangeLabel}</p>
                <p style="margin: 2px 0; font-size: 11px; color: #64748b; font-weight: 500;"><strong>Generated on:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
        </div>
        
        <div style="background: #f8fafc; border-radius: 10px; padding: 14px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
            <h3 style="margin: 0 0 6px; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Account Holder Info</h3>
            <p style="margin: 4px 0; font-size: 12px; font-weight: 600;">Name: <span style="color:#0f172a;">${username}</span></p>
            <p style="margin: 4px 0; font-size: 12px; font-weight: 600;">Phone: <span style="color:#0f172a;">${phone}</span></p>
        </div>
        
        <div style="display: flex; gap: 16px; margin-bottom: 24px; width: 100%;">
            <div style="flex: 1; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; box-sizing: border-box;">
                <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Total Income</div>
                <div style="font-size: 18px; font-weight: 800; color: #10b981;">${CS()}${overallIncome.toLocaleString()}</div>
            </div>
            <div style="flex: 1; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; box-sizing: border-box;">
                <div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">Total Spends</div>
                <div style="font-size: 18px; font-weight: 800; color: #ef4444;">${CS()}${totalSpends.toLocaleString()}</div>
            </div>
            <div style="flex: 1; background: #e0e7ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 14px; box-sizing: border-box;">
                <div style="font-size: 10px; font-weight: 700; color: #4f46e5; text-transform: uppercase; margin-bottom: 4px;">Net Balance</div>
                <div style="font-size: 18px; font-weight: 800; color: #4f46e5;">${CS()}${netBalance.toLocaleString()}</div>
            </div>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px;">
            <thead>
                <tr>
                    <th style="width: 15%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: left; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Date</th>
                    <th style="width: 20%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: left; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Category</th>
                    <th style="width: 15%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: right; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Earnings</th>
                    <th style="width: 15%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: right; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Other Inc.</th>
                    <th style="width: 15%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: right; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Spends</th>
                    <th style="width: 20%; background-color: #f1f5f9; color: #475569; font-weight: 700; font-size: 10px; text-transform: uppercase; text-align: right; padding: 10px 12px; border-bottom: 2px solid #cbd5e1;">Running Bal.</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
        
        <div style="margin-top: 40px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px;">
            This is a computer-generated financial statement of your expenses and earnings registered in the Spends & Earns application.
        </div>
    `;

    wrapper.appendChild(element);
    document.body.appendChild(wrapper);
    
    // Load library dynamically and perform direct PDF Blob download
    try {
        const html2pdfLib = await loadHtml2Pdf();
        
        // Detect mobile users to set smaller scale to bypass HTML5 canvas limits
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const canvasScale = isMobile ? 1.3 : 2.0;

        const opt = {
            margin:       12,
            filename:     `${docTitle}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: canvasScale, 
                useCORS: true, 
                logging: false,
                letterRendering: true,
                scrollX: 0,
                scrollY: 0,
                windowWidth: 750,
                onclone: (clonedDoc) => {
                    const wr = clonedDoc.getElementById('pdf-wrapper');
                    if (wr) {
                        wr.style.height = 'auto';
                        wr.style.opacity = '1';
                    }
                }
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        
        // Use html2pdf's native save method (more compatible on iOS/Android browsers)
        await html2pdfLib().set(opt).from(element).save();
    } catch (err) {
        console.error("PDF download failed:", err);
        alert("Failed to download PDF Statement directly. Please check your internet connection.");
        throw err;
    } finally {
        document.body.removeChild(wrapper);
    }
}

function loadHtml2Pdf() {
    return new Promise((resolve, reject) => {
        if (window.html2pdf) return resolve(window.html2pdf);
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = () => resolve(window.html2pdf);
        script.onerror = () => reject(new Error('Failed to load html2pdf library'));
        document.head.appendChild(script);
    });
}

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

let securitySourceView = "tracker";

function goToSecurityView(source) {
    securitySourceView = source || "tracker";
    if (profileDrawer) profileDrawer.style.display = 'none';

    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));

    const securityView = document.getElementById('security-view');
    if (securityView) securityView.classList.add('active');

    // Hide main elements
    const summaryStrip = document.getElementById('summary-strip');
    if (summaryStrip) summaryStrip.style.display = 'none';

    const fabBtn = document.getElementById('fab-add-btn');
    if (fabBtn) fabBtn.style.display = 'none';

    // Show back button in header
    const backBtn = document.getElementById('settings-back-btn');
    if (backBtn && profileTrigger) {
        backBtn.style.display = 'flex';
        profileTrigger.style.display = 'none';
    }

    // Refresh data in security page
    if (typeof loadSecurityPageData === "function") {
        loadSecurityPageData();
    }
}

const drawerSecurityBtn = document.getElementById('drawer-security-btn');
if (drawerSecurityBtn) {
    drawerSecurityBtn.addEventListener('click', () => {
        goToSecurityView("tracker");
    });
}
const drawerHelpBtn = document.getElementById('drawer-help-btn');
if (drawerHelpBtn) {
    drawerHelpBtn.addEventListener('click', () => {
        if (profileDrawer) profileDrawer.style.display = 'none';
        
        const appViews = document.querySelectorAll('.app-view');
        appViews.forEach(v => v.classList.remove('active'));
        
        const supportView = document.getElementById('support-view');
        if (supportView) supportView.classList.add('active');

        // Hide tracker specific layouts
        const summaryStrip = document.getElementById('summary-strip');
        if (summaryStrip) summaryStrip.style.display = 'none';

        const fabBtn = document.getElementById('fab-add-btn');
        if (fabBtn) fabBtn.style.display = 'none';

        // Show back button in header
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn && profileTrigger) {
            backBtn.style.display = 'flex';
            profileTrigger.style.display = 'none';
        }

        const tabFaq = document.getElementById('tab-support-faq');
        if (tabFaq) tabFaq.click();
    });
}

// Settings Back Button Action (Go back to tracker and open profile drawer, or settings from sub-pages)
const settingsBackBtn = document.getElementById('settings-back-btn');
if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
        const avatarView = document.getElementById('avatar-view');
        const editProfileView = document.getElementById('edit-profile-view');
        const exportView = document.getElementById('export-view');
        const securityView = document.getElementById('security-view');
        const supportView = document.getElementById('support-view');
        
        if (securityView && securityView.classList.contains('active')) {
            const appViews = document.querySelectorAll('.app-view');
            appViews.forEach(v => v.classList.remove('active'));
            
            if (securitySourceView === "settings") {
                const settingsView = document.getElementById('settings-view');
                if (settingsView) settingsView.classList.add('active');
            } else {
                const trackerTab = document.getElementById('nav-tracker');
                if (trackerTab) trackerTab.click();
                if (profileDrawer) profileDrawer.style.display = 'block';
            }
            return;
        }

        if ((avatarView && avatarView.classList.contains('active')) || (editProfileView && editProfileView.classList.contains('active'))) {
            const appViews = document.querySelectorAll('.app-view');
            appViews.forEach(v => v.classList.remove('active'));
            const settingsView = document.getElementById('settings-view');
            if (settingsView) settingsView.classList.add('active');
            return;
        }

        const referView = document.getElementById('refer-view');
        if ((exportView && exportView.classList.contains('active')) || 
            (referView && referView.classList.contains('active')) || 
            (supportView && supportView.classList.contains('active'))) {
            const trackerTab = document.getElementById('nav-tracker');
            if (trackerTab) {
                trackerTab.click();
            }
            if (profileDrawer) {
                profileDrawer.style.display = 'block';
            }
            return;
        }

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

    // Reset lock panels
    const pinPanel = document.getElementById('lock-pin-panel');
    const mfaPanel = document.getElementById('lock-2fa-panel');
    if (pinPanel) pinPanel.style.display = 'flex';
    if (mfaPanel) mfaPanel.style.display = 'none';

    overlay.style.display = 'flex';
    let inputPin = "";
    const dots = document.querySelectorAll('.pin-dot-lock');
    const btns = document.querySelectorAll('.lock-pin-btn');

    const user = JSON.parse(localStorage.getItem('currentUser'));
    const cacheKey = user ? `userSettings_${user.phone}` : '';
    const cachedSettings = cacheKey ? JSON.parse(localStorage.getItem(cacheKey)) : null;

    btns.forEach(btn => {
        const newBtn = btn.cloneNode(true); // Remove previous listeners
        btn.parentNode.replaceChild(newBtn, btn);
        
        // Handle biometric trigger
        if (newBtn.id === 'lock-biometric-btn') {
            if (cachedSettings && cachedSettings.biometricsEnabled) {
                newBtn.style.display = 'block';
                newBtn.addEventListener('click', () => {
                    const bioOverlay = document.getElementById('biometric-scanner-overlay');
                    const bioStatus = document.getElementById('biometric-scan-status');
                    if (bioOverlay) {
                        bioOverlay.style.display = 'flex';
                        if (bioStatus) bioStatus.textContent = "Scanning face/fingerprint...";
                        
                        setTimeout(() => {
                            if (bioStatus) bioStatus.textContent = "Analyzing biometrics...";
                            setTimeout(() => {
                                if (bioStatus) bioStatus.textContent = "Unlock Successful! Match Found";
                                setTimeout(() => {
                                    bioOverlay.style.display = 'none';
                                    
                                    if (cachedSettings && cachedSettings.twoFactorEnabled) {
                                        if (pinPanel) pinPanel.style.display = 'none';
                                        if (mfaPanel) mfaPanel.style.display = 'flex';
                                    } else {
                                        sessionStorage.setItem('app_verified', 'true');
                                        overlay.style.display = 'none';
                                    }
                                }, 500);
                            }, 1000);
                        }, 1000);
                    }
                });
            } else {
                newBtn.style.display = 'none';
            }
            return;
        }

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
                    if (cachedSettings && cachedSettings.twoFactorEnabled) {
                        // Go to 2FA phase
                        if (pinPanel) pinPanel.style.display = 'none';
                        if (mfaPanel) mfaPanel.style.display = 'flex';
                    } else {
                        // Direct unlock
                        sessionStorage.setItem('app_verified', 'true');
                        overlay.style.display = 'none';
                    }
                } else {
                    alert("Incorrect PIN! Try again.");
                    inputPin = "";
                    dots.forEach(dot => dot.classList.remove('filled'));
                }
            }
        });
    });
}

// Run lock check before initializing
async function startApp() {
    await checkAppLock();
    await init();
    initUser();
}

startApp();
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

// ===== Refer & Earn Feature =====
const referShareBtn = document.getElementById('refer-share-btn');
const referBackBtn = document.getElementById('refer-back-btn');

function getAppUrl() {
    return window.location.href.split('?')[0].split('#')[0];
}

function getReferralLink(referralCode) {
    const baseUrl = getAppUrl();
    const cleanBase = baseUrl.endsWith('index.html') ? baseUrl.replace('index.html', '') : baseUrl;
    const separator = cleanBase.endsWith('/') ? '' : '/';
    return `${cleanBase}${separator}auth.html?ref=${referralCode}`;
}

if (referShareBtn) {
    referShareBtn.addEventListener('click', () => {
        // Close the profile drawer
        if (profileDrawer) profileDrawer.style.display = 'none';

        const appViews = document.querySelectorAll('.app-view');
        appViews.forEach(v => v.classList.remove('active'));

        const referView = document.getElementById('refer-view');
        if (referView) referView.classList.add('active');

        // Hide main elements
        const summaryStrip = document.getElementById('summary-strip');
        if (summaryStrip) summaryStrip.style.display = 'none';

        const fabBtn = document.getElementById('fab-add-btn');
        if (fabBtn) fabBtn.style.display = 'none';

        // Show back button in header
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn && profileTrigger) {
            backBtn.style.display = 'flex';
            profileTrigger.style.display = 'none';
        }

        // Populate User Code
        const user = JSON.parse(localStorage.getItem('currentUser'));
        const codeDisplay = document.getElementById('referral-code-display');
        if (user && user.referralCode && codeDisplay) {
            codeDisplay.textContent = user.referralCode;
        }

        // Fetch and load referral list
        loadReferralData();
    });
}

if (referBackBtn) {
    referBackBtn.addEventListener('click', () => {
        const appViews = document.querySelectorAll('.app-view');
        appViews.forEach(v => v.classList.remove('active'));

        const trackerView = document.getElementById('tracker-view');
        if (trackerView) trackerView.classList.add('active');

        // Restore main elements
        const summaryStrip = document.getElementById('summary-strip');
        if (summaryStrip) summaryStrip.style.display = 'flex';

        const fabBtn = document.getElementById('fab-add-btn');
        if (fabBtn) fabBtn.style.display = 'flex';

        // Hide back button in header
        const backBtn = document.getElementById('settings-back-btn');
        if (backBtn && profileTrigger) {
            backBtn.style.display = 'none';
            profileTrigger.style.display = 'flex';
        }
    });
}

const copyRefBtn = document.getElementById('copy-ref-btn');
if (copyRefBtn) {
    copyRefBtn.addEventListener('click', () => {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user || !user.referralCode) return;
        
        navigator.clipboard.writeText(user.referralCode).then(() => {
            const original = copyRefBtn.innerHTML;
            copyRefBtn.innerHTML = '✓ Copied';
            setTimeout(() => {
                copyRefBtn.innerHTML = original;
            }, 2000);
        }).catch(() => {
            alert('Referral code: ' + user.referralCode);
        });
    });
}

const referShareWhatsapp = document.getElementById('refer-share-whatsapp');
if (referShareWhatsapp) {
    referShareWhatsapp.addEventListener('click', () => {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user || !user.referralCode) return;
        const link = getReferralLink(user.referralCode);
        const text = encodeURIComponent(`Hey! I use this awesome Expense Tracker app to manage my daily finances. Sign up with my link and start tracking: `);
        window.open(`https://wa.me/?text=${text}${encodeURIComponent(link)}`, '_blank');
    });
}

const referShareNative = document.getElementById('refer-share-native');
if (referShareNative) {
    referShareNative.addEventListener('click', () => {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user || !user.referralCode) return;
        const link = getReferralLink(user.referralCode);
        
        if (navigator.share) {
            navigator.share({
                title: 'Refer & Earn',
                text: 'Track your daily expenses easily and earn rewards!',
                url: link,
            }).catch(() => {});
        } else {
            // Fallback: Copy link
            navigator.clipboard.writeText(link).then(() => {
                const original = referShareNative.innerHTML;
                referShareNative.innerHTML = '✓ Link Copied!';
                setTimeout(() => {
                    referShareNative.innerHTML = original;
                }, 2000);
            }).catch(() => {
                alert('Copied link: ' + link);
            });
        }
    });
}

async function loadReferralData() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user || !user.phone) return;

    const listBody = document.getElementById('referral-list-body');
    const countEl = document.getElementById('stat-referral-count');
    const earningsEl = document.getElementById('stat-referral-earnings');

    if (!listBody) return;
    listBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">Loading referrals...</td></tr>';

    try {
        const q = query(collection(db, "referrals"), where("referrerPhone", "==", user.phone));
        const snap = await getDocs(q);
        
        let count = 0;
        let earnings = 0;
        listBody.innerHTML = '';

        if (snap.empty) {
            listBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: var(--text-muted);">No referrals yet. Share your code to start earning!</td></tr>';
            if (countEl) countEl.textContent = '0';
            if (earningsEl) earningsEl.textContent = '0 XP';
            return;
        }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            count++;
            earnings += (data.xpEarned || 500);

            // Mask phone number for privacy e.g. 9876543210 -> 9876***210
            const rawPhone = data.referredPhone || '';
            const maskedPhone = rawPhone.length >= 10 ? `${rawPhone.slice(0, 4)}***${rawPhone.slice(-3)}` : rawPhone;

            const dateStr = data.timestamp ? new Date(data.timestamp).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric'
            }) : 'N/A';

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding: 8px 10px; color: var(--text-main); font-weight: 700;">
                    ${data.referredName || 'Friend'}<br>
                    <span style="font-size: 9px; color: var(--text-muted); font-weight: 400;">${maskedPhone}</span>
                </td>
                <td style="padding: 8px 10px; color: #10b981; font-weight: 800;">+${data.xpEarned || 500} XP</td>
                <td style="padding: 8px 10px; color: var(--text-muted); text-align: right;">${dateStr}</td>
            `;
            listBody.appendChild(tr);
        });

        if (countEl) countEl.textContent = count;
        if (earningsEl) earningsEl.textContent = `${earnings} XP`;

        // Update referral milestones & progress bar dynamically
        const progressFill = document.getElementById('ref-progress-fill');
        const milestoneText = document.getElementById('ref-milestone-text');
        
        let level = "Bronze";
        let percent = 0;
        
        if (count >= 5) {
            level = "Gold (Wealth Ambassador)";
            percent = 100;
        } else if (count >= 3) {
            level = "Silver (Super Spreader)";
            percent = 70;
        } else if (count >= 1) {
            level = "Bronze (Starter)";
            percent = 35;
        } else {
            level = "Bronze";
            percent = 0;
        }
        
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (milestoneText) milestoneText.textContent = `Level: ${level}`;
        
        // Highlight achieved milestones (set opacity to 1 and add checkmark/glow)
        const m1 = document.getElementById('milestone-1');
        const m3 = document.getElementById('milestone-3');
        const m5 = document.getElementById('milestone-5');
        
        if (m1) {
            m1.style.opacity = count >= 1 ? '1' : '0.5';
            m1.style.color = count >= 1 ? 'var(--success-gradient, #10b981)' : 'inherit';
        }
        if (m3) {
            m3.style.opacity = count >= 3 ? '1' : '0.5';
            m3.style.color = count >= 3 ? 'var(--success-gradient, #10b981)' : 'inherit';
        }
        if (m5) {
            m5.style.opacity = count >= 5 ? '1' : '0.5';
            m5.style.color = count >= 5 ? 'var(--success-gradient, #10b981)' : 'inherit';
        }

    } catch (err) {
        console.error("Error loading referral data:", err);
        listBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load referrals.</td></tr>';
    }
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
    if (weekEarnVal) weekEarnVal.textContent = `${CS()}${Math.round(weekEarn).toLocaleString()}`;
    if (weekSpendVal) weekSpendVal.textContent = `${CS()}${Math.round(weekSpend).toLocaleString()}`;

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
    if (monthEarnVal) monthEarnVal.textContent = `${CS()}${Math.round(monthEarn).toLocaleString()}`;
    if (monthSpendVal) monthSpendVal.textContent = `${CS()}${Math.round(monthSpend).toLocaleString()}`;
    
    calculateTrophies();
    initMonthlyChart();
}

function calculateTrophies() {
    const trophies = [
        { id: 'first_save', icon: '💰', title: 'First Save', desc: `Saved first ${CS()}1,000` },
        { id: 'streak_7', icon: '🔥', title: '7-Day Streak', desc: 'Logged 7 days in a row' },
        { id: 'big_earner', icon: '👑', title: 'Big Earner', desc: `Earned ${CS()}10k in a month` }
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
                    <span class="amt" style="font-weight: 700; color: #1e293b;">${CS()}${Math.round(data.values[i])}</span>
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
                        ctx.fillText(CS() + text, bar.x, bar.y - 3);
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
                        tooltip: { callbacks: { label: function(context) { return ' ' + CS() + context.parsed.y; } } }
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
                        tooltip: { callbacks: { label: function(context) { return ' ' + CS() + context.parsed.y; } } }
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
        if (pAvatar) {
            pAvatar.textContent = user.profileIcon || user.username.charAt(0).toUpperCase();
            pAvatar.style.fontSize = user.profileIcon ? '24px' : '';
            pAvatar.style.background = user.profileBg || '';
        }
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
            if (userData.currency && userData.currency !== selectedCurrency) {
                setCurrency(userData.currency, false);
            }
            const displayMotto = document.getElementById('display-motto');
            const pMotto = document.getElementById('p-motto');
            if (userData.motto !== undefined) {
                if (displayMotto) displayMotto.textContent = userData.motto;
                if (pMotto) pMotto.textContent = userData.motto;
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
const securityModal = document.getElementById('security-modal');
const emailModal = document.getElementById('email-modal');
const feedbackModal = document.getElementById('feedback-modal');
const referModal = document.getElementById('refer-modal');
const avatarView = document.getElementById('avatar-view');

document.getElementById('edit-profile-btn')?.addEventListener('click', () => {
    const editProfileView = document.getElementById('edit-profile-view');
    if (editProfileView) {
        const appViews = document.querySelectorAll('.app-view');
        appViews.forEach(v => v.classList.remove('active'));
        editProfileView.classList.add('active');

        // Pre-populate fields
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (user) {
            const cacheKey = `userSettings_${user.phone}`;
            const cachedSettings = JSON.parse(localStorage.getItem(cacheKey)) || {};
            
            const nameInput = document.getElementById('edit-name-input');
            const emailInput = document.getElementById('edit-email-input');
            const mottoInput = document.getElementById('edit-motto-input');
            const dobInput = document.getElementById('edit-dob-input');
            const phoneInput = document.getElementById('edit-phone-input');
            
            if (nameInput) nameInput.value = user.username || '';
            if (emailInput) emailInput.value = cachedSettings.email || '';
            if (mottoInput) mottoInput.value = cachedSettings.motto || '';
            if (dobInput) dobInput.value = cachedSettings.dob || '';
            if (phoneInput) phoneInput.value = user.phone || '';
        }

        // Toggle header back button visibility
        const backBtn = document.getElementById('settings-back-btn');
        const profileTrigger = document.getElementById('profile-trigger');
        if (backBtn && profileTrigger) {
            backBtn.style.display = 'flex';
            profileTrigger.style.display = 'none';
        }
    }
});

document.getElementById('settings-security-btn')?.addEventListener('click', () => {
    goToSecurityView("settings");
});

document.getElementById('edit-profile-cancel')?.addEventListener('click', () => {
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    const settingsView = document.getElementById('settings-view');
    if (settingsView) settingsView.classList.add('active');
});

document.getElementById('edit-profile-back-btn')?.addEventListener('click', () => {
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    const settingsView = document.getElementById('settings-view');
    if (settingsView) settingsView.classList.add('active');
});

const currencyModal = document.getElementById('currency-modal');

function openCurrencyModal() {
    if (!currencyModal) return;
    const container = document.getElementById('currency-list-container');
    if (container) {
        container.innerHTML = '';
        Object.keys(SUPPORTED_CURRENCIES).forEach(code => {
            const curr = SUPPORTED_CURRENCIES[code];
            const isActive = selectedCurrency === code;
            const item = document.createElement('div');
            item.className = `currency-card-item ${isActive ? 'active' : ''}`;
            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">${curr.flag}</span>
                    <div style="display: flex; flex-direction: column; text-align: left;">
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-main);">${curr.name}</span>
                        <span style="font-size: 8px; color: var(--text-muted); font-weight: 600;">${code}</span>
                    </div>
                </div>
                <span class="currency-symbol">${curr.symbol}</span>
            `;
            item.addEventListener('click', () => {
                setCurrency(code);
                currencyModal.style.display = 'none';
            });
            container.appendChild(item);
        });
    }
    currencyModal.style.display = 'flex';
}

document.getElementById('currency-select-btn')?.addEventListener('click', openCurrencyModal);
document.getElementById('close-currency-modal')?.addEventListener('click', () => {
    if (currencyModal) currencyModal.style.display = 'none';
});

// --- Rewards Store Logic ---
document.getElementById('store-btn')?.addEventListener('click', () => {
    const profileDrawer = document.getElementById('profile-drawer');
    if (profileDrawer) profileDrawer.style.display = 'none';

    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(i => i.classList.remove('active'));

    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    
    const storeView = document.getElementById('store-view');
    if (storeView) storeView.classList.add('active');

    const summaryStrip = document.getElementById('summary-strip');
    if (summaryStrip) summaryStrip.style.display = 'none';

    const fabBtn = document.getElementById('fab-add-btn');
    if (fabBtn) fabBtn.style.display = 'none';

    const backBtn = document.getElementById('settings-back-btn');
    const profileTrigger = document.getElementById('profile-trigger');
    if (backBtn && profileTrigger) {
        backBtn.style.display = 'flex';
        profileTrigger.style.display = 'none';
    }

    initStoreView();
});

let currentStoreCategory = "Boy";

// Avatar price map: one premium (1000 XP) per category, rest vary 200-500
const avatarPrices = {
    // Boy
    "👱‍♂️": 1000, "👨‍🦰": 400, "👨‍🦱": 350, "👨‍🦳": 300, "👨‍🦲": 250, "🧑‍🦰": 450,
    "🧑‍🦱": 300, "🧑‍🦳": 250, "🧑‍🦲": 200, "👦🏼": 200, "👦🏽": 200, "👦🏾": 200, "👦🏿": 200,
    // Girl
    "👱‍♀️": 1000, "👩‍🦰": 400, "👩‍🦱": 350, "👩‍🦳": 300, "👩‍🦲": 250, "🧒": 300,
    "🧒🏻": 200, "🧒🏼": 200, "🧒🏽": 200, "🧒🏾": 200, "🧒🏿": 200, "👧🏼": 200, "👧🏽": 200, "👧🏾": 200, "👧🏿": 200,
    // Uncle
    "🕵️‍♂️": 1000, "👮‍♂️": 500, "🧔": 350, "🧔‍♂️": 400, "👴": 300, "👴🏻": 200,
    "👴🏼": 200, "👴🏽": 200, "👴🏾": 200, "👴🏿": 200, "👨🏻": 200, "👨🏼": 200, "👨🏽": 200, "👨🏾": 200, "👨🏿": 200,
    // Aunty
    "🕵️‍♀️": 1000, "👮‍♀️": 500, "🧕": 400, "👵": 300, "👵🏻": 200,
    "👵🏼": 200, "👵🏽": 200, "👵🏾": 200, "👵🏿": 200, "👩🏻": 200, "👩🏼": 200, "👩🏽": 200, "👩🏾": 200, "👩🏿": 200,
    // Fun & Pets
    "👑": 1000, "💎": 500, "🦄": 450, "🔥": 400, "⚡": 350, "🦁": 350,
    "🦊": 300, "🦉": 300, "🌟": 250, "🚀": 250, "💰": 200, "💸": 200, "💳": 200,
    "⚽": 200, "🎮": 250, "🍕": 200, "☕": 200, "🐼": 350, "🐨": 300, "🐱": 250
};

function initStoreView() {
    const container = document.getElementById('store-items-container');
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!container || !user) return;

    container.innerHTML = '';
    const unlockedAvatars = user.unlockedAvatars || [];
    
    // Check if everything is unlocked
    let allUnlocked = true;
    Object.keys(emojiCategories).forEach(cat => {
        const catLocked = emojiCategories[cat].filter(emoji => !freeAvatars.includes(emoji) && !unlockedAvatars.includes(emoji));
        if (catLocked.length > 0) allUnlocked = false;
    });

    if (allUnlocked) {
        container.innerHTML = '<p style="text-align:center; font-size:12px; color:#64748b;">You have unlocked all avatars!</p>';
        return;
    }

    container.innerHTML = `
        <div class="store-section-label" style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; margin-left: 4px;">Select Category</div>
        <div id="store-categories" style="display: flex; gap: 4px; overflow-x: auto; margin-bottom: 12px; padding-bottom: 6px; scrollbar-width: none; -ms-overflow-style: none;">
            <!-- Category buttons -->
        </div>

        <div id="store-avatars-group" class="settings-group" style="background: white; border-radius: 14px; padding: 12px; margin-bottom: 20px; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0,0,0,0.02); display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        </div>
        
        <div class="store-section-label" style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; margin-left: 4px;">More Features (Coming Soon)</div>
        <div class="settings-group" style="background: white; border-radius: 14px; padding: 0; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0,0,0,0.02); overflow: hidden; margin-bottom: 20px;">
            <div class="settings-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #f1f5f9;">
                <div class="settings-left" style="display: flex; align-items: center; gap: 12px;">
                    <span class="settings-icon" style="font-size: 18px;">🎨</span>
                    <span class="settings-label" style="font-size: 13px; font-weight: 700; color: #94a3b8;">Custom Themes</span>
                </div>
                <div class="settings-right" style="color: var(--text-muted); font-size: 10px;"><span style="background: #f1f5f9; padding: 4px 8px; border-radius: 10px; font-weight: 700;">Locked</span></div>
            </div>
            <div class="settings-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px;">
                <div class="settings-left" style="display: flex; align-items: center; gap: 12px;">
                    <span class="settings-icon" style="font-size: 18px;">📊</span>
                    <span class="settings-label" style="font-size: 13px; font-weight: 700; color: #94a3b8;">Pro Analytics</span>
                </div>
                <div class="settings-right" style="color: var(--text-muted); font-size: 10px;"><span style="background: #f1f5f9; padding: 4px 8px; border-radius: 10px; font-weight: 700;">Locked</span></div>
            </div>
        </div>
    `;

    const catContainer = document.getElementById('store-categories');
    const avatarGroup = document.getElementById('store-avatars-group');

    function renderStoreCategory(selectedCat) {
        // Update tabs UI
        catContainer.innerHTML = '';
        Object.keys(emojiCategories).forEach(cat => {
            const btn = document.createElement('button');
            btn.textContent = cat;
            btn.className = cat === selectedCat ? 'primary-btn' : 'outline-btn';
            btn.style.padding = '6px 12px';
            btn.style.fontSize = '11px';
            btn.style.borderRadius = '20px';
            btn.style.whiteSpace = 'nowrap';
            if (cat !== selectedCat) {
                btn.style.background = 'white';
                btn.style.color = '#64748b';
                btn.style.border = '1px solid #cbd5e1';
            }
            btn.addEventListener('click', () => {
                currentStoreCategory = cat;
                renderStoreCategory(cat);
            });
            catContainer.appendChild(btn);
        });

        // Update grid UI
        avatarGroup.innerHTML = '';
        const catLocked = emojiCategories[selectedCat].filter(emoji => !freeAvatars.includes(emoji) && !unlockedAvatars.includes(emoji));

        if (catLocked.length === 0) {
            avatarGroup.style.display = 'block';
            avatarGroup.innerHTML = '<p style="text-align:center; font-size:11px; color:#94a3b8; padding: 20px 0; margin: 0;">All avatars in this category are unlocked!</p>';
        } else {
            avatarGroup.style.display = 'grid';
            catLocked.forEach(emoji => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.flexDirection = 'column';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'center';
                item.style.gap = '8px';
                item.style.padding = '12px 8px';
                item.style.background = '#f8fafc';
                item.style.borderRadius = '12px';
                item.style.border = '1px solid #e2e8f0';

                const cost = avatarPrices[emoji] || 300;
                const isPremium = cost === 1000;

                if (isPremium) {
                    item.style.background = 'linear-gradient(135deg, #fef3c7, #fde68a)';
                    item.style.border = '1.5px solid #f59e0b';
                    item.style.position = 'relative';
                }

                item.innerHTML = `
                    ${isPremium ? '<span style="position:absolute;top:4px;right:6px;font-size:9px;font-weight:800;color:#92400e;background:#fcd34d;padding:2px 5px;border-radius:6px;">⭐ RARE</span>' : ''}
                    <span style="font-size: 32px; line-height: 1;">${emoji}</span>
                    <button class="primary-btn" style="padding: 4px 0; font-size: 10px; width: 100%; border-radius: 8px; ${isPremium ? 'background: linear-gradient(135deg,#f59e0b,#d97706); color:white; border:none;' : ''}">${isPremium ? '👑' : '⭐'} ${cost} XP</button>
                `;

                const buyBtn = item.querySelector('button');
                buyBtn.addEventListener('click', () => {
                    const currentXp = user.xpBalance || 0;
                    if (currentXp >= cost) {
                        user.xpBalance = currentXp - cost;
                        const newUnlocked = user.unlockedAvatars || [];
                        newUnlocked.push(emoji);
                        user.unlockedAvatars = newUnlocked;
                        
                        localStorage.setItem('currentUser', JSON.stringify(user));
                        initUser(); // refresh XP in header
                        updateDoc(doc(db, "users", user.phone), { 
                            xpBalance: user.xpBalance,
                            unlockedAvatars: user.unlockedAvatars
                        }).catch(err => console.error("Store sync failed:", err));
                        
                        alert('Avatar Unlocked! You can now use it in your profile.');
                        initStoreView(); // refresh store list
                    } else {
                        alert('Not enough XP! Keep logging expenses and reaching limits to earn more XP.');
                    }
                });

                avatarGroup.appendChild(item);
            });
        }
    }

    renderStoreCategory(currentStoreCategory);
}

function addXP(amount) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        user.xpBalance = (user.xpBalance || 0) + amount;
        localStorage.setItem('currentUser', JSON.stringify(user));
        initUser(); // Update header
        updateDoc(doc(db, "users", user.phone), { xpBalance: user.xpBalance }).catch(e => console.error("XP Sync failed", e));
        
        // Show floating toast
        const toast = document.createElement('div');
        toast.textContent = `⭐ +${amount} XP Earned!`;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = '#10b981';
        toast.style.color = 'white';
        toast.style.padding = '8px 16px';
        toast.style.borderRadius = '20px';
        toast.style.fontWeight = 'bold';
        toast.style.zIndex = '9999';
        toast.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
        toast.style.transition = 'opacity 0.3s';
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2500);
    }
}

// --- Change Profile Icon Modal ---
const emojiCategories = {
    "Boy": ["👦", "👦🏻", "👦🏼", "👦🏽", "👦🏾", "👦🏿", "👱‍♂️", "👨‍🦰", "👨‍🦱", "👨‍🦳", "👨‍🦲", "🧑‍🦰", "🧑‍🦱", "🧑‍🦳", "🧑‍🦲"],
    "Girl": ["👧", "👧🏻", "👧🏼", "👧🏽", "👧🏾", "👧🏿", "👱‍♀️", "👩‍🦰", "👩‍🦱", "👩‍🦳", "👩‍🦲", "🧒", "🧒🏻", "🧒🏼", "🧒🏽", "🧒🏾", "🧒🏿"],
    "Uncle": ["👨", "👨🏻", "👨🏼", "👨🏽", "👨🏾", "👨🏿", "👴", "👴🏻", "👴🏼", "👴🏽", "👴🏾", "👴🏿", "🧔", "🧔‍♂️", "👮‍♂️", "🕵️‍♂️"],
    "Aunty": ["👩", "👩🏻", "👩🏼", "👩🏽", "👩🏾", "👩🏿", "👵", "👵🏻", "👵🏼", "👵🏽", "👵🏾", "👵🏿", "🧕", "👮‍♀️", "🕵️‍♀️"],
    "Fun & Pets": ["🦊", "🐱", "🦁", "🐼", "🐨", "🦄", "🦉", "🚀", "💎", "💰", "💸", "💳", "⚡", "👑", "🔥", "⚽", "🎮", "🌟", "🍕", "☕"]
};

const freeAvatars = ["👦", "👦🏻", "👧", "👧🏻", "👨", "👨🏻", "👩", "👩🏻", "🦊", "🐱"];

const bgOptions = [
    'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', // Indigo-Purple (Default)
    'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)', // Teal-Green
    'linear-gradient(135deg, #f43f5e 0%, #f97316 100%)', // Rose-Orange
    'linear-gradient(135deg, #f59e0b 0%, #eab308 100%)', // Gold-Amber
    'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', // Blue-Indigo
    'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)', // Pink-Rose
    'linear-gradient(135deg, #84cc16 0%, #10b981 100%)', // Lime-Teal
    'linear-gradient(135deg, #7928ca 0%, #ff0080 100%)', // Purple-Pink Neon
    'linear-gradient(135deg, #ff4e50 0%, #f9d423 100%)', // Coral-Yellow Sunshine
    'linear-gradient(135deg, #475569 0%, #1e293b 100%)'  // Slate-Dark
];

let selectedEmoji = "";
let selectedBg = "";

function openAvatarModal() {
    if (!avatarView) return;

    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    selectedEmoji = user.profileIcon || "";
    selectedBg = user.profileBg || "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)";

    // Setup preview
    const previewEl = document.getElementById('avatar-preview');
    if (previewEl) {
        previewEl.textContent = selectedEmoji || user.username.charAt(0).toUpperCase();
        previewEl.style.background = selectedBg;
        previewEl.style.fontSize = selectedEmoji ? '28px' : '';
    }

    // Determine default tab based on selected emoji
    let currentTab = "Boy";
    if (selectedEmoji) {
        for (const [catName, emojis] of Object.entries(emojiCategories)) {
            if (emojis.includes(selectedEmoji)) {
                currentTab = catName;
                break;
            }
        }
    }

    // Build Category Tabs
    const catContainer = document.getElementById('avatar-categories');
    if (catContainer) {
        catContainer.innerHTML = '';
        Object.keys(emojiCategories).forEach(catName => {
            const tabBtn = document.createElement('button');
            tabBtn.className = `avatar-tab-btn ${currentTab === catName ? 'active' : ''}`;
            tabBtn.textContent = catName;
            tabBtn.addEventListener('click', () => {
                document.querySelectorAll('.avatar-tab-btn').forEach(btn => btn.classList.remove('active'));
                tabBtn.classList.add('active');
                currentTab = catName;
                renderEmojiGrid(catName, previewEl, user);
            });
            catContainer.appendChild(tabBtn);
        });
    }

    // Function to render emojis for selected category
    function renderEmojiGrid(category, previewEl, user) {
        const emojiGrid = document.getElementById('avatar-emoji-grid');
        if (!emojiGrid) return;
        emojiGrid.innerHTML = '';
        const emojis = emojiCategories[category] || [];
        const unlockedAvatars = user.unlockedAvatars || [];
        emojis.forEach(emoji => {
            const isFree = freeAvatars.includes(emoji);
            const isUnlocked = isFree || unlockedAvatars.includes(emoji);

            const item = document.createElement('div');
            item.className = `avatar-emoji-item ${selectedEmoji === emoji ? 'active' : ''}`;
            item.style.position = 'relative';

            if (!isUnlocked) {
                item.style.opacity = '0.5';
                item.style.cursor = 'not-allowed';
                item.innerHTML = `<span>${emoji}</span><span style="position:absolute; bottom:-2px; right:-2px; font-size:10px; background:rgba(0,0,0,0.6); border-radius:50%; padding:2px;">🔒</span>`;
            } else {
                item.textContent = emoji;
            }

            item.addEventListener('click', () => {
                if (!isUnlocked) {
                    alert('This avatar is locked! Visit the Rewards Store to unlock it using XP.');
                    return;
                }

                if (selectedEmoji === emoji) {
                    item.classList.remove('active');
                    selectedEmoji = "";
                    if (previewEl) {
                        previewEl.textContent = user.username.charAt(0).toUpperCase();
                        previewEl.style.fontSize = '';
                    }
                } else {
                    document.querySelectorAll('.avatar-emoji-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    selectedEmoji = emoji;
                    if (previewEl) {
                        previewEl.textContent = emoji;
                        previewEl.style.fontSize = '28px';
                    }
                }
            });
            emojiGrid.appendChild(item);
        });
    }

    // Render initial emoji grid
    renderEmojiGrid(currentTab, previewEl, user);

    // Build bg grid
    const bgGrid = document.getElementById('avatar-bg-grid');
    if (bgGrid) {
        bgGrid.innerHTML = '';
        bgOptions.forEach(bg => {
            const item = document.createElement('div');
            item.className = `avatar-bg-item ${selectedBg === bg ? 'active' : ''}`;
            item.style.background = bg;
            item.addEventListener('click', () => {
                document.querySelectorAll('.avatar-bg-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                selectedBg = bg;
                if (previewEl) {
                    previewEl.style.background = bg;
                }
            });
            bgGrid.appendChild(item);
        });
    }

    // Hide all other views and show avatar view
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    avatarView.classList.add('active');
}

// Back button to navigate to Settings Page
document.getElementById('avatar-back-btn')?.addEventListener('click', () => {
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    const settingsView = document.getElementById('settings-view');
    if (settingsView) settingsView.classList.add('active');
});

document.getElementById('change-avatar-btn')?.addEventListener('click', openAvatarModal);
document.getElementById('p-avatar')?.addEventListener('click', openAvatarModal);
document.getElementById('close-avatar-modal')?.addEventListener('click', () => {
    // Cancel also goes back to settings page
    const appViews = document.querySelectorAll('.app-view');
    appViews.forEach(v => v.classList.remove('active'));
    const settingsView = document.getElementById('settings-view');
    if (settingsView) settingsView.classList.add('active');
});

document.getElementById('save-avatar')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-avatar');
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        btn.textContent = "Syncing...";
        btn.disabled = true;
        try {
            // Optimistic UI Update - make it instant for the user
            user.profileIcon = selectedEmoji;
            user.profileBg = selectedBg;
            localStorage.setItem('currentUser', JSON.stringify(user));
            
            // Go back to settings view
            const appViews = document.querySelectorAll('.app-view');
            appViews.forEach(v => v.classList.remove('active'));
            const settingsView = document.getElementById('settings-view');
            if (settingsView) settingsView.classList.add('active');
            
            initUser();
            initSettings();

            // Sync to Firestore in the background (non-blocking)
            updateDoc(doc(db, "users", user.phone), { 
                profileIcon: selectedEmoji, 
                profileBg: selectedBg 
            }).catch(err => console.error("Avatar sync failed:", err));

        } catch (err) {
            console.error(err);
        } finally {
            btn.textContent = "Save Icon";
            btn.disabled = false;
        }
    }
});

document.getElementById('close-feedback-modal')?.addEventListener('click', () => { if (feedbackModal) feedbackModal.style.display = 'none'; });

// --- Profile Update ---
document.getElementById('save-profile')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-profile');
    const newName = document.getElementById('edit-name-input')?.value.trim();
    const newEmail = document.getElementById('edit-email-input')?.value.trim();
    const newMotto = document.getElementById('edit-motto-input')?.value.trim();
    const newDob = document.getElementById('edit-dob-input')?.value;

    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (user) {
        if (!newName) {
            alert("Display name cannot be empty.");
            return;
        }

        btn.textContent = "Syncing...";
        btn.disabled = true;

        try {
            const updates = {
                username: newName,
                email: newEmail,
                motto: newMotto,
                dob: newDob
            };

            await updateDoc(doc(db, "users", user.phone), updates);

            // Update local storage currentUser
            user.username = newName;
            localStorage.setItem('currentUser', JSON.stringify(user));

            // Update user settings cache
            const cacheKey = `userSettings_${user.phone}`;
            const cachedSettings = JSON.parse(localStorage.getItem(cacheKey)) || {};
            cachedSettings.username = newName;
            cachedSettings.email = newEmail;
            cachedSettings.motto = newMotto;
            cachedSettings.dob = newDob;
            localStorage.setItem(cacheKey, JSON.stringify(cachedSettings));

            // Award 50 XP
            addXP(50);

            // Navigate back to Settings view
            const appViews = document.querySelectorAll('.app-view');
            appViews.forEach(v => v.classList.remove('active'));
            const settingsView = document.getElementById('settings-view');
            if (settingsView) settingsView.classList.add('active');

            initUser();
            initSettings();
        } catch (err) {
            console.error("Save profile sync failed:", err);
            alert("Sync failed. Check your internet connection.");
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

// =============================================
// HELP & SUPPORT CENTER REDESIGN LOGIC
// =============================================

// Tab Switching Wires
const tabFaq = document.getElementById('tab-support-faq');
const tabCreate = document.getElementById('tab-support-create');
const tabAi = document.getElementById('tab-support-ai');
const tabHistory = document.getElementById('tab-support-history');

const panelFaq = document.getElementById('support-panel-faq');
const panelCreate = document.getElementById('support-panel-create');
const panelAi = document.getElementById('support-panel-ai');
const panelHistory = document.getElementById('support-panel-history');

function switchSupportTab(activeTab) {
    [tabFaq, tabCreate, tabAi, tabHistory].forEach(tab => {
        if (!tab) return;
        if (tab === activeTab) {
            tab.classList.add('active');
            tab.style.background = '#6366f1';
            tab.style.color = 'white';
        } else {
            tab.classList.remove('active');
            tab.style.background = 'transparent';
            tab.style.color = '#64748b';
        }
    });

    if (panelFaq) panelFaq.style.display = activeTab === tabFaq ? 'block' : 'none';
    if (panelCreate) {
        panelCreate.style.display = activeTab === tabCreate ? 'block' : 'none';
        if (activeTab === tabCreate) {
            populateTicketTransactions();
        }
    }
    if (panelAi) panelAi.style.display = activeTab === tabAi ? 'block' : 'none';
    if (panelHistory) panelHistory.style.display = activeTab === tabHistory ? 'block' : 'none';
}

tabFaq?.addEventListener('click', () => switchSupportTab(tabFaq));
tabCreate?.addEventListener('click', () => switchSupportTab(tabCreate));
tabAi?.addEventListener('click', () => switchSupportTab(tabAi));
tabHistory?.addEventListener('click', () => switchSupportTab(tabHistory));

// Function to dynamically load user's recent transactions for optional ticket linkage
function populateTicketTransactions() {
    const selectEl = document.getElementById('ticket-transaction-link');
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">-- None --</option>';
    
    const localUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!localUser || !localUser.phone) return;
    
    const dataKey = `trackerData_${localUser.phone}`;
    const data = JSON.parse(localStorage.getItem(dataKey)) || trackerData || [];
    
    // Filter transactions that have some actual amount (earns, other, or spends > 0)
    const validRows = data
        .filter(r => r.date && ((r.earns && parseFloat(r.earns) > 0) || (r.other && parseFloat(r.other) > 0) || (r.spends && parseFloat(r.spends) > 0)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 15);
        
    validRows.forEach(row => {
        const earnsVal = parseFloat(row.earns) || 0;
        const otherVal = parseFloat(row.other) || 0;
        const spendsVal = parseFloat(row.spends) || 0;
        const amount = earnsVal + otherVal - spendsVal;
        const sign = amount >= 0 ? '+' : '';
        const categoryStr = row.category && row.category !== '-' ? ` [${row.category}]` : '';
        const dateStr = row.date;
        const currencySymbol = typeof CS === 'function' ? CS() : '₹';
        const label = `${dateStr}${categoryStr}: ${sign}${currencySymbol}${Math.round(Math.abs(amount))}`;
        const option = document.createElement('option');
        option.value = JSON.stringify({ date: row.date, category: row.category, amount: amount });
        option.textContent = label;
        selectEl.appendChild(option);
    });
}

// FAQ Search Filter and Highlight
const faqSearch = document.getElementById('faq-search');
faqSearch?.addEventListener('input', (e) => {
    const queryStr = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.faq-item').forEach(item => {
        const triggerSpan = item.querySelector('.faq-trigger span');
        const contentDiv = item.querySelector('.faq-content');
        if (!triggerSpan || !contentDiv) return;
        
        const originalQuestion = triggerSpan.getAttribute('data-original') || triggerSpan.textContent;
        if (!triggerSpan.getAttribute('data-original')) {
            triggerSpan.setAttribute('data-original', originalQuestion);
        }
        
        const originalAnswer = contentDiv.getAttribute('data-original') || contentDiv.textContent.trim();
        if (!contentDiv.getAttribute('data-original')) {
            contentDiv.setAttribute('data-original', originalAnswer);
        }
        
        const questionLower = originalQuestion.toLowerCase();
        const answerLower = originalAnswer.toLowerCase();
        
        if (questionLower.includes(queryStr) || answerLower.includes(queryStr)) {
            item.style.display = 'block';
            
            if (queryStr) {
                // Highlight query in question
                const qRegex = new RegExp(`(${queryStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
                triggerSpan.innerHTML = originalQuestion.replace(qRegex, '<mark style="background: #fef08a; color: #1e293b; padding: 1px 2px; border-radius: 2px;">$1</mark>');
                
                // Highlight query in answer
                contentDiv.innerHTML = originalAnswer.replace(qRegex, '<mark style="background: #fef08a; color: #1e293b; padding: 1px 2px; border-radius: 2px;">$1</mark>');
            } else {
                triggerSpan.textContent = originalQuestion;
                contentDiv.textContent = originalAnswer;
            }
        } else {
            item.style.display = 'none';
        }
    });
});

// FAQ Accordion Collapsing
document.querySelectorAll('.faq-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
        const content = trigger.nextElementSibling;
        const arrow = trigger.querySelector('.faq-arrow');
        const isOpen = content.style.display === 'block';

        // Collapse all other FAQ panels first
        document.querySelectorAll('.faq-content').forEach(c => c.style.display = 'none');
        document.querySelectorAll('.faq-arrow').forEach(a => a.style.transform = 'rotate(0deg)');

        if (!isOpen) {
            content.style.display = 'block';
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        }
    });
});

// Category Selector Cards
let selectedSupportCategory = "Bug Report";
const supportCards = document.querySelectorAll('.support-cat-card');
supportCards.forEach(card => {
    card.addEventListener('click', () => {
        supportCards.forEach(c => {
            c.classList.remove('active');
            c.style.borderColor = 'var(--border-color)';
            c.style.background = 'white';
        });
        card.classList.add('active');
        card.style.borderColor = '#6366f1';
        card.style.background = 'rgba(99, 102, 241, 0.05)';
        selectedSupportCategory = card.getAttribute('data-value') || 'Other';
    });
});

// Textarea Character Counter
const ticketMessageInput = document.getElementById('ticket-message');
const charCounter = document.getElementById('support-char-counter');
ticketMessageInput?.addEventListener('input', () => {
    const len = ticketMessageInput.value.length;
    if (charCounter) charCounter.textContent = `${len}/500`;
});

// Firestore Live Support History Listener
let supportTicketsListener = null;
function startSupportTicketsListener() {
    const localUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!localUser || !localUser.phone) return;

    if (supportTicketsListener) {
        supportTicketsListener();
    }

    const q = query(collection(db, "support_tickets"), where("userId", "==", localUser.phone));
    supportTicketsListener = onSnapshot(q, (snapshot) => {
        const historyList = document.getElementById('support-history-list');
        const historyBadge = document.getElementById('support-history-badge');
        if (!historyList) return;

        let tickets = [];
        snapshot.forEach(docSnap => {
            tickets.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Client-side sort by createdAt desc to avoid index requirements
        tickets.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
            const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });

        // Set unread replies badge (number of resolved tickets that have an admin reply)
        const unresolvedRepliesCount = tickets.filter(t => t.status === 'resolved' && t.adminReply).length;
        if (historyBadge) {
            if (unresolvedRepliesCount > 0) {
                historyBadge.textContent = unresolvedRepliesCount;
                historyBadge.style.display = 'inline-block';
            } else {
                historyBadge.style.display = 'none';
            }
        }

        // Render Support History Stats
        const statsContainer = document.getElementById('support-history-stats');
        if (statsContainer) {
            const total = tickets.length;
            const open = tickets.filter(t => t.status === 'open').length;
            const resolved = tickets.filter(t => t.status === 'resolved').length;
            statsContainer.innerHTML = `
                <div style="flex: 1; background: var(--border-color); opacity: 0.8; padding: 6px 8px; border-radius: 8px; text-align: center; font-size: 9px; font-weight: 700; color: var(--text-main);">📋 ${total} Total</div>
                <div style="flex: 1; background: rgba(217, 119, 6, 0.1); padding: 6px 8px; border-radius: 8px; text-align: center; font-size: 9px; font-weight: 700; color: #d97706;">🟢 ${open} Open</div>
                <div style="flex: 1; background: rgba(5, 150, 105, 0.1); padding: 6px 8px; border-radius: 8px; text-align: center; font-size: 9px; font-weight: 700; color: #059669;">✅ ${resolved} Resolved</div>
            `;
        }

        historyList.innerHTML = '';
        if (tickets.length === 0) {
            historyList.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted); font-size: 11px; font-weight: 600;">No support tickets logged.</div>';
            return;
        }

        tickets.forEach(ticket => {
            const timeStr = ticket.createdAt ? new Date(ticket.createdAt.toMillis()).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : 'Just now';

            const card = document.createElement('div');
            card.className = 'history-ticket-card';
            card.style.cssText = 'border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; position: relative;';

            let typeColor = '#6366f1';
            if (ticket.type === 'Bug Report') typeColor = '#ef4444';
            else if (ticket.type === 'Payment Issue' || ticket.type === 'Payment/XP') typeColor = '#f59e0b';
            else if (ticket.type === 'Suggestion') typeColor = '#10b981';

            const isResolved = ticket.status === 'resolved';
            const badgeClass = isResolved ? 'resolved' : 'open';
            const badgeText = isResolved ? 'Resolved' : 'Open';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: white; background: ${typeColor}; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;">${ticket.type || 'Support'}</span>
                        <span class="support-status-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <span style="font-size: 9px; color: var(--text-muted); font-weight: 600;">${timeStr}</span>
                </div>
                <div style="font-size: 11px; color: var(--text-main); line-height: 1.4; white-space: pre-wrap; margin-top: 4px;">${ticket.message}</div>
                ${ticket.adminReply ? `
                    <div style="margin-top: 8px; padding: 10px; background: rgba(16, 185, 129, 0.05); border-left: 3px solid #10b981; border-radius: 6px;">
                        <div style="font-size: 9px; font-weight: 800; color: #10b981; text-transform: uppercase; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                            <span>📩 Admin Response</span>
                            ${ticket.repliedAt ? `<span style="font-weight: 600; text-transform: none; color: var(--text-muted); font-size: 8px;">(${new Date(ticket.repliedAt.toMillis()).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})})</span>` : ''}
                        </div>
                        <div style="font-size: 10.5px; color: var(--text-main); line-height: 1.4; white-space: pre-wrap;">${ticket.adminReply}</div>
                    </div>
                ` : ''}
            `;
            historyList.appendChild(card);
        });
    });
}

// Initial Call to Start Listener
startSupportTicketsListener();

// --- Support ticket submission ---
document.getElementById('submit-ticket')?.addEventListener('click', async () => {
    const message = ticketMessageInput?.value || "";
    const btn = document.getElementById('submit-ticket');
    const successOverlay = document.getElementById('success-overlay-settings');
    const localUser = JSON.parse(localStorage.getItem('currentUser'));

    if (!message.trim()) return alert("Please type a message.");
    if (!localUser) return alert("You must be logged in.");

    btn.textContent = "Sending...";
    btn.disabled = true;

    try {
        await addDoc(collection(db, "support_tickets"), {
            userId: localUser.phone,
            username: localUser.username,
            type: selectedSupportCategory,
            message: message,
            status: 'open',
            createdAt: serverTimestamp()
        });

        if (ticketMessageInput) ticketMessageInput.value = "";
        if (charCounter) charCounter.textContent = "0/500";
        
        // Reset category cards back to Bug Report
        supportCards.forEach(c => {
            const isBug = c.getAttribute('data-value') === 'Bug Report';
            c.classList.toggle('active', isBug);
            c.style.borderColor = isBug ? '#6366f1' : 'var(--border-color)';
            c.style.background = isBug ? 'rgba(99, 102, 241, 0.05)' : 'white';
        });
        selectedSupportCategory = "Bug Report";
        
        // Switch to history tab to immediately show the user their ticket
        const tabHistory = document.getElementById('tab-support-history');
        if (tabHistory) tabHistory.click();
        
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

// =============================================
// ADVANCED ACCOUNT SECURITY REDESIGN LOGIC
// =============================================
let pinFlowState = "new"; // "verify_current" | "new" | "confirm"
let secPinBuffer = "";
let currentPinAnswer = "";
let newPinCandidate = "";

// Inactivity variables
let lastInteractionTime = Date.now();
let inactivityInterval = null;

// 2FA state
let currentMfaCode = "123456";

// Utility helpers for platform detection
function getBrowserName() {
    const ua = navigator.userAgent;
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Edge")) return "Edge";
    return "Web Browser";
}

function getOSName() {
    const ua = navigator.userAgent;
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Macintosh") || ua.includes("Mac OS")) return "macOS";
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
    if (ua.includes("Android")) return "Android";
    return "Device OS";
}

// 1. Core Data Refresher
async function loadSecurityPageData() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const cacheKey = `userSettings_${user.phone}`;
    let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};

    // Elements
    const lockToggle = document.getElementById('lock-toggle');
    const pinActionsSection = document.getElementById('pin-actions-section');
    const autolockSelect = document.getElementById('autolock-duration-select');
    const biometricsToggle = document.getElementById('biometrics-toggle');
    const twofactorToggle = document.getElementById('twofactor-toggle');
    const recoveryEmailInput = document.getElementById('recovery-email-input');

    // Load states
    if (lockToggle) {
        lockToggle.checked = !!userData.isLockActive;
        if (pinActionsSection) {
            pinActionsSection.style.display = userData.isLockActive ? 'block' : 'none';
        }
    }
    
    currentPinAnswer = userData.appPin || "";
    
    if (autolockSelect) {
        autolockSelect.value = userData.autoLockDuration || "immediate";
    }

    if (biometricsToggle) {
        biometricsToggle.checked = !!userData.biometricsEnabled;
    }

    if (twofactorToggle) {
        twofactorToggle.checked = !!userData.twoFactorEnabled;
    }

    if (recoveryEmailInput) {
        recoveryEmailInput.value = userData.email || "";
    }

    // Refresh dynamic lists
    renderActiveSessions(userData);
    renderSecurityAuditLog(userData);
}

// 2. Security Log Logger Helper
async function addSecurityLog(action, status) {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const cacheKey = `userSettings_${user.phone}`;
    let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};

    let logs = userData.securityLog || [];
    const newEntry = {
        action: action,
        status: status || "success",
        time: new Date().toLocaleString()
    };
    
    logs.unshift(newEntry);
    
    // limit logs size to 10 entries for neat rendering
    if (logs.length > 10) logs = logs.slice(0, 10);

    userData.securityLog = logs;
    localStorage.setItem(cacheKey, JSON.stringify(userData));

    // Save to Firebase non-blockingly
    try {
        const userRef = doc(db, "users", user.phone);
        await updateDoc(userRef, { securityLog: logs });
    } catch(e) {
        console.warn("Audit log firebase sync failed:", e);
    }
}

// 3. Render Session Log
function renderActiveSessions(userData) {
    const sessionList = document.getElementById('active-sessions-list');
    if (!sessionList) return;

    sessionList.innerHTML = "";

    // A. Current Device
    const browser = getBrowserName();
    const os = getOSName();

    const currentItem = document.createElement('div');
    currentItem.className = "session-item";
    currentItem.innerHTML = `
        <div class="session-device-icon">💻</div>
        <div class="session-details">
            <div class="session-device-name">${browser} on ${os} <span class="active-dot"></span></div>
            <div class="session-meta">This device • Bangalore, India • Active now</div>
        </div>
    `;
    sessionList.appendChild(currentItem);

    // B. Mock Devices if not revoked
    if (!userData.sessionsRevoked) {
        const mockDevice1 = document.createElement('div');
        mockDevice1.className = "session-item";
        mockDevice1.innerHTML = `
            <div class="session-device-icon">📱</div>
            <div class="session-details">
                <div class="session-device-name">Safari on iPhone 15 Pro</div>
                <div class="session-meta">Mobile • London, UK • Active 2 hours ago</div>
            </div>
        `;
        sessionList.appendChild(mockDevice1);

        const mockDevice2 = document.createElement('div');
        mockDevice2.className = "session-item";
        mockDevice2.innerHTML = `
            <div class="session-device-icon">💻</div>
            <div class="session-details">
                <div class="session-device-name">Chrome on macOS</div>
                <div class="session-meta">Desktop • New York, USA • Active 3 days ago</div>
            </div>
        `;
        sessionList.appendChild(mockDevice2);
        
        document.getElementById('revoke-sessions-btn').style.display = 'block';
    } else {
        document.getElementById('revoke-sessions-btn').style.display = 'none';
    }
}

// 4. Render Audit Logs
function renderSecurityAuditLog(userData) {
    const logBody = document.getElementById('security-log-body');
    if (!logBody) return;

    logBody.innerHTML = "";

    let logs = userData.securityLog;
    if (!logs || logs.length === 0) {
        logs = [
            { action: "Login session started", status: "success", time: new Date(Date.now() - 3600000 * 2).toLocaleString() },
            { action: "Security verification setup", status: "success", time: new Date(Date.now() - 86400000).toLocaleString() }
        ];
    }

    logs.forEach(log => {
        const row = document.createElement('tr');
        row.style.borderBottom = "1px solid var(--border-color)";
        
        const badgeClass = log.status === "success" ? "badge-success" : (log.status === "failed" ? "badge-failed" : "badge-info");
        
        row.innerHTML = `
            <td style="padding: 6px 8px; font-weight: 600; color: var(--text-main);">${log.action}</td>
            <td style="padding: 6px 8px;"><span class="badge ${badgeClass}">${log.status}</span></td>
            <td style="padding: 6px 8px; text-align: right; color: var(--text-muted);">${log.time.split(',')[1] || log.time}</td>
        `;
        logBody.appendChild(row);
    });
}

// 5. Wire Active Revocation
document.getElementById('revoke-sessions-btn')?.addEventListener('click', async () => {
    if (confirm("Are you sure you want to log out all other sessions?")) {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user) return;
        
        const cacheKey = `userSettings_${user.phone}`;
        let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};

        userData.sessionsRevoked = true;
        localStorage.setItem(cacheKey, JSON.stringify(userData));

        try {
            const userRef = doc(db, "users", user.phone);
            await updateDoc(userRef, { sessionsRevoked: true });
            alert("All other sessions successfully revoked!");
            await addSecurityLog("Logged out other sessions", "success");
            loadSecurityPageData();
        } catch (e) {
            alert("Failed to revoke sessions.");
        }
    }
});

// 6. Wire Recovery Email Save
document.getElementById('save-email')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-email');
    const newEmail = document.getElementById('recovery-email-input')?.value.trim();
    const user = JSON.parse(localStorage.getItem('currentUser'));
    
    if (newEmail && newEmail.includes('@') && user) {
        btn.textContent = "Saving...";
        btn.disabled = true;
        
        try {
            await updateDoc(doc(db, "users", user.phone), { email: newEmail });
            
            const cacheKey = `userSettings_${user.phone}`;
            let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
            userData.email = newEmail;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            alert("Recovery email updated!");
            await addSecurityLog("Updated recovery email", "success");
            loadSecurityPageData();
            initSettings(); // Refresh settings panel
        } catch (err) {
            alert("Update failed.");
        } finally {
            btn.textContent = "Save";
            btn.disabled = false;
        }
    } else {
        alert("Please enter a valid email address.");
    }
});

// 7. Autolock select listener
document.getElementById('autolock-duration-select')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const cacheKey = `userSettings_${user.phone}`;
    let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
    userData.autoLockDuration = val;
    localStorage.setItem(cacheKey, JSON.stringify(userData));

    try {
        await updateDoc(doc(db, "users", user.phone), { autoLockDuration: val });
        await addSecurityLog(`Changed auto-lock timeout to ${val}`, "success");
    } catch(err) {
        console.warn("Failed to save timeout settings:", err);
    }
});

// 8. Biometrics Toggle listener
document.getElementById('biometrics-toggle')?.addEventListener('change', async (e) => {
    const val = e.target.checked;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const cacheKey = `userSettings_${user.phone}`;
    let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
    userData.biometricsEnabled = val;
    localStorage.setItem(cacheKey, JSON.stringify(userData));

    try {
        await updateDoc(doc(db, "users", user.phone), { biometricsEnabled: val });
        await addSecurityLog(`${val ? "Enabled" : "Disabled"} simulated biometrics`, "success");
        alert(val ? "Simulated Touch/Face ID enabled!" : "Simulated biometrics disabled.");
    } catch(err) {
        console.warn("Failed to save biometrics setting:", err);
    }
});

// 9. Two-Factor Authentication Setup Flow
document.getElementById('twofactor-toggle')?.addEventListener('change', async (e) => {
    const val = e.target.checked;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const qrBlock = document.getElementById('qr-setup-block');

    if (val) {
        // Show QR block for verification
        if (qrBlock) qrBlock.style.display = 'block';
        e.target.checked = false; // Reset checkbox until verified
    } else {
        // Turn off directly
        if (confirm("Are you sure you want to disable 2FA?")) {
            const cacheKey = `userSettings_${user.phone}`;
            let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
            userData.twoFactorEnabled = false;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            try {
                await updateDoc(doc(db, "users", user.phone), { twoFactorEnabled: false });
                if (qrBlock) qrBlock.style.display = 'none';
                await addSecurityLog("Disabled 2FA", "success");
                alert("2FA has been disabled.");
                loadSecurityPageData();
            } catch(err) {
                console.warn(err);
            }
        } else {
            e.target.checked = true;
        }
    }
});

// 2FA setup verification inputs focus wiring
const totpInputs = document.querySelectorAll('#qr-setup-block .totp-digit');
totpInputs.forEach((inp, idx) => {
    inp.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val && idx < totpInputs.length - 1) {
            totpInputs[idx + 1].focus();
        }
    });
    inp.addEventListener('keydown', (e) => {
        if (e.key === "Backspace" && !inp.value && idx > 0) {
            totpInputs[idx - 1].focus();
        }
    });
});

document.getElementById('verify-2fa-setup-btn')?.addEventListener('click', async () => {
    let joinedCode = "";
    totpInputs.forEach(inp => joinedCode += inp.value);

    if (joinedCode === currentMfaCode) {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user) return;

        const cacheKey = `userSettings_${user.phone}`;
        let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
        userData.twoFactorEnabled = true;
        localStorage.setItem(cacheKey, JSON.stringify(userData));

        try {
            await updateDoc(doc(db, "users", user.phone), { twoFactorEnabled: true });
            alert("2FA Verification Successful! Google Authenticator 2FA enabled.");
            await addSecurityLog("Enabled Google Authenticator 2FA", "success");
            
            // Reset input boxes
            totpInputs.forEach(inp => inp.value = "");
            const qrBlock = document.getElementById('qr-setup-block');
            if (qrBlock) qrBlock.style.display = 'none';
            loadSecurityPageData();
        } catch(err) {
            alert("Firebase write failed.");
        }
    } else {
        alert("Invalid verification code. Please enter '123456' to simulate setup.");
        await addSecurityLog("Attempted 2FA setup validation", "failed");
    }
});

// 10. Inline Keypad PIN Setup/Change Flow
const secPinDots = document.querySelectorAll('.sec-pin-dot');
const secPinButtons = document.querySelectorAll('.sec-pin-btn');
const inlineKeypadSection = document.getElementById('security-inline-keypad');
const changePinBtn = document.getElementById('trigger-change-pin-btn');
const pinActionsSection = document.getElementById('pin-actions-section');

function updateSecPinDotsUI() {
    secPinDots.forEach((dot, i) => {
        if (i < secPinBuffer.length) dot.classList.add('filled');
        else dot.classList.remove('filled');
    });
}

function resetSecPinFlow() {
    secPinBuffer = "";
    newPinCandidate = "";
    updateSecPinDotsUI();
    if (inlineKeypadSection) inlineKeypadSection.style.display = 'none';
}

if (changePinBtn) {
    changePinBtn.addEventListener('click', () => {
        if (inlineKeypadSection) {
            if (inlineKeypadSection.style.display === 'block') {
                resetSecPinFlow();
            } else {
                inlineKeypadSection.style.display = 'block';
                secPinBuffer = "";
                newPinCandidate = "";
                updateSecPinDotsUI();
                
                const flowMsg = document.getElementById('pin-flow-message');
                if (currentPinAnswer) {
                    pinFlowState = "verify_current";
                    if (flowMsg) flowMsg.textContent = "Enter Current PIN";
                } else {
                    pinFlowState = "new";
                    if (flowMsg) flowMsg.textContent = "Enter New 4-digit PIN";
                }
            }
        }
    });
}

// Cancel pin setup click
document.querySelector('.cancel-pin-flow')?.addEventListener('click', () => {
    resetSecPinFlow();
});

// Lock toggle change logic
document.getElementById('lock-toggle')?.addEventListener('change', async (e) => {
    const val = e.target.checked;
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    if (val) {
        // Enabling App Lock
        if (!currentPinAnswer) {
            // Need a new PIN first!
            e.target.checked = false;
            alert("Please set a secure PIN first.");
            // Open change pin keypad
            changePinBtn?.click();
        } else {
            // Toggle active directly
            const cacheKey = `userSettings_${user.phone}`;
            let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
            userData.isLockActive = true;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            try {
                await updateDoc(doc(db, "users", user.phone), { isLockActive: true });
                await addSecurityLog("Enabled App Lock", "success");
                loadSecurityPageData();
            } catch(e) {
                console.warn(e);
            }
        }
    } else {
        // Disabling App Lock
        // Ask for current PIN to confirm disable!
        e.target.checked = true; // reset until validated
        const entered = prompt("Enter your current secure PIN to disable App Lock:");
        if (entered === currentPinAnswer) {
            const cacheKey = `userSettings_${user.phone}`;
            let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
            userData.isLockActive = false;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            try {
                await updateDoc(doc(db, "users", user.phone), { isLockActive: false });
                await addSecurityLog("Disabled App Lock", "success");
                loadSecurityPageData();
            } catch(e) {
                console.warn(e);
            }
        } else if (entered !== null) {
            alert("Incorrect PIN! Security setting unchanged.");
            await addSecurityLog("Failed disable App Lock check", "failed");
        }
    }
});

// Inline keypad numbers clicks
secPinButtons.forEach(btn => {
    if (btn.classList.contains('cancel-pin-flow') || btn.classList.contains('back')) return;
    
    btn.addEventListener('click', () => {
        const val = btn.textContent;
        if (secPinBuffer.length < 4) {
            secPinBuffer += val;
            updateSecPinDotsUI();
            
            if (secPinBuffer.length === 4) {
                setTimeout(handlePinBufferFull, 200);
            }
        }
    });
});

// Backspace click
document.querySelector('.sec-pin-btn.back')?.addEventListener('click', () => {
    secPinBuffer = secPinBuffer.slice(0, -1);
    updateSecPinDotsUI();
});

async function handlePinBufferFull() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const flowMsg = document.getElementById('pin-flow-message');
    const entered = secPinBuffer;
    secPinBuffer = "";
    updateSecPinDotsUI();

    if (pinFlowState === "verify_current") {
        if (entered === currentPinAnswer) {
            pinFlowState = "new";
            if (flowMsg) flowMsg.textContent = "Enter New 4-digit PIN";
        } else {
            alert("Incorrect PIN code! Please try again.");
            await addSecurityLog("Attempted change PIN validation", "failed");
            resetSecPinFlow();
        }
    } else if (pinFlowState === "new") {
        newPinCandidate = entered;
        pinFlowState = "confirm";
        if (flowMsg) flowMsg.textContent = "Confirm New 4-digit PIN";
    } else if (pinFlowState === "confirm") {
        if (entered === newPinCandidate) {
            // Save PIN
            const cacheKey = `userSettings_${user.phone}`;
            let userData = JSON.parse(localStorage.getItem(cacheKey)) || {};
            userData.isLockActive = true;
            userData.appPin = entered;
            localStorage.setItem(cacheKey, JSON.stringify(userData));

            try {
                await updateDoc(doc(db, "users", user.phone), { 
                    isLockActive: true,
                    appPin: entered
                });
                alert("PIN changed and App Lock enabled successfully!");
                await addSecurityLog("Updated secure PIN", "success");
                resetSecPinFlow();
                loadSecurityPageData();
            } catch(e) {
                alert("Failed to write to database.");
            }
        } else {
            alert("PINs do not match! Resetting PIN setup flow.");
            pinFlowState = "new";
            if (flowMsg) flowMsg.textContent = "Enter New 4-digit PIN";
        }
    }
}

// 11. Inactivity detection and auto-locking
function updateInteractionTime() {
    lastInteractionTime = Date.now();
}

function handleVisibilityLock() {
    const user = JSON.parse(localStorage.getItem('currentUser'));
    if (!user) return;

    const cacheKey = `userSettings_${user.phone}`;
    const cachedSettings = JSON.parse(localStorage.getItem(cacheKey));
    if (cachedSettings && cachedSettings.isLockActive && cachedSettings.appPin) {
        if (sessionStorage.getItem('app_verified') === 'true') {
            const duration = cachedSettings.autoLockDuration || "immediate";
            if (duration === "immediate") {
                // Backgrounding triggers lock immediately
                sessionStorage.removeItem('app_verified');
                checkAppLock();
            }
        }
    }
}

function startInactivityCheck() {
    window.addEventListener('mousemove', updateInteractionTime);
    window.addEventListener('click', updateInteractionTime);
    window.addEventListener('keydown', updateInteractionTime);
    window.addEventListener('touchstart', updateInteractionTime);

    if (inactivityInterval) clearInterval(inactivityInterval);
    inactivityInterval = setInterval(() => {
        const user = JSON.parse(localStorage.getItem('currentUser'));
        if (!user) return;

        const cacheKey = `userSettings_${user.phone}`;
        const cachedSettings = JSON.parse(localStorage.getItem(cacheKey));
        if (cachedSettings && cachedSettings.isLockActive && cachedSettings.appPin) {
            if (sessionStorage.getItem('app_verified') === 'true') {
                const duration = cachedSettings.autoLockDuration || "immediate";
                if (duration !== "immediate") {
                    const thresholdMs = parseInt(duration) * 60 * 1000;
                    if (Date.now() - lastInteractionTime >= thresholdMs) {
                        sessionStorage.removeItem('app_verified');
                        checkAppLock();
                    }
                }
            }
        }
    }, 10000); // Check every 10 seconds
}

// Initialize activity check
startInactivityCheck();
document.addEventListener('visibilitychange', handleVisibilityLock);

// 12. Lock Screen Verification & Biometrics Simulation
const lockBiometricBtn = document.getElementById('lock-biometric-btn');
const biometricOverlay = document.getElementById('biometric-scanner-overlay');
const biometricStatus = document.getElementById('biometric-scan-status');

if (lockBiometricBtn) {
    lockBiometricBtn.addEventListener('click', () => {
        if (biometricOverlay) {
            biometricOverlay.style.display = 'flex';
            if (biometricStatus) biometricStatus.textContent = "Scanning face/fingerprint...";
            
            // Simulating biometric sweep
            setTimeout(() => {
                if (biometricStatus) biometricStatus.textContent = "Analyzing biometrics...";
                
                setTimeout(() => {
                    if (biometricStatus) biometricStatus.textContent = "Unlock Successful! Match Found";
                    
                    setTimeout(() => {
                        biometricOverlay.style.display = 'none';
                        
                        // Proceed to 2FA if active, else unlock!
                        const user = JSON.parse(localStorage.getItem('currentUser'));
                        const cacheKey = `userSettings_${user.phone}`;
                        const cachedSettings = JSON.parse(localStorage.getItem(cacheKey));
                        
                        if (cachedSettings && cachedSettings.twoFactorEnabled) {
                            // Go to 2FA phase
                            const pinPanel = document.getElementById('lock-pin-panel');
                            const mfaPanel = document.getElementById('lock-2fa-panel');
                            if (pinPanel) pinPanel.style.display = 'none';
                            if (mfaPanel) mfaPanel.style.display = 'flex';
                        } else {
                            // Full unlock
                            sessionStorage.setItem('app_verified', 'true');
                            const overlay = document.getElementById('app-lock-overlay');
                            if (overlay) overlay.style.display = 'none';
                        }
                    }, 500);
                }, 1000);
            }, 1000);
        }
    });
}

// 13. Lock overlay 2FA inputs wiring
const lockTotpInputs = document.querySelectorAll('#lock-2fa-panel .totp-lock-digit');
lockTotpInputs.forEach((inp, idx) => {
    inp.addEventListener('input', (e) => {
        const val = e.target.value;
        if (val && idx < lockTotpInputs.length - 1) {
            lockTotpInputs[idx + 1].focus();
        }
    });
    inp.addEventListener('keydown', (e) => {
        if (e.key === "Backspace" && !inp.value && idx > 0) {
            lockTotpInputs[idx - 1].focus();
        }
    });
});

document.getElementById('verify-lock-2fa-btn')?.addEventListener('click', () => {
    let joinedCode = "";
    lockTotpInputs.forEach(inp => joinedCode += inp.value);

    if (joinedCode === currentMfaCode) {
        sessionStorage.setItem('app_verified', 'true');
        const overlay = document.getElementById('app-lock-overlay');
        if (overlay) overlay.style.display = 'none';
        
        // Reset inputs
        lockTotpInputs.forEach(inp => inp.value = "");
        const pinPanel = document.getElementById('lock-pin-panel');
        const mfaPanel = document.getElementById('lock-2fa-panel');
        if (pinPanel) pinPanel.style.display = 'flex';
        if (mfaPanel) mfaPanel.style.display = 'none';
    } else {
        alert("Invalid verification code. Please enter '123456'.");
        lockTotpInputs.forEach(inp => inp.value = "");
        lockTotpInputs[0].focus();
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
                    <div style="font-size:13px; font-weight:800; color:#ef4444;">${CS()}${sub.price}</div>
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
                    `${CS()}${sub.price} will be charged on ${sub.nextBillingDate}. Be prepared!`,
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
                    <span class="suggestion-item-price">${CS()}${item.price} • ${item.cycle}</span>
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
                const subNames = dueSubs.map(s => `• ${s.name} (${CS()}${s.price})`).join('\n');
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
                <span class="sub-item-price">${CS()}${sub.price}</span>
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

