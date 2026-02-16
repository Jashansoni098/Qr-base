import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, addDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const loader = document.getElementById('loader');

// --- 1. Payment Details & QR Upload Fix ---
window.savePaymentInfo = async () => {
    const upi = document.getElementById('res-upi').value;
    const qrFile = document.getElementById('res-qr-file').files[0];
    
    if(!upi) return alert("UPI ID bharna zaroori hai!");

    loader.style.display = 'flex';
    try {
        let updateData = { upiId: upi };

        if(qrFile) {
            const qrRef = ref(storage, `payment_qrs/${auth.currentUser.uid}`);
            const uploadTask = await uploadBytes(qrRef, qrFile);
            updateData.paymentQrUrl = await getDownloadURL(uploadTask.ref);
        }

        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), updateData);
        alert("Payment details successfully save ho gayi hain!");
    } catch (e) {
        alert("Error: " + e.message);
    }
    loader.style.display = 'none';
};

// --- 2. Offers & Discounts Fix ---
window.saveOffer = async () => {
    const text = document.getElementById('offer-text').value;
    const status = document.getElementById('offer-status').checked;

    loader.style.display = 'flex';
    try {
        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), {
            offerText: text,
            showOffer: status
        });
        alert("Offer updated!");
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// --- 3. Profile & Logo Upload Fix ---
window.saveProfile = async () => {
    const name = document.getElementById('res-name').value;
    const addr = document.getElementById('res-address').value;
    const phone = document.getElementById('res-phone').value;
    const about = document.getElementById('res-about').value;
    const logoFile = document.getElementById('res-logo-file').files[0];

    loader.style.display = 'flex';
    try {
        let updateData = { name, address: addr, ownerPhone: phone, about };

        if(logoFile) {
            const logoRef = ref(storage, `logos/${auth.currentUser.uid}`);
            await uploadBytes(logoRef, logoFile);
            updateData.logoUrl = await getDownloadURL(logoRef);
        }

        await updateDoc(doc(db, "restaurants", auth.currentUser.uid), updateData);
        alert("Restaurant info updated!");
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// --- 4. Expiry Date Calculation Logic ---
function handleStatus(data) {
    document.getElementById('disp-status').innerText = data.status.toUpperCase();
    document.getElementById('disp-plan').innerText = data.plan;
    document.getElementById('top-res-name').innerText = data.name;

    // Expiry Calculation (Agar createdAt hai toh +30 days for Monthly)
    if(data.createdAt) {
        let createdDate = data.createdAt.toDate();
        let expiryDate = new Date(createdDate);
        
        if(data.plan === "Monthly") expiryDate.setDate(createdDate.getDate() + 30);
        else if(data.plan === "Yearly") expiryDate.setFullYear(createdDate.getFullYear() + 1);

        document.getElementById('disp-expiry').innerText = expiryDate.toLocaleDateString('en-GB'); // DD/MM/YYYY
    }

    // Auto-fill inputs if data exists
    if(data.upiId) document.getElementById('res-upi').value = data.upiId;
    if(data.offerText) document.getElementById('offer-text').value = data.offerText;
    if(data.showOffer) document.getElementById('offer-status').checked = data.showOffer;
}

// --- 5. Menu Manager with Image Fix ---
window.addMenuItem = async () => {
    const name = document.getElementById('item-name').value;
    const price = document.getElementById('item-price').value;
    const file = document.getElementById('item-img').files[0];

    if(!name || !price) return alert("Details bhariye!");

    loader.style.display = 'flex';
    try {
        let itemData = { name, price, createdAt: new Date() };

        if(file) {
            const itemRef = ref(storage, `menu/${auth.currentUser.uid}/${Date.now()}`);
            await uploadBytes(itemRef, file);
            itemData.imgUrl = await getDownloadURL(itemRef);
        }

        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), itemData);
        alert("Menu item added!");
        // Clear inputs
        document.getElementById('item-name').value = "";
        document.getElementById('item-price').value = "";
        document.getElementById('item-img').value = "";
    } catch (e) { alert(e.message); }
    loader.style.display = 'none';
};

// ... Rest of the script (onAuthStateChanged, logout, showSection) ...
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