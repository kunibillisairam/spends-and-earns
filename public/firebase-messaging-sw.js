importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBk6CDHw_TKBfkqs_o0CZG2MueSiC9P_IY",
  authDomain: "spends-and-earns.firebaseapp.com",
  databaseURL: "https://spends-and-earns-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "spends-and-earns",
  storageBucket: "spends-and-earns.firebasestorage.app",
  messagingSenderId: "451945219976",
  appId: "1:451945219976:web:7d20c72eaa73fa1c9a1c3d",
  measurementId: "G-4Q12527WJS"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: '/' }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
