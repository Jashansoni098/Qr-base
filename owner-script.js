import { auth, db, storage } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    sendPasswordResetEmail 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, onSnapshot, collection, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Global Variables
let isLoginMode = true;
let selectedPlanName = "";
const loader = document.getElementById('loader');

// --- 1. Toggle Login/Signup ---
window.toggleAuth = () => {
    isLoginMode = !isLoginMode;
    const title = document.getElementById('auth-title');
    const btn = document.getElementById('authBtn');
    const toggleLink = document.getElementById('toggle-link');

    if (isLoginMode) {
        title.innerText = "Partner Login";
        btn.innerText = "Login";
        toggleLink.innerText = "Create Account";
    } else {
        title.innerText = "Partner Sign Up";
        btn.innerText = "Register Now";
        toggleLink.innerText = "Login here";
    }
};

// --- 2. Auth Execution ---
window.handleAuth = async () => {
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;

    if (!email || !pass) return alert("Email aur Password bhariye!");
    
    loader.style.display = 'flex';
    try {
        if (isLoginMode) {
            await signInWithEmailAndPassword(auth, email, pass);
        } else {
            await createUserWithEmailAndPassword(auth, email, pass);
        }
    } catch (error) {
        alert("Auth Error: " + error.message);
    }
    loader.style.display = 'none';
};

// HTML mein 'authBtn' par onclick="handleAuth()" laga dein ya niche wala listener use karein:
document.getElementById('authBtn').onclick = window.handleAuth;

// --- 3. Plan Selection ---
window.selectPlan = (name, price) => {
    selectedPlanName = name;
    document.getElementById('selected-plan-name').innerText = name;
    document.getElementById('payable-amt').innerText = "₹" + price;
    document.getElementById('payment-panel').style.display = 'block';
    console.log("Plan selected: " + name);
};

// --- 4. Submit Payment Details ---
window.submitPayment = async () => {
    const file = document.getElementById('payment-proof').files[0];
    const resName = document.getElementById('res-name-input').value;

    if(!file || !resName) return alert("Pehle screenshot select karein aur restaurant ka naam likhen!");

    loader.style.display = 'flex';
    try {
        // Upload photo to Storage
        const storageRef = ref(storage, `proofs/${auth.currentUser.uid}_${Date.now()}`);
        const uploadTask = await uploadBytes(storageRef, file);
        const proofUrl = await getDownloadURL(uploadTask.ref);

        // Save data to Firestore
        await setDoc(doc(db, "restaurants", auth.currentUser.uid), {
            ownerId: auth.currentUser.uid,
            name: resName,
            plan: selectedPlanName,
            paymentProof: proofUrl,
            status: "pending",
            createdAt: new Date()
        });
        alert("Details submitted! Ab admin approval ka wait karein.");
    } catch (error) {
        alert("Upload Error: " + error.message);
    }
    loader.style.display = 'none';
};

document.getElementById('submitPaymentBtn').onclick = window.submitPayment;

// --- 5. Dashboard Tab Management ---
window.showTab = (tab) => {
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById(tab + '-tab').style.display = 'block';
    event.currentTarget.classList.add('active');
};

// --- Restaurant Profile Save Function ---
window.saveProfile = async () => {
    const name = document.getElementById('edit-res-name').value;
    const address = document.getElementById('edit-res-address').value;
    const upi = document.getElementById('edit-res-upi').value;

    if (!name || !address || !upi) {
        return alert("Kripya saari details (Name, Address, UPI) bhariye!");
    }

    loader.style.display = 'flex';
    try {
        const resRef = doc(db, "restaurants", auth.currentUser.uid);
        
        // Firestore mein data update karna
        await updateDoc(resRef, {
            name: name,
            address: address,
            upiId: upi // Customer isi UPI par pay karenge
        });

        alert("Profile successfully update ho gayi hai!");
    } catch (error) {
        console.error("Error updating profile:", error);
        alert("Error: " + error.message);
    } finally {
        loader.style.display = 'none';
    }
};

