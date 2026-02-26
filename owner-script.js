import { auth, db, storage } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, orderBy, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

console.log("Platto Master Dashboard Script Active...");

// --- Global Variables ---
const loader = document.getElementById('loader');
const authArea = document.getElementById('auth-area');
const mainWrapper = document.getElementById('main-wrapper');

let activeMenuFilter = ""; 
let historyRange = "all"; // History range control ke liye
let restaurantData = {};
let currentOrderTab = "Pending";
let isLoginMode = true;
let selectedPlanName = ""; 
let platformPrices = { "Monthly": 0, "6-Months": 0, "Yearly": 0 };
let adminUPI = "";

// --- 1. Safety Helpers ---
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };
const getV = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const hideLoader = () => { if(loader) loader.style.display = 'none'; };

// ==========================================
// 2. DASHBOARD SYNC (Fixed Position)
// ==========================================
function syncDashboard(data, uid) {
    console.log("Syncing Dashboard Data...");
    setUI('disp-status', data.status.toUpperCase());
    setUI('disp-plan', data.plan);
    setUI('top-res-name', data.name);

    const fill = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ""; };
    fill('res-name', data.name);
    fill('res-phone', data.ownerPhone);
    fill('res-wifi-n', data.wifiName);
    fill('res-wifi-p', data.wifiPass);
    fill('res-min-order', data.minOrder);
    fill('res-max-km', data.maxKM);
    fill('res-prep-time', data.prepTime);
    fill('res-ig', data.igLink);
    fill('res-fb', data.fbLink);
    fill('res-yt', data.ytLink);
    fill('res-address', data.address);
    fill('res-about', data.about);
    fill('ann-title', data.annTitle);
    fill('ann-text', data.annText);
    
    const annActive = document.getElementById('ann-active');
    if(annActive) annActive.checked = data.activeAnnouncement || false;

    if(data.createdAt) {
        let expiry = new Date(data.createdAt.toDate());
        let days = (data.plan === "Monthly") ? 30 : (data.plan === "6-Months" ? 180 : 365);
        expiry.setDate(expiry.getDate() + days);
        setUI('disp-expiry', expiry.toLocaleDateString('en-GB'));
        
        let today = new Date();
        if(expiry < today) showFlex('expired-screen');
        
        let daysLeft = Math.ceil((expiry - today) / (1000 * 3600 * 24));
        if(daysLeft <= 7 && daysLeft > 0) {
            showEl('expiry-warning');
            setUI('days-left', daysLeft);
        }
    }
    renderCategoriesUI(data.categories || []);
}

// ==========================================
// 3. AUTHENTICATION & OBSERVER
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {

      window.currentUID = user.uid; 
        
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) {
                restaurantData = d.data();
                // ... baki logic ...
                renderExtrasUI(); // Naya UI render karne ke liye
            }
        });
    }
});  
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if (d.exists()) {
                restaurantData = d.data();
                if (restaurantData.status === 'active' || restaurantData.status === 'expired') {
                    showEl('auth-area', false);
                    showFlex('main-wrapper');
                    syncDashboard(restaurantData, user.uid); // Now defined above
                    loadOrders(user.uid);
                    loadMenu(user.uid);
                    loadCoupons(user.uid);
                    generateQR(user.uid);
                } else {
                    showEl('auth-section', false);
                    showEl('waiting-section');
                }
            } else {
                showEl('auth-section', false);
                showEl('membership-section');
                fetchAdminSettings();
            }
            hideLoader();
        }, (err) => { console.error(err); hideLoader(); });
    } else {
        showEl('auth-area');
        showEl('auth-section');
        showEl('main-wrapper', false);
    }
    hideLoader();
});

document.getElementById('authBtn').onclick = async () => {
    const e = getV('email');
    const p = getV('password');
    if(!e || !p) return alert("Fill credentials");
    showEl('loader', true);
    try {
        if(isLoginMode) await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
    } catch (err) { alert(err.message); }
    hideLoader();
};

window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    setUI('auth-title', isLoginMode ? "Partner Login" : "Partner Sign Up");
    const btn = document.getElementById('authBtn');
    if(btn) btn.innerText = isLoginMode ? "Login" : "Sign Up";
};

