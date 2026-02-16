import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// --- Tab Navigation ---
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(id + '-sec').style.display = 'block';
    event.currentTarget.classList.add('active');
};

// --- Profile & Call Button Update ---
window.saveProfile = async () => {
    const loader = document.getElementById('loader');
    loader.style.display = 'flex';
    
    const name = document.getElementById('res-name').value;
    const addr = document.getElementById('res-address').value;
    const phone = document.getElementById('res-phone').value;
    const about = document.getElementById('res-about').value;
    const logoFile = document.getElementById('res-logo-file').files[0];

    let updateData = { name, address: addr, ownerPhone: phone, about };

    if(logoFile) {
        const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
        await uploadBytes(logoRef, logoFile);
        updateData.logoUrl = await getDownloadURL(logoRef);
    }

    await updateDoc(doc(db, "restaurants", auth.currentUser.uid), updateData);
    loader.style.display = 'none';
    alert("Profile Updated!");
};

// --- Menu Manager ---
window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    const file = document.getElementById('item-img').files[0];

    let itemData = { name, price, createdAt: new Date() };

    if(file) {
        const itemRef = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
        await uploadBytes(itemRef, file);
        itemData.imgUrl = await getDownloadURL(itemRef);
    }

    await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), itemData);
    alert("Item Added!");
};

// Load Menu with Delete Option
function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const container = document.getElementById('owner-menu-list');
        container.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            container.innerHTML += `
                <div class="menu-item-card">
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}">
                    <h4>${item.name}</h4>
                    <p>₹${item.price}</p>
                    <button class="del-btn" onclick="deleteItem('${d.id}')">🗑️ Delete</button>
                </div>`;
        });
    });
}

window.deleteItem = async (id) => {
    if(confirm("Delete this item?")) {
        await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id));
    }
};

// --- Membership & Notifications ---
function handleStatus(data) {
    document.getElementById('disp-status').innerText = data.status.toUpperCase();
    document.getElementById('disp-plan').innerText = data.plan;
    document.getElementById('top-res-name').innerText = data.name;
    
    if(data.status === 'active') {
        document.getElementById('main-wrapper').style.display = 'flex';
        // Fill profile inputs
        document.getElementById('res-name').value = data.name || "";
        document.getElementById('res-address').value = data.address || "";
        document.getElementById('res-phone').value = data.ownerPhone || "";
    }

    // Notification logic
    const notif = document.getElementById('notif-box');
    if(data.status === 'pending') {
        notif.innerText = "🔔 Your payment is under review. Please wait.";
        notif.style.display = "block";
    }
}

// --- QR Generation ---
function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    box.innerHTML = "";
    new QRCode(box, `https://platto.netlify.app/user.html?resId=${uid}`);
}

onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) {
                handleStatus(d.data());
                loadMenu(user.uid);
                generateQR(user.uid);
            }
        });
    }
    document.getElementById('loader').style.display = 'none';
});