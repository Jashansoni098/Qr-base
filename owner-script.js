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

// Dynamic Prices from Admin
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
        console.log("Session User:", user.email);
        
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
                // User logged in but No Doc (New Signup flow)
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

// Auth Execution
document.getElementById('authBtn').onclick = async () => {
    const e = getV('email');
    const p = getV('password');
    if(!e || !p) return alert("Please enter credentials");
    showEl('loader', true);
    try {
        if(isLoginMode) await signInWithEmailAndPassword(auth, e, p);
        else await createUserWithEmailAndPassword(auth, e, p);
    } catch (err) { alert(err.message); }
    hideLoader();
};

window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('authBtn');
    const toggleWrapper = document.getElementById('toggle-wrapper');
    if(title) title.innerText = isLoginMode ? "Partner Login" : "Partner Sign Up";
    if(btn) btn.innerText = isLoginMode ? "Login" : "Sign Up";
    if(toggleWrapper) {
        toggleWrapper.innerHTML = isLoginMode ? 
        `New? <span onclick="window.toggleAuth()" class="link-text" style="color:#6366f1; cursor:pointer; font-weight:800;">Create Account</span>` : 
        `Have account? <span onclick="window.toggleAuth()" class="link-text" style="color:#6366f1; cursor:pointer; font-weight:800;">Login</span>`;
    }
};

// ==========================================
// 3. MEMBERSHIP & ADMIN SYNC
// ==========================================
// ==========================================
// ADMIN SETTINGS SYNC (Prices, UPI & Banner)
// ==========================================
async function fetchAdminSettings() {
    try {
        // Platform Settings Document fetch karna
        const snap = await getDoc(doc(db, "platform", "settings"));
        
        if(snap.exists()) {
            const s = snap.data();
            
            // 1. Global Variables ko Admin values se update karna
            platformPrices["Monthly"] = s.priceMonthly || 499;
            platformPrices["6-Months"] = s.price6Months || 2499;
            platformPrices["Yearly"] = s.priceYearly || 3999;
            adminUPI = s.adminUpi || "platto@okaxis";

            // 2. UI mein Prices aur UPI dikhana
            setUI('display-price-Monthly', platformPrices["Monthly"]);
            setUI('display-price-6-Months', platformPrices["6-Months"]);
            setUI('display-price-Yearly', platformPrices["Yearly"]);
            setUI('admin-upi-display', adminUPI);

            // 3. PROMO BANNER LOGIC (FIXED)
            // Agar Admin side se promoBanner mein text hai, toh hi banner dikhao
            if(s.promoBanner && s.promoBanner.trim() !== "") {
                showEl('promo-banner', true); // Banner box ko show karo
                setUI('promo-banner-text', s.promoBanner); // Banner ka text set karo
            } else {
                showEl('promo-banner', false); // Agar text khali hai toh hide karo
            }

            console.log("Admin Settings successfully synced with Dashboard.");
        } else {
            console.log("No Admin settings found in Firestore.");
        }
    } catch(e) { 
        console.error("Admin fetch failed:", e); 
    }
}

window.selectPlan = (name) => {
    selectedPlanName = name;
    setUI('payable-amt', platformPrices[name]);
    showEl('payment-panel', true);
    document.getElementById('payment-panel').scrollIntoView({ behavior: 'smooth' });
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
            ownerId: auth.currentUser.uid,
            ownerEmail: auth.currentUser.email,
            name: resName,
            plan: selectedPlanName,
            paymentProof: url,
            status: "pending",
            createdAt: new Date()
        });
    } catch(e) { alert(e.message); }
    hideLoader();
};
//coupon logic Code
window.applyMembershipCoupon = async () => {
    const code = document.getElementById('m-coupon-input').value.trim().toUpperCase();
    const msg = document.getElementById('m-coupon-msg');
    
    if(!code) return;
    if(!selectedPlanName) return alert("Pehle ek Plan select karein!");

    try {
        const q = query(collection(db, "membership_coupons"), where("code", "==", code));
        const snap = await getDocs(q);

        if(!snap.empty) {
            const c = snap.docs[0].data();
            
            // Check if coupon is valid for selected plan
            if(c.applyOn !== "All" && c.applyOn !== selectedPlanName) {
                msg.style.color = "red";
                msg.innerText = `❌ Ye coupon sirf ${c.applyOn} plan par valid hai.`;
                return;
            }

            let basePrice = platformPrices[selectedPlanName];
            let discount = Math.floor((basePrice * c.percent) / 100);
            if(discount > c.maxDiscount) discount = c.maxDiscount;

            let finalPayable = basePrice - discount;
            setUI('payable-amt', finalPayable);
            
            msg.style.color = "green";
            msg.innerText = `✅ Applied! ₹${discount} ki bachat hui.`;
            document.getElementById('m-coupon-input').disabled = true;

        } else {
            msg.style.color = "red";
            msg.innerText = "❌ Invalid Coupon Code";
        }
    } catch(e) { alert("Coupon apply karne mein error aaya."); }
};
// ==========================================
// 4. MASTER SETTINGS & DASHBOARD SYNC
// ==========================================
function syncDashboard(data, uid) {
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

    if(data.createdAt) {
        let expiry = new Date(data.createdAt.toDate());
        let days = (data.plan === "Monthly") ? 30 : (data.plan === "6-Months" ? 180 : 365);
        expiry.setDate(expiry.getDate() + days);
        setUI('disp-expiry', expiry.toLocaleDateString('en-GB'));
        
        if(expiry < new Date()) showFlex('expired-screen');
        
        let daysLeft = Math.ceil((expiry - new Date()) / (1000 * 3600 * 24));
        if(daysLeft <= 7 && daysLeft > 0) {
            showEl('expiry-warning');
            setUI('days-left', daysLeft);
        }
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
    if(logo) {
        const refL = ref(storage, `logos/${auth.currentUser.uid}`);
        await uploadBytes(refL, logo);
        upData.logoUrl = await getDownloadURL(refL);
    }
    
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), upData);
    hideLoader(); alert("Settings Saved!");
};

// ==========================================
// 5. MENU & CATEGORIES (Full CRUD)
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
        display.innerHTML += `<span class="tag-badge" style="background:#eee; padding:5px 10px; border-radius:10px; margin:5px; display:inline-block;">${c} <i class="fas fa-times" onclick="window.deleteCategory('${c}')" style="cursor:pointer; color:red;"></i></span>`;
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
        name: getV('item-name'),
        price: parseInt(getV('item-price')) || 0,
        priceM: parseInt(getV('item-price-m')) || 0,
        priceL: parseInt(getV('item-price-l')) || 0,
        ingredients: getV('item-ingredients'),
        category: getV('item-category-select'),
        createdAt: new Date()
    };
    const file = document.getElementById('item-img').files[0];
    try {
        if(file) {
            const refM = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            await uploadBytes(refM, file);
            mData.imgUrl = await getDownloadURL(refM);
        }
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), mData);
        alert("Item Added!");
    } catch(e) { alert(e.message); }
    hideLoader();
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

window.deleteItem = async (id) => { if(confirm("Delete item?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); };

// ==========================================
// 6. KDS ORDERS (5-TABS & SOUND)
// ==========================================
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

                grid.innerHTML += `<div class="order-card"><b>Table ${o.table}</b> [${o.customerName}]<hr>${items}<br>Total: ₹${o.total}<br>${btn}</div>`;
            }
        });
        setUI('order-count-badge', pending);
        setUI('count-new', pending);
    });
}

window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 7. PROMOS & POPUP
// ==========================================
window.addCoupon = async () => {
    const coupon = {
        code: getV('cp-code').toUpperCase(),
        percent: parseInt(getV('cp-perc')),
        minOrder: parseInt(getV('cp-min')),
        maxDiscount: parseInt(getV('cp-max')),
    };
    await addDoc(collection(db, "restaurants", auth.currentUser.uid, "coupons"), coupon);
    alert("Coupon Created!");
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

window.deleteCoupon = async (id) => { await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "coupons", id)); };

window.saveAnnouncement = async () => {
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
        annTitle: getV('ann-title'),
        annText: getV('ann-text'),
        activeAnnouncement: document.getElementById('ann-active').checked
    });
    alert("Popup Updated!");
};

// ==========================================
// 8. QR & UTILS
// ==========================================
function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) {
        box.innerHTML = "";
        new QRCode(box, { text: `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`, width: 220, height: 220 });
    }
}

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

window.logout = () => signOut(auth).then(() => location.reload());

// --- Initial Boot ---
async function init() {
    console.log("Dashboard Booting Up...");
    await fetchAdminSettings(); 
}

init();