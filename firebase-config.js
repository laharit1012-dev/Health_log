// Firebase settings for this app (Firebase console → Project settings → Your apps).
// These values are meant to be public: they identify the project but grant no
// access by themselves. Access is controlled by the rules in firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyAgmcBTOT8cvTOk0mTXDKKL4_eKjPrJibw",
  authDomain: "health-log-37775.firebaseapp.com",
  projectId: "health-log-37775",
  storageBucket: "health-log-37775.firebasestorage.app",
  messagingSenderId: "18270740905",
  appId: "1:18270740905:web:f6ef98044ed2d5bea5e4b8",
};

// Web Push key for reminders (Firebase console → Project settings → Cloud Messaging →
// Web Push certificates → Key pair). Public by design, like the settings above.
export const vapidKey = "PASTE_WEB_PUSH_KEY";
