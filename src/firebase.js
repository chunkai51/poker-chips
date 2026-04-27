import { initializeApp } from "https://www.gstatic.com/firebasejs/9.13.0/firebase-app.js";
import {
  getDatabase,
  ref,
  update,
  onValue,
  get,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWngC6KUU2jRcyArjD42U7mKMwJecaqt8",
  authDomain: "online-room-test.firebaseapp.com",
  databaseURL: "https://online-room-test-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "online-room-test",
  storageBucket: "online-room-test.firebasestorage.app",
  messagingSenderId: "225690962519",
  appId: "1:225690962519:web:f9652634f1ab627c197112"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export {
  db,
  ref,
  update,
  onValue,
  get,
  runTransaction
};
