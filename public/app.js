import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, set, onValue } from "firebase/database";

const firebaseConfig = {
  // Replace these placeholders with your actual config from the Firebase Console!
  apiKey: "YOUR_API_KEY",
  authDomain: "trading-journal-4a6af.firebaseapp.com",
  databaseURL: "https://trading-journal-4a6af-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "trading-journal-4a6af",
  storageBucket: "trading-journal-4a6af.appspot.com",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const tradeForm = document.getElementById('tradeForm');
const tradesList = document.getElementById('tradesList');

// 1. Save trade when form is submitted
tradeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const pair = document.getElementById('pair').value;
  const type = document.getElementById('type').value;
  const price = document.getElementById('price').value;

  const newTradeRef = push(ref(database, "trades"));
  set(newTradeRef, {
    pair: pair,
    type: type,
    price: Number(price),
    timestamp: Date.now()
  });

  tradeForm.reset(); // Clear the form fields
});

// 2. Automatically load and display trades in real-time
onValue(ref(database, "trades"), (snapshot) => {
  tradesList.innerHTML = ''; 
  const trades = snapshot.val();
  
  if (trades) {
    Object.keys(trades).forEach((key) => {
      const trade = trades[key];
      const li = document.createElement('li');
      li.textContent = `${trade.pair} | ${trade.type.toUpperCase()} at $${trade.price}`;
      tradesList.appendChild(li);
    });
  }
});
