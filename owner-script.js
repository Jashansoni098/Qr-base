import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

console.log("Platto Owner Script Loaded...");

const loader = document.getElementById('loader');
const mainWrapper = document.getElementById('main-wrapper');

// --- 1. Tab Navigation ---
window.showSection = (id) => {
    document.querySelectorAll('.page-sec').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(id + '-sec').style.display = 'block';
    event.currentTarget.classList.add('active');
};

// --- 2. Profile & Logo Upload ---
window.saveProfile = async () => {
    loader.style.display = 'flex';
    const name = document.getElementById('res-name').value;
    const addr = document.getElementById('res-address').value;
    const phone = document.getElementById('res-phone').value;
    const about = document.getElementById('res-about').value;
    const logoFile = document.getElementById('res-logo-file').files[0];

    try {
        let updateData = { name, address: addr, ownerPhone: phone, about };
        if(logoFile) {
            const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
            const uploadTask = await uploadBytes(logoRef, logoFile);
            updateData.logoUrl = await getDownloadURL(uploadTask.ref);
        }
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), updateData);
        alert("Restaurant Profile Updated!");
    } catch (e) { alert("Error: " + e.message); }
    loader.style.display = 'none';
};

// --- 3. Payment Details & QR Upload ---
window.savePaymentInfo = async () => {
    const upi = document.getElementById('res-upi').value;
    const qrFile = document.getElementById('res-qr-file').files[0];
    if(!upi) return alert("UPI ID is required!");

    loader.style.display = 'flex';
    try {
        let updateData = { upiId: upi };
        if(qrFile) {
            const qrRef = ref(storage, `payment_qrs/${auth.currentUser.uid}`);
            const uploadTask = await uploadBytes(qrRef, qrFile);
            updateData.paymentQrUrl = await getDownloadURL(uploadTask.ref);
        }
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), updateData);
        alert("Payment Details Saved!");
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// --- 4. Offers Manager ---
window.saveOffer = async () => {
    const text = document.getElementById('offer-text').value;
    const status = document.getElementById('offer-status').checked;
    loader.style.display = 'flex';
    try {
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
            offerText: text, showOffer: status
        });
        alert("Offer Updated!");
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// --- 5. Menu Manager ---
window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    const file = document.getElementById('item-img').files[0];
    if(!name || !price) return alert("Enter item name and price!");

    loader.style.display = 'flex';
    try {
        let itemData = { name, price, createdAt: new Date() };
        if(file) {
            const itemRef = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            const uploadTask = await uploadBytes(itemRef, file);
            itemData.imgUrl = await getDownloadURL(uploadTask.ref);
        }
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), itemData);
        alert("Item Added!");
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

window.deleteItem = async (id) => {
    if(confirm("Delete this item?")) {
        await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id));
    }
};

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

// --- 6. Status & Expiry Logic ---
function handleStatus(data) {
    document.getElementById('disp-status').innerText = data.status.toUpperCase();
    document.getElementById('disp-plan').innerText = data.plan;
    document.getElementById('top-res-name').innerText = data.name;

    if(data.createdAt) {
        let createdDate = data.createdAt.toDate();
        let expiryDate = new Date(createdDate);
        if(data.plan === "Monthly") expiryDate.setDate(createdDate.getDate() + 30);
        else expiryDate.setFullYear(createdDate.getFullYear() + 1);
        document.getElementById('disp-expiry').innerText = expiryDate.toLocaleDateString('en-GB');
    }

    if(data.status === 'active') {
        if(mainWrapper) mainWrapper.style.display = 'flex';
    }
}

// --- 7. QR Code ---
function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) {
        box.innerHTML = "";
        new QRCode(box, {
            text: `https://platto.netlify.app/user.html?resId=${uid}&table=1`,
            width: 200, height: 200
        });
    }
}

window.downloadQR = () => {
    const img = document.querySelector("#qrcode-box img");
    if(img) {
        const link = document.createElement("a");
        link.href = img.src;
        link.download = "Platto_Restaurant_QR.png";
        link.click();
    }
};

// --- 8. Auth Listener ---
onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) {
                handleStatus(d.data());
                loadMenu(user.uid);
                generateQR(user.uid);
            }
        });
    } else {
        window.location.href = "owner.html"; // Redirect if logout
    }
    if(loader) loader.style.display = 'none';
});

window.logout = () => signOut(auth).then(() => location.reload());