// ==========================================
// 4. KDS ORDERS (FIXED BADGES & SOUND)
// ==========================================
// ==========================================
// 1. KDS & ORDERS Logic (Fixed Phone & Note)
window.updateOrderStatus = async (id, status) => {
    try {
        await updateDoc(doc(db, "orders", id), { status: status });
        console.log("Order updated to:", status);
    } catch (e) {
        alert("Update Failed: " + e.message);
    }
};
// ==========================================
// ==========================================
// 1. LIVE ORDERS LOGIC (FIXED DETAILS)
// ==========================================
function loadOrders(uid) {
    const q = query(collection(db, "orders"), where("resId", "==", uid), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('orders-display-grid');
        if(!grid) return; grid.innerHTML = "";
        
        let counts = { Pending: 0, Preparing: 0, Ready: 0, "Picked Up": 0 };

        snap.forEach(d => {
            const o = d.data();
            if(counts[o.status] !== undefined) counts[o.status]++;

            if(o.status === currentOrderTab) {
                // FIX: Map items with quantity
                const itemsList = o.items.map(i => `
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.9rem;">
                        <span>• ${i.name} (x${i.qty || 1})</span>
                        <b>₹${parseInt(i.price) * (i.qty || 1)}</b>
                    </div>
                `).join('');

                // Button Logic
                let btnAction = "";
                if(o.status === "Pending") btnAction = `<button class="primary-btn" style="background:#22c55e" onclick="window.updateOrderStatus('${d.id}','Preparing')">Accept Order</button>`;
                else if(o.status === "Preparing") btnAction = `<button class="primary-btn" style="background:#f59e0b" onclick="window.updateOrderStatus('${d.id}','Ready')">Mark Ready</button>`;
                else if(o.status === "Ready") btnAction = `<button class="primary-btn" style="background:#3b82f6" onclick="window.updateOrderStatus('${d.id}','Picked Up')">Picked Up</button>`;
                else if(o.status === "Picked Up") btnAction = `<button class="primary-btn" style="background:#64748b" onclick="window.updateOrderStatus('${d.id}','Done')">Finish & Archive</button>`;

                grid.innerHTML += `
                <div class="order-card-pro" style="background:#fff; border-radius:20px; padding:20px; border: 1px solid #f1f5f9; margin-bottom:20px; box-shadow: var(--shadow); text-align:left;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="background:#f1f5f9; padding:5px 12px; border-radius:8px; font-weight:800;">Table ${o.table}</span>
                        <span style="font-size:0.7rem; font-weight:800; color:var(--primary);">${o.paymentMode} | ${o.orderType}</span>
                    </div>

                    <div style="margin:15px 0;">
                        <h4 style="margin:0; font-size:1.1rem; color:var(--dark);">${o.customerName || 'Guest'}</h4>
                        <p style="margin:2px 0; font-size:0.9rem; color:#2563eb; font-weight:700;"><i class="fas fa-phone-alt"></i> ${o.customerPhone || 'N/A'}</p>
                    </div>

                    <div style="background:#f8fafc; padding:15px; border-radius:12px; border:1px solid #f1f5f9;">
                        ${itemsList}
                        <div style="border-top:1px dashed #cbd5e1; margin-top:10px; padding-top:10px; display:flex; justify-content:space-between; font-weight:900; font-size:1.1rem;">
                            <span>Total Bill:</span><span>₹${o.total}</span>
                        </div>
                    </div>

                    ${o.instruction ? `
                    <div style="background:#fff1f2; border-left:4px solid #e11d48; padding:10px; border-radius:8px; margin-top:15px;">
                        <small style="color:#e11d48; font-weight:800; text-transform:uppercase; font-size:0.6rem;">Chef Instruction:</small>
                        <p style="margin:2px 0; font-size:0.85rem; color:#be123c; font-weight:600;">${o.instruction}</p>
                    </div>` : ''}

                    <div style="margin-top:15px;">${btnAction}</div>
                </div>`;
            }
        });
        
        // Update counts
        setUI('count-new', counts.Pending);
        setUI('count-prep', counts.Preparing);
        setUI('count-ready', counts.Ready);
        setUI('count-picked', counts["Picked Up"]);
        setUI('order-count-badge', counts.Pending);
    });
}

