// firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyCr1UChjglXhfjxasX9dJCsCt1ZW5trfqw",
    authDomain: "webrtc-tunnel.firebaseapp.com",
    databaseURL: "https://webrtc-tunnel-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "webrtc-tunnel",
    storageBucket: "webrtc-tunnel.appspot.com",
    messagingSenderId: "638989893698",
    appId: "1:638989893698:web:b4b067233a0e731fb26ddb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
