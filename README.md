# Mis gastitos

App personal de gastos: Google Apps Script (Web App) + Google Sheet como base de datos.

- `src/Code.gs` — backend (Apps Script)
- `src/Index.html` — app nueva (v2): Inicio · Movimientos · Nuevo movimiento
- `src/IndexViejo.html` — app anterior completa, disponible agregando `?v=old` a la URL, hasta que se porte todo
- `docs/handoff-v2.md` — diseño y plan de implementación (cortes 1–8)
- `docs/diseno-v2/` — maquetas (`*.dc.html`)
- `test/ui_smoke.py` — prueba de la UI con un `google.script.run` simulado (Playwright)

## Cómo se despliega

Cada push a `main` sube `src/` al proyecto de Apps Script con [clasp](https://github.com/google/clasp) (queda en HEAD, URL `/dev`).
Si está el secreto `DEPLOYMENT_ID`, cada push a `main` también publica en la URL `/exec`. Sin ese secreto: pestaña **Actions → Deploy a Apps Script → Run workflow →** marcar *publicar*.

### Configuración (una sola vez)

1. **Activar la API de Apps Script** en tu cuenta: https://script.google.com/home/usersettings → "Google Apps Script API" → Activada.
2. **Iniciar sesión con clasp en tu compu**:
   ```
   npm install -g @google/clasp
   clasp login
   ```
   Se crea el archivo `~/.clasprc.json` (en Windows: `C:\Users\TU_USUARIO\.clasprc.json`).
3. **Cargar los secretos** en GitHub (Settings → Secrets and variables → Actions → New repository secret):
   - `CLASPRC_JSON`: el contenido completo de `~/.clasprc.json`.
   - `SCRIPT_ID`: en Apps Script → Configuración del proyecto (⚙) → ID de la secuencia de comandos.
   - `DEPLOYMENT_ID` (opcional, para publicar a `/exec`): Apps Script → Implementar → Administrar implementaciones → ID de la implementación de la app web.
4. Hacé un push (o corré el workflow a mano) y revisá la pestaña Actions.

> `.clasprc.json` da acceso a tu cuenta de Google: nunca lo subas al repo (está en `.gitignore`). Solo va como secreto.

## Importante

- El workflow **pisa el código del proyecto de Apps Script** con lo que haya en `src/`. A partir de ahora, editá acá y no en el editor de Apps Script (o copiá primero cualquier cambio manual al repo).
- Respaldo antes del primer deploy: en Apps Script, Archivo → Hacer una copia, o `clasp clone` en tu compu.