// ==========================================
// 2. HISTORY & DATE FILTER LOGIC
// ==========================================
window.switchOrderTab = (status, el) => {
    currentOrderTab = status;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    
    const historyControls = document.getElementById('history-filter-controls');
    if(status === 'Past Orders') {
        if(historyControls) historyControls.style.display = "flex";
        window.loadOrderHistory(auth.currentUser.uid); 
    } else {
        if(historyControls) historyControls.style.display = "none";
        loadOrders(auth.currentUser.uid); 
    }
};

// ==========================================
// 2. ADVANCED HISTORY LOGIC (RANGE FILTER)
// ==========================================
window.loadOrderHistory = async (uid, range = "all") => {
    const grid = document.getElementById('orders-display-grid');
    const statsDiv = document.getElementById('history-stats');
    grid.innerHTML = "<div style='text-align:center; padding:50px;'>Generating Report...</div>";
    
    let q = query(collection(db, "orders"), where("resId", "==", uid), where("status", "==", "Done"), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    
    grid.innerHTML = "";
    let totalSales = 0;
    let orderCount = 0;

    const now = new Date();
    
    snap.forEach(d => {
        const o = d.data();
        const orderDate = o.timestamp.toDate();
        let show = false;

        // Date Range Logic
        if(range === "all") show = true;
        else {
            const diffTime = Math.abs(now - orderDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if(range === "today" && orderDate.toDateString() === now.toDateString()) show = true;
            else if(range === "7days" && diffDays <= 7) show = true;
            else if(range === "30days" && diffDays <= 30) show = true;
            else if(range === "1year" && diffDays <= 365) show = true;
        }

        if(show) {
            orderCount++;
            totalSales += parseInt(o.total || 0);

            grid.innerHTML += `
            <div class="order-card-pro" style="background:#f8fafc; border-radius:15px; padding:15px; margin-bottom:10px; text-align:left; border:1px solid #eee;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b>Table ${o.table}</b>
                    <small>${orderDate.toLocaleDateString()} | ${orderDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small>
                </div>
                <p style="margin:5px 0;">Customer: <b>${o.customerName}</b> | Bill: <b style="color:var(--primary);">₹${o.total}</b></p>
                <div style="font-size:0.75rem; color:gray;">Items: ${o.items.map(i => i.name).join(', ')}</div>
            </div>`;
        }
    });

    if(orderCount === 0) {
        grid.innerHTML = "<p style='padding:50px; text-align:center;'>No records found for this period.</p>";
        if(statsDiv) statsDiv.style.display = "none";
    } else {
        if(statsDiv) statsDiv.style.display = "grid";
        setUI('hist-total-qty', orderCount);
        setUI('hist-total-amt', "₹" + totalSales);
    }
};

window.filterHistoryByDate = (val) => window.loadOrderHistory(auth.currentUser.uid, val);
// ==========================================
// 5. MENU & CATEGORIES Logic (S/M/L)
// ==========================================
// 1. CATEGORY & VARIANTS LOGIC
// ==========================================

// --- Add New Category ---
window.addCategory = async () => {
    const name = getV('new-cat-name');
    if(!name) return alert("Category name likhen!");
    let cats = restaurantData.categories || [];
    if(cats.includes(name)) return alert("Category already exists!");
    
    cats.push(name);
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: cats });
    document.getElementById('new-cat-name').value = "";
};

// --- Edit Category Name ---
window.editCategory = async (oldName) => {
    const newName = prompt("Enter new name for category:", oldName);
    if (!newName || newName === oldName) return;

    let cats = restaurantData.categories.map(c => c === oldName ? newName : c);
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: cats });
    alert("Category Updated! Note: Purane items ka category name manually update karna pad sakta hai.");
};

// --- Delete Category ---
window.deleteCategory = async (catName) => {
    if(confirm(`Delete "${catName}"?`)) {
        const newCats = restaurantData.categories.filter(c => c !== catName);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: newCats });
    }
};
// 1. Add Extra Category (Group)
// ADVANCED EXTRAS & VARIANTS LOGIC
// ==========================================

// 1. Group (Extra Category) Add karna
window.addExtraCategory = async () => {
    const name = getV('ex-cat-name');
    const limit = parseInt(document.getElementById('ex-cat-limit').value);
    if (!name) return alert("Group name bhariye!");

    let exGroups = restaurantData.extraGroups || [];
    const newGroup = { id: "grp_" + Date.now(), name, limit };
    exGroups.push(newGroup);

    try {
        await updateDoc(doc(db, "restaurants", window.currentUID), { extraGroups: exGroups });
        document.getElementById('ex-cat-name').value = "";
    } catch (e) { alert("Error: " + e.message); }
};

// 2. Extra Item ko Group se jodna
window.addExtraItem = async () => {
    const groupId = document.getElementById('ex-item-group-select').value;
    const name = getV('ex-item-name');
    const price = parseInt(getV('ex-item-price'));

    if (!groupId || !name || isNaN(price)) return alert("Sari details bhariye!");

    let allVariants = restaurantData.variants || [];
    allVariants.push({ id: "var_" + Date.now(), groupId, name, price });

    try {
        await updateDoc(doc(db, "restaurants", window.currentUID), { variants: allVariants });
        document.getElementById('ex-item-name').value = "";
        document.getElementById('ex-item-price').value = "";
    } catch (e) { alert(e.message); }
};

// 3. Render Extras UI (Dropdowns & Summary)
function renderExtrasUI() {
    const catDisplay = document.getElementById('ex-cat-display');
    const groupSelect = document.getElementById('ex-item-group-select');
    const groupedDisplay = document.getElementById('grouped-extras-display');

    const groups = restaurantData.extraGroups || [];
    const variants = restaurantData.variants || [];

    if(catDisplay) catDisplay.innerHTML = "";
    if(groupSelect) groupSelect.innerHTML = '<option value="">Choose Group First</option>';
    if(groupedDisplay) groupedDisplay.innerHTML = "";

    groups.forEach(g => {
        // Tag Display
        if(catDisplay) {
            catDisplay.innerHTML += `<span class="tag-badge" style="background:#eef2ff; color:#4f46e5; border:1px solid #c7d2fe; padding:8px 12px; border-radius:10px; margin:5px; display:inline-block; font-weight:700;">
                ${g.name} (Limit: ${g.limit == 0 ? '∞' : g.limit})
                <i class="fas fa-times" onclick="window.deleteExtraGroup('${g.id}')" style="margin-left:8px; color:red; cursor:pointer;"></i>
            </span>`;
        }
        // Dropdown Update
        if(groupSelect) groupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;

        // Summary View Update
        if(groupedDisplay) {
            const relatedItems = variants.filter(v => v.groupId === g.id);
            let itemsHtml = relatedItems.map(v => `
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:6px 0; border-bottom:1px solid #f1f5f9;">
                    <span>${v.name} (+₹${v.price})</span>
                    <i class="fas fa-trash" onclick="window.deleteExtraItem('${v.id}')" style="color:red; cursor:pointer;"></i>
                </div>
            `).join('');

            groupedDisplay.innerHTML += `
            <div class="card" style="border-left:4px solid var(--primary); text-align:left; padding:15px;">
                <h4 style="margin:0 0 10px 0; color:var(--primary);">${g.name} <small style="color:gray;">(Limit: ${g.limit})</small></h4>
                ${itemsHtml || '<p style="font-size:0.7rem; color:gray;">No items yet.</p>'}
            </div>`;
        }
    });
}

// 4. Delete Functions
window.deleteExtraGroup = async (id) => {
    if(confirm("Delete Group? Sab items bhi hat jayenge.")) {
        const newGroups = restaurantData.extraGroups.filter(g => g.id !== id);
        const newVariants = (restaurantData.variants || []).filter(v => v.groupId !== id);
        await updateDoc(doc(db, "restaurants", window.currentUID), { extraGroups: newGroups, variants: newVariants });
    }
};

window.deleteExtraItem = async (id) => {
    if(confirm("Delete Item?")) {
        const newVariants = restaurantData.variants.filter(v => v.id !== id);
        await updateDoc(doc(db, "restaurants", window.currentUID), { variants: newVariants });
    }
};
// ==========================================
// 1. CATEGORIES & VARIANTS UI RENDER
// ==========================================
function renderCategoriesUI(cats) {
    const display = document.getElementById('cat-list-display'); 
    const select = document.getElementById('item-category-select'); 
    const filterTabs = document.getElementById('menu-filter-tabs'); 
    const varDisplay = document.getElementById('variant-list-display'); 

    // --- Management Tags (Edit/Delete in Settings) ---
    if(display) {
        display.innerHTML = "";
        cats.forEach(c => {
            display.innerHTML += `
            <div class="tag-badge">
                <span>${c}</span>
                <div style="display:flex; gap:10px; align-items:center; margin-left:10px;">
                    <i class="fas fa-edit" onclick="window.editCategory('${c}')" style="color:#6366f1; cursor:pointer; font-size:0.8rem;"></i>
                    <i class="fas fa-times" onclick="window.deleteCategory('${c}')" style="color:#ef4444; cursor:pointer; font-size:0.8rem;"></i>
                </div>
            </div>`;
        });
    }

    // --- Add Item Form Dropdown ---
    if(select) {
        select.innerHTML = `<option value="Others">Choose Category</option>`;
        cats.forEach(c => {
            select.innerHTML += `<option value="${c}">${c}</option>`;
        });
    }

    // --- Filter Tabs (Manage Menu section) ---
    if(filterTabs) {
        filterTabs.innerHTML = `<button class="cat-pill ${activeMenuFilter === "" ? "active" : ""}" onclick="window.setMenuFilter('')">View All</button>`;
        cats.forEach(c => {
            filterTabs.innerHTML += `
            <button class="cat-pill ${activeMenuFilter === c ? "active" : ""}" onclick="window.setMenuFilter('${c}')">
                ${c}
            </button>`;
        });
    }

    // --- Variants / Extras Display ---
    if(varDisplay && restaurantData.variants) {
        varDisplay.innerHTML = "";
        restaurantData.variants.forEach(v => {
            varDisplay.innerHTML += `
            <div class="tag-badge" style="background:#fff1f2; color:#e11d48; border-color:#e11d48; font-weight:800;">
                <span>${v.name} (+₹${v.price})</span>
                <i class="fas fa-trash" onclick="window.deleteVariant('${v.name}')" style="margin-left:10px; cursor:pointer;"></i>
            </div>`;
        });
    }
}

// --- Filter Tab Trigger ---
window.setMenuFilter = (catName) => {
    activeMenuFilter = catName;
    renderCategoriesUI(restaurantData.categories || []); // Tabs refresh
    if(auth.currentUser) loadMenu(auth.currentUser.uid); // Menu refresh
};

// ==========================================
// 2. ADD MENU ITEM (S/M/L & IMAGE)
// ==========================================
window.addMenuItem = async () => {
    const name = getV('item-name');
    const price = parseInt(getV('item-price')) || 0;
    const cat = document.getElementById('item-category-select').value;

    if(!name || price === 0) return alert("Item name aur Regular price zaroori hai!");
    if(!cat || cat === "Others") return alert("Kripya Category select karein!");

    showEl('loader', true);

    const mData = {
        name: name,
        price: price,
        priceM: parseInt(getV('item-price-m')) || 0,
        priceL: parseInt(getV('item-price-l')) || 0,
        category: cat,
        ingredients: getV('item-ingredients'),
        createdAt: new Date()
    };

    const file = document.getElementById('item-img').files[0];
    try {
        if(file) {
            const refM = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            await uploadBytes(refM, file);
            mData.imgUrl = await getDownloadURL(refM);
        }
        // Save to Restaurant's Menu Collection
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), mData);
        
        alert("Dish successfully added to your menu!");
        
        // Clear Form
        document.getElementById('item-name').value = "";
        document.getElementById('item-price').value = "";
        document.getElementById('item-price-m').value = "";
        document.getElementById('item-price-l').value = "";
        document.getElementById('item-ingredients').value = "";
    } catch(e) { 
        console.error(e);
        alert("Error adding item: " + e.message); 
    }
    hideLoader();
};

// ==========================================
// 3. LOAD MENU (Filtered & Professional Grid)
function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const container = document.getElementById('filtered-menu-container');
        if (!container) return;
        container.innerHTML = "";

        const allItems = [];
        snap.forEach(d => allItems.push({ id: d.id, ...d.data() }));

        // Filter logic (Jo aapne pehle set kiya tha)
        const filteredItems = activeMenuFilter === "" 
            ? allItems 
            : allItems.filter(item => item.category === activeMenuFilter);

        if(filteredItems.length === 0) {
            container.innerHTML = `<div style="grid-column:1/-1; padding:50px; color:#94a3b8; text-align:center;">
                <i class="fas fa-search" style="font-size:2rem; margin-bottom:10px; opacity:0.5;"></i>
                <p>No items found in this category.</p>
            </div>`;
            return;
        }

        filteredItems.forEach(item => {
            // Price Display Check
            const pM = (item.priceM && item.priceM > 0) ? `₹${item.priceM}` : "-";
            const pL = (item.priceL && item.priceL > 0) ? `₹${item.priceL}` : "-";

            container.innerHTML += `
            <div class="menu-item-card-pro">
                <div class="card-img-wrapper">
                    <img src="${item.imgUrl || 'https://via.placeholder.com/300x150?text=Food+Image'}">
                    <span class="img-cat-badge">${item.category || 'General'}</span>
                </div>
                
                <div class="card-content-pro">
                    <h4 class="item-title-pro">${item.name}</h4>
                    <p class="item-desc-pro">${item.ingredients || 'Freshly prepared delicious meal.'}</p>

                    <div class="price-row-pro">
                        <div class="price-pill-pro"><small>Reg</small><b>₹${item.price}</b></div>
                        <div class="price-pill-pro"><small>Med</small><b>${pM}</b></div>
                        <div class="price-pill-pro"><small>Lrg</small><b>${pL}</b></div>
                    </div>

                    <button class="btn-delete-pro" onclick="window.deleteItem('${item.id}')">
                        <i class="fas fa-trash-alt"></i> Delete Dish
                    </button>
                </div>
            </div>`;
        });
    });
}

// ==========================================
// 4. DELETE FUNCTIONS
// ==========================================
window.deleteItem = async (id) => {
    if(confirm("Are you sure you want to delete this dish?")) {
        try {
            await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id));
        } catch(e) { alert("Error deleting: " + e.message); }
    }
};

window.deleteVariant = async (vName) => {
    if (confirm(`Delete extra topping "${vName}"?`)) {
        const variants = restaurantData.variants.filter(v => v.name !== vName);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { variants: variants });
    }
};

// ==========================================
// 6. MEMBERSHIP & ADMIN SYNC
// ==========================================
async function fetchAdminSettings() {
    try {
        const snap = await getDoc(doc(db, "platform", "settings"));
        if(snap.exists()) {
            const s = snap.data();
            platformPrices = { "Monthly": s.priceMonthly, "6-Months": s.price6Months, "Yearly": s.priceYearly };
            setUI('display-price-Monthly', s.priceMonthly);
            setUI('display-price-6-Months', s.price6Months);
            setUI('display-price-Yearly', s.priceYearly);
            setUI('admin-upi-display', s.adminUpi || "platto@okaxis");
        }
    } catch(e) { console.error("Admin sync failed", e); }
}

window.selectPlan = (name) => {
    selectedPlanName = name;
    setUI('payable-amt', platformPrices[name]);
    showEl('payment-panel', true);
};

window.submitPayment = async () => {
    const file = document.getElementById('payment-proof').files[0];
    const resName = getV('res-name-input');
    if(!file || !resName) return alert("Details required!");
    showEl('loader', true);
    try {
        const sRef = ref(storage, `proofs/${auth.currentUser.uid}`);
        await uploadBytes(sRef, file);
        const url = await getDownloadURL(sRef);
        await setDoc(doc(db, "restaurants", auth.currentUser.uid), {
            ownerId: auth.currentUser.uid, ownerEmail: auth.currentUser.email,
            name: resName, plan: selectedPlanName, paymentProof: url, status: "pending", createdAt: new Date()
        });
    } catch(e) { alert(e.message); }
    hideLoader();
};

// ==========================================
// 7. UTILS & MASTER SAVE
// ==========================================
window.saveProfile = async () => {
    showEl('loader', true);
    const upData = {
        name: getV('res-name'), ownerPhone: getV('res-phone'), wifiName: getV('res-wifi-n'),
        wifiPass: getV('res-wifi-p'), minOrder: getV('res-min-order'), maxKM: getV('res-max-km'),
        prepTime: getV('res-prep-time'), igLink: getV('res-ig'), fbLink: getV('res-fb'),
        ytLink: getV('res-yt'), address: getV('res-address'), about: getV('res-about')
    };
    try {
        const logo = document.getElementById('res-logo-file').files[0];
        if(logo) {
            const refL = ref(storage, `logos/${auth.currentUser.uid}`);
            await uploadBytes(refL, logo);
            upData.logoUrl = await getDownloadURL(refL);
        }
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), upData);
        alert("Master Settings Saved!");
    } catch(e) { alert(e.message); }
    hideLoader();
};

window.saveAnnouncement = async () => {
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
        annTitle: getV('ann-title'), annText: getV('ann-text'), activeAnnouncement: document.getElementById('ann-active').checked
    });
    alert("Popup Updated!");
};

function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) { box.innerHTML = ""; new QRCode(box, { text: `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`, width: 220, height: 220 }); }
}

// Range filter ke liye function (Isme UID mangne ki zaroorat nahi hai)
window.loadOrderHistory = async (range = "all") => {
    const grid = document.getElementById('orders-display-grid');
    const statsDiv = document.getElementById('history-stats');
    
    // FIX: UID yahan andar hi get kar lo
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if(!uid) return alert("Session expired, please login again.");

    if(!grid) return; 
    grid.innerHTML = "<div style='text-align:center; padding:50px;'>Generating Report...</div>";
    
    let q = query(collection(db, "orders"), where("resId", "==", uid), where("status", "==", "Done"), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    
    grid.innerHTML = "";
    let totalSales = 0, orderCount = 0;
    const now = new Date();

    snap.forEach(d => {
        const o = d.data();
        const orderDate = o.timestamp.toDate();
        let show = false;

        if(range === "all") show = true;
        else {
            const diffDays = Math.ceil(Math.abs(now - orderDate) / (1000 * 60 * 60 * 24));
            if(range === "today" && orderDate.toDateString() === now.toDateString()) show = true;
            else if(range === "7days" && diffDays <= 7) show = true;
            else if(range === "30days" && diffDays <= 30) show = true;
            else if(range === "1year" && diffDays <= 365) show = true;
        }

        if(show) {
            orderCount++;
            totalSales += parseInt(o.total || 0);
            grid.innerHTML += `<div class="order-card" style="text-align:left; opacity:0.8; border-left:5px solid #64748b; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between;">
                    <b>Table ${o.table}</b> 
                    <small>${orderDate.toLocaleDateString()}</small>
                </div>
                <p style="margin:5px 0;">Customer: <b>${o.customerName}</b> | Bill: <b>₹${o.total}</b></p>
            </div>`;
        }
    });

    if(statsDiv) {
        statsDiv.style.display = orderCount > 0 ? "grid" : "none";
        setUI('hist-total-qty', orderCount);
        setUI('hist-total-amt', "₹" + totalSales);
    }
    if(orderCount === 0) grid.innerHTML = "<p style='padding:50px; text-align:center;'>No records found.</p>";
};

// Date picker ke liye bhi UID wala jhanjhat khatam
window.filterHistoryByDate = (val) => window.loadOrderHistory(val);

window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if(document.getElementById(id + '-sec')) document.getElementById(id + '-sec').style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};
window.logout = () => signOut(auth).then(() => location.reload());
window.deleteItem = async (id) => { if(confirm("Delete item?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); };
window.downloadQR = () => { const img = document.querySelector("#qrcode-box img"); if(img) { const link = document.createElement("a"); link.href = img.src; link.download = "QR.png"; link.click(); } };
// ==========================================
// 1. ADD NEW COUPON (FIXED ERROR)
// ==========================================
window.addCoupon = async () => {
    const code = getV('cp-code').toUpperCase();
    const percent = parseInt(getV('cp-perc'));
    const minOrder = parseInt(getV('cp-min'));
    const maxDiscount = parseInt(getV('cp-max'));

    if (!code || isNaN(percent)) {
        return alert("Kripya Code aur Discount Percentage zaroori bhariye!");
    }

    showEl('loader', true);
    try {
        // Firestore path: restaurants -> {uid} -> coupons -> {new_doc}
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "coupons"), {
            code: code,
            percent: percent,
            minOrder: minOrder || 0,
            maxDiscount: maxDiscount || 9999,
            status: "active", // Default active
            createdAt: new Date()
        });

        alert("🎉 Coupon Code '" + code + "' successfully create ho gaya!");
        
        // Inputs clear karein
        if(document.getElementById('cp-code')) document.getElementById('cp-code').value = "";
        if(document.getElementById('cp-perc')) document.getElementById('cp-perc').value = "";
        if(document.getElementById('cp-min')) document.getElementById('cp-min').value = "";
        if(document.getElementById('cp-max')) document.getElementById('cp-max').value = "";

    } catch (e) {
        console.error("Coupon Error:", e);
        alert("Coupon banane mein error aaya: " + e.message);
    }
    hideLoader();
};

// ==========================================
// 1. LOAD COUPONS (With Activate/Deactivate UI)
// ==========================================
function loadCoupons(uid) {
    const list = document.getElementById('coupons-list');
    if(!list) return;

    onSnapshot(collection(db, "restaurants", uid, "coupons"), (snap) => {
        list.innerHTML = "";
        if(snap.empty) {
            list.innerHTML = "<p style='font-size:0.8rem; color:gray;'>No coupons found.</p>";
            return;
        }

        snap.forEach(d => {
            const c = d.data();
            const isActive = c.status === "active";
            
            list.innerHTML += `
                <div class="coupon-item-pro" style="background: ${isActive ? '#fff' : '#f1f5f9'}; opacity: ${isActive ? '1' : '0.7'};">
                    <div class="coupon-info">
                        <b>${c.code} <span class="status-indicator ${isActive ? 'bg-success' : 'bg-danger'}">${c.status}</span></b>
                        <p>Min: ₹${c.minOrder} | Max: ₹${c.maxDiscount}</p>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap:12px;">
                        <!-- ACTIVATE / DEACTIVATE TOGGLE -->
                        <label class="switch-ui-sm">
                            <input type="checkbox" ${isActive ? 'checked' : ''} onchange="window.toggleCouponStatus('${d.id}', '${c.status}')">
                            <span class="slider-ui-sm"></span>
                        </label>
                        
                        <!-- DELETE BUTTON -->
                        <button onclick="window.deleteCoupon('${d.id}')" style="color:var(--danger); border:none; background:none; cursor:pointer; font-size:1rem;">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>`;
        });
    });
}

// ==========================================
// 2. TOGGLE STATUS FUNCTION (NEW)
// ==========================================
window.toggleCouponStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    try {
        const couponRef = doc(db, "restaurants", auth.currentUser.uid, "coupons", id);
        await updateDoc(couponRef, { status: newStatus });
        // UI auto-update ho jayega onSnapshot ki wajah se
    } catch (e) {
        alert("Error updating status: " + e.message);
    }
};

// ==========================================
// 3. DELETE COUPON
// ==========================================
window.deleteCoupon = async (id) => {
    if (confirm("Kya aap is coupon ko permanent delete karna chahte hain?")) {
        try {
            await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "coupons", id));
            // Snapshot apne aap UI update kar dega
        } catch (e) {
            alert("Error deleting coupon: " + e.message);
        }
    }
};

window.goToRenewal = () => location.reload();

async function init() { await fetchAdminSettings(); }
init();