importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBco9DWpSv0xnsQHwBaX3WYhQGeojUwwMg",
  authDomain: "spendsearnstracker.firebaseapp.com",
  projectId: "spendsearnstracker",
  storageBucket: "spendsearnstracker.firebasestorage.app",
  messagingSenderId: "245370711942",
  appId: "1:245370711942:web:b227f5e139b7deee5e0607"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
