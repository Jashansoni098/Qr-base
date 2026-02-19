import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const loader = document.getElementById('loader');
const authArea = document.getElementById('auth-area');
const mainWrapper = document.getElementById('main-wrapper');
let currentOrderTab = "Pending";

// ==========================================
// 1. AUTH LOGIC (LOGIN / SIGNUP)
// ==========================================
let isLoginMode = true;
window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('authBtn');
    const toggleWrapper = document.getElementById('toggle-wrapper');

    if(title) title.innerText = isLoginMode ? "Partner Login" : "Partner Sign Up";
    if(btn) btn.innerText = isLoginMode ? "Login" : "Sign Up";
    if(toggleWrapper) {
        toggleWrapper.innerHTML = isLoginMode ? 
        `New here? <span onclick="toggleAuth()" class="link-text" style="color:#6366f1; cursor:pointer; font-weight:bold;">Create Account</span>` : 
        `Have account? <span onclick="toggleAuth()" class="link-text" style="color:#6366f1; cursor:pointer; font-weight:bold;">Login</span>`;
    }
};

document.getElementById('authBtn').onclick = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;
    if(!email || !pass) return alert("Credentials bhariye!");

    if(loader) loader.style.display = 'flex';
    try {
        if(isLoginMode) await signInWithEmailAndPassword(auth, email, pass);
        else await createUserWithEmailAndPassword(auth, email, pass);
    } catch (e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

// ==========================================
// 2. MEMBERSHIP & PAYMENT
// ==========================================
let selectedPlanName = "";
window.selectPlan = (name, price) => {
    selectedPlanName = name;
    const payAmt = document.getElementById('payable-amt');
    const payPanel = document.getElementById('payment-panel');
    if(payAmt) payAmt.innerText = price;
    if(payPanel) payPanel.style.display = 'block';
};

document.getElementById('submitPaymentBtn').onclick = async () => {
    const file = document.getElementById('payment-proof').files[0];
    const resName = document.getElementById('res-name-input').value;
    if(!file || !resName) return alert("Name & Screenshot required!");

    if(loader) loader.style.display = 'flex';
    try {
        const storageRef = ref(storage, `proofs/${auth.currentUser.uid}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        await addDoc(collection(db, "restaurants"), {
            ownerId: auth.currentUser.uid,
            name: resName,
            plan: selectedPlanName,
            paymentProof: url,
            status: "pending",
            createdAt: new Date()
        });
        location.reload();
    } catch (e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

// ==========================================
// 3. DASHBOARD LOGIC (Status & Sync)
// ==========================================
function syncDashboard(data, uid) {
    const statusEl = document.getElementById('disp-status');
    const planEl = document.getElementById('disp-plan');
    const expiryEl = document.getElementById('disp-expiry');
    const topName = document.getElementById('top-res-name');
    const warning = document.getElementById('expiry-warning');
    const expired = document.getElementById('expired-screen');
    const waiting = document.getElementById('waiting-section');
    const authSec = document.getElementById('auth-section');

    if(statusEl) statusEl.innerText = data.status.toUpperCase();
    if(planEl) planEl.innerText = data.plan;
    if(topName) topName.innerText = data.name || "Partner";

    if(data.createdAt) {
        let createdDate = data.createdAt.toDate();
        let expiryDate = new Date(createdDate);
        expiryDate.setDate(createdDate.getDate() + (data.plan === "Monthly" ? 30 : 365));
        
        if(expiryEl) expiryEl.innerText = expiryDate.toLocaleDateString('en-GB');

        let daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 3600 * 24));
        
        if(daysLeft <= 0) {
            if(expired) expired.style.display = 'flex'; 
            if(mainWrapper) mainWrapper.style.display = 'none';
        } else if(daysLeft <= 7) {
            if(warning) warning.style.display = 'block'; 
            const daysLeftSpan = document.getElementById('days-left');
            if(daysLeftSpan) daysLeftSpan.innerText = daysLeft;
        }
    }

    if(data.status === 'active') {
        if(authArea) authArea.style.display = 'none';
        if(mainWrapper) mainWrapper.style.display = 'flex';
        
        // Data auto-fill
        if(document.getElementById('res-name')) document.getElementById('res-name').value = data.name || "";
        if(document.getElementById('res-phone')) document.getElementById('res-phone').value = data.ownerPhone || "";
        if(document.getElementById('res-address')) document.getElementById('res-address').value = data.address || "";
        if(document.getElementById('res-prep-time')) document.getElementById('res-prep-time').value = data.prepTime || "";
        
        loadOrders(uid);
        loadMenu(uid);
        generateQR(uid);
    } else if(data.status === 'pending') {
        if(authArea) authArea.style.display = 'block';
        if(authSec) authSec.style.display = 'none';
        if(waiting) waiting.style.display = 'block';
    }
}

// ==========================================
// 4. ORDER SYSTEM (KDS)
// ==========================================
window.switchOrderTab = (status, el) => {
    currentOrderTab = status;
    document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    loadOrders(auth.currentUser.uid);
};

function loadOrders(uid) {
    const q = query(collection(db, "orders"), where("resId", "==", uid));
    onSnapshot(q, (snap) => {
        const grid = document.getElementById('orders-display-grid');
        if(!grid) return;
        grid.innerHTML = "";
        
        let counts = { Pending: 0, Preparing: 0, Ready: 0, "Picked Up": 0 };

        snap.forEach(d => {
            const order = d.data();
            if(counts[order.status] !== undefined) counts[order.status]++;
            
            const isHistoryTab = (currentOrderTab === 'Past Orders' && (order.status === 'Picked Up' || order.status === 'Rejected'));
            const isNormalTab = (order.status === currentOrderTab);

            if(isNormalTab || isHistoryTab) {
                const items = order.items.map(i => `• ${i.name}`).join('<br>');
                const orderDate = order.timestamp ? order.timestamp.toDate().toLocaleDateString('en-GB') : "No Date";
                
                let btn = "";
                if(order.status === "Pending") btn = `<button class="primary-btn" style="background:green; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Preparing')">Accept Order</button>`;
                else if(order.status === "Preparing") btn = `<button class="primary-btn" style="background:orange; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Ready')">Mark Ready</button>`;
                else if(order.status === "Ready") btn = `<button class="primary-btn" style="background:blue; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Picked Up')">Order Picked Up</button>`;

                grid.innerHTML += `
                    <div class="order-card">
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:gray; margin-bottom:5px;">
                            <span>Date: ${orderDate}</span> <span>Table ${order.table}</span>
                        </div>
                        <hr>${items}<p>Total: <b>₹${order.total}</b></p>${btn}
                    </div>`;
            }
        });

        if(document.getElementById('count-new')) document.getElementById('count-new').innerText = counts.Pending;
        if(document.getElementById('count-prep')) document.getElementById('count-prep').innerText = counts.Preparing;
        if(document.getElementById('count-ready')) document.getElementById('count-ready').innerText = counts.Ready;
        if(document.getElementById('count-picked')) document.getElementById('count-picked').innerText = counts["Picked Up"];
        if(document.getElementById('order-count-badge')) document.getElementById('order-count-badge').innerText = counts.Pending;
    });
}

window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 5. PROFILE & MENU LOGIC
// ==========================================
window.saveProfile = async () => {
    if(loader) loader.style.display = 'flex';
    const upData = {
        name: document.getElementById('res-name').value,
        ownerPhone: document.getElementById('res-phone').value,
        address: document.getElementById('res-address').value,
        prepTime: document.getElementById('res-prep-time').value
    };
    
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        await updateDoc(resRef, upData);
        
        const logoFile = document.getElementById('res-logo-file').files[0];
        if(logoFile) {
            const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
            await uploadBytes(logoRef, logoFile);
            const logoUrl = await getDownloadURL(logoRef);
            await updateDoc(resRef, { logoUrl: logoUrl });
        }
        alert("Profile & Settings Saved Successfully!");
    } catch (e) { alert("Error: " + e.message); }
    if(loader) loader.style.display = 'none';
};

window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    if(!name || !price) return alert("Details missing!");
    
    if(loader) loader.style.display = 'flex';
    try {
        const itemRef = collection(db, "restaurants", auth.currentUser.uid, "menu");
        await addDoc(itemRef, { name, price });
        alert("Item Added!");
    } catch(e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const list = document.getElementById('owner-menu-list');
        if(!list) return;
        list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `<div class="card" style="margin-bottom:10px;">${item.name} - ₹${item.price} <button onclick="deleteItem('${d.id}')" style="color:red; background:none; border:none; cursor:pointer; float:right;">Delete</button></div>`;
        });
    });
}

window.deleteItem = async (id) => { 
    if(confirm("Delete item?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); 
};

// ==========================================
// 6. QR & OFFERS
// ==========================================
function generateQR(uid) {
    const box = document.getElementById("qrcode-box"); 
    if(box) {
        box.innerHTML = "";
        const userUrl = `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`;
        new QRCode(box, { text: userUrl, width: 200, height: 200 });
    }
}

window.saveOffer = async () => {
    const text = document.getElementById('offer-text').value;
    const status = document.getElementById('offer-status').checked;
    try {
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), { offerText: text, showOffer: status });
        alert("Offer Saved!");
    } catch (e) { alert(e.message); }
};

// ==========================================
// 7. OBSERVER & APP INITIALIZATION
// ==========================================
onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) {
                syncDashboard(d.data(), user.uid);
            } else {
                if(authArea) authArea.style.display = 'block';
                const authSec = document.getElementById('auth-section');
                const memSec = document.getElementById('membership-section');
                if(authSec) authSec.style.display = 'none';
                if(memSec) memSec.style.display = 'block';
            }
        });
    } else {
        if(authArea) authArea.style.display = 'block';
        if(mainWrapper) mainWrapper.style.display = 'none';
        const authSec = document.getElementById('auth-section');
        if(authSec) authSec.style.display = 'block';
    }
    if(loader) loader.style.display = 'none';
});

window.logout = () => signOut(auth).then(() => location.reload());

window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const target = document.getElementById(id + '-sec');
    if(target) target.style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};

window.downloadQR = () => {
    const img = document.querySelector("#qrcode-box img");
    if(img) {
        const link = document.createElement("a");
        link.href = img.src; link.download = "Platto_QR.png"; link.click();
    }
};

window.goToRenewal = () => {
    const expired = document.getElementById('expired-screen');
    const memSec = document.getElementById('membership-section');
    if(expired) expired.style.display = 'none';
    if(authArea) authArea.style.display = 'block';
    if(memSec) memSec.style.display = 'block';
};