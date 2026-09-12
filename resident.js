const HOUSE_NAMES = {
  f2: 'Фонтанная 2',
  f5: 'Фонтанная 5',
  f8: 'Фонтанная 8',
  karp81: 'Карпинского 81',
  kron31: 'Кронштадская 31',
  kam5: 'Каменского 5',
  shk127: 'Шоссе Космонавтов 127',
  rev38: 'Революции 38',
  rev42: 'Революции 42',
  rev50: 'Революции 50',
  rev52: 'Революции 52',
  ek98: 'Екатерининская 98'
};

const params = new URLSearchParams(location.search);
const houseCode = String(params.get('h') || '').trim().toLowerCase();
const houseName = HOUSE_NAMES[houseCode];
const universalMode = !houseCode;

const houseBox = document.getElementById('residentHouse');
const errorBox = document.getElementById('residentError');
const form = document.getElementById('residentForm');
const successBox = document.getElementById('residentSuccess');
const submitButton = document.getElementById('residentSubmit');
const photoInput = document.getElementById('residentPhotos');
const photoList = document.getElementById('residentPhotoList');
const addressWrap = document.getElementById('residentAddressWrap');
const addressInput = document.getElementById('residentAddress');

if (universalMode) {
  houseBox.textContent = '🏠 Заявка по адресу';
  if (addressWrap) addressWrap.hidden = false;
  if (addressInput) addressInput.required = true;
  form.hidden = false;
} else if (!houseName) {
  houseBox.textContent = 'Ссылка недействительна';
  errorBox.textContent = 'Попросите у обслуживающей организации актуальную ссылку для вашего дома.';
  errorBox.style.display = 'block';
} else {
  houseBox.textContent = '🏠 ' + houseName;
  form.hidden = false;
}

function jsonp(action, payload) {
  return new Promise((resolve, reject) => {
    const callback = 'residentCallback_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');

    window[callback] = data => {
      delete window[callback];
      script.remove();

      if (!data || !data.ok) {
        reject(new Error((data && data.error) || 'Не удалось отправить заявку'));
        return;
      }

      resolve(data.result);
    };

    const url = new URL(API_URL);
    url.searchParams.set('api', '1');
    url.searchParams.set('action', action);
    url.searchParams.set('callback', callback);
    url.searchParams.set('payload', JSON.stringify(payload || {}));

    script.src = url.toString();
    script.onerror = () => {
      delete window[callback];
      script.remove();
      reject(new Error('Нет связи с сервером. Попробуйте ещё раз.'));
    };

    document.body.appendChild(script);
  });
}

function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

function selectedPhotos() {
  return Array.from((photoInput && photoInput.files) || []).slice(0, 5);
}

function renderPhotoList() {
  if (!photoList) return;
  const files = selectedPhotos();
  photoList.innerHTML = files.map((file, index) => `<div>📷 ${index + 1}. ${file.name}</div>`).join('');
  if (photoInput && photoInput.files && photoInput.files.length > 5) {
    photoList.innerHTML += '<div class="resident-photo-warning">Будут отправлены только первые 5 фотографий.</div>';
  }
}

if (photoInput) photoInput.addEventListener('change', renderPhotoList);

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.style.display = 'none';

  const houseAddress = universalMode && addressInput ? addressInput.value.trim() : '';
  if (universalMode && !houseAddress) {
    errorBox.textContent = 'Укажите адрес дома.';
    errorBox.style.display = 'block';
    if (addressInput) addressInput.focus();
    return;
  }

  const phone = normalizePhone(document.getElementById('residentPhone').value);
  if (phone.length !== 11 || !phone.startsWith('7')) {
    errorBox.textContent = 'Проверьте номер телефона.';
    errorBox.style.display = 'block';
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем заявку…';

  try {
    const result = await jsonp('submitResidentRequest', {
      houseCode,
      houseAddress,
      flat: document.getElementById('residentFlat').value.trim(),
      name: document.getElementById('residentName').value.trim(),
      phone: '+' + phone,
      category: document.getElementById('residentCategory').value,
      description: document.getElementById('residentDescription').value.trim(),
      isEmergency: document.getElementById('residentEmergency').checked
    });

    const photos = selectedPhotos();
    let photoErrors = 0;

    for (let i = 0; i < photos.length; i++) {
      submitButton.textContent = `Загружаем фото ${i + 1} из ${photos.length}…`;
      try {
        await uploadResidentPhoto(result.requestId, result.residentPhotoToken || '', photos[i]);
      } catch (error) {
        photoErrors++;
        console.error('Resident photo upload failed:', error);
      }
    }

    form.hidden = true;
    successBox.hidden = false;
    successBox.innerHTML = `
      <div class="success-icon">✓</div>
      <h1>Заявка отправлена</h1>
      <p>Номер заявки: <strong>${result.requestId}</strong></p>
      <p>Мы получили ваше обращение.</p>
      ${photos.length && !photoErrors ? `<p class="resident-photo-success">📷 Фотографий прикреплено: ${photos.length}</p>` : ''}
      ${photoErrors ? `<p class="resident-photo-warning">Заявка отправлена, но ${photoErrors === photos.length ? 'фотографии не загрузились' : `не загрузилось фотографий: ${photoErrors}`}. При необходимости отправьте ещё одну заявку с фото.</p>` : ''}
      <button type="button" onclick="location.reload()">Отправить ещё одну заявку</button>`;
  } catch (error) {
    errorBox.textContent = error.message || String(error);
    errorBox.style.display = 'block';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить заявку';
  }
});

function compressResidentPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Не удалось открыть фотографию'));
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.72), fileName: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function uploadResidentPhoto(requestId, residentPhotoToken, file) {
  return compressResidentPhoto(file).then(photo => new Promise((resolve, reject) => {
    const uploadId = 'resident_photo_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const iframe = document.createElement('iframe');
    iframe.name = uploadId;
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    const formEl = document.createElement('form');
    formEl.method = 'POST'; formEl.action = API_URL; formEl.target = uploadId; formEl.style.display = 'none';
    const values = { action:'uploadPhoto', uploadId, resident:'1', houseCode, residentPhotoToken, requestId, kind:'before', fileName:photo.fileName, dataUrl:photo.dataUrl };
    Object.entries(values).forEach(([name,value]) => { const input=document.createElement('input'); input.type='hidden'; input.name=name; input.value=value; formEl.appendChild(input); });
    document.body.appendChild(formEl);
    let timer;
    const onMessage = event => {
      const msg=event.data;
      if(!msg || msg.source!=='nashdom-photo-upload' || !msg.payload || msg.payload.uploadId!==uploadId) return;
      cleanup();
      msg.payload.ok ? resolve(msg.payload.result) : reject(new Error(msg.payload.error || 'Ошибка загрузки'));
    };
    const cleanup=()=>{ clearTimeout(timer); window.removeEventListener('message',onMessage); formEl.remove(); iframe.remove(); };
    window.addEventListener('message',onMessage);
    timer=setTimeout(()=>{cleanup();reject(new Error('Превышено время загрузки'));},90000);
    formEl.submit();
  }));
}
