import { auth, db, storage } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, orderBy, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

console.log("Platto Master Dashboard System Active...");

// ==========================================
// 1. GLOBAL VARIABLES & HELPERS
// ==========================================
const loader = document.getElementById('loader');
const authArea = document.getElementById('auth-area');
const mainWrapper = document.getElementById('main-wrapper');

let restaurantData = {};
let currentOrderTab = "Pending";
let isLoginMode = true;
let selectedPlanName = ""; 
let activeMenuFilter = ""; 

let platformPrices = { "Monthly": 0, "6-Months": 0, "Yearly": 0 };
let adminUPI = "";

// Safety Helpers
const setUI = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val; };
const showEl = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "block" : "none"; };
const showFlex = (id, show = true) => { const el = document.getElementById(id); if(el) el.style.display = show ? "flex" : "none"; };
const getV = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const hideLoader = () => { if(loader) loader.style.display = 'none'; };

// ==========================================
// 2. AUTHENTICATION & STATE CONTROLLER
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.currentUID = user.uid; // Set Global UID for buttons
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if (d.exists()) {
                restaurantData = d.data();
                if (restaurantData.status === 'active' || restaurantData.status === 'expired') {
                    showEl('auth-area', false);
                    showFlex('main-wrapper');
                    syncDashboard(restaurantData, user.uid);
                    loadOrders(user.uid);
                    loadMenu(user.uid);
                    loadOwnerTickets(user.uid);
                    loadCoupons(user.uid);
                    loadAnnouncementHistory(user.uid)
                    generateQR(user.uid);
                    renderExtrasUI();
                } else if (restaurantData.status === 'pending') {
                    showEl('auth-section', false);
                    showEl('membership-section', false);
                    showEl('waiting-section', true);
                }
            } else {
                // New signup flow: Show Plans
                showEl('auth-section', false);
                showEl('membership-section', true);
                fetchAdminSettings(); 
            }
            hideLoader();
        }, (err) => { console.error(err); hideLoader(); });
    } else {
        showEl('auth-area', true);
        showEl('auth-section', true);
        showEl('main-wrapper', false);
        hideLoader();
    }
});

