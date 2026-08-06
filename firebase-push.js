import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyAu_IiktVtl7VQRLowbdb0zJ_slOkVK_NA",
  authDomain: "nashdom-crm.firebaseapp.com",
  projectId: "nashdom-crm",
  storageBucket: "nashdom-crm.firebasestorage.app",
  messagingSenderId: "412290588017",
  appId: "1:412290588017:web:2fc4d1cb4d47ffd52c2ad0"
};

const VAPID_KEY = "BKsqdcd48X3HO3mmic7RxJjyShEnfK3SCXtaL2fXCNh9kaiHeyTWpJTMrGS0eeTRCcTUb7jNMeHUa7fKhxzjYoY";

const button = document.getElementById("pushButton");

function setButton(text, disabled, hidden) {
  if (!button) return;
  button.textContent = text;
  button.disabled = Boolean(disabled);
  button.style.display = hidden ? "none" : "";
}

function setPushStatus(enabled) {
  const icon = document.getElementById("pushStatusIcon");
  if (!icon) return;

  icon.textContent = enabled ? "🔔" : "🔕";
  icon.title = enabled ? "Уведомления включены" : "Уведомления выключены";
  icon.classList.toggle("enabled", Boolean(enabled));
}

async function enablePush() {
  try {
    const supported = await isSupported();

    if (!supported) {
      alert("На этом устройстве push-уведомления не поддерживаются.");
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      alert("Разрешение на уведомления не предоставлено.");
      return;
    }

    setButton("Подключаю…", true);

    const registration = await navigator.serviceWorker.ready;
    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      throw new Error("Не удалось получить FCM-токен");
    }

    apiCall(
      "registerPushToken",
      {
        token: token,
        deviceInfo: navigator.userAgent
      },
      function() {
        localStorage.setItem("nashdom_push_enabled", "1");
        setPushStatus(true);
        setButton("🔔 Уведомления включены", true, true);
      },
      function(error) {
        setPushStatus(false);
        setButton("🔔 Включить уведомления", false, false);
        alert("Ошибка регистрации уведомлений: " + error);
      }
    );

    onMessage(messaging, function(payload) {
      const notification = payload.notification || {};
      const title = notification.title || "Новая заявка";
      const body = notification.body || "";

      if (Notification.permission === "granted") {
        new Notification(title, {
          body: body,
          icon: "icon-192.png",
          tag: "foreground-resident-request"
        });
      }
    });

  } catch (error) {
    console.error(error);
    setPushStatus(false);
    setButton("🔔 Включить уведомления", false, false);
    alert("Не удалось включить уведомления: " + (error.message || error));
  }
}

if (button) {
  button.addEventListener("click", enablePush);

  const enabled =
    localStorage.getItem("nashdom_push_enabled") === "1" &&
    Notification.permission === "granted";

  setPushStatus(enabled);

  if (enabled) {
    setButton("🔔 Уведомления включены", true, true);
  } else {
    localStorage.removeItem("nashdom_push_enabled");
    setButton("🔔 Включить уведомления", false, false);
  }
}
