/* Luz — prototipo de asistente visual por voz. Todas las respuestas son simuladas. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const micBtn = $('#mic'), micLabel = $('#mic-label'), statusEl = $('#status'), alertEl = $('#alert');
  const pill = $('#state-pill'), camWrap = $('#camera-wrap'), video = $('#camera'), camCap = $('#camera-cap');
  const navControls = $('#nav-controls'), typed = $('#typed'), cmdInput = $('#cmd-input');
  const rateEl = $('#rate'), voiceOnEl = $('#voice-on'), vibOnEl = $('#vibrate-on'), camOnEl = $('#camera-on');

  // ---------- Ajustes persistentes ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('luz.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('luz.' + k, JSON.stringify(v)); } catch {} }
  };
  rateEl.value = store.get('rate', 0.95);
  voiceOnEl.checked = store.get('voiceOn', true);
  vibOnEl.checked = store.get('vibrate', true);
  camOnEl.checked = store.get('camera', true);
  const rateText = (r) => r < 0.8 ? 'Lenta' : r > 1.15 ? 'Rápida' : 'Normal';
  rateEl.setAttribute('aria-valuetext', rateText(+rateEl.value));
  rateEl.addEventListener('input', () => { store.set('rate', +rateEl.value); rateEl.setAttribute('aria-valuetext', rateText(+rateEl.value)); });
  rateEl.addEventListener('change', () => say('Así suena esta velocidad.'));
  voiceOnEl.addEventListener('change', () => { store.set('voiceOn', voiceOnEl.checked); syncLive();
    say(voiceOnEl.checked ? 'Voz de Luz activada.' : 'Voz de Luz desactivada. VoiceOver leerá las respuestas.'); });
  vibOnEl.addEventListener('change', () => { store.set('vibrate', vibOnEl.checked); buzz([60]); });
  camOnEl.addEventListener('change', () => { store.set('camera', camOnEl.checked); if (!camOnEl.checked) stopCamera(); });

  // ---------- Voz de salida ----------
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let voice = null, lastSpoken = '', speakingQueue = 0, ttsWorks = !!synth;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    const es = vs.filter(v => /^es[-_]ES/i.test(v.lang));
    const anyEs = vs.filter(v => /^es/i.test(v.lang));
    const pool = es.length ? es : anyEs;
    voice = pool.find(v => /premium|enhanced|mejorad/i.test(v.name)) ||
            pool.find(v => /m[oó]nica|jorge|marisol|paulina|google espa/i.test(v.name)) || pool[0] || null;
  }
  if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

  // Cuando la voz de Luz está activa, la región de estado no se anuncia automáticamente
  // (evita que VoiceOver y Luz hablen a la vez); el texto sigue visible y se puede leer deslizando.
  function syncLive() { statusEl.setAttribute('aria-live', useTTS() ? 'off' : 'polite'); }
  const useTTS = () => voiceOnEl.checked && ttsWorks;
  syncLive();

  function chunks(text) { return text.match(/[^.!?…]+[.!?…]*/g)?.map(s => s.trim()).filter(Boolean) || [text]; }

  function say(text, { onend, assertive = false, remember = true } = {}) {
    if (remember) lastSpoken = text;
    statusEl.textContent = text;
    if (!useTTS()) {
      // Espejo para lectores de pantalla
      if (assertive) { alertEl.textContent = ''; setTimeout(() => alertEl.textContent = text, 50); }
      setState('idle');
      if (onend) setTimeout(onend, Math.min(8000, 900 + text.length * 55));
      return;
    }
    synth.cancel();
    const parts = chunks(text);
    const myTurn = ++speakingQueue;
    setState('speaking');
    let started = false;
    const watchdog = setTimeout(() => { if (!started && myTurn === speakingQueue) { // la voz no arrancó: usar VoiceOver
      ttsWorks = false; syncLive(); statusEl.textContent = ''; setTimeout(() => statusEl.textContent = text, 50);
      setState('idle'); onend && onend(); } }, 2500);
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'es-ES'; if (voice) u.voice = voice;
      u.rate = +rateEl.value; u.pitch = 1; u.volume = 1;
      u.onstart = () => { started = true; clearTimeout(watchdog); };
      if (i === parts.length - 1) u.onend = () => { if (myTurn === speakingQueue) { setState('idle'); onend && onend(); } };
      u.onerror = () => { clearTimeout(watchdog); if (myTurn === speakingQueue && i === parts.length - 1) setState('idle'); };
      // pequeño retraso tras cancel(): necesario en iOS
      setTimeout(() => synth.speak(u), 60);
    });
  }
  function shutUp() { speakingQueue++; synth && synth.cancel(); setState('idle'); }

  // ---------- Desbloqueo de audio (iOS exige un gesto) ----------
  let audioCtx = null, unlocked = false;
  function unlock() {
    if (unlocked) return; unlocked = true;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
    if (synth) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); pickVoice(); }
  }

  // ---------- Tonos y vibración ----------
  function tone(freqs, dur = 0.12) {
    if (!audioCtx) return;
    let t = audioCtx.currentTime;
    freqs.forEach(f => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur + 0.02); t += dur * 0.9;
    });
  }
  const earcon = { listen: () => tone([660, 880]), stop: () => tone([880, 560]), think: () => tone([520], 0.08), error: () => tone([300, 220], 0.18) };
  function buzz(p) { if (vibOnEl.checked && navigator.vibrate) try { navigator.vibrate(p); } catch {} }

  // ---------- Estado visual ----------
  const STATE_TXT = { idle: 'Lista', listening: 'Escuchando', thinking: 'Analizando', speaking: 'Hablando', error: 'Aviso' };
  const MIC_TXT = { idle: 'Toca y habla', listening: 'Te escucho…', thinking: 'Un momento…', speaking: 'Toca para hablar', error: 'Toca y habla' };
  let state = 'idle';
  function setState(s) {
    state = s; micBtn.dataset.state = s; pill.dataset.state = s; pill.textContent = STATE_TXT[s]; micLabel.textContent = MIC_TXT[s];
    micBtn.setAttribute('aria-label', s === 'listening' ? 'Escuchando. Habla ahora. Toca para cancelar.' :
      s === 'speaking' ? 'Luz está hablando. Toca para interrumpir y dar otra orden.' : 'Hablar con Luz. Toca una vez y di lo que necesitas.');
  }

  // ---------- Reconocimiento de voz ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, srBroken = !SR, gotResult = false;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function listen() {
    shutUp();
    if (srBroken) return fallbackInput();
    try {
      rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
    } catch { srBroken = true; return fallbackInput(); }
    gotResult = false;
    rec.onstart = () => { setState('listening'); earcon.listen(); buzz([40]); statusEl.textContent = 'Te escucho…'; };
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
      }
      if (interim) statusEl.textContent = '«' + interim + '»';
      if (final) { gotResult = true; try { rec.stop(); } catch {} handle(final); }
    };
    rec.onerror = (e) => {
      earcon.error();
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        srBroken = true;
        say('No puedo usar el micrófono aquí. ' + (standalone ? 'En la app instalada del iPhone el reconocimiento de voz a veces no está disponible. ' : 'Revisa el permiso del micrófono. ') +
            'Te abro el campo para escribir o dictar con el teclado.', { assertive: true, onend: () => {} });
        fallbackInput(true);
      } else if (e.error === 'no-speech') {
        say('No te he oído. Toca el botón y vuelve a intentarlo.', { assertive: true });
      } else if (e.error !== 'aborted') {
        say('No te he entendido bien. Toca el botón y repítelo.', { assertive: true });
      } else setState('idle');
    };
    rec.onend = () => { if (state === 'listening') { setState('idle'); if (!gotResult) earcon.stop(); } };
    try { rec.start(); } catch { srBroken = true; fallbackInput(); }
  }
  function stopListening() { try { rec && rec.abort(); } catch {} earcon.stop(); setState('idle'); statusEl.textContent = 'Escucha cancelada.'; }

  function fallbackInput(silent) {
    typed.open = true;
    if (!silent) say('El reconocimiento de voz no está disponible en este navegador. Escribe la orden o pulsa el micrófono del teclado para dictarla. También puedes usar los botones grandes de abajo.', { assertive: true });
    setTimeout(() => cmdInput.focus(), silent ? 0 : 100);
  }

  // ---------- Interpretación de órdenes ----------
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:«»"]/g, ' ').replace(/\s+/g, ' ').trim();
  let awaitingDestination = false;

  function intent(raw) {
    const t = norm(raw), words = t.split(' ').length;
    if (/^(para|parar|parate|silencio|calla|callate|detente|stop|basta|cancela|cancelar)\b/.test(t) && words <= 4) return { type: 'stop' };
    if (/\b(ayuda|que puedo (decir|hacer)|comandos|ordenes|como funciona|instrucciones)\b/.test(t)) return { type: 'help' };
    if (/\b(terminar|termina|cancelar|cancela|fin de la?|acabar|salir de la?)\s*(ruta|navegacion|viaje)\b|\bhe llegado\b/.test(t)) return { type: 'endRoute' };
    if (/\b(repite|repetir|repitelo|otra vez|que has dicho|no te he oido)\b/.test(t)) return { type: 'repeat' };
    if (/^(siguiente|sigue|continua|continuar|y ahora|vale|listo|ya|hecho|adelante)\b/.test(t) && words <= 4) return { type: 'next' };
    if (/\b(mas despacio|mas lento|habla despacio)\b/.test(t)) return { type: 'slower' };
    if (/\b(mas rapido|habla rapido|mas deprisa)\b/.test(t)) return { type: 'faster' };
    if (/\b(cierra|apaga|quita) la camara\b/.test(t)) return { type: 'camOff' };
    const nav = t.match(/\b(llevame|lleva me|quiero ir|como (llego|voy)|guiame|ir|navega|vamos|indicame (el camino|como llegar))( (a|al|hasta|hacia|para))?( (la|el|los|las|una|un))?\s*(.*)$/);
    if (nav && /\b(llevame|lleva me|quiero ir|como llego|como voy|guiame|navega|vamos|indicame)\b|^ir\b/.test(t))
      return { type: 'navigate', dest: cleanDest(raw, nav[nav.length - 1]) };
    if (/\b(que es esto|que es eso|que tengo|identifica|que objeto|reconoce|que llevo)\b/.test(t)) return { type: 'whatIs' };
    if (/\b(lee|leer|leeme|lectura|que pone|que dice|que esta escrito|texto|etiqueta|cartel)\b/.test(t)) return { type: 'read' };
    if (/\b(describe|describir|describeme|que hay|que ves|entorno|alrededor|delante|donde estoy|mira|que tengo delante|obstaculo)\b/.test(t)) return { type: 'describe' };
    return { type: 'unknown', text: t };
  }
  function cleanDest(raw, d) {
    d = (d || '').trim();
    if (!d) return '';
    // recuperar acentos del texto original si es posible
    const m = raw.match(new RegExp('\\b(a|al|hasta|hacia|para)\\s+((?:la|el|los|las|una|un)\\s+)?(.+)$', 'i'));
    let out = m ? m[3] : d;
    out = out.replace(/[.?!¿¡]+$/g, '').trim();
    const art = (m && m[2]) ? m[2].toLowerCase() : (m && /^al$/i.test(m[1])) ? 'el ' : (/^(farmacia|parada|estacion|estación|panaderia|panadería|puerta|calle|plaza|salida|casa)/i.test(out) ? 'la ' : '');
    return (art + out).trim();
  }

  function handle(raw) {
    if (!raw || !raw.trim()) return;
    unlock();
    if (awaitingDestination) {
      awaitingDestination = false;
      const i = intent(raw);
      if (i.type === 'stop') return say('De acuerdo, cancelado.');
      return navigate(i.type === 'navigate' && i.dest ? i.dest : cleanDest(raw, raw) || raw);
    }
    const i = intent(raw);
    switch (i.type) {
      case 'stop': shutUp(); statusEl.textContent = 'En silencio. Toca el botón cuando me necesites.'; buzz([30]); break;
      case 'help': help(); break;
      case 'repeat': say(lastSpoken || 'Todavía no he dicho nada. Toca el botón y dime qué necesitas.', { remember: !!lastSpoken }); break;
      case 'next': route ? nextStep() : say('No hay ninguna ruta activa. Di, por ejemplo: llévame a la farmacia.'); break;
      case 'endRoute': endRoute(); break;
      case 'slower': rateEl.value = Math.max(0.6, +rateEl.value - 0.15).toFixed(2); store.set('rate', +rateEl.value); say('Vale, hablo más despacio.'); break;
      case 'faster': rateEl.value = Math.min(1.4, +rateEl.value + 0.15).toFixed(2); store.set('rate', +rateEl.value); say('Vale, hablo más rápido.'); break;
      case 'camOff': stopCamera(); say('Cámara apagada.'); break;
      case 'navigate': i.dest ? navigate(i.dest) : askDestination(); break;
      case 'whatIs': analyse('whatIs'); break;
      case 'read': analyse('read'); break;
      case 'describe': analyse('describe'); break;
      default:
        earcon.error(); buzz([80, 60, 80]);
        say('He oído: «' + raw.trim() + '». No sé hacer eso todavía. Puedes decir: describe lo que hay delante, lee esto, qué es esto, o llévame a un sitio. Di ayuda para más opciones.');
    }
  }

  function help() {
    say('Así funciono. Toca el botón grande del centro, espera el tono y habla. ' +
      'Di «describe lo que hay delante» y te contaré qué hay a tu alrededor. ' +
      'Di «lee esto» apuntando a un texto, y lo leeré en voz alta. ' +
      'Di «qué es esto» para identificar un objeto. ' +
      'Di «llévame a», y el sitio, por ejemplo «llévame a la farmacia», y te guiaré paso a paso; di «siguiente» para el próximo paso. ' +
      'También puedes decir «repite», «para», «más despacio» o «más rápido». ' +
      'Debajo del botón grande hay botones con las mismas acciones.');
  }

  // ---------- Cámara ----------
  let stream = null, camTimer = null;
  async function startCamera(caption) {
    if (!camOnEl.checked || !navigator.mediaDevices?.getUserMedia) return false;
    camCap.textContent = caption;
    try {
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = stream; camWrap.hidden = false; await video.play().catch(() => {});
      clearTimeout(camTimer); camTimer = setTimeout(stopCamera, 45000);
      return true;
    } catch { return false; }
  }
  function stopCamera() { clearTimeout(camTimer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; camWrap.hidden = true; }

  // ---------- Respuestas simuladas ----------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let lastPick = {};
  const pickNew = (key, a) => { let x; do { x = pick(a); } while (a.length > 1 && x === lastPick[key]); lastPick[key] = x; return x; };

  const SCENES = [
    'Estás en una habitación que parece un salón. Justo delante, a unos dos metros, hay un sofá gris. A tu izquierda, a un metro, una mesa baja con una taza encima: cuidado con las rodillas. A tu derecha hay una ventana con la persiana medio subida. La puerta está detrás de ti, a unos tres metros.',
    'Estás en una acera. Delante, el camino está despejado unos diez metros. A tu derecha, pegada al bordillo, hay una papelera a un metro y medio. A tu izquierda, la fachada de un edificio con un portal abierto. Hay dos personas caminando hacia ti, a unos cinco metros.',
    'Parece una cocina. Delante tienes la encimera, a menos de un metro. A tu izquierda, el frigorífico. A tu derecha, la placa de cocina: está apagada. En el suelo, a tus pies a la derecha, hay una bolsa: cuidado al dar un paso.',
    'Estás en un pasillo estrecho. Al fondo, a unos cuatro metros, hay una puerta cerrada de color blanco con el pomo a la derecha. A mitad de camino, a tu izquierda, hay otra puerta abierta. El suelo está despejado.',
    'Estás frente a un paso de peatones. El semáforo para peatones está en rojo. Hay un coche detenido a tu izquierda. Espera a que se ponga en verde. Una persona espera a tu lado derecho, a un metro.',
    'Estás en la entrada de una tienda. Delante, a tres metros, está el mostrador con una persona detrás. A tu izquierda hay estanterías con productos. Atención: a un metro delante de ti hay un escalón hacia abajo.',
    'Estás en una parada de autobús. A tu derecha, a dos metros, hay un banco con una persona sentada. Delante, el bordillo de la calzada a un metro y medio: no avances más. El poste con los horarios está a tu izquierda.'
  ];
  const TEXTS = [
    ['una carta', 'Querida Elena: Te escribo para contarte que el sábado celebramos el cumpleaños de la abuela en casa, a las dos de la tarde. No hace falta que traigas nada, solo ganas de pasarlo bien. Un abrazo muy fuerte. Tu prima, Marta.'],
    ['la etiqueta de un medicamento', 'Paracetamol, 1 gramo. Veinte comprimidos. Vía oral. Adultos: un comprimido cada ocho horas si hay dolor o fiebre. No tomar más de tres gramos al día. Caduca en marzo de 2027.'],
    ['una carta de restaurante', 'Menú del día, catorce euros. Primeros: ensalada mixta, crema de calabaza o lentejas estofadas. Segundos: merluza a la plancha, pollo asado o tortilla de patatas. Postre: flan casero, fruta o yogur. Incluye pan y bebida.'],
    ['una carta del banco', 'Estimado cliente: le informamos de que el próximo día cinco se cargará en su cuenta el recibo de la luz, por un importe de sesenta y dos euros con cuarenta céntimos. Para cualquier duda, llame al 900 123 456.'],
    ['un cartel', 'Cerrado por vacaciones del 1 al 15 de agosto. Disculpen las molestias.'],
    ['un envase de leche', 'Leche semidesnatada. Un litro. Consumir preferentemente antes del 28 de noviembre. Una vez abierto, conservar en frío y consumir en tres días.']
  ];
  const OBJECTS = [
    'Es una lata de tomate triturado, de 400 gramos. La etiqueta es roja.',
    'Es un billete de veinte euros.',
    'Es un bote de champú. En la etiqueta pone «cabello normal», 400 mililitros.',
    'Es una taza de cerámica blanca, vacía.',
    'Es un mando a distancia de televisión. El botón rojo de encendido está arriba a la izquierda.',
    'Es una caja de cereales de avena. Parece que está abierta.',
    'Son unas llaves: un llavero con tres llaves, una de ellas más grande, de color dorado.',
    'Es una camiseta azul marino, de manga corta, sin dibujos.',
    'Es un cartón de huevos. Hay seis huevos.'
  ];

  async function analyse(kind) {
    shutUp();
    const caption = { describe: 'Mirando el entorno…', read: 'Buscando texto…', whatIs: 'Identificando…' }[kind];
    const tip = { describe: 'Mirando. Sostén el móvil a la altura del pecho, con la cámara hacia delante.',
                  read: 'Buscando texto. Mantén el móvil quieto, a unos treinta centímetros del papel.',
                  whatIs: 'Identificando. Pon el objeto delante de la cámara.' }[kind];
    setState('thinking'); statusEl.textContent = tip; buzz([30]);
    const camOk = await startCamera(caption);
    say(tip, { remember: false, onend: () => {} });
    earcon.think();
    const wait = 1600 + Math.random() * 900;
    setTimeout(() => {
      buzz([40, 60, 40]);
      const pre = camOk ? '' : (camOnEl.checked ? '(Sin acceso a la cámara, uso un ejemplo.) ' : '');
      let out;
      if (kind === 'describe') out = pickNew('scene', SCENES);
      else if (kind === 'whatIs') out = pickNew('obj', OBJECTS);
      else { const [what, body] = pickNew('text', TEXTS); out = 'He encontrado ' + what + '. Dice así: ' + body; }
      say(pre + out + ' Di «repite» si quieres oírlo otra vez.');
    }, wait);
  }

  // ---------- Navegación simulada ----------
  let route = null;
  const aDest = (d) => /^el\s/i.test(d) ? 'al ' + d.slice(3) : 'a ' + d;
  function askDestination() {
    awaitingDestination = true;
    say('¿A dónde quieres ir? Dímelo después del tono.', { onend: () => { if (awaitingDestination) srBroken ? fallbackInput(true) : listen(); } });
    if (srBroken) { cmdInput.placeholder = 'Por ejemplo: la farmacia'; }
  }
  function buildRoute(dest) {
    const streets = ['la calle Mayor', 'la calle del Sol', 'la avenida de la Paz', 'la calle Real', 'la calle de la Luna', 'el paseo del Prado'];
    const s1 = pickNew('s1', streets), s2 = pick(streets.filter(s => s !== s1));
    const m1 = pick([20, 30, 40, 50]), m2 = pick([60, 80, 100, 120]), m3 = pick([10, 15, 25]);
    return [
      `Sal por la puerta y gira a la derecha. Estás en ${s1}. Camina recto unos ${m1} metros, pegado a la pared de tu derecha.`,
      `Llegas a una esquina. Gira a la izquierda. Ahora estás en ${s2}.`,
      `Sigue recto unos ${m2} metros. A mitad de camino pasarás junto a una parada de autobús a tu derecha: mantente a la izquierda para esquivarla.`,
      `Hay un paso de peatones delante. Espera al pitido del semáforo y cruza recto. Son unos ocho metros.`,
      `Al otro lado, gira a la derecha y camina unos ${m3} metros.`,
      `Has llegado ${aDest(dest)}. La entrada está a tu izquierda, a un metro. Fin de la ruta.`
    ];
  }
  function navigate(dest) {
    dest = (dest || '').trim() || 'tu destino';
    shutUp(); stopCamera(); setState('thinking'); statusEl.textContent = 'Calculando la ruta ' + aDest(dest) + '…'; earcon.think();
    const go = (where) => {
      route = { dest, steps: buildRoute(dest), i: 0 };
      navControls.hidden = false;
      say(`${where} Ruta ${aDest(dest)}: unos ${pick([4, 6, 8, 10])} minutos andando, ${route.steps.length} pasos. ` +
          `Paso 1. ${route.steps[0]} Di «siguiente» o toca «Siguiente paso» cuando estés listo.`);
    };
    let done = false;
    const fallback = setTimeout(() => { if (!done) { done = true; go('Uso una ubicación de ejemplo.'); } }, 4000);
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
      () => { if (!done) { done = true; clearTimeout(fallback); go('Ya sé dónde estás.'); } },
      () => { if (!done) { done = true; clearTimeout(fallback); go('No he podido obtener tu ubicación, uso una de ejemplo.'); } },
      { timeout: 3500, maximumAge: 60000 });
  }
  function nextStep() {
    route.i++;
    if (route.i >= route.steps.length - 1) {
      const last = route.steps[route.steps.length - 1]; route = null; navControls.hidden = true;
      buzz([80, 80, 80, 80, 200]); say(last); return;
    }
    say(`Paso ${route.i + 1}. ${route.steps[route.i]}`);
  }
  function endRoute() {
    if (!route) return say('No hay ninguna ruta activa.');
    route = null; navControls.hidden = true; say('Ruta terminada.');
  }

  // ---------- Eventos ----------
  const WELCOME = 'Hola, soy Luz. Te ayudo a ver con la cámara y a orientarte. Toca el botón grande del centro de la pantalla, espera el tono y dime lo que necesitas. Por ejemplo: «describe lo que hay delante», «lee esto», «qué es esto» o «llévame a la farmacia». Di «ayuda» cuando quieras.';
  let welcomed = store.get('welcomed', false);

  micBtn.addEventListener('click', () => {
    unlock();
    if (!welcomed) { welcomed = true; store.set('welcomed', true); return say(WELCOME, { onend: () => {} }); }
    if (state === 'listening') return stopListening();
    listen();
  });

  document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
    unlock(); welcomed = true; store.set('welcomed', true); handle(b.dataset.cmd);
  }));
  $('#btn-stop').addEventListener('click', () => { unlock(); shutUp(); statusEl.textContent = 'En silencio.'; });
  $('#btn-test').addEventListener('click', () => { unlock(); say('Hola, soy Luz. Así suena mi voz.' + (voice ? '' : ' No encuentro una voz en español; usaré la del sistema.')); });
  $('#cmd-form').addEventListener('submit', (e) => {
    e.preventDefault(); const v = cmdInput.value.trim(); if (!v) return;
    cmdInput.value = ''; cmdInput.placeholder = ''; handle(v);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shutUp(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { shutUp(); stopCamera(); } });

  // Texto inicial (lo lee VoiceOver al abrir)
  statusEl.textContent = welcomed ? 'Toca el botón grande y habla. Di «ayuda» para saber qué puedo hacer.'
    : 'Te doy la bienvenida a Luz. Toca el botón grande del centro para escuchar las instrucciones.';
  setState('idle');

  // Para pruebas
  window.__luz = { intent, handle };

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();
