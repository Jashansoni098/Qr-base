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

        // Naya restaurant document create karein
        await doc(db, "restaurants", auth.currentUser.uid); 
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
        
        // Data auto-fill karein profile tab mein
        document.getElementById('res-name').value = data.name || "";
        document.getElementById('res-phone').value = data.ownerPhone || "";
        document.getElementById('res-address').value = data.address || "";
        document.getElementById('res-prep-time').value = data.prepTime || "";
    } else if(data.status === 'pending') {
        authArea.style.display = 'block';
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('waiting-section').style.display = 'block';
    }
}

// ==========================================
// 4. FIX: ORDER SYSTEM (COUNTS & DATE)
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
        
        // All tab counts
        let counts = { Pending: 0, Preparing: 0, Ready: 0, "Picked Up": 0 };

        snap.forEach(d => {
            const order = d.data();
            if(counts[order.status] !== undefined) counts[order.status]++;
            
            // Tab Filter Logic
            const isHistoryTab = (currentOrderTab === 'Past Orders' && (order.status === 'Picked Up' || order.status === 'Rejected'));
            const isNormalTab = (order.status === currentOrderTab);

            if(isNormalTab || isHistoryTab) {
                const items = order.items.map(i => `• ${i.name}`).join('<br>');
                const orderDate = order.timestamp ? order.timestamp.toDate().toLocaleDateString('en-GB') : "No Date";
                
                let btn = "";
                if(order.status === "Pending") btn = `<button class="primary-btn" style="background:green;" onclick="updateOrderStatus('${d.id}','Preparing')">Accept Order</button>`;
                else if(order.status === "Preparing") btn = `<button class="primary-btn" style="background:orange;" onclick="updateOrderStatus('${d.id}','Ready')">Mark Ready</button>`;
                else if(order.status === "Ready") btn = `<button class="primary-btn" style="background:blue;" onclick="updateOrderStatus('${d.id}','Picked Up')">Order Picked Up</button>`;

                grid.innerHTML += `
                    <div class="order-card">
                        <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:gray; margin-bottom:5px;">
                            <span>Date: ${orderDate}</span> <span>Table ${order.table}</span>
                        </div>
                        <hr>${items}<p>Total: <b>₹${order.total}</b></p>${btn}
                    </div>`;
            }
        });

        // FIX: Update All Count Badges
        if(document.getElementById('count-new')) document.getElementById('count-new').innerText = counts.Pending;
        if(document.getElementById('count-prep')) document.getElementById('count-prep').innerText = counts.Preparing;
        if(document.getElementById('count-ready')) document.getElementById('count-ready').innerText = counts.Ready;
        if(document.getElementById('count-picked')) document.getElementById('count-picked').innerText = counts["Picked Up"];
        if(document.getElementById('order-count-badge')) document.getElementById('order-count-badge').innerText = counts.Pending;
    });
}

window.updateOrderStatus = async (id, status) => { await updateDoc(doc(db, "orders", id), { status }); };

// ==========================================
// 5. FIX: PROFILE SAVE LOGIC
// ==========================================
window.saveProfile = async () => {
    loader.style.display = 'flex';
    const upData = {
        name: document.getElementById('res-name').value,
        ownerPhone: document.getElementById('res-phone').value,
        address: document.getElementById('res-address').value,
        prepTime: document.getElementById('res-prep-time').value
    };
    
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        await updateDoc(resRef, upData);
        
        // Logo Upload Fix
        const logoFile = document.getElementById('res-logo-file').files[0];
        if(logoFile) {
            const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
            await uploadBytes(logoRef, logoFile);
            const logoUrl = await getDownloadURL(logoRef);
            await updateDoc(resRef, { logoUrl: logoUrl });
        }
        
        alert("Profile & Settings Saved Successfully!");
    } catch (e) {
        alert("Error: " + e.message);
    }
    loader.style.display = 'none';
};

window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    if(!name || !price) return alert("Details missing!");
    
    loader.style.display = 'flex';
    try {
        const itemRef = collection(db, "restaurants", auth.currentUser.uid, "menu");
        await addDoc(itemRef, { name, price });
        alert("Item Added!");
    } catch(e) { alert(e.message); }
    loader.style.display = 'none';
};

function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const list = document.getElementById('owner-menu-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `<div class="card">${item.name} - ₹${item.price} <button onclick="deleteItem('${d.id}')" style="color:red; background:none; border:none; cursor:pointer; float:right;">Delete</button></div>`;
        });
    });
}

window.deleteItem = async (id) => { 
    if(confirm("Delete item?")) await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id)); 
};

// ==========================================
// 6. FIX: QR SCAN URL
// ==========================================
function generateQR(uid) {
    const box = document.getElementById("qrcode-box"); 
    if(box) {
        box.innerHTML = "";
        // Correct User Site URL
        const userUrl = `https://qrbaseuser-site.netlify.app/user.html?resId=${uid}&table=1`;
        new QRCode(box, {
            text: userUrl,
            width: 200,
            height: 200
        });
    }
}

// ==========================================
// 7. OBSERVER
// ==========================================
onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) syncDashboard(d.data(), user.uid);
            else { 
                authArea.style.display = 'block'; 
                document.getElementById('membership-section').style.display = 'block'; 
                document.getElementById('auth-section').style.display = 'none'; 
            }
        });
    } else { 
        authArea.style.display = 'block'; 
        mainWrapper.style.display = 'none'; 
        document.getElementById('auth-section').style.display = 'block'; 
    }
    loader.style.display = 'none';
});

window.logout = () => signOut(auth).then(() => location.reload());
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(id + '-sec').style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
};