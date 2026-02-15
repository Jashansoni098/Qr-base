import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const loader = document.getElementById('loader');

// 1. Login Handler
document.getElementById('loginBtn').onclick = async () => {
    const email = document.getElementById('admEmail').value;
    const pass = document.getElementById('admPass').value;
    
    loader.style.display = 'flex';
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
        alert("Admin Login Failed: " + e.message);
    }
    loader.style.display = 'none';
};

// 2. Auth State Check
onAuthStateChanged(auth, (user) => {
    if(user) {
        // Yahan aap apna admin email dalen
        if(user.email === "admin@platto.com") {
            document.getElementById('login-ui').style.display = 'none';
            document.getElementById('admin-dashboard').style.display = 'grid';
            loadPendingRequests();
            loadActivePartners();
        } else {
            alert("Authorized personnel only!");
            signOut(auth);
        }
    } else {
        document.getElementById('login-ui').style.display = 'flex';
        document.getElementById('admin-dashboard').style.display = 'none';
    }
    loader.style.display = 'none';
});

// 3. Tab Management
window.showTab = (tab) => {
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById(tab + '-tab').style.display = 'block';
    document.getElementById('tab-title').innerText = tab.replace('-', ' ').toUpperCase();
    event.currentTarget.classList.add('active');
};

// 4. Load Pending Requests (Real-time)
function loadPendingRequests() {
    const q = query(collection(db, "restaurants"), where("status", "==", "pending"));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('pending-list');
        list.innerHTML = "";
        document.getElementById('stat-pending').innerText = snapshot.size;
        
        snapshot.forEach((d) => {
            const res = d.data();
            list.innerHTML += `
                <div class="approval-card">
                    <h4>${res.name}</h4>
                    <p>Plan: <b>${res.plan}</b></p>
                    <img src="${res.paymentProof}" class="proof-img" onclick="window.open('${res.paymentProof}')">
                    <div style="display:flex; justify-content:space-between;">
                        <button class="btn-approve" onclick="updateResStatus('${d.id}', 'active')">Approve</button>
                        <button class="btn-reject" onclick="updateResStatus('${d.id}', 'rejected')">Reject</button>
                    </div>
                </div>
            `;
        });
    });
}

// 5. Load Active Partners
function loadActivePartners() {
    const q = query(collection(db, "restaurants"), where("status", "==", "active"));
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('active-list');
        list.innerHTML = "";
        document.getElementById('stat-active').innerText = snapshot.size;
        
        snapshot.forEach((d) => {
            const res = d.data();
            list.innerHTML += `
                <tr>
                    <td><b>${res.name}</b></td>
                    <td>${res.plan}</td>
                    <td><span style="color:green; font-weight:bold;">● Active</span></td>
                    <td><button onclick="updateResStatus('${d.id}', 'pending')" style="cursor:pointer;">Block</button></td>
                </tr>
            `;
        });
    });
}

// 6. Approve/Reject Function
window.updateResStatus = async (id, newStatus) => {
    if(confirm(`Are you sure you want to set status to ${newStatus}?`)) {
        await updateDoc(doc(db, "restaurants", id), {
            status: newStatus,
            activatedAt: new Date()
        });
        alert("Restaurant updated!");
    }
};

document.getElementById('logoutBtn').onclick = () => signOut(auth);