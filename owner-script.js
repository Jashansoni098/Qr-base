import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const loader = document.getElementById('loader');
const authArea = document.getElementById('auth-area');
const mainWrapper = document.getElementById('main-wrapper');
let currentOrderTab = "Pending";

// ==========================================
// 1. AUTH LOGIC
// ==========================================
let isLoginMode = true;
window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "Partner Login" : "Partner Sign Up";
    document.getElementById('authBtn').innerText = isLoginMode ? "Login" : "Sign Up";
    document.getElementById('toggle-wrapper').innerHTML = isLoginMode ? 
        `New here? <span onclick="toggleAuth()" class="link-text">Create Account</span>` : 
        `Have account? <span onclick="toggleAuth()" class="link-text">Login</span>`;
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
// 2. MEMBERSHIP & PAYMENT (ONBOARDING)
// ==========================================
let selectedPlanName = "";
window.selectPlan = (name, price) => {
    selectedPlanName = name;
    document.getElementById('payable-amt').innerText = price;
    document.getElementById('payment-panel').style.display = 'block';
};

document.getElementById('submitPaymentBtn').onclick = async () => {
    const file = document.getElementById('payment-proof').files[0];
    const resName = document.getElementById('res-name-input').value;
    if(!file || !resName) return alert("Proof & Name required!");
    if(loader) loader.style.display = 'flex';
    try {
        const storageRef = ref(storage, `proofs/${auth.currentUser.uid}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await setDoc(doc(db, "restaurants", auth.currentUser.uid), {
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
// FIX 1: PROFILE & LOGO SAVE
// ==========================================
window.saveProfile = async () => {
    if(loader) loader.style.display = 'flex';
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        let updateData = {
            name: document.getElementById('res-name').value,
            ownerPhone: document.getElementById('res-phone').value,
            address: document.getElementById('res-address').value,
            prepTime: document.getElementById('res-prep-time').value || "20"
        };

        const logoFile = document.getElementById('res-logo-file').files[0];
        if(logoFile) {
            const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
            await uploadBytes(logoRef, logoFile);
            updateData.logoUrl = await getDownloadURL(logoRef);
        }

        await updateDoc(resRef, updateData);
        alert("Restaurant Profile Updated!");
    } catch (e) { alert("Profile Error: " + e.message); }
    if(loader) loader.style.display = 'none';
};

// ==========================================
// FIX 2: PAYMENT UPI & QR SAVE
// ==========================================
window.savePaymentInfo = async () => {
    if(loader) loader.style.display = 'flex';
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        let updateData = {
            upiId: document.getElementById('res-upi').value
        };

        const qrFile = document.getElementById('res-qr-file').files[0];
        if(qrFile) {
            const qrRef = ref(storage, `payment_qrs/${auth.currentUser.uid}`);
            await uploadBytes(qrRef, qrFile);
            updateData.paymentQrUrl = await getDownloadURL(qrRef);
        }

        await updateDoc(resRef, updateData);
        alert("Payment Details Saved!");
    } catch (e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

// ==========================================
// FIX 3: DISCOUNT & OFFER SAVE
// ==========================================
window.saveOffer = async () => {
    if(loader) loader.style.display = 'flex';
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        await updateDoc(resRef, {
            offerText: document.getElementById('offer-text').value,
            showOffer: document.getElementById('offer-status').checked
        });
        alert("Offer Updated!");
    } catch (e) { alert(e.message); }
    if(loader) loader.style.display = 'none';
};

// ==========================================
// 4. MENU MANAGER
// ==========================================
window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    const file = document.getElementById('item-img').files[0];
    if(!name || !price) return alert("Fill details");
    if(loader) loader.style.display = 'flex';
    try {
        let itemData = { name, price, createdAt: new Date() };
        if(file) {
            const itemRef = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            await uploadBytes(itemRef, file);
            itemData.imgUrl = await getDownloadURL(itemRef);
        }
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), itemData);
        alert("Added!");
    } catch (e) { alert(e.message); }
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
    if(confirm("Delete?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id));
};

// ==========================================
// 5. ORDERS & KDS (UPDATED WITH NEW FEATURES)
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
            if(order.status === currentOrderTab) {
                const items = order.items.map(i => `• ${i.name}`).join('<br>');
                let btn = "";
                if(order.status === "Pending") btn = `<button class="primary-btn" style="background:#22c55e; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Preparing')">Accept Order</button>`;
                else if(order.status === "Preparing") btn = `<button class="primary-btn" style="background:#f59e0b; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Ready')">Mark Ready</button>`;
                else if(order.status === "Ready") btn = `<button class="primary-btn" style="background:#3b82f6; margin-top:10px;" onclick="updateOrderStatus('${d.id}','Picked Up')">Order Picked Up</button>`;

                grid.innerHTML += `
                    <div class="order-card">
                        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                            <span style="background:#f1f5f9; padding:4px 8px; border-radius:6px; font-weight:800;">Table ${order.table}</span>
                            <span style="color:#6366f1; font-size:0.8rem; font-weight:bold; border:1px solid #6366f1; padding:2px 6px; border-radius:5px;">${order.paymentMode || 'N/A'}</span>
                        </div>
                        <p style="margin:5px 0; font-size:0.95rem;">Customer: <b>${order.customerName || 'Guest'}</b></p>
                        <hr style="border:0; border-top:1px solid #eee; margin:10px 0;">
                        <div style="font-size:0.9rem; color:#475569; margin-bottom:10px;">${items}</div>
                        ${order.instruction ? `<p style="font-size:0.8rem; color:#e11d48; background:#fff1f2; padding:8px; border-radius:8px; margin-bottom:10px;"><b>Note:</b> ${order.instruction}</p>` : ''}
                        <p style="border-top:1px solid #eee; padding-top:10px;">Total Bill: <b>₹${order.total}</b></p>
                        ${btn}
                    </div>`;
            }
        });
        if(document.getElementById('count-new')) document.getElementById('count-new').innerText = counts.Pending;
        if(document.getElementById('order-count-badge')) document.getElementById('order-count-badge').innerText = counts.Pending;
    });
}

window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 6. SYNC & OBSERVER
// ==========================================
function syncDashboard(data, uid) {
    const statusEl = document.getElementById('disp-status');
    const planEl = document.getElementById('disp-plan');
    const expiryEl = document.getElementById('disp-expiry');
    const topName = document.getElementById('top-res-name');
    const warning = document.getElementById('expiry-warning');
    const expired = document.getElementById('expired-screen');

    if(statusEl) statusEl.innerText = data.status.toUpperCase();
    if(planEl) planEl.innerText = data.plan;
    if(topName) topName.innerText = data.name || "Partner";

    if(data.createdAt && expiryEl) {
        let createdDate = data.createdAt.toDate();
        let expiryDate = new Date(createdDate);
        expiryDate.setDate(createdDate.getDate() + (data.plan === "Monthly" ? 30 : 365));
        expiryEl.innerText = expiryDate.toLocaleDateString('en-GB');
        
        let daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 3600 * 24));
        if(daysLeft <= 0) {
            if(expired) expired.style.display = 'flex';
            if(mainWrapper) mainWrapper.style.display = 'none';
        } else if(daysLeft <= 7) { 
            if(warning) warning.style.display = 'block'; 
            if(document.getElementById('days-left')) document.getElementById('days-left').innerText = daysLeft;
        }
    }

    if(data.status === 'active') {
        if(authArea) authArea.style.display = 'none';
        if(mainWrapper) mainWrapper.style.display = 'flex';
        // Auto-fill inputs
        if(document.getElementById('res-name')) document.getElementById('res-name').value = data.name || "";
        if(document.getElementById('res-phone')) document.getElementById('res-phone').value = data.ownerPhone || "";
        if(document.getElementById('res-address')) document.getElementById('res-address').value = data.address || "";
        if(document.getElementById('res-prep-time')) document.getElementById('res-prep-time').value = data.prepTime || "";
        if(document.getElementById('res-upi')) document.getElementById('res-upi').value = data.upiId || "";
        if(document.getElementById('offer-text')) document.getElementById('offer-text').value = data.offerText || "";
        if(document.getElementById('offer-status')) document.getElementById('offer-status').checked = data.showOffer || false;
        
        loadOrders(uid); loadMenu(uid); generateQR(uid);
    } else if(data.status === 'pending') {
        if(authArea) authArea.style.display = 'block';
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('waiting-section').style.display = 'block';
    }
}

function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) {
        box.innerHTML = "";
        new QRCode(box, { text: `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`, width: 200, height: 200 });
    }
}

onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) syncDashboard(d.data(), user.uid);
            else {
                if(authArea) authArea.style.display = 'block';
                document.getElementById('auth-section').style.display = 'none';
                document.getElementById('membership-section').style.display = 'block';
            }
        });
    } else {
        if(authArea) authArea.style.display = 'block';
        if(mainWrapper) mainWrapper.style.display = 'none';
        document.getElementById('auth-section').style.display = 'block';
    }
    if(loader) loader.style.display = 'none';
});

window.logout = () => signOut(auth).then(() => location.reload());
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    if(document.getElementById(id + '-sec')) document.getElementById(id + '-sec').style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};
window.downloadQR = () => {
    const img = document.querySelector("#qrcode-box img");
    if(img) { const link = document.createElement("a"); link.href = img.src; link.download = "QR.png"; link.click(); }
};
window.goToRenewal = () => location.reload();