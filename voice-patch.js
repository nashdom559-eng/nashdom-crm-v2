// v2.0.5 — длинная диктовка заявки до ручной остановки.
// Chrome/Android иногда сам завершает одну сессию распознавания после паузы,
// поэтому при активной кнопке мы тихо запускаем следующую и продолжаем текст.
(function () {
  let recognition = null;
  let keepListening = false;
  let restarting = false;
  let sessionBase = '';

  function RecognitionClass() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function status(text, isError) {
    if (typeof window.setVoiceStatus === 'function') {
      window.setVoiceStatus(text || '', Boolean(isError));
    }
  }

  function buttonState(listening) {
    const button = document.getElementById('voiceBtn');
    if (!button) return;
    button.classList.toggle('listening', Boolean(listening));
    button.textContent = listening ? '⏹ Остановить' : '🎙 Говорить';
  }

  function currentText() {
    const field = document.getElementById('description');
    return field ? field.value.trim() : '';
  }

  function setText(text) {
    const field = document.getElementById('description');
    if (field) field.value = text;
  }

  function startSession() {
    if (!keepListening || !recognition || restarting) return;
    restarting = true;
    sessionBase = currentText();
    window.setTimeout(function () {
      try {
        recognition.start();
      } catch (error) {
        restarting = false;
        if (keepListening) window.setTimeout(startSession, 350);
      }
    }, 120);
  }

  function setupLongRecognition() {
    const Recognition = RecognitionClass();
    const button = document.getElementById('voiceBtn');
    if (!button || !Recognition) return false;

    recognition = new Recognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      restarting = false;
      buttonState(true);
      status('Слушаю… говори сколько нужно. Когда закончишь — нажми «Остановить».');
    };

    recognition.onresult = function (event) {
      let finalText = '';
      let interimText = '';

      // Берём всю текущую сессию, а не только последний кусок — так текст
      // не пропадает после коротких пауз между фразами.
      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0].transcript || '';
        if (event.results[i].isFinal) finalText += text + ' ';
        else interimText += text;
      }

      const spoken = (finalText + interimText).trim();
      const separator = sessionBase && spoken ? ' ' : '';
      setText(sessionBase + separator + spoken);
    };

    recognition.onerror = function (event) {
      restarting = false;

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        keepListening = false;
        buttonState(false);
        status('Нет доступа к микрофону. Разреши микрофон для приложения.', true);
        return;
      }

      // no-speech на Android часто означает просто длинную паузу. Не считаем
      // это завершением диктовки: onend запустит следующую сессию.
      if (event.error === 'no-speech') {
        status('Слушаю… можно продолжать.');
        return;
      }

      if (event.error === 'network' || event.error === 'audio-capture') {
        keepListening = false;
        buttonState(false);
        status('Голосовой ввод остановлен: ' + event.error, true);
        return;
      }
    };

    recognition.onend = function () {
      restarting = false;
      if (keepListening) {
        // Chrome может сам закрыть распознавание после паузы. Сохраняем уже
        // набранный текст и продолжаем новой сессией автоматически.
        sessionBase = currentText();
        startSession();
      } else {
        buttonState(false);
        status(currentText() ? 'Готово. Текст можно поправить вручную.' : '');
      }
    };

    return true;
  }

  window.setupVoiceInput = function () {
    const button = document.getElementById('voiceBtn');
    const Recognition = RecognitionClass();
    if (!button) return;
    if (!Recognition) {
      button.disabled = true;
      button.textContent = '🎙 Голос недоступен';
      status('На этом устройстве браузерный голосовой ввод не поддерживается.', true);
      return;
    }
    if (!recognition) setupLongRecognition();
  };

  window.toggleVoiceInput = function () {
    if (!recognition && !setupLongRecognition()) return;

    if (keepListening) {
      keepListening = false;
      try { recognition.stop(); } catch (error) {}
      buttonState(false);
      status(currentText() ? 'Готово. Текст можно поправить вручную.' : '');
      return;
    }

    keepListening = true;
    sessionBase = currentText();
    buttonState(true);
    status('Запускаю микрофон…');
    startSession();
  };

  // Если основной app.js уже успел настроить старый обработчик — новая
  // глобальная функция всё равно будет вызвана inline-кнопкой onclick.
  window.setTimeout(function () {
    window.setupVoiceInput();
  }, 0);
})();
