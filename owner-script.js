import { auth, db, storage } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, orderBy, getDocs, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

console.log("Platto Master Dashboard System Active...");

// --- Global Elements ---
const loader = document.getElementById('loader');
const authArea = document.getElementById('auth-area');
const mainWrapper = document.getElementById('main-wrapper');

let restaurantData = {};
let currentOrderTab = "Pending";
let isLoginMode = true;
let selectedPlanName = ""; 

// Dynamic Prices & Settings from Admin
let platformPrices = { "Monthly": 0, "6-Months": 0, "Yearly": 0 };
let adminUPI = "";

// --- 1. Safety Helpers (Prevents Crashes) ---
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
        console.log("Session Active:", user.email);
        
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if (d.exists()) {
                restaurantData = d.data();
                if (restaurantData.status === 'active' || restaurantData.status === 'expired') {
                    showEl('auth-area', false);
                    showFlex('main-wrapper');
                    syncDashboard(restaurantData, user.uid);
                    loadOrders(user.uid);
                    loadMenu(user.uid);
                    loadCoupons(user.uid);
                    generateQR(user.uid);
                } else if (restaurantData.status === 'pending') {
                    showEl('auth-area', true);
                    showEl('auth-section', false);
                    showEl('membership-section', false);
                    showEl('waiting-section', true);
                }
            } else {
                // New User: Show Plans & Fetch Admin Rates
                showEl('auth-area', true);
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
        showEl('membership-section', false);
        showEl('waiting-section', false);
        hideLoader();
    }
});

// Login/Signup Execution
document.getElementById('authBtn').onclick = async () => {
    const e = getV('email');
    const p = getV('password');
    if(!e || !p) return alert("Credentials bhariye!");
    showEl('loader', true);
    try {
        if(isLoginMode) await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
    } catch (err) { alert("Auth Error: " + err.message); }
    hideLoader();
};

window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    setUI('auth-title', isLoginMode ? "Partner Login" : "Partner Sign Up");
    const btn = document.getElementById('authBtn');
    if(btn) btn.innerText = isLoginMode ? "Login" : "Sign Up";
    const tw = document.getElementById('toggle-wrapper');
    if(tw) tw.innerHTML = isLoginMode ? `New? <span onclick="window.toggleAuth()" style="color:#6366f1; cursor:pointer; font-weight:800;">Create Account</span>` : `Have account? <span onclick="window.toggleAuth()" style="color:#6366f1; cursor:pointer; font-weight:800;">Login</span>`;
};

// ==========================================
// 3. MEMBERSHIP & ADMIN SYNC
// ==========================================
async function fetchAdminSettings() {
    try {
        const snap = await getDoc(doc(db, "platform", "settings"));
        if(snap.exists()) {
            const s = snap.data();
            platformPrices["Monthly"] = s.priceMonthly || 499;
            platformPrices["6-Months"] = s.price6Months || 2499;
            platformPrices["Yearly"] = s.priceYearly || 3999;
            adminUPI = s.adminUpi || "platto@okaxis";

            setUI('display-price-Monthly', platformPrices["Monthly"]);
            setUI('display-price-6-Months', platformPrices["6-Months"]);
            setUI('display-price-Yearly', platformPrices["Yearly"]);
            setUI('admin-upi-display', adminUPI);

            if(s.promoBanner && s.promoBanner.trim() !== "") {
                showEl('promo-banner', true);
                setUI('promo-banner-text', s.promoBanner);
            } else { showEl('promo-banner', false); }
        }
    } catch(e) { console.error("Admin fetch failed", e); }
}

window.selectPlan = (name) => {
    selectedPlanName = name;
    setUI('payable-amt', platformPrices[name]);
    showEl('payment-panel', true);
    document.getElementById('payment-panel').scrollIntoView({ behavior: 'smooth' });
};

window.applyMembershipCoupon = async () => {
    const code = getV('m-coupon-input').toUpperCase();
    const msg = document.getElementById('m-coupon-msg');
    if(!code || !selectedPlanName) return alert("Select plan and enter code!");

    try {
        const q = query(collection(db, "membership_coupons"), where("code", "==", code));
        const snap = await getDocs(q);
        if(!snap.empty) {
            const c = snap.docs[0].data();
            if(c.status !== "active") { setUI('m-coupon-msg', "❌ Inactive"); return; }
            if(c.applyOn !== "All" && c.applyOn !== selectedPlanName) { setUI('m-coupon-msg', "❌ Not for this plan"); return; }

            let base = platformPrices[selectedPlanName];
            let disc = Math.min(Math.floor((base * c.percent)/100), c.maxDiscount);
            setUI('payable-amt', base - disc);
            if(msg) { msg.innerText = `✅ Discount ₹${disc} Applied!`; msg.style.color = "green"; }
        } else { setUI('m-coupon-msg', "❌ Invalid Code"); }
    } catch(e) { console.error(e); }
};

window.submitPayment = async () => {
    const file = document.getElementById('payment-proof').files[0];
    const resName = getV('res-name-input');
    if(!file || !resName) return alert("Proof & Name required!");

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
// 4. MASTER SETTINGS & DASHBOARD SYNC
// ==========================================
function syncDashboard(data, uid) {
    setUI('disp-status', data.status.toUpperCase());
    setUI('disp-plan', data.plan);
    setUI('top-res-name', data.name);

    const fill = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ""; };
    fill('res-name', data.name); fill('res-phone', data.ownerPhone); fill('res-address', data.address);
    fill('res-wifi-n', data.wifiName); fill('res-wifi-p', data.wifiPass);
    fill('res-min-order', data.minOrder); fill('res-max-km', data.maxKM); fill('res-prep-time', data.prepTime);
    fill('res-ig', data.igLink); fill('res-fb', data.fbLink); fill('res-yt', data.ytLink); fill('res-about', data.about);

    if(data.createdAt) {
        let exp = new Date(data.createdAt.toDate());
        let days = (data.plan === "Monthly") ? 30 : (data.plan === "6-Months" ? 180 : 365);
        exp.setDate(exp.getDate() + days);
        setUI('disp-expiry', exp.toLocaleDateString('en-GB'));
        if(exp < new Date()) showFlex('expired-screen');
        let dLeft = Math.ceil((exp - new Date()) / (1000*3600*24));
        if(dLeft <= 7 && dLeft > 0) { showEl('expiry-warning'); setUI('days-left', dLeft); }
    }
    renderCategoriesUI(data.categories || []);
}

window.saveProfile = async () => {
    showEl('loader', true);
    const upData = {
        name: getV('res-name'), ownerPhone: getV('res-phone'), wifiName: getV('res-wifi-n'),
        wifiPass: getV('res-wifi-p'), minOrder: getV('res-min-order'), maxKM: getV('res-max-km'),
        prepTime: getV('res-prep-time'), igLink: getV('res-ig'), fbLink: getV('res-fb'),
        ytLink: getV('res-yt'), address: getV('res-address'), about: getV('res-about')
    };
    const logo = document.getElementById('res-logo-file').files[0];
    const banner = document.getElementById('res-banner-file').files[0];
    if(logo) {
        const refL = ref(storage, `logos/${auth.currentUser.uid}`);
        await uploadBytes(refL, logo);
        upData.logoUrl = await getDownloadURL(refL);
    }
    if(banner) {
        const refB = ref(storage, `banners/${auth.currentUser.uid}`);
        await uploadBytes(refB, banner);
        upData.bannerUrl = await getDownloadURL(refB);
    }
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), upData);
    hideLoader(); alert("Settings Saved!");
};

// ==========================================
// 5. MENU & CATEGORIES & KDS
// ==========================================
window.addCategory = async () => {
    const name = getV('new-cat-name');
    if(!name) return;
    let cats = restaurantData.categories || [];
    cats.push(name);
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: cats });
    document.getElementById('new-cat-name').value = "";
};

function renderCategoriesUI(cats) {
    const display = document.getElementById('cat-list-display');
    const select = document.getElementById('item-category-select');
    if(!display || !select) return;
    display.innerHTML = ""; select.innerHTML = `<option value="">Select Category</option>`;
    cats.forEach(c => {
        display.innerHTML += `<span class="tag-badge" style="background:#eee; padding:5px 10px; border-radius:10px; margin-right:5px;">${c} <i class="fas fa-times" onclick="window.deleteCategory('${c}')" style="cursor:pointer; color:red;"></i></span>`;
        select.innerHTML += `<option value="${c}">${c}</option>`;
    });
}

window.deleteCategory = async (catName) => {
    if(confirm("Delete Category?")) {
        const newCats = restaurantData.categories.filter(c => c !== catName);
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { categories: newCats });
    }
};

window.addMenuItem = async () => {
    showEl('loader', true);
    const mData = {
        name: getV('item-name'), price: parseInt(getV('item-price')),
        priceM: parseInt(getV('item-price-m')) || 0, priceL: parseInt(getV('item-price-l')) || 0,
        ingredients: getV('item-ingredients'), category: getV('item-category-select'),
        createdAt: new Date()
    };
    const file = document.getElementById('item-img').files[0];
    if(file) {
        const refM = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
        await uploadBytes(refM, file);
        mData.imgUrl = await getDownloadURL(refM);
    }
    await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), mData);
    hideLoader(); alert("Item Added!");
};

function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const list = document.getElementById('owner-menu-list');
        if(!list) return; list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `<div class="card" style="margin-bottom:10px;"><b>${item.name}</b> <button onclick="window.deleteItem('${d.id}')" style="color:red; float:right; border:none; background:none; cursor:pointer;">Delete</button></div>`;
        });
    });
}

window.switchOrderTab = (status, el) => {
    currentOrderTab = status;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    loadOrders(auth.currentUser.uid);
};

function loadOrders(uid) {
    const q = query(collection(db, "orders"), where("resId", "==", uid), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('orders-display-grid');
        if(!grid) return; grid.innerHTML = "";
        let pending = 0;
        
        snap.docChanges().forEach(change => {
            if (change.type === "added" && change.doc.data().status === "Pending") {
                const sound = document.getElementById('order-alert-sound');
                if(sound) sound.play().catch(() => {});
            }
        });

        snap.forEach(d => {
            const o = d.data();
            if(o.status === "Pending") pending++;
            const isHistory = (currentOrderTab === 'Past Orders' && (o.status === 'Picked Up' || o.status === 'Rejected'));
            if(o.status === currentOrderTab || isHistory) {
                const items = o.items.map(i => `• ${i.name} (x${i.qty || 1})`).join('<br>');
                let btn = `<button class="primary-btn" onclick="window.updateOrderStatus('${d.id}','Preparing')">Accept</button>`;
                if(o.status === 'Preparing') btn = `<button class="primary-btn" style="background:orange" onclick="window.updateOrderStatus('${d.id}','Ready')">Ready</button>`;
                if(o.status === 'Ready') btn = `<button class="primary-btn" style="background:blue" onclick="window.updateOrderStatus('${d.id}','Picked Up')">Done</button>`;
                grid.innerHTML += `<div class="order-card"><b>Table ${o.table}</b> [${o.customerName}]<hr>${items}<br>Total Bill: <b>₹${o.total}</b><br>${btn} ${o.instruction ? `<p style="color:red; font-size:0.75rem;">Note: ${o.instruction}</p>` : ''}</div>`;
            }
        });
        setUI('order-count-badge', pending); setUI('count-new', pending);
    });
}

// ==========================================
// 6. PROMOS & QR & UTILS
// ==========================================
window.saveAnnouncement = async () => {
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
        annTitle: getV('ann-title'), annText: getV('ann-text'), activeAnnouncement: document.getElementById('ann-active').checked
    });
    alert("Popup Updated!");
};

function loadCoupons(uid) {
    onSnapshot(collection(db, "restaurants", uid, "coupons"), (snap) => {
        const list = document.getElementById('coupons-list');
        if(!list) return; list.innerHTML = "";
        snap.forEach(d => {
            const c = d.data();
            list.innerHTML += `<span class="tag-badge" style="background:#fef08a">${c.code} (${c.percent}%) <i class="fas fa-trash" onclick="window.deleteCoupon('${d.id}')"></i></span> `;
        });
    });
}

function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) {
        box.innerHTML = "";
        new QRCode(box, { text: `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`, width: 220, height: 220 });
    }
}

// Global UI mappings
window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };
window.deleteCoupon = async (id) => { await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "coupons", id)); };
window.deleteItem = async (id) => { if(confirm("Delete item?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); };
window.logout = () => signOut(auth).then(() => location.reload());
window.downloadQR = () => {
    const img = document.querySelector("#qrcode-box img");
    if(img) { const link = document.createElement("a"); link.href = img.src; link.download = "QR.png"; link.click(); }
};
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if(document.getElementById(id + '-sec')) document.getElementById(id + '-sec').style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};
window.goToRenewal = () => location.reload();

// Final Boot
async function init() { await fetchAdminSettings(); }
init();