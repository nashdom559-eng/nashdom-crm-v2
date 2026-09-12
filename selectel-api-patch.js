(function(){
  if (window.__nashdomSelectelApiV209) return;
  window.__nashdomSelectelApiV209 = true;

  const ENDPOINT = location.origin + '/api';

  function jsonpRequest(action, payload, token, onSuccess, onError) {
    const callbackName = 'nashdomSelectelCallback_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    script.id = callbackName;

    function cleanup() {
      delete window[callbackName];
      if (script.isConnected) script.remove();
    }

    window[callbackName] = function(response) {
      cleanup();
      if (!response || !response.ok) {
        const message = response && response.error ? response.error : 'Неизвестная ошибка сервера';
        if (message === 'Доступ запрещён' && typeof localStorage !== 'undefined') {
          try { localStorage.removeItem('nashdom_api_access_key'); } catch (e) {}
        }
        if (onError) onError(message);
        return;
      }
      if (onSuccess) onSuccess(response.result);
    };

    const url = new URL(ENDPOINT);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('t', Date.now());
    if (token) url.searchParams.set('token', token);
    if (payload) url.searchParams.set('payload', JSON.stringify(payload));

    script.src = url.toString();
    script.onerror = function() {
      cleanup();
      if (onError) onError('Не удалось подключиться к серверу');
    };
    document.body.appendChild(script);
  }

  if (typeof window.getAccessKey === 'function' || typeof window.apiCall === 'function') {
    window.apiCall = function(action, payload, onSuccess, onError) {
      let token = '';
      try { token = typeof getAccessKey === 'function' ? getAccessKey() : ''; } catch (e) {}
      jsonpRequest(action, payload, token, onSuccess, function(message) {
        if (message === 'Доступ запрещён') {
          try { localStorage.removeItem('nashdom_api_access_key'); } catch (e) {}
          alert('Неверный ключ доступа. Введите новый ключ Selectel.');
          location.reload();
          return;
        }
        if (onError) onError(message);
      });
    };

    window.uploadPhotoPayload = function(payload, expectedCount) {
      return new Promise(function(resolve, reject) {
        const uploadId = 'photo_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        const iframe = document.createElement('iframe');
        iframe.name = uploadId;
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = ENDPOINT;
        form.target = uploadId;
        form.style.display = 'none';

        const values = Object.assign({}, payload, { action:'uploadPhoto', uploadId });
        Object.keys(values).forEach(function(key) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = values[key] == null ? '' : String(values[key]);
          form.appendChild(input);
        });
        document.body.appendChild(form);

        let finished = false;
        let timer;
        function cleanup(){ clearTimeout(timer); window.removeEventListener('message', onMessage); if(form.isConnected)form.remove(); if(iframe.isConnected)iframe.remove(); }
        function ok(result){ if(finished)return; finished=true; cleanup(); resolve(result || {confirmed:true}); }
        function fail(error){ if(finished)return; finished=true; cleanup(); reject(error); }
        function onMessage(event){
          const msg = event.data;
          if(!msg || msg.source!=='nashdom-photo-upload' || !msg.payload || msg.payload.uploadId!==uploadId) return;
          msg.payload.ok ? ok(msg.payload.result) : fail(new Error(msg.payload.error || 'Ошибка загрузки фото'));
        }
        window.addEventListener('message', onMessage);

        if (typeof waitForPhotoConfirmation === 'function') {
          waitForPhotoConfirmation({rowNumber:payload.rowNumber,requestId:payload.requestId,kind:payload.kind,expectedCount})
            .then(ok).catch(function(){});
        }
        timer = setTimeout(function(){ fail(new Error('Превышено время загрузки фото')); }, 90000);
        form.submit();
      });
    };

    const oldGetFullPhotoUrl = window.getFullPhotoUrl;
    window.getFullPhotoUrl = function(photo) {
      if (photo && photo.local) {
        const value = String(photo.url || photo.thumb || '');
        if (!value) return '';
        return value.startsWith('http') ? value : location.origin + (value.startsWith('/') ? value : '/' + value);
      }
      return typeof oldGetFullPhotoUrl === 'function' ? oldGetFullPhotoUrl(photo) : String((photo && (photo.thumb || photo.url)) || '');
    };

    // Новые заявки жителей раньше не показывали photosBefore, хотя фото уже
    // сохранялись на сервере. Добавляем ту же галерею прямо во входящую карточку.
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

      try { window.renderResidentInbox(); } catch (e) {}
    }

    document.addEventListener('DOMContentLoaded', function(){
      const subtitle = document.querySelector('.subtitle');
      if (subtitle) {
        Array.from(subtitle.childNodes).forEach(function(node){
          if(node.nodeType===Node.TEXT_NODE) node.nodeValue = node.nodeValue.replace(/v2\.0\.[0-9]+/,'v2.0.9');
        });
      }
    });
  }

  if (document.getElementById('residentForm')) {
    const residentHouseCode = String(new URLSearchParams(location.search).get('h') || '').trim().toLowerCase();

    window.jsonp = function(action, payload) {
      return new Promise(function(resolve, reject){
        jsonpRequest(action, payload, '', resolve, function(error){ reject(new Error(error || 'Не удалось отправить заявку')); });
      });
    };

    if (typeof window.compressResidentPhoto === 'function') {
      window.uploadResidentPhoto = function(requestId, file) {
        return compressResidentPhoto(file).then(function(photo){
          return new Promise(function(resolve, reject){
            const uploadId='resident_photo_'+Date.now()+'_'+Math.floor(Math.random()*100000);
            const iframe=document.createElement('iframe'); iframe.name=uploadId; iframe.style.display='none'; document.body.appendChild(iframe);
            const form=document.createElement('form'); form.method='POST'; form.action=ENDPOINT; form.target=uploadId; form.style.display='none';
            const values={action:'uploadPhoto',uploadId,resident:'1',houseCode:residentHouseCode,requestId,kind:'before',fileName:photo.fileName,dataUrl:photo.dataUrl};
            Object.entries(values).forEach(function(entry){ const input=document.createElement('input'); input.type='hidden'; input.name=entry[0]; input.value=entry[1]; form.appendChild(input); });
            document.body.appendChild(form);
            let timer;
            function cleanup(){clearTimeout(timer);window.removeEventListener('message',onMessage);if(form.isConnected)form.remove();if(iframe.isConnected)iframe.remove();}
            function onMessage(event){const msg=event.data;if(!msg||msg.source!=='nashdom-photo-upload'||!msg.payload||msg.payload.uploadId!==uploadId)return;cleanup();msg.payload.ok?resolve(msg.payload.result):reject(new Error(msg.payload.error||'Ошибка загрузки'));}
            window.addEventListener('message',onMessage);
            timer=setTimeout(function(){cleanup();reject(new Error('Превышено время загрузки'));},90000);
            form.submit();
          });
        });
      };
    }
  }
})();
