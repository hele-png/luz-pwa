# Luz · Tus ojos, por voz

PWA en español para personas ciegas o con baja visión. Toca el botón grande, espera el tono y habla:
«qué hay delante», «lee esto», «qué es esto», «¿de qué color es esta camisa?», «llévame a la farmacia más cercana», «dónde estoy», «siguiente», «repite», «para», «ayuda».

- Visión y comprensión de voz: Google Gemini (`gemini-3.5-flash-lite`, respaldo `gemini-3.5-flash`), llamado directamente desde el navegador.
- Voz de entrada: grabación con MediaRecorder + detección de silencio (funciona en la app instalada del iPhone).
- Navegación a pie: OpenStreetMap (Nominatim) + OSRM (perfil peatonal). Es una ayuda: usa siempre bastón o perro guía.
- La clave de demostración va ofuscada en `key.js`; se puede sustituir en Ajustes (se guarda solo en el móvil).
