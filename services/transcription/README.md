# Transcripción de videos

El portal usa `faster-whisper` (modelo multilingüe small, CPU int8) en una función Python independiente dentro del mismo proyecto Vercel. No llama a Gemini ni consume ScrapeCreators.

- POST autenticado `inspiration/transcribe`: recupera el video registrado, firma una solicitud al worker, valida y guarda el resultado en Redis.
- GET autenticado `inspiration/transcript`: recupera el resultado guardado.
- `/api/whisper`: acepta exclusivamente solicitudes firmadas por el servidor; no acepta cargas anónimas. Firma con contexto específico y expiración de 5 minutos. Solo descarga videos de Meta CDN o Blob privado, sin redirects.
- Resultado: texto original, segmentos con tiempos, idioma y modelo. Exportación TXT y SRT en el navegador.
- Límites de esta versión: video de hasta 5 minutos y 32 MB. El worker usa archivos temporales y elimina el video al terminar. Una transcripción simultánea por instancia; bloqueo por anuncio en Redis.
- El build descarga una revisión fija del modelo y la empaqueta con la función; la primera ejecución solo carga esos archivos. Las siguientes en esa instancia reutilizan el modelo. Los resultados finales permanecen en Redis incluso si la instancia se recicla.
- Env: reutiliza `DASH_BASE_URL`, `DASH_SESSION_SECRET` y las credenciales Redis existentes. La URL base debe apuntar al despliegue que contiene el worker. No expone secretos al navegador. `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` permite empaquetar el modelo y sus dependencias sin llenar el espacio temporal.
- Consumo: no hay tarifa de API de transcripción, pero sí consumo de CPU/memoria del alojamiento. No modifica planes, presupuesto ni límites de Gemini.

## Validación

`node --test test/*.test.js`

`python3 test/whisper_worker_test.py`

Para prueba local real: crear un venv, instalar requirements.txt, importar `api/whisper.py` y llamar `transcribe_file('/ruta/video.mp4')`. La descarga inicial del modelo necesita acceso a Hugging Face. No guardar medios ni modelos en Git.

La transcripción es automática: los nombres de marca y términos especializados pueden necesitar corrección. No sustituye el audio con el copy del anuncio.