// --- 6. Menu Management ---
window.addMenuItem = async () => {
    const name = document.getElementById('food-name').value;
    const price = document.getElementById('food-price').value;
    const cat = document.getElementById('food-cat').value;

    if(!name || !price) return alert("Dish details bhariye");

    try {
        await addDoc(collection(db, "restaurants", auth.currentUser.uid, "menu"), {
            name, price, category: cat, status: "available"
        });
        alert("Item added to menu!");
        document.getElementById('food-name').value = "";
        document.getElementById('food-price').value = "";
    } catch (e) {
        alert("Error adding item: " + e.message);
    }
};

// --- 7. Load Menu Items ---
function loadMenu(uid) {
    onSnapshot(collection(db, "restaurants", uid, "menu"), (snap) => {
        const list = document.getElementById('menu-items-list');
        list.innerHTML = "";
        snap.forEach(d => {
            const item = d.data();
            list.innerHTML += `
                <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
                    <span><b>${item.name}</b> - ₹${item.price}</span>
                    <small>${item.category}</small>
                </div>`;
        });
    });
}

// --- 8. QR Generation ---
// --- Final QR Generation Function for Platto.netlify.app ---
window.generateQRCode = (uid) => {
    const qrDiv = document.getElementById("qrcode-display");
    
    // 1. Purana QR saaf karein
    qrDiv.innerHTML = "";

    // 2. Aapka asli Live URL (Jo aapne bheja hai)
    const liveUserUrl = "https://platto.netlify.app/user.html"; 

    // 3. Final URL: Isme Restaurant ID (?resId=...) aur Table Number (&table=1) jod rahe hain
    const finalUrl = `${liveUserUrl}?resId=${uid}&table=1`;

    console.log("QR Code is pointing to:", finalUrl);

    // 4. Generate QR Code using QRCode.js library
    new QRCode(qrDiv, {
        text: finalUrl,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
};

// QR Download function
window.downloadQR = () => {
    const qrImg = document.querySelector("#qrcode-display img");
    if (qrImg) {
        const link = document.createElement("a");
        link.href = qrImg.src;
        link.download = "Platto_Restaurant_QR.png";
        link.click();
    } else {
        alert("Pehle QR code generate hone dein!");
    }
};

window.downloadQR = () => {
    const img = document.querySelector("#qrcode-display img");
    if(img) {
        const link = document.createElement("a");
        link.href = img.src;
        link.download = "Restaurant_QR.png";
        link.click();
    }
};

// --- 9. Auth State Control ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('auth-section').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'block';

        onSnapshot(doc(db, "restaurants", user.uid), (d) => {
            if (!d.exists()) {
                document.getElementById('membership-section').style.display = 'block';
                document.getElementById('waiting-section').style.display = 'none';
                document.getElementById('dashboard-section').style.display = 'none';
            } else {
                const data = d.data();
                document.getElementById('membership-section').style.display = 'none';
                if (data.status === "pending") {
                    document.getElementById('waiting-section').style.display = 'flex';
                } else if (data.status === "active") {
                   // onAuthStateChanged ke andar jahan data.status === "active" hai wahan ye dalein:
document.getElementById('edit-res-name').value = data.name || "";
document.getElementById('edit-res-address').value = data.address || "";
document.getElementById('edit-res-upi').value = data.upiId || "";
                    document.getElementById('waiting-section').style.display = 'none';
                    document.getElementById('dashboard-section').style.display = 'block';
                    loadMenu(user.uid);
                    generateQRCode(user.uid);
                }
            }
            loader.style.display = 'none';
        });
    } else {
        document.getElementById('auth-section').style.display = 'flex';
        document.getElementById('dashboard-section').style.display = 'none';
        document.getElementById('membership-section').style.display = 'none';
        document.getElementById('waiting-section').style.display = 'none';
        document.getElementById('logoutBtn').style.display = 'none';
        loader.style.display = 'none';
    }
});

window.logout = () => signOut(auth);
document.getElementById('logoutBtn').onclick = window.logout;