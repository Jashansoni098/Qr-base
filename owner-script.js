import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
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

    loader.style.display = 'flex';
    try {
        if(isLoginMode) await signInWithEmailAndPassword(auth, email, pass);
        else await createUserWithEmailAndPassword(auth, email, pass);
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// ==========================================
// 2. MEMBERSHIP & PAYMENT
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
    if(!file || !resName) return alert("Name & Screenshot required!");

    loader.style.display = 'flex';
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
    loader.style.display = 'none';
};

// ==========================================
// 3. DASHBOARD LOGIC (Status & Orders)
// ==========================================
function syncDashboard(data, uid) {
    document.getElementById('disp-status').innerText = data.status.toUpperCase();
    document.getElementById('disp-plan').innerText = data.plan;
    document.getElementById('top-res-name').innerText = data.name || "Partner";

    if(data.createdAt) {
        let expiry = new Date(data.createdAt.toDate());
        expiry.setDate(expiry.getDate() + (data.plan === "Monthly" ? 30 : 365));
        document.getElementById('disp-expiry').innerText = expiry.toLocaleDateString('en-GB');
        
        let daysLeft = Math.ceil((expiry - new Date()) / (1000 * 3600 * 24));
        if(daysLeft <= 0) { document.getElementById('expired-screen').style.display = 'flex'; }
        else if(daysLeft <= 7) { 
            document.getElementById('expiry-warning').style.display = 'block'; 
            document.getElementById('days-left').innerText = daysLeft;
        }
    }

    if(data.status === 'active') {
        authArea.style.display = 'none';
        mainWrapper.style.display = 'flex';
        loadOrders(uid);
        loadMenu(uid);
        generateQR(uid);
    } else if(data.status === 'pending') {
        authArea.style.display = 'block';
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('waiting-section').style.display = 'block';
    }
}

// ==========================================
// 4. KDS (5-TAB ORDER SYSTEM)
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
        grid.innerHTML = "";
        let counts = { Pending: 0, Preparing: 0, Ready: 0 };

        snap.forEach(d => {
            const order = d.data();
            if(counts[order.status] !== undefined) counts[order.status]++;
            
            if(order.status === currentOrderTab || (currentOrderTab === 'Past Orders' && order.status === 'Picked Up')) {
                const items = order.items.map(i => `• ${i.name}`).join('<br>');
                let btn = "";
                if(order.status === "Pending") btn = `<button class="primary-btn" onclick="updateOrderStatus('${d.id}','Preparing')">Accept</button>`;
                else if(order.status === "Preparing") btn = `<button class="primary-btn" style="background:orange;" onclick="updateOrderStatus('${d.id}','Ready')">Ready</button>`;
                else if(order.status === "Ready") btn = `<button class="primary-btn" style="background:blue;" onclick="updateOrderStatus('${d.id}','Picked Up')">Done</button>`;

                grid.innerHTML += `<div class="order-card"><b>Table ${order.table}</b><hr>${items}<p>Total: ₹${order.total}</p>${btn}</div>`;
            }
        });
        document.getElementById('count-new').innerText = counts.Pending;
        document.getElementById('order-count-badge').innerText = counts.Pending;
    });
}

window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 5. PROFILE & MENU
// ==========================================
window.saveProfile = async () => {
    loader.style.display = 'flex';
    const upData = {
        name: document.getElementById('res-name').value,
        ownerPhone: document.getElementById('res-phone').value,
        address: document.getElementById('res-address').value,
        prepTime: document.getElementById('res-prep-time').value
    };
    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), upData);
    loader.style.display = 'none'; alert("Profile Saved!");
};

window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    if(!name || !price) return;
    await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), { name, price });
    alert("Item Added!");
};

function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const list = document.getElementById('owner-menu-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `<div class="card">${item.name} - ₹${item.price} <button onclick="deleteItem('${d.id}')" style="color:red; background:none; border:none; cursor:pointer;">Delete</button></div>`;
        });
    });
}

window.deleteItem = async (id) => { await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); };

// ==========================================
// 6. QR & OBSERVER
// ==========================================
function generateQR(uid) {
    const box = document.getElementById("qrcode-box"); box.innerHTML = "";
    new QRCode(box, `https://platto.netlify.app/user.html?resId=${uid}&table=1`);
}

onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) syncDashboard(d.data(), user.uid);
            else { authArea.style.display = 'block'; document.getElementById('membership-section').style.display = 'block'; document.getElementById('auth-section').style.display = 'none'; }
        });
    } else { authArea.style.display = 'block'; mainWrapper.style.display = 'none'; document.getElementById('auth-section').style.display = 'block'; }
    loader.style.display = 'none';
});

window.logout = () => signOut(auth).then(() => location.reload());
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(id + '-sec').style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};