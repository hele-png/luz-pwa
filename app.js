/* Luz — asistente visual por voz con IA (Gemini) para personas ciegas o con baja visión. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const micBtn = $('#mic'), micText = $('#mic-text'), statusEl = $('#status'), alertEl = $('#alert'), chip = $('#state-chip');
  const camWrap = $('#camera-wrap'), video = $('#camera'), navPanel = $('#nav-panel'), navNext = $('#nav-next');
  const cmdInput = $('#cmd-input'), dlg = $('#settings');
  const rateEl = $('#rate'), voiceOnEl = $('#voice-on'), vibOnEl = $('#vibrate-on'), fastSrEl = $('#fast-sr'), keyEl = $('#api-key');

  const VISION_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash']; // lite: ~1-3 s; flash como respaldo
  const INTENT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash']; // reintento: la latencia a veces se dispara
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

  // ---------- Ajustes ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('luz.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('luz.' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('luz.' + k); } catch {} }
  };
  rateEl.value = store.get('rate', 1);
  voiceOnEl.checked = store.get('voiceOn', true);
  vibOnEl.checked = store.get('vibrate', true);
  fastSrEl.checked = store.get('fastSR', false);
  const rateText = (r) => r < 0.85 ? 'Lenta' : r > 1.15 ? 'Rápida' : 'Normal';
  const syncRate = () => rateEl.setAttribute('aria-valuetext', rateText(+rateEl.value));
  syncRate();
  rateEl.addEventListener('input', () => { store.set('rate', +rateEl.value); syncRate(); });
  rateEl.addEventListener('change', () => say('Así suena esta velocidad.'));
  voiceOnEl.addEventListener('change', () => { store.set('voiceOn', voiceOnEl.checked); syncLive();
    say(voiceOnEl.checked ? 'Voz de Luz activada.' : 'Voz de Luz desactivada. VoiceOver leerá las respuestas.'); });
  vibOnEl.addEventListener('change', () => { store.set('vibrate', vibOnEl.checked); buzz([60]); });
  fastSrEl.addEventListener('change', () => store.set('fastSR', fastSrEl.checked));

  // ---------- Clave ----------
  function builtinKey() {
    try { const p = window.__LUZ_K; if (!p) return ''; return atob(p.slice().reverse().join('')).split('').reverse().join(''); } catch { return ''; }
  }
  const apiKey = () => store.get('apiKey', '') || builtinKey();
  $('#key-save').addEventListener('click', () => {
    const v = keyEl.value.trim(); if (!v) return say('Escribe o pega primero la clave.');
    store.set('apiKey', v); keyEl.value = ''; say('Clave guardada en este móvil.');
  });
  $('#key-reset').addEventListener('click', () => { store.del('apiKey'); keyEl.value = ''; say('Usaré la clave incluida.'); });

  // ---------- Voz de salida ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice = null, lastSpoken = '', turn = 0, ttsWorks = !!synth;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    const pool = vs.filter(v => /^es[-_]ES/i.test(v.lang)).length ? vs.filter(v => /^es[-_]ES/i.test(v.lang)) : vs.filter(v => /^es/i.test(v.lang));
    voice = pool.find(v => /premium|enhanced|mejorad|neural|natural/i.test(v.name)) ||
            pool.find(v => /m[oó]nica|marisol|jorge|google espa/i.test(v.name)) || pool[0] || null;
  }
  if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }
  const useTTS = () => voiceOnEl.checked && ttsWorks;
  // Con la voz de Luz activa, el estado no se autoanuncia (evita que VoiceOver y Luz hablen a la vez).
  function syncLive() { statusEl.setAttribute('aria-live', useTTS() ? 'off' : 'polite'); }
  syncLive();
  const clean = (t) => String(t || '').replace(/[*_#`>]+/g, '').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' ').trim();
  const sentences = (t) => t.match(/[^.!?…]+[.!?…]*/g)?.map(s => s.trim()).filter(Boolean) || [t];

  function say(text, { onend, assertive = false, remember = true } = {}) {
    text = clean(text);
    if (remember) lastSpoken = text;
    statusEl.textContent = text;
    stopTicker();
    const my = ++turn;
    if (!useTTS()) {
      if (assertive) { alertEl.textContent = ''; setTimeout(() => alertEl.textContent = text, 60); }
      setState('idle');
      if (onend) setTimeout(() => my === turn && onend(), Math.min(9000, 800 + text.length * 50));
      return;
    }
    synth.cancel();
    setState('speaking');
    let started = false;
    const parts = sentences(text);
    const watchdog = setTimeout(() => { if (!started && my === turn) {
      ttsWorks = false; syncLive(); statusEl.textContent = ''; setTimeout(() => statusEl.textContent = text, 60);
      setState('idle'); onend && onend(); } }, 3000);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'es-ES'; if (voice) u.voice = voice; u.rate = +rateEl.value;
      u.onstart = () => { started = true; clearTimeout(watchdog); };
      if (i === parts.length - 1) u.onend = () => { if (my === turn) { setState('idle'); onend && onend(); } };
      setTimeout(() => { if (my === turn) synth.speak(u); }, 50);
    });
  }
  function shutUp() { turn++; synth && synth.cancel(); stopTicker(); if (state === 'speaking') setState('idle'); }

  // ---------- Audio: desbloqueo, tonos, vibración ----------
  let audioCtx = null, unlocked = false;
  function unlock() {
    if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    audioCtx?.resume?.();
    if (unlocked) return; unlocked = true;
    if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); pickVoice(); }
  }
  function tone(freqs, dur = 0.12, vol = 0.22) {
    if (!audioCtx) return; let t = audioCtx.currentTime;
    freqs.forEach(f => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.03); t += dur * 0.9;
    });
  }
  const earcon = { listen: () => tone([660, 990]), stop: () => tone([990, 620]), tick: () => tone([520], 0.07, 0.08), error: () => tone([330, 220], 0.2), done: () => tone([784], 0.1, 0.12) };
  function buzz(p) { if (vibOnEl.checked && navigator.vibrate) try { navigator.vibrate(p); } catch {} }
  let tickTimer = null;
  function startTicker() { stopTicker(); tickTimer = setInterval(() => earcon.tick(), 1400); }
  function stopTicker() { clearInterval(tickTimer); tickTimer = null; }

  // ---------- Estado visual ----------
  const CHIP = { idle: 'Lista', listening: 'Escuchando', thinking: 'Pensando', speaking: 'Hablando', error: 'Aviso' };
  const MICT = { idle: 'Toca y habla', listening: 'Te escucho… toca para terminar', thinking: 'Un momento…', speaking: 'Toca para hablar', error: 'Toca y habla' };
  let state = 'idle';
  function setState(s) { state = s; micBtn.dataset.state = s; chip.dataset.state = s; chip.textContent = CHIP[s]; micText.textContent = MICT[s]; }

  // ---------- Errores ----------
  class LuzError extends Error { constructor(kind, msg) { super(msg || kind); this.kind = kind; } }
  const ERR_MSG = {
    nokey: 'Falta la clave de la IA. Ábrela en Ajustes y pega una clave de Gemini.',
    key: 'La clave de la IA no funciona. En Ajustes puedes pegar una clave nueva de Gemini.',
    quota: 'He llegado al límite de uso de la IA por ahora. Espera un minuto y vuelve a intentarlo.',
    busy: 'El servicio de IA está saturado. Inténtalo de nuevo en unos segundos.',
    timeout: 'La IA está tardando demasiado. Inténtalo otra vez o revisa la conexión.',
    offline: 'No hay conexión a internet. Luz necesita internet para ver y entender.',
    empty: 'No he podido sacar una respuesta. Prueba otra vez.',
    camera: 'No puedo usar la cámara. Revisa que Luz o Safari tengan permiso de cámara en los Ajustes del iPhone.',
    mic: 'No puedo usar el micrófono. Revisa el permiso de micrófono en los Ajustes del iPhone. Mientras, puedes escribir o dictar con el teclado en el campo de abajo.',
    location: 'No puedo saber dónde estás. Activa la localización para Safari en los Ajustes del iPhone, en Privacidad, Localización, y vuelve a intentarlo.',
    cancel: ''
  };
  function fail(e) {
    if (e?.kind === 'cancel' || e?.name === 'AbortError' && !e.kind) return;
    console.warn('Luz', e);
    earcon.error(); buzz([90, 60, 90]); setState('error');
    say(ERR_MSG[e?.kind] || 'Algo ha fallado. Inténtalo otra vez.', { assertive: true });
  }

  // ---------- Gemini ----------
  let op = null; // operación en curso (AbortController)
  function newOp() { op?.abort(); op = new AbortController(); return op.signal; }

  async function gemini(models, parts, { system, json, schema, maxTokens = 500, timeout = 15000, signal } = {}) {
    const key = apiKey(); if (!key) throw new LuzError('nokey');
    if (!navigator.onLine) throw new LuzError('offline');
    let last;
    for (const [mi, model] of models.entries()) {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), mi === 0 ? timeout : timeout * 1.3);
      const onAbort = () => ctrl.abort(); signal?.addEventListener('abort', onAbort);
      try {
        const body = { contents: [{ role: 'user', parts }],
          generationConfig: { temperature: json ? 0 : 0.3, maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'minimal' } } };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        if (json) { body.generationConfig.responseMimeType = 'application/json'; if (schema) body.generationConfig.responseSchema = schema; }
        const res = await fetch(API + model + ':generateContent', { method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          if (res.status === 400 && /API_KEY|api key/i.test(t) || res.status === 401 || res.status === 403) throw new LuzError('key');
          last = new LuzError(res.status === 429 ? 'quota' : res.status >= 500 ? 'busy' : 'empty', t.slice(0, 200));
          continue; // probar el siguiente modelo
        }
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (!text) { last = new LuzError('empty'); continue; }
        return text;
      } catch (e) {
        if (e.kind === 'key') throw e;
        if (signal?.aborted) throw new LuzError('cancel');
        last = e.name === 'AbortError' ? new LuzError('timeout') : (e instanceof LuzError ? e : new LuzError(navigator.onLine ? 'busy' : 'offline'));
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    }
    throw last || new LuzError('empty');
  }
  const blobToB64 = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });

  // ---------- Prompts ----------
  const BASE = 'Eres Luz, los ojos de una persona ciega o con muy poca visión. Hablas en español de España, con frases cortas, claras y tranquilas, pensadas para ser escuchadas: sin markdown, sin listas, sin emojis, sin símbolos. No inventes nada: si algo no se ve bien, dilo. La foto la ha hecho la propia persona con la cámara trasera del móvil, sostenido más o menos a la altura del pecho. Si la foto está oscura, borrosa o mal encuadrada, dilo en una frase y explica cómo mover el móvil (más arriba, más lejos, gira a la izquierda...).';
  const SYS = {
    describe: BASE + ' Tarea: describe lo que hay delante. Empieza por lo importante para moverse con seguridad: obstáculos, escalones, bordillos, desniveles, puertas, coches, semáforos y su color, personas cerca. Luego lo demás relevante. Usa posiciones como «justo delante», «a tu izquierda», «a tu derecha» o las horas del reloj, y distancias aproximadas en metros o pasos. Máximo 60 palabras.',
    read: BASE + ' Tarea: lee el texto que se ve. Primero di en pocas palabras qué es (carta, etiqueta, menú, cartel, pantalla...). Después léelo tal cual, palabra por palabra, en orden natural de lectura, sin resumir. Lee con claridad fechas de caducidad, precios, dosis, horarios y teléfonos. Si una parte está cortada o no se lee, dilo y explica cómo mover el móvil. Si no hay texto, dilo.',
    identify: BASE + ' Tarea: identifica el objeto principal que la persona sostiene o enfoca: qué es, marca y producto si se ve, cantidad o tamaño, color. Billetes y monedas: valor y moneda. Medicamentos: nombre y dosis. Ropa: tipo, color y estampado. Alimentos: qué es y si se ve, la fecha de caducidad. Máximo 40 palabras.',
    ask: BASE + ' Tarea: responde a la pregunta de la persona sobre lo que se ve en la foto, de forma directa y breve, en máximo 45 palabras. Si la foto no permite responder, dilo y explica cómo encuadrar mejor.'
  };
  const PROMPT = { describe: '¿Qué hay delante de mí?', read: 'Léeme el texto.', identify: '¿Qué es esto?' };

  const INTENT_SYS = 'Eres el oído de Luz, una app por voz para personas ciegas. Recibes una orden corta en español (audio o texto). Transcribe lo que dice y clasifícalo. Devuelve solo JSON.\n' +
    'intent: describe (qué hay delante, describe el entorno, qué ves), read (lee esto, qué pone, léeme la carta o la etiqueta), identify (qué es esto, qué billete es, qué tengo en la mano), ' +
    'ask (cualquier otra pregunta sobre lo que enfoca la cámara: color, caducidad, precio, si hay algo, cuántos hay... pon la pregunta completa en question), ' +
    'navigate (quiere ir a un sitio: destination = el sitio tal como lo dice, p. ej. «la farmacia más cercana»; place_query = término corto para buscar en un mapa, p. ej. «farmacia», o la dirección o nombre propio), ' +
    'where (dónde estoy, en qué calle estoy), next (siguiente, ya, continúa), repeat (repite, qué has dicho), stop (para, calla, silencio), end_route (termina o cancela la ruta), help (ayuda, qué puedes hacer), slower (más despacio), faster (más rápido), ' +
    'none (silencio, ruido o no se entiende). Si dudas entre describe y ask, usa ask solo si hay una pregunta concreta.';
  const INTENT_SCHEMA = { type: 'OBJECT', properties: {
    transcript: { type: 'STRING' },
    intent: { type: 'STRING', enum: ['describe', 'read', 'identify', 'ask', 'navigate', 'where', 'next', 'repeat', 'stop', 'end_route', 'help', 'slower', 'faster', 'none'] },
    destination: { type: 'STRING' }, place_query: { type: 'STRING' }, question: { type: 'STRING' } }, required: ['transcript', 'intent'] };

  // Órdenes escritas claras: se resuelven al instante sin IA
  function localIntent(raw) {
    const t = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim();
    const w = t.split(' ').length, I = (intent, extra) => ({ transcript: raw, intent, ...extra });
    if (w <= 3 && /^(para|parar|silencio|calla|callate|stop|basta)$/.test(t)) return I('stop');
    if (w <= 3 && /^(ayuda|que puedes hacer)$/.test(t)) return I('help');
    if (w <= 3 && /^(repite|repitelo|otra vez)$/.test(t)) return I('repeat');
    if (w <= 2 && /^(siguiente|sigue|continua)$/.test(t)) return I('next');
    if (/^(terminar|termina|cancelar|cancela) (la )?ruta$/.test(t)) return I('end_route');
    if (/^(donde estoy|en que calle estoy)$/.test(t)) return I('where');
    if (/^(que hay delante|describe lo que hay delante|que ves|describe)$/.test(t)) return I('describe');
    if (/^(lee esto|leer|leeme esto|lee el texto|que pone)$/.test(t)) return I('read');
    if (/^(que es esto|que es eso|que tengo en la mano)$/.test(t)) return I('identify');
    const m = raw.match(/^\s*(ll[eé]vame|quiero ir|c[oó]mo (llego|voy)|g[uú][ií]ame)\s+(a|al|hasta|hacia)\s+(.+?)[.?!]*\s*$/i);
    if (m) { const dest = (m[3].toLowerCase() === 'al' ? 'el ' : '') + m[4]; return I('navigate', { destination: dest, place_query: cleanQuery(dest) }); }
    return null;
  }

  async function understand({ blob, text, context }, signal) {
    if (text && !context) { const li = localIntent(text); if (li) return li; }
    const parts = [];
    if (blob) parts.push({ inlineData: { mimeType: (blob.type || 'audio/mp4').split(';')[0], data: await blobToB64(blob) } });
    if (text) parts.push({ text: 'Orden escrita: ' + text });
    if (context) parts.push({ text: 'Contexto: ' + context });
    const out = await gemini(INTENT_MODELS, parts, { system: INTENT_SYS, json: true, schema: INTENT_SCHEMA, maxTokens: 300, timeout: 9000, signal });
    try { return JSON.parse(out); } catch { const m = out.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new LuzError('empty'); }
  }

  // ---------- Micrófono: grabación con detección de silencio ----------
  let micStream = null, micRelease = null, recording = null;
  async function getMic() {
    clearTimeout(micRelease);
    if (micStream && micStream.getAudioTracks().some(t => t.readyState === 'live')) return micStream;
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { throw new LuzError('mic'); }
    return micStream;
  }
  function releaseMicLater() { clearTimeout(micRelease); micRelease = setTimeout(() => { micStream?.getTracks().forEach(t => t.stop()); micStream = null; }, 30000); }

  function record() {
    return new Promise(async (resolve, reject) => {
      let stream; try { stream = await getMic(); } catch (e) { return reject(e); }
      if (!window.MediaRecorder) return reject(new LuzError('mic'));
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
      let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch { mr = new MediaRecorder(stream); }
      const chunks = []; let spoke = false, timer = null, src = null;
      const t0 = performance.now(); let lastVoice = t0, floor = 0.01, n = 0;
      mr.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        clearInterval(timer); try { src?.disconnect(); } catch {}
        recording = null; releaseMicLater();
        resolve({ blob: new Blob(chunks, { type: mr.mimeType || mime || 'audio/mp4' }), spoke, manual: stopReason === 'manual', ms: performance.now() - t0 });
      };
      let stopReason = '';
      const stop = (why) => { if (mr.state !== 'inactive') { stopReason = why; mr.stop(); } };
      recording = { stop };
      // Detector de voz sencillo con WebAudio
      try {
        unlock(); src = audioCtx.createMediaStreamSource(stream);
        const an = audioCtx.createAnalyser(); an.fftSize = 1024; src.connect(an);
        const buf = new Float32Array(an.fftSize);
        timer = setInterval(() => {
          an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const rms = Math.sqrt(s / buf.length);
          const now = performance.now();
          if (now - t0 < 350) { floor = (floor * n + rms) / (++n); return; }
          if (rms > Math.max(0.015, floor * 2.6)) { spoke = true; lastVoice = now; }
          if (spoke && now - lastVoice > 1500) stop('silence');
          else if (!spoke && now - t0 > 7000) stop('nospeech');
          else if (now - t0 > 15000) stop('max');
        }, 60);
      } catch { setTimeout(() => stop('max'), 6000); spoke = true; }
      mr.start(250);
    });
  }

  // Reconocimiento del navegador (opcional, más rápido si funciona)
  function browserSR() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Promise.reject(new Error('nosr'));
    return new Promise((ok, ko) => {
      const r = new SR(); r.lang = 'es-ES'; r.interimResults = true; r.continuous = false; let done = false;
      recording = { stop: () => { try { r.stop(); } catch {} } };
      r.onresult = (e) => { let fin = '', tmp = ''; for (const x of e.results) x.isFinal ? fin += x[0].transcript : tmp += x[0].transcript;
        if (tmp) statusEl.textContent = '«' + tmp + '»'; if (fin && !done) { done = true; ok(fin); } };
      r.onerror = (e) => { if (!done) { done = true; ko(e); } };
      r.onend = () => { recording = null; if (!done) { done = true; ko(new Error('nospeech')); } };
      try { r.start(); } catch (e) { ko(e); }
    });
  }

  let pendingContext = null; // p. ej. esperando destino
  async function listen() {
    shutUp(); const signal = newOp();
    setState('listening'); statusEl.textContent = 'Te escucho…'; earcon.listen(); buzz([40]);
    await new Promise(r => setTimeout(r, 220)); // que el tono no entre en la grabación
    const context = pendingContext; pendingContext = null;
    try {
      if (fastSrEl.checked) {
        try { const t = await browserSR(); setState('thinking'); return await run(await understand({ text: t, context }, signal), signal); }
        catch { if (signal.aborted) return; }
      }
      const rec = await record();
      if (signal.aborted) return;
      earcon.stop();
      if (!rec.spoke && !rec.manual) { setState('idle'); return say('No te he oído. Toca el botón y vuelve a intentarlo.'); }
      setState('thinking'); statusEl.textContent = 'Entendiendo…'; startTicker();
      const it = await understand({ blob: rec.blob, context }, signal);
      if (signal.aborted) return;
      await run(it, signal);
    } catch (e) { if (!signal.aborted) fail(e); else setState('idle'); }
  }

  // ---------- Acciones ----------
  async function run(it, signal = newOp()) {
    stopTicker();
    const intent = it.intent || 'none';
    if (it.transcript) statusEl.textContent = '«' + it.transcript + '»';
    switch (intent) {
      case 'describe': case 'read': case 'identify': return look(intent, null, signal);
      case 'ask': return look('ask', it.question || it.transcript, signal);
      case 'navigate': return (it.destination || it.place_query) ? navigateTo(it.destination || it.place_query, it.place_query, signal) : askDestination();
      case 'where': return whereAmI(signal);
      case 'next': return route ? advance(true) : say('No hay ninguna ruta activa. Di, por ejemplo: llévame a la farmacia.');
      case 'repeat': return say(lastSpoken || 'Aún no he dicho nada.', { remember: !!lastSpoken });
      case 'stop': shutUp(); setState('idle'); statusEl.textContent = 'En silencio.'; return;
      case 'end_route': return endRoute();
      case 'help': return help();
      case 'slower': rateEl.value = Math.max(0.6, +rateEl.value - 0.15).toFixed(2); store.set('rate', +rateEl.value); syncRate(); return say('Vale, hablo más despacio.');
      case 'faster': rateEl.value = Math.min(1.4, +rateEl.value + 0.15).toFixed(2); store.set('rate', +rateEl.value); syncRate(); return say('Vale, hablo más rápido.');
      default: earcon.error();
        return say(it.transcript ? 'He oído: «' + it.transcript + '», pero no sé qué hacer con eso. Prueba con: qué hay delante, lee esto, qué es esto, o llévame a un sitio.' : 'No te he entendido. Toca el botón y vuelve a intentarlo.');
    }
  }

  function help() {
    say('Toca el botón grande, espera el tono y habla. Cuando termines, calla un momento o vuelve a tocar. ' +
      'Puedes decir: «qué hay delante», y te describo lo que ve la cámara. «Lee esto», y leo el texto que enfoques. ' +
      '«Qué es esto», para saber qué objeto, producto o billete tienes. También puedes preguntar lo que quieras, como «de qué color es esta camisa» o «cuándo caduca». ' +
      '«Llévame a», y el sitio, por ejemplo «llévame a la farmacia más cercana», y te guío paso a paso por la calle. «Dónde estoy», para saber la calle. ' +
      'Y también «repite», «para», «más despacio» o «más rápido». Sujeta el móvil a la altura del pecho, con la cámara de atrás mirando hacia delante.');
  }

  // ---------- Cámara + visión ----------
  let camStream = null, camRelease = null;
  async function ensureCamera() {
    clearTimeout(camRelease);
    if (camStream && camStream.getVideoTracks().some(t => t.readyState === 'live')) return true;
    if (!navigator.mediaDevices?.getUserMedia) throw new LuzError('camera');
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
    catch { throw new LuzError('camera'); }
    video.srcObject = camStream; camWrap.hidden = false;
    await video.play().catch(() => {});
    await new Promise(r => { if (video.readyState >= 2 && video.videoWidth) r(); else video.onloadeddata = () => r(); setTimeout(r, 2500); });
    await new Promise(r => setTimeout(r, 700)); // dejar que ajuste exposición y enfoque
    return true;
  }
  function releaseCameraLater() { clearTimeout(camRelease); camRelease = setTimeout(stopCamera, 60000); }
  function stopCamera() { clearTimeout(camRelease); camStream?.getTracks().forEach(t => t.stop()); camStream = null; video.srcObject = null; camWrap.hidden = true; }
  function captureFrame(max = 1024) {
    const w = video.videoWidth, h = video.videoHeight; if (!w || !h) throw new LuzError('camera');
    const k = Math.min(1, max / Math.max(w, h)); const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }

  async function look(kind, question, signal) {
    shutUp(); setState('thinking');
    statusEl.textContent = { describe: 'Mirando…', read: 'Leyendo… mantén el móvil quieto', identify: 'Identificando…', ask: 'Mirando para responderte…' }[kind];
    earcon.tick(); buzz([30]); startTicker();
    try {
      await ensureCamera();
      if (signal?.aborted) return;
      const img = captureFrame(); buzz([20]);
      const text = await gemini(VISION_MODELS, [{ inlineData: { mimeType: 'image/jpeg', data: img } }, { text: question || PROMPT[kind] }],
        { system: SYS[kind], maxTokens: kind === 'read' ? 1500 : 400, timeout: kind === 'read' ? 14000 : 10000, signal });
      if (signal?.aborted) return;
      earcon.done(); buzz([40, 50, 40]);
      say(text);
    } catch (e) { if (!signal?.aborted) fail(e); }
    finally { stopTicker(); releaseCameraLater(); }
  }
  window.__luzTest = { look: async (kind, q, b64) => { // usado por las pruebas automáticas
    const t = await gemini(VISION_MODELS, [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }, { text: q || PROMPT[kind] }], { system: SYS[kind], maxTokens: 1500 });
    say(t); return t; }, understand };

  // ---------- Ubicación ----------
  function getPosition(timeout = 12000) {
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new LuzError('location'));
      navigator.geolocation.getCurrentPosition(p => ok(p.coords), () => ko(new LuzError('location')), { enableHighAccuracy: true, timeout, maximumAge: 15000 });
    });
  }
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  function dist(a, b) { const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
  function bearing(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function distToSeg(p, a, b) { // proyección equirectangular local
    const kx = Math.cos(rad(p.lat)) * R * Math.PI / 180, ky = R * Math.PI / 180;
    const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky, bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy); }
  const metres = (m) => m < 15 ? 'unos pocos metros' : (m < 1000 ? 'unos ' + (m < 50 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + ' metros' : (Math.round(m / 100) / 10).toString().replace('.', ',') + ' kilómetros');
  const CARD = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  const cardinal = (b) => CARD[Math.round(b / 45) % 8];

  async function nominatim(path, params, signal) {
    const u = new URL('https://nominatim.openstreetmap.org/' + path);
    Object.entries({ format: 'jsonv2', 'accept-language': 'es', addressdetails: 1, ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000); signal?.addEventListener('abort', () => ctrl.abort());
    try { const r = await fetch(u, { signal: ctrl.signal }); if (!r.ok) throw new LuzError('busy'); return await r.json(); }
    catch (e) { if (e instanceof LuzError) throw e; throw new LuzError(navigator.onLine ? 'busy' : 'offline'); } finally { clearTimeout(t); }
  }
  const addrLine = (a = {}) => [a.road || a.pedestrian || a.footway || a.square, a.house_number].filter(Boolean).join(', ');

  async function whereAmI(signal) {
    shutUp(); setState('thinking'); statusEl.textContent = 'Buscando dónde estás…'; startTicker();
    try {
      const c = await getPosition();
      const r = await nominatim('reverse', { lat: c.latitude, lon: c.longitude, zoom: 18 }, signal);
      const a = r.address || {};
      const street = addrLine(a), area = a.neighbourhood || a.quarter || a.suburb || a.city_district, city = a.city || a.town || a.village;
      let msg = street ? `Estás en ${street}` : 'Estás cerca de ' + (r.name || r.display_name?.split(',').slice(0, 2).join(','));
      if (area) msg += `, en ${area}`; if (city) msg += `, ${city}`;
      msg += '.'; if (c.accuracy > 60) msg += ` La precisión del GPS es baja, de unos ${Math.round(c.accuracy)} metros.`;
      say(msg);
    } catch (e) { if (!signal?.aborted) fail(e); } finally { stopTicker(); }
  }

  // ---------- Navegación real (OpenStreetMap + OSRM a pie) ----------
  let route = null, watchId = null;
  function askDestination() {
    pendingContext = 'La persona está respondiendo a la pregunta «¿A dónde quieres ir?». Clasifica como navigate y pon el sitio en destination y place_query, salvo que diga para o cancela.';
    say('¿A dónde quieres ir? Dímelo después del tono.', { onend: () => listen() });
  }
  const cleanQuery = (q) => String(q || '').replace(/\b(m[aá]s )?(cercan[oa]s?|pr[oó]xim[oa]s?)\b/gi, '').replace(/^\s*(a |al |hasta |hacia )?(la |el |los |las |un |una )?/i, '').trim();

  async function findPlace(query, c, signal) {
    const q = cleanQuery(query) || query;
    for (const d of [0.015, 0.05, 0.2]) {
      const vb = [c.longitude - d, c.latitude + d, c.longitude + d, c.latitude - d].join(',');
      const res = await nominatim('search', { q, viewbox: vb, bounded: 1, limit: 15 }, signal);
      if (res.length) return res.map(x => ({ x, d: dist({ lat: c.latitude, lon: c.longitude }, { lat: +x.lat, lon: +x.lon }) })).sort((a, b) => a.d - b.d)[0].x;
    }
    const res = await nominatim('search', { q, limit: 5 }, signal);
    return res[0] || null;
  }

  function stepText(s, destName) {
    const m = s.maneuver, name = s.name ? (/^(calle|avenida|plaza|paseo|carrera|camino|ronda|glorieta|travesía|callejón|pasaje|vía|via)\b/i.test(s.name) ? 'la ' + s.name : s.name) : '';
    const MOD = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha',
      'sharp left': 'muy cerrado a la izquierda', 'sharp right': 'muy cerrado a la derecha' };
    let t;
    if (m.type === 'depart') t = `Empieza a caminar en dirección ${cardinal(m.bearing_after)}${name ? ', por ' + name : ''}`;
    else if (m.type === 'arrive') { const side = m.modifier && /left|right/.test(m.modifier) ? (m.modifier.includes('left') ? ', a tu izquierda' : ', a tu derecha') : '';
      return `Has llegado a ${destName}${side}. Fin de la ruta.`; }
    else if (/roundabout|rotary/.test(m.type)) t = `En la rotonda, toma la ${['primera', 'segunda', 'tercera', 'cuarta', 'quinta'][(m.exit || 1) - 1] || m.exit + 'ª'} salida`;
    else if (m.modifier === 'uturn') t = 'Da media vuelta';
    else if (!m.modifier || m.modifier === 'straight' || m.type === 'new name' || m.type === 'continue' && !MOD[m.modifier]) t = `Sigue recto${name ? ' por ' + name : ''}`;
    else t = `Gira ${MOD[m.modifier]}${name ? ' hacia ' + name : ''}`;
    return s.distance > 1 ? `${t} y camina ${metres(s.distance)}.` : t + '.';
  }

  async function navigateTo(destination, placeQuery, signal) {
    endRoute(true); shutUp(); setState('thinking'); statusEl.textContent = 'Buscando ' + destination + '…'; startTicker();
    try {
      const c = await getPosition();
      const place = await findPlace(placeQuery || destination, c, signal);
      if (signal?.aborted) return;
      if (!place) { stopTicker(); return say(`No he encontrado «${destination}» cerca de ti. Prueba con otro nombre o con una dirección.`); }
      const spoken = String(destination).replace(/\s*(m[aá]s\s+)?(cercan|pr[oó]xim)\w*/gi, '').trim();
      const pname = place.name || (/^\d/.test(place.display_name) ? spoken : place.display_name.split(',')[0]) || spoken;
      const paddr = addrLine(place.address);
      const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${c.longitude},${c.latitude};${place.lon},${place.lat}?steps=true&overview=full&geometries=geojson`;
      const ctrl = new AbortController(); const tt = setTimeout(() => ctrl.abort(), 15000); signal?.addEventListener('abort', () => ctrl.abort());
      let data; try { const r = await fetch(url, { signal: ctrl.signal }); data = await r.json(); } catch { throw new LuzError(navigator.onLine ? 'busy' : 'offline'); } finally { clearTimeout(tt); }
      if (data.code !== 'Ok' || !data.routes?.length) { stopTicker(); return say(`He encontrado ${pname}, pero no consigo calcular una ruta a pie hasta allí.`); }
      const r0 = data.routes[0];
      const destName = pname + (paddr && !pname.includes(paddr) ? ', en ' + paddr : '');
      route = {
        destName, place, geometry: r0.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
        steps: r0.legs[0].steps.map(s => ({ text: stepText(s, pname), short: stepText({ ...s, distance: 0 }, pname), loc: { lon: s.maneuver.location[0], lat: s.maneuver.location[1] } })),
        i: 0, warned: -1, off: 0, lastOff: 0, lastWrong: 0
      };
      // pasos que empiezan prácticamente donde estás: se dicen juntos al principio
      let first = route.steps[0].text;
      while (route.steps.length > 2 && route.i + 1 < route.steps.length - 1 && dist({ lat: c.latitude, lon: c.longitude }, route.steps[route.i + 1].loc) < 15) {
        route.i++; first = route.steps[route.i].text; }
      const nx = route.steps[route.i + 1]; if (nx && dist({ lat: c.latitude, lon: c.longitude }, nx.loc) < 50) route.warned = route.i + 1;
      navPanel.hidden = false; updatePanel(c);
      const mins = Math.max(1, Math.round(r0.duration / 60));
      stopTicker(); earcon.done();
      say(`Vamos a ${destName}. Está a ${metres(r0.distance)}, ${mins === 1 ? "un minuto" : "unos " + mins + " minutos"} andando. ` +
          'Soy una guía: usa siempre tu bastón o tu perro y ten mucho cuidado al cruzar. ' +
          (c.accuracy > 40 ? `El GPS tiene poca precisión ahora, unos ${Math.round(c.accuracy)} metros. ` : '') +
          first + ' Te avisaré en cada giro. Di «siguiente» o «repite» cuando quieras.');
      startWatch();
    } catch (e) { stopTicker(); if (!signal?.aborted) fail(e); }
  }
  function updatePanel(c) {
    if (!route) return; const nxt = route.steps[route.i + 1];
    const d = c && nxt ? ' en ' + metres(dist({ lat: c.latitude, lon: c.longitude }, nxt.loc)).replace('unos ', '') : '';
    navNext.textContent = nxt ? `Próximo: ${nxt.short.replace(/\.$/, '')}${d}` : route.steps[route.i].text;
  }
  function startWatch() {
    if (!navigator.geolocation) return;
    stopWatch();
    watchId = navigator.geolocation.watchPosition(onMove, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function stopWatch() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }
  function onMove(p) {
    if (!route) return stopWatch();
    const c = p.coords, here = { lat: c.latitude, lon: c.longitude }, now = Date.now();
    updatePanel(c);
    const nxt = route.steps[route.i + 1]; if (!nxt) return;
    const d = dist(here, nxt.loc), reach = Math.min(25, Math.max(10, c.accuracy * 0.6));
    if (state === 'speaking' && d > 6) return; // no cortar lo que Luz está diciendo
    if (d < reach) return advance(false);
    if (d < 35 && route.warned !== route.i + 1) { route.warned = route.i + 1; buzz([60]); say(`En ${metres(d)}: ${nxt.short.charAt(0).toLowerCase() + nxt.short.slice(1)}`); return; }
    // ¿se ha salido de la ruta?
    let off = Infinity; for (let k = 0; k < route.geometry.length - 1; k++) off = Math.min(off, distToSeg(here, route.geometry[k], route.geometry[k + 1]));
    if (off > Math.max(40, c.accuracy * 1.5)) {
      if (++route.off >= 3 && now - route.lastOff > 30000) { route.lastOff = now; route.off = 0;
        say('Parece que te has salido de la ruta. Recalculo.', { onend: () => route && navigateTo(route.place.name || route.destName, route.place.display_name, newOp()) }); }
      return;
    } else route.off = 0;
    // ¿va en sentido contrario?
    if (c.heading != null && !isNaN(c.heading) && c.speed > 0.6 && now - route.lastWrong > 25000) {
      let diff = Math.abs(((bearing(here, nxt.loc) - c.heading) + 540) % 360 - 180);
      if (diff > 130) { route.lastWrong = now; say('Parece que vas en sentido contrario. Date la vuelta.'); }
    }
  }
  function advance(manual) {
    if (!route) return;
    route.i++;
    const s = route.steps[route.i];
    if (!s) return endRoute(true);
    buzz(manual ? [40] : [80, 60, 80]); earcon.done();
    if (route.i >= route.steps.length - 1) { const t = s.text; endRoute(true); buzz([80, 80, 80, 80, 200]); return say(t); }
    updatePanel(); say(s.text);
  }
  function endRoute(silent) {
    const had = !!route; route = null; stopWatch(); navPanel.hidden = true;
    if (!silent) say(had ? 'Ruta terminada.' : 'No hay ninguna ruta activa.');
  }

  // ---------- Eventos ----------
  const WELCOME = 'Hola, soy Luz. Veo con la cámara de tu móvil y te lo cuento. Toca el botón grande del centro, espera el tono y dime lo que necesitas: «qué hay delante», «lee esto», «qué es esto», o «llévame a la farmacia». Cuando acabes de hablar, calla un momento. La primera vez, el iPhone te pedirá permiso para el micrófono, la cámara y la ubicación: acéptalos. Di «ayuda» cuando quieras.';
  let welcomed = store.get('welcomed2', false);

  micBtn.addEventListener('click', () => {
    unlock();
    if (!welcomed) { welcomed = true; store.set('welcomed2', true); return say(WELCOME); }
    if (state === 'listening' && recording) { recording.stop('manual'); return; }
    listen();
  });
  document.querySelectorAll('[data-intent]').forEach(b => b.addEventListener('click', () => {
    unlock(); welcomed = true; store.set('welcomed2', true);
    const intent = b.dataset.intent;
    if (intent === 'navigate') { newOp(); return askDestination(); }
    run({ intent }, newOp());
  }));
  $('#btn-stop').addEventListener('click', () => { unlock(); op?.abort(); recording?.stop('manual'); shutUp(); setState('idle'); statusEl.textContent = 'En silencio.'; });
  $('#btn-settings').addEventListener('click', () => { unlock(); dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); });
  $('#btn-test').addEventListener('click', () => { unlock(); say('Hola, soy Luz. Así suena mi voz.' + (voice ? '' : ' No encuentro una voz en español, uso la del sistema.')); });
  $('#cmd-form').addEventListener('submit', async (e) => {
    e.preventDefault(); unlock(); const v = cmdInput.value.trim(); if (!v) return;
    cmdInput.value = ''; cmdInput.blur();
    const signal = newOp(); const context = pendingContext; pendingContext = null;
    setState('thinking'); statusEl.textContent = 'Entendiendo…'; startTicker();
    try { await run(await understand({ text: v, context }, signal), signal); } catch (err) { stopTicker(); if (!signal.aborted) fail(err); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { op?.abort(); shutUp(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { shutUp(); stopCamera(); } });

  statusEl.textContent = welcomed ? 'Toca el botón grande y habla. Di «ayuda» para saber qué puedo hacer.'
    : 'Te doy la bienvenida a Luz. Toca el botón grande del centro para escuchar cómo funciona.';
  setState('idle');

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {}));
})();