// Login / Signup Action
document.getElementById('authBtn').onclick = async () => {
    const e = getV('email');
    const p = getV('password');
    if(!e || !p) return alert("Credentials bhariye!");
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
// 3. MEMBERSHIP & ADMIN SETTINGS SYNC
// ==========================================
async function fetchAdminSettings() {
    console.log("Fetching Admin Settings..."); // Debugging ke liye
    try {
        const snap = await getDoc(doc(db, "platform", "settings"));
        if(snap.exists()) {
            const s = snap.data();
            
            // 1. Global prices update karein
            platformPrices = { 
                "Monthly": s.priceMonthly || 499, 
                "6-Months": s.price6Months || 2499, 
                "Yearly": s.priceYearly || 3999 
            };
            
            adminUPI = s.adminUpi || "platto@okaxis";

            // 2. UI mein Prices update karein
            setUI('display-price-Monthly', platformPrices["Monthly"]);
            setUI('display-price-6-Months', platformPrices["6-Months"]);
            setUI('display-price-Yearly', platformPrices["Yearly"]);
            
            // 3. Admin UPI update karein
            setUI('admin-upi-display', adminUPI);

            // ✅ 4. FIX: PROMO BANNER LOGIC
            const banner = document.getElementById('promo-banner');
            const bannerText = document.getElementById('promo-banner-text');

            // Agar Admin ne banner mein kuch likha hai, toh hi dikhao
            if(s.promoBanner && s.promoBanner.trim() !== "") {
                if(banner) banner.style.display = "flex"; // Banner show karein
                if(bannerText) bannerText.innerText = s.promoBanner; // Text set karein
            } else {
                if(banner) banner.style.display = "none"; // Khali hone par hide karein
            }
        }
    } catch(e) { 
        console.error("Admin sync error:", e); 
    }
}

window.selectPlan = (name) => {
    selectedPlanName = name;
    setUI('payable-amt', platformPrices[name]);
    showEl('payment-panel', true);
};

window.applyMembershipCoupon = async () => {
    const code = getV('m-coupon-input').toUpperCase();
    if(!code || !selectedPlanName) return alert("Select plan and enter code!");
    try {
        const q = query(collection(db, "membership_coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const c = snap.docs[0].data();
            if(c.status !== "active") return alert("Coupon Inactive");
            let base = platformPrices[selectedPlanName];
            let disc = Math.min(Math.floor((base * c.percent)/100), c.maxDiscount);
            setUI('payable-amt', base - disc);
            setUI('m-coupon-msg', `✅ ₹${disc} Discount Applied!`);
        } else alert("Invalid Code");
    } catch(e) { console.error(e); }
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
// 4. KDS ORDERS (LIVE & SOUND)
// ==========================================
window.switchOrderTab = (status, el) => {
    currentOrderTab = status;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    
    if(status === 'Past Orders') {
        showEl('history-filter-controls', true);
        window.loadOrderHistory("all"); 
    } else {
        showEl('history-filter-controls', false);
        loadOrders(auth.currentUser.uid); 
    }
};

// ==========================================
// 1. LIVE ORDERS LOGIC (FIXED VARIANTS & BADGES)
// ==========================================
function loadOrders(uid) {
    const q = query(collection(db, "orders"), where("resId", "==", uid), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('orders-display-grid');
        if(!grid) return; 
        grid.innerHTML = "";
        
        let counts = { Pending: 0, Preparing: 0, Ready: 0, "Picked Up": 0 };

        // New Order Sound Logic
        snap.docChanges().forEach(change => {
            if (change.type === "added" && change.doc.data().status === "Pending") {
                const sound = document.getElementById('order-alert-sound');
                if(sound) sound.play().catch(() => {});
            }
        });

        snap.forEach(d => {
            const o = d.data();
            if(counts[o.status] !== undefined) counts[o.status]++;

            if(o.status === currentOrderTab || (currentOrderTab === 'Picked Up' && o.status === 'Picked Up')) {
                
                // FIX: Map items with Variants/Extras
                const itemsHtml = o.items.map(i => {
                    const extrasText = (i.extras && i.extras.length > 0) 
                        ? `<div style="color:#2563eb; font-size:0.75rem; margin-left:12px; font-weight:700;">+ ${i.extras.join(', ')}</div>` 
                        : "";
                    return `
                    <div style="margin-bottom:10px; border-bottom:1px solid #f1f5f9; padding-bottom:5px;">
                        <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
                            <span>• ${i.name} (x${i.qty || 1})</span>
                            <b>₹${parseInt(i.price) * (i.qty || 1)}</b>
                        </div>
                        ${extrasText}
                    </div>`;
                }).join('');

                // Button Workflow logic
                let btnAction = "";
                if(o.status === "Pending") btnAction = `<button class="primary-btn" style="background:#22c55e" onclick="window.updateOrderStatus('${d.id}','Preparing')">Accept Order</button>`;
                else if(o.status === "Preparing") btnAction = `<button class="primary-btn" style="background:#f59e0b" onclick="window.updateOrderStatus('${d.id}','Ready')">Mark Ready</button>`;
                else if(o.status === "Ready") btnAction = `<button class="primary-btn" style="background:#3b82f6" onclick="window.updateOrderStatus('${d.id}','Picked Up')">Order Picked Up</button>`;
                else if(o.status === "Picked Up") btnAction = `<button class="primary-btn" style="background:#64748b" onclick="window.updateOrderStatus('${d.id}','Done')">Archive Order</button>`;

                grid.innerHTML += `
                <div class="order-card" style="background:#fff; border-radius:20px; padding:20px; border:1px solid #e2e8f0; margin-bottom:20px; box-shadow: var(--shadow); text-align:left; border-left:6px solid var(--primary);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <span style="background:#f1f5f9; padding:4px 10px; border-radius:8px; font-weight:800; font-size:0.8rem;">Table ${o.table}</span>
                        <span style="font-size:0.65rem; font-weight:800; color:var(--gray); text-transform:uppercase;">${o.paymentMode} | ${o.orderType}</span>
                    </div>

                    <div style="margin-bottom:12px;">
                        <h4 style="margin:0; font-size:1.1rem; color:var(--dark);">${o.customerName || 'Guest'}</h4>
                        <p style="margin:2px 0; font-size:0.85rem; color:#2563eb; font-weight:700;"><i class="fas fa-phone-alt"></i> ${o.customerPhone || 'N/A'}</p>
                    </div>

                    <div style="background:#f8fafc; padding:12px; border-radius:12px; border:1px solid #f1f5f9;">
                        ${itemsHtml}
                        <div style="display:flex; justify-content:space-between; font-weight:900; font-size:1.1rem; margin-top:10px; padding-top:10px; border-top:1.5px dashed #cbd5e1;">
                            <span>Total Bill:</span><span>₹${o.total}</span>
                        </div>
                    </div>

                    ${o.instruction ? `<div style="background:#fff1f2; color:#e11d48; padding:10px; border-radius:10px; margin-top:12px; border-left:3px solid #e11d48; font-size:0.8rem;"><b>Chef Note:</b> ${o.instruction}</div>` : ''}

                    <div style="margin-top:15px;">${btnAction}</div>
                </div>`;
            }
        });
        
        // FIX: Update all 4 Badges properly
        setUI('count-new', counts.Pending);
        setUI('count-prep', counts.Preparing);
        setUI('count-ready', counts.Ready);
        setUI('order-count-badge', counts.Pending);
    });
}


window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 5. MENU & CATEGORY MANAGEMENT
// ==========================================
window.addCategory = async () => {
    const name = getV('new-cat-name');
    if(!name) return;
    let cats = restaurantData.categories || [];
    if(!cats.includes(name)) {
        cats.push(name);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: cats });
    }
    document.getElementById('new-cat-name').value = "";
};

window.editCategory = async (old) => {
    const n = prompt("New category name:", old);
    if(n) {
        let cats = restaurantData.categories.map(c => c === old ? n : c);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: cats });
    }
};

window.deleteCategory = async (cat) => {
    if(confirm("Delete category?")) {
        const n = restaurantData.categories.filter(c => c !== cat);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: n });
    }
};

// ==========================================
// 1. CATEGORIES & VARIANTS Logic (FIXED)
// ==========================================
function renderCategoriesUI(cats) {
    const display = document.getElementById('cat-list-display'); 
    const select = document.getElementById('item-category-select'); 
    const filterTabs = document.getElementById('menu-filter-tabs'); 
    const exCatDisplay = document.getElementById('ex-cat-display'); // Extras Groups
    const exGroupSelect = document.getElementById('ex-item-group-select'); // Dropdown for extras

    // --- Category Management Tags ---
    if(display) {
        display.innerHTML = "";
        cats.forEach(c => {
            display.innerHTML += `
            <div class="tag-badge">
                <span>${c}</span>
                <div style="display:flex; gap:8px; margin-left:10px;">
                    <i class="fas fa-edit" onclick="window.editCategory('${c}')" style="color:blue; cursor:pointer;"></i>
                    <i class="fas fa-times" onclick="window.deleteCategory('${c}')" style="color:red; cursor:pointer;"></i>
                </div>
            </div>`;
        });
    }

    // --- Dropdown for adding new items ---
    if(select) {
        select.innerHTML = `<option value="">Choose Category</option>`;
        cats.forEach(c => select.innerHTML += `<option value="${c}">${c}</option>`);
    }

    // --- Filter Tabs for Manage Active Menu ---
    if(filterTabs) {
        filterTabs.innerHTML = `<button class="cat-pill ${activeMenuFilter === "" ? "active" : ""}" onclick="window.setMenuFilter('')">View All</button>`;
        cats.forEach(c => {
            filterTabs.innerHTML += `<button class="cat-pill ${activeMenuFilter === c ? "active" : ""}" onclick="window.setMenuFilter('${c}')">${c}</button>`;
        });
    }

    // --- Extra Variants Groups & Dropdown (FIXED) ---
    const groups = restaurantData.extraGroups || [];
    if(exCatDisplay) exCatDisplay.innerHTML = "";
    if(exGroupSelect) exGroupSelect.innerHTML = '<option value="">Choose Group First</option>';
    
    groups.forEach(g => {
        if(exCatDisplay) {
            exCatDisplay.innerHTML += `
            <div class="tag-badge" style="background:#eef2ff; color:#4f46e5;">
                <span>${g.name}</span>
                <i class="fas fa-times" onclick="window.deleteExtraGroup('${g.id}')" style="margin-left:8px; color:red; cursor:pointer;"></i>
            </div>`;
        }
        if(exGroupSelect) exGroupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });

    // Variants ka summary dikhane ke liye function call
    renderExtrasSummary();
}

