// Receives reminder notifications for Health Log (Firebase Cloud Messaging).
// Notifications sent with a "notification" payload are shown automatically,
// and tapping one opens the app.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAgmcBTOT8cvTOk0mTXDKKL4_eKjPrJibw",
  authDomain: "health-log-37775.firebaseapp.com",
  projectId: "health-log-37775",
  storageBucket: "health-log-37775.firebasestorage.app",
  messagingSenderId: "18270740905",
  appId: "1:18270740905:web:f6ef98044ed2d5bea5e4b8",
});

firebase.messaging();
