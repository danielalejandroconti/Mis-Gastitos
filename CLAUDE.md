# Mis gastitos — contexto para trabajar en este repo

App personal de Dani (argentino en Barcelona). Web App de Google Apps Script atada a un Google Sheet (ID en `src/Code.gs`, constante `SHEET_ID`), que es la base de datos y ya tiene el histórico del año (Origen `excel-historico`).

- Idioma: español rioplatense. Monedas EUR (principal), ARS, USD, siempre separadas.
- Diseño y plan: `docs/handoff-v2.md` (autoritativo). Maquetas en `docs/diseno-v2/`. Implementación por cortes verticales; el Corte 1 (Inicio, Movimientos, Nuevo movimiento) está en `src/Index.html`.
- Esquema de `Transacciones`: A=ID, B=Fecha, C=Concepto, D=Monto, E=Moneda, F=Cuenta, G=Categoría, H=Subcategoría, I=Origen, J=Notas, K=Validado, L=Grupo, M=Mi parte, N=Conciliado. `Validado` vacío = validado (histórico); solo `'No'` es pendiente.
- Reglas del backend: mantener nombres y forma de las llamadas `google.script.run` existentes; anotar cada cambio. Nunca devolver `undefined` en un campo (Apps Script devuelve toda la respuesta como `null`). Toda escritura concurrente usa `LockService`. Las altas llevan ID generado en el cliente (idempotentes).
- `PresupuestoCategorias` está desactivado en `getBootstrap()` por un bug de respuesta null; reactivar en el corte 3.
- Probar la UI sin Apps Script: `python3 test/ui_smoke.py` (necesita Playwright; simula `google.script.run`).
- Deploy: push a `main` → GitHub Action → clasp (ver README).
