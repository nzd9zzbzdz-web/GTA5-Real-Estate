// ============================================================
// config.js — shared database connection (optional).
//
// To share the map with other players, create a Firebase project
// (console.firebase.google.com), add a Web app to it, and paste
// the firebaseConfig object it gives you below. Full walkthrough
// in the README.
//
// These values are DESIGNED to be visible in a browser app — the
// security lives in firestore.rules, not in hiding this config.
//
// Leave it null and the app runs in local-only mode (data stays
// in this browser's localStorage).
// ============================================================

const FIREBASE_CONFIG = null;

// Example of what it looks like filled in:
// const FIREBASE_CONFIG = {
//   apiKey: "AIzaSy...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.firebasestorage.app",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123"
// };