// --- NEW CATEGORY ADD Logic (FIXED) ---
window.addCategory = async () => {
    const name = getV('new-cat-name');
    if(!name) return alert("Category ka naam likhen!");
    
    let cats = restaurantData.categories || [];
    if(cats.includes(name)) return alert("Ye category pehle se hai!");
    
    cats.push(name);
    try {
        await updateDoc(doc(db, "restaurants", window.currentUID), { categories: cats });
        document.getElementById('new-cat-name').value = "";
    } catch(e) { alert("Category add nahi hui: " + e.message); }
};

window.setMenuFilter = (cat) => {
    activeMenuFilter = cat;
    renderCategoriesUI(restaurantData.categories || []);
    loadMenu(auth.currentUser.uid);
};

window.addMenuItem = async () => {
    showEl('loader', true);
    const mData = {
        name: getV('item-name'), price: parseInt(getV('item-price')),
        priceM: parseInt(getV('item-price-m')) || 0, priceL: parseInt(getV('item-price-l')) || 0,
        category: getV('item-category-select'), ingredients: getV('item-ingredients'), createdAt: new Date()
    };
    const file = document.getElementById('item-img').files[0];
    try {
        if(file) {
            const refM = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            await uploadBytes(refM, file);
            mData.imgUrl = await getDownloadURL(refM);
        }
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), mData);
        alert("Dish Added!");
    } catch(e) { alert(e.message); }
    hideLoader();
};

// ==========================================
// 2. MANAGE ACTIVE MENU (FIXED IMAGES)
// ==========================================
function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const container = document.getElementById('filtered-menu-container');
        if (!container) return;
        container.innerHTML = "";

        const allItems = [];
        snap.forEach(d => allItems.push({ id: d.id, ...d.data() }));

        const filteredItems = activeMenuFilter === "" 
            ? allItems 
            : allItems.filter(item => item.category === activeMenuFilter);

        filteredItems.forEach(item => {
            const pM = (item.priceM && item.priceM > 0) ? `₹${item.priceM}` : "-";
            const pL = (item.priceL && item.priceL > 0) ? `₹${item.priceL}` : "-";

            container.innerHTML += `
            <div class="menu-item-card-pro">
                <div class="card-img-wrapper">
                    <!-- IMAGE FIX: Item ki image dikhane ke liye -->
                    <img src="${item.imgUrl || 'https://via.placeholder.com/300x150?text=No+Image'}" onerror="this.src='https://via.placeholder.com/300x150?text=Image+Error'">
                    <span class="img-cat-badge">${item.category || 'General'}</span>
                </div>
                
                <div class="card-content-pro">
                    <h4 class="item-title-pro">${item.name}</h4>
                    <p class="item-desc-pro">${item.ingredients || 'No description.'}</p>

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

// --- Variants Summary rendering ---
function renderExtrasSummary() {
    const groupedDisplay = document.getElementById('grouped-extras-display');
    if(!groupedDisplay) return;
    
    const groups = restaurantData.extraGroups || [];
    const variants = restaurantData.variants || [];
    groupedDisplay.innerHTML = "";

    groups.forEach(g => {
        const relatedItems = variants.filter(v => v.groupId === g.id);
        let itemsHtml = relatedItems.map(v => `
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; padding:5px 0; border-bottom:1px solid #f1f5f9;">
                <span>${v.name} (+₹${v.price})</span>
                <i class="fas fa-trash" onclick="window.deleteExtraItem('${v.id}')" style="color:red; cursor:pointer;"></i>
            </div>
        `).join('');

        groupedDisplay.innerHTML += `
        <div style="background:#fff; border:1px solid #e2e8f0; padding:15px; border-radius:15px; margin-bottom:10px;">
            <b style="color:var(--primary); font-size:0.85rem;">${g.name}</b>
            ${itemsHtml || '<p style="font-size:0.7rem; color:gray;">No items.</p>'}
        </div>`;
    });
}

// ==========================================
// 6. EXTRAS / VARIANTS LOGIC
// ==========================================
window.addExtraCategory = async () => {
    const name = getV('ex-cat-name');
    const limit = parseInt(document.getElementById('ex-cat-limit').value);
    if (!name) return;
    let exGroups = restaurantData.extraGroups || [];
    exGroups.push({ id: "grp_" + Date.now(), name, limit });
    await updateDoc(doc(db, "restaurants", window.currentUID), { extraGroups: exGroups });
    document.getElementById('ex-cat-name').value = "";
};

window.addExtraItem = async () => {
    const groupId = document.getElementById('ex-item-group-select').value;
    const name = getV('ex-item-name');
    const price = parseInt(getV('ex-item-price'));
    if (!groupId || !name) return;
    let variants = restaurantData.variants || [];
    variants.push({ id: "var_" + Date.now(), groupId, name, price });
    await updateDoc(doc(db, "restaurants", window.currentUID), { variants: variants });
};

function renderExtrasUI() {
    const groupSelect = document.getElementById('ex-item-group-select');
    const groupedDisplay = document.getElementById('grouped-extras-display');
    const groups = restaurantData.extraGroups || [];
    const variants = restaurantData.variants || [];

    if(groupSelect) groupSelect.innerHTML = '<option value="">Choose Group</option>';
    if(groupedDisplay) groupedDisplay.innerHTML = "";

    groups.forEach(g => {
        if(groupSelect) groupSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
        const related = variants.filter(v => v.groupId === g.id);
        groupedDisplay.innerHTML += `<div class="card" style="text-align:left">
            <b>${g.name} (Lim: ${g.limit})</b><hr>
            ${related.map(v => `<div style="display:flex; justify-content:space-between"><span>${v.name}</span><b>₹${v.price}</b></div>`).join('')}
        </div>`;
    });
}

// ==========================================
// 7. SYNC DASHBOARD & QR
// ==========================================
function syncDashboard(data, uid) {
    setUI('disp-status', data.status.toUpperCase());
    setUI('disp-plan', data.plan);
    setUI('top-res-name', data.name);
    const fill = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ""; };
    fill('res-name', data.name); fill('res-phone', data.ownerPhone); fill('res-wifi-n', data.wifiName);
    fill('res-wifi-p', data.wifiPass); fill('res-min-order', data.minOrder); fill('res-max-km', data.maxKM);
    fill('res-prep-time', data.prepTime); fill('res-ig', data.igLink); fill('res-fb', data.fbLink);
    fill('res-yt', data.ytLink); fill('res-address', data.address); fill('res-about', data.about);

    if(data.createdAt) {
        let exp = new Date(data.createdAt.toDate());
        let days = (data.plan === "Monthly") ? 30 : (data.plan === "6-Months" ? 180 : 365);
        exp.setDate(exp.getDate() + days);
        setUI('disp-expiry', exp.toLocaleDateString('en-GB'));
        if(exp < new Date()) showFlex('expired-screen');
    }
    renderCategoriesUI(data.categories || []);
}

function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) { box.innerHTML = ""; new QRCode(box, { text: `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`, width: 200, height: 200 }); }
}

// ==========================================
// 8. FINAL UTILS & BOOT
// ==========================================
// --- 1. Helper to handle Active Tabs & Range ---
window.updateHistoryFilter = (range, btn) => {
    // Buttons ki active class change karein
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if(btn && btn.classList.contains('chip')) btn.classList.add('active');
    
    // History load karein
    window.loadOrderHistory(range);
};

// --- 2. Main History Function (Fixed & Complete) ---
window.loadOrderHistory = async (range = "all") => {
    const grid = document.getElementById('orders-display-grid');
    const statsDiv = document.getElementById('history-stats');
    const customDateInput = document.getElementById('history-custom-date');
    
    if(!grid) return;
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:50px; color:gray;"><i class="fas fa-spinner fa-spin"></i> Generating Report...</div>`;
    
    // Status 'Done' wale orders fetch karein
    let q = query(collection(db, "orders"), 
              where("resId", "==", window.currentUID), 
              where("status", "==", "Done"), 
              orderBy("timestamp", "desc"));
              
    const snap = await getDocs(q);
    
    grid.innerHTML = "";
    let totalSales = 0;
    let totalOrders = 0;
    const now = new Date();
    now.setHours(0,0,0,0); // Today starting

    const customDateValue = customDateInput ? customDateInput.value : "";

    snap.forEach(d => {
        const o = d.data();
        const orderDate = o.timestamp.toDate();
        const orderDateOnly = new Date(orderDate);
        orderDateOnly.setHours(0,0,0,0);

        let shouldShow = false;

        // --- Advanced Filtering Logic ---
        if(range === "all") {
            shouldShow = true;
        } else if(range === "today") {
            if(orderDateOnly.getTime() === now.getTime()) shouldShow = true;
        } else if(range === "7days") {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(now.getDate() - 7);
            if(orderDateOnly >= sevenDaysAgo) shouldShow = true;
        } else if(range === "custom" && customDateValue !== "") {
            const selectedDate = new Date(customDateValue);
            selectedDate.setHours(0,0,0,0);
            if(orderDateOnly.getTime() === selectedDate.getTime()) shouldShow = true;
        }

        if(shouldShow) {
            totalOrders++;
            totalSales += parseInt(o.total || 0);

            // Item Details Mapping
            const itemsDetails = o.items.map(i => `
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#475569; margin-bottom:2px;">
                    <span>${i.name} (x${i.qty || 1})</span>
                    <span>₹${i.price * (i.qty || 1)}</span>
                </div>
            `).join('');

            grid.innerHTML += `
            <div class="history-order-card" style="background:#fff; border:1px solid #f1f5f9; padding:20px; border-radius:20px; margin-bottom:15px; box-shadow:0 4px 12px rgba(0,0,0,0.03); text-align:left;">
                <div class="hist-top-flex" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px dashed #e2e8f0; padding-bottom:12px; margin-bottom:12px;">
                    <div>
                        <span style="font-weight:900; color:var(--dark); font-size:1rem;">Table ${o.table}</span>
                        <div style="font-size:0.7rem; color:var(--gray); font-weight:600;">${orderDate.toLocaleDateString('en-GB')} | ${orderDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                    </div>
                    <span style="font-size:0.65rem; font-weight:800; background:#f1f5f9; padding:4px 10px; border-radius:8px; text-transform:uppercase;">${o.paymentMode}</span>
                </div>
                
                <div class="hist-body">
                    <p style="margin:0 0 10px 0; font-weight:700; font-size:0.9rem; color:var(--dark);">Cust: ${o.customerName || 'Guest'}</p>
                    <div style="background:#f8fafc; padding:12px; border-radius:12px; border:1px solid #f1f5f9;">
                        ${itemsDetails}
                        <div style="margin-top:8px; padding-top:8px; border-top:1px solid #eee; display:flex; justify-content:space-between; font-weight:900; color:var(--primary); font-size:1rem;">
                            <span>Total Bill</span>
                            <span>₹${o.total}</span>
                        </div>
                    </div>
                </div>
                
                <div style="margin-top:10px; font-size:0.65rem; color:#94a3b8;">Order ID: #${d.id.substring(0,8).toUpperCase()}</div>
            </div>`;
        }
    });

    // --- Update Stats UI ---
    if(totalOrders > 0) {
        if(statsDiv) statsDiv.style.display = "grid";
        setUI('hist-total-qty', totalOrders);
        setUI('hist-total-amt', "₹" + totalSales);
    } else {
        grid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; padding:80px; color:gray;">
            <i class="fas fa-history" style="font-size:3.5rem; opacity:0.1; margin-bottom:15px;"></i>
            <p style="font-weight:700;">No records found for this period.</p>
            <small>Try selecting a different date range.</small>
        </div>`;
        if(statsDiv) statsDiv.style.display = "none";
    }
};

window.updateOrderStatus = async (id, status) => { 
    try {
        await updateDoc(doc(db, "orders", id), { status: status }); 
    } catch(e) { alert("Error: " + e.message); }
};

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
// 1. ADVANCED COUPON LOGIC (ACTIVE/INACTIVE)
// ==========================================
window.addCoupon = async () => {
    const code = getV('cp-code').toUpperCase();
    const percent = parseInt(getV('cp-perc'));
    if (!code || isNaN(percent)) return alert("Code and % are required!");

    try {
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "coupons"), {
            code: code,
            percent: percent,
            minOrder: parseInt(getV('cp-min')) || 0,
            maxDiscount: parseInt(getV('cp-max')) || 9999,
            status: "active", // Default status
            createdAt: new Date()
        });
        alert("Coupon Created!");
    } catch (e) { console.error(e); }
};

function loadCoupons(uid) {
    const list = document.getElementById('coupons-list');
    onSnapshot(collection(db, "restaurants", uid, "coupons"), (snap) => {
        if(!list) return; list.innerHTML = "";
        snap.forEach(d => {
            const c = d.data();
            const isActive = c.status === "active";
            list.innerHTML += `
            <div class="coupon-item-pro" style="opacity: ${isActive ? '1' : '0.6'}">
                <div class="coupon-info">
                    <b>${c.code} <span class="status-indicator ${isActive ? 'bg-success' : 'bg-danger'}">${c.status}</span></b>
                    <p>${c.percent}% OFF | Min: ₹${c.minOrder}</p>
                </div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <label class="switch-ui">
                        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="window.toggleCouponStatus('${d.id}', '${c.status}')">
                        <span class="slider-ui"></span>
                    </label>
                    <i class="fas fa-trash" style="color:red; cursor:pointer;" onclick="window.deleteCoupon('${d.id}')"></i>
                </div>
            </div>`;
        });
    });
}

window.toggleCouponStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid, "coupons", id), { status: newStatus });
};

// ==========================================
// 2. ANNOUNCEMENT HISTORY LOGIC
// ==========================================
window.saveAnnouncement = async () => {
    const title = getV('ann-title');
    const text = getV('ann-text');
    const isActive = document.getElementById('ann-active').checked;

    if(!title || !text) return alert("Title and Message required!");

    try {
        // 1. Current Restaurant Doc Update (For User Site)
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
            annTitle: title, annText: text, activeAnnouncement: isActive
        });

        // 2. Add to History Collection
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "announcements"), {
            title, text, createdAt: new Date()
        });
        
        alert("Announcement Published & Saved to History!");
    } catch (e) { alert(e.message); }
};

function loadAnnouncementHistory(uid) {
    const list = document.getElementById('announcement-history-list');
    const q = query(collection(db, "restaurants", uid, "announcements"), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        if(!list) return; list.innerHTML = "";
        snap.forEach(d => {
            const a = d.data();
            list.innerHTML += `
            <div class="history-item-pro">
                <div style="text-align:left;">
                    <b style="font-size:0.8rem;">${a.title}</b>
                    <p style="font-size:0.7rem; color:gray; margin:0;">${a.text.substring(0, 40)}...</p>
                </div>
                <button class="btn-reuse" onclick="window.reuseAnnouncement('${a.title}', '${a.text.replace(/'/g, "\\'")}')">Reuse</button>
            </div>`;
        });
    });
}

window.reuseAnnouncement = (title, text) => {
    document.getElementById('ann-title').value = title;
    document.getElementById('ann-text').value = text;
    alert("Purana announcement upar load ho gaya hai. Ab 'Update' dabayein.");
};
window.deleteCoupon = async (id) => { await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "coupons", id)); };
// Ticket Submit Karne Ka Logic
window.submitTicket = async () => {
    const subject = getV('ticket-subject');
    const message = getV('ticket-message');
    if(!subject || !message) return alert("Kripya dono fields bhariye!");

    showEl('loader', true);
    try {
        await addDoc(collection(db, "tickets"), {
            resId: window.currentUID,
            resName: restaurantData.name || "Unknown",
            ownerEmail: auth.currentUser.email,
            subject: subject,
            message: message,
            status: "open",
            createdAt: new Date()
        });
        alert("✅ Ticket Raised! Admin jald hi help karenge.");
        document.getElementById('ticket-subject').value = "";
        document.getElementById('ticket-message').value = "";
    } catch(e) { alert(e.message); }
    hideLoader();
};

// Purani Tickets load karne ka logic
function loadOwnerTickets(uid) {
    const q = query(collection(db, "tickets"), where("resId", "==", uid), orderBy("createdAt", "desc"));
    onSnapshot(q, (snap) => {
        const list = document.getElementById('owner-ticket-list');
        if(!list) return;
        list.innerHTML = snap.empty ? "<p style='color:gray;'>No tickets raised yet.</p>" : "";
        snap.forEach(d => {
            const t = d.data();
            list.innerHTML += `
            <div class="history-item-pro">
                <div style="text-align:left;">
                    <b>${t.subject}</b><br>
                    <small>Status: <span style="color:orange;">${t.status.toUpperCase()}</span></small>
                </div>
            </div>`;
        });
    });
}

async function init() { await fetchAdminSettings(); }
init();