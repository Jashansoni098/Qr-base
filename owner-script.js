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
    const target = document.getElementById(id + '-sec');
    if (target) target.style.display = 'block';
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
        alert("Restaurant Profile Updated Successfully!");
    } catch (e) { alert("Error updating profile: " + e.message); }
    loader.style.display = 'none';
};

// --- 3. Payment Details & UPI QR Upload ---
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
        alert("Payment Details & QR Saved!");
    } catch (e) { alert("Error saving payment info: " + e.message); }
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
        alert("Offers Updated!");
    } catch (e) { alert("Error: " + e.message); }
    loader.style.display = 'none';
};

// --- 5. Menu Manager (With Image Upload) ---
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
        alert("Food Item Added to Menu!");
        // Clear Inputs
        document.getElementById('item-name').value = "";
        document.getElementById('item-price').value = "";
        document.getElementById('item-img').value = "";
    } catch (e) { alert("Error adding item: " + e.message); }
    loader.style.display = 'none';
};

window.deleteItem = async (id) => {
    if(confirm("Are you sure you want to delete this item?")) {
        try {
            await deleteDoc(doc(db, "restaurants", auth.currentUser.uid, "menu", id));
        } catch (e) { alert(e.message); }
    }
};

function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const container = document.getElementById('owner-menu-list');
        if(!container) return;
        container.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            container.innerHTML += `
                <div class="menu-item-card">
                    <img src="${item.imgUrl || 'https://via.placeholder.com/150'}" onerror="this.src='https://via.placeholder.com/150'">
                    <h4>${item.name}</h4>
                    <p>₹${item.price}</p>
                    <button class="del-btn" onclick="deleteItem('${d.id}')">🗑️ Delete</button>
                </div>`;
        });
    });
}

// --- 6. Status & Expiry Logic (VVIP) ---
function handleStatus(data, uid) {
    document.getElementById('disp-status').innerText = data.status.toUpperCase();
    document.getElementById('disp-plan').innerText = data.plan;
    document.getElementById('top-res-name').innerText = data.name;

    if(data.createdAt) {
        let createdDate = data.createdAt.toDate();
        let expiryDate = new Date(createdDate);
        
        // Calculate Expiry Date
        if(data.plan === "Monthly") expiryDate.setDate(createdDate.getDate() + 30);
        else expiryDate.setFullYear(createdDate.getFullYear() + 1);
        
        document.getElementById('disp-expiry').innerText = expiryDate.toLocaleDateString('en-GB');

        // Logic for Expiry Alerts & Blocking
        let today = new Date();
        let timeDiff = expiryDate.getTime() - today.getTime();
        let daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

        const warningBanner = document.getElementById('expiry-warning');
        const expiredScreen = document.getElementById('expired-screen');
        const daysSpan = document.getElementById('days-left');

        if (daysLeft <= 0) {
            // PLAN EXPIRED
            if(expiredScreen) expiredScreen.style.display = 'flex';
            if(mainWrapper) mainWrapper.style.display = 'none';
            if(data.status !== "expired") {
                updateDoc(doc(db, "restaurants", uid), { status: "expired" });
            }
        } 
        else if (daysLeft <= 7) {
            // 7 DAY WARNING
            if(warningBanner) {
                warningBanner.style.display = 'block';
                if(daysSpan) daysSpan.innerText = daysLeft;
            }
        } else {
            if(warningBanner) warningBanner.style.display = 'none';
        }
    }

    if(data.status === 'active') {
        if(mainWrapper) mainWrapper.style.display = 'flex';
        document.getElementById('expired-screen').style.display = 'none';
    } else if (data.status === 'expired') {
        document.getElementById('expired-screen').style.display = 'flex';
        if(mainWrapper) mainWrapper.style.display = 'none';
    }
}

// Renewal Button Logic
window.goToRenewal = () => {
    document.getElementById('expired-screen').style.display = 'none';
    document.getElementById('membership-section').style.display = 'block';
};

// --- 7. QR Code Generation ---
function generateQR(uid) {
    const box = document.getElementById("qrcode-box");
    if(box) {
        box.innerHTML = "";
        new QRCode(box, {
            text: `https://platto.netlify.app/user.html?resId=${uid}&table=1`,
            width: 200, 
            height: 200,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
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
    } else {
        alert("Please wait for QR to generate");
    }
};

// --- 8. Auth Listener & Real-time Sync ---
onAuthStateChanged(auth, (user) => {
    if(user) {
        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if(d.exists()) {
                const data = d.data();
                handleStatus(data, user.uid);
                loadMenu(user.uid);
                generateQR(user.uid);
                
                // Pre-fill profile if active
                if(data.status === 'active') {
                    document.getElementById('res-name').value = data.name || "";
                    document.getElementById('res-address').value = data.address || "";
                    document.getElementById('res-phone').value = data.ownerPhone || "";
                    document.getElementById('res-about').value = data.about || "";
                    document.getElementById('res-upi').value = data.upiId || "";
                    document.getElementById('offer-text').value = data.offerText || "";
                    document.getElementById('offer-status').checked = data.showOffer || false;
                }
            }
        });
    } else {
        // Only redirect if not on the login page to avoid loops
        if(!window.location.href.includes("owner.html")) {
            window.location.href = "owner.html";
        }
    }
    if(loader) loader.style.display = 'none';
});

window.logout = () => {
    signOut(auth).then(() => {
        location.reload();
    }).catch((error) => {
        alert("Error logging out: " + error.message);
    });
};