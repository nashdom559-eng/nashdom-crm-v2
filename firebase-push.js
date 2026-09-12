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

    setButton("Подключаю…", true, false);

    const registration = await navigator.serviceWorker.register(
      "./firebase-messaging-sw.js",
      { scope: "./firebase-push-scope/" }
    );

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
    "Notification" in window &&
    Notification.permission === "granted";

  setPushStatus(enabled);

  if (enabled) {
    // Уведомления уже включены: при обычном старте ничего не
    // регистрируем заново и не запрашиваем FCM-токен повторно.
    setButton("🔔 Уведомления включены", true, true);
  } else {
    localStorage.removeItem("nashdom_push_enabled");
    setButton("🔔 Включить уведомления", false, false);
  }
}

// Входящие заявки жителей раньше не выводили уже загруженные фотографии,
// хотя сервер сохранял их в photosBefore. Переопределяем только отрисовку
// входящих: после принятия заявки используется обычная карточка CRM.
if (typeof window.renderResidentInbox === 'function') {
  window.renderResidentInbox = function() {
    const box = document.getElementById('residentInbox');
    if (!box || !CRM || !CRM.data) return;

    const items = CRM.data.residentRequests || [];
    if (!items.length) {
      box.innerHTML = '';
      return;
    }

    box.innerHTML = `
      <div class="resident-inbox">
        <div class="resident-inbox-title">📨 Новые от жителей <span>${items.length}</span></div>
        <div class="resident-inbox-list">
          ${items.map(req => `
            <div class="resident-request-card">
              <div class="resident-request-top">
                <strong>${escapeHtml(req.house || '')}, кв. ${escapeHtml(req.flat || '—')}</strong>
                ${req.isEmergency ? '<span class="resident-emergency">🚨 Житель отметил как аварийную</span>' : ''}
              </div>
              ${req.priority ? `<div class="resident-category">🔧 ${escapeHtml(req.priority)}</div>` : ''}
              <div class="resident-person">${escapeHtml(req.name || '')}</div>
              ${req.phone ? `<a class="phone-link" href="tel:${phoneForCall(req.phone)}">${escapeHtml(req.phone)}</a>` : ''}
              <div class="resident-description">${escapeHtml(req.description || '')}</div>
              ${renderPhotoGallery(req.photosBefore || [], '📷 От жителя', req.rowNumber, 'before')}
              <div class="resident-actions">
                <button type="button" onclick="acceptResidentRequestUi(${Number(req.rowNumber)}, false)">✅ Принять</button>
                <button type="button" class="resident-emergency-btn" onclick="acceptResidentRequestUi(${Number(req.rowNumber)}, true)">🚨 Как аварийную</button>
                <button type="button" class="dispatch-inbox-btn" onclick="acceptAndDispatchResident(${Number(req.rowNumber)})">👷 Принять и передать</button>
                <button type="button" class="resident-reject-btn" onclick="rejectResidentRequestUi(${Number(req.rowNumber)})">Отклонить</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  };

  window.renderResidentInbox();
}
