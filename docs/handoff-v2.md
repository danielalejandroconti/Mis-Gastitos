# Mis gastitos — Rediseño UI/UX v2 (traspaso para implementar)

Actualizado: 2026-10-19 (revisión 2: validación simplificada, banco opcional, Por cobrar en pareja, Proyección aparte)

## 0. Cómo usar este documento

- Es el **resumen autoritativo del rediseño v2**. Si algo contradice a `mis-gastitos-roadmap-y-requerimientos.md` o a `mis-gastitos-contexto-rediseno.md` en UI/UX, manda este documento. El contexto viejo habla de "cinco pantallas" y está desactualizado: ahora son 12.
- **[decidido]** = lo dijo Dani. **[propuesto]** = lo propuso Claude; conviene revisarlo mirando la pantalla.
- Todos los números de las pantallas son **datos de ejemplo**.
- Las maquetas son estáticas. La app real sigue siendo Web App de Google Apps Script (`Code.gs` + `Index.html`, `google.script.run`). Se reutiliza markup, estilos y estructura, no el runtime de las maquetas.
- **La base de datos ya existe**: el Google Sheet conectado hoy a Apps Script (ID `1_UPXULf7J7wIIhdpYx76QidfC36ljOBpKu4B79lAAJ8`), que ya contiene el histórico del año (Origen `excel-historico`, desde 1/1/2026). No se migra nada: el rediseño se apoya en él.

## 1. Dónde está el diseño

- Fuentes en este proyecto: `claude/diseno-v2/` (un `*.dc.html` por pantalla + `canvas.json`). El lienzo de claude.ai (https://claude.ai/artifact/XLhVNssgwrXmzWQ7nB4KxN) **no se actualizó** y refleja la versión anterior; vale esta carpeta.
- Los `href` entre pantallas muestran la navegación prevista.

| Archivo | Pantalla | Formato |
| --- | --- | --- |
| `Main.dc.html` | Móvil · Inicio | 390×844 |
| `Nuevo.dc.html` | Móvil · Nuevo movimiento | 390×844 |
| `Pendientes.dc.html` | Móvil · Movimientos (Pendiente / Conciliado) | 390×844 |
| `CierreMovil.dc.html` | Móvil · Cierre de mes (**nueva**) | 390×844 |
| `Revisar.dc.html` | Móvil · Revisar importación (incluye Coincidencias) | 390×844 |
| `Cobrar.dc.html` | Móvil · Por cobrar (pareja) | 390×844 |
| `Cuentas.dc.html` | Móvil · Cuentas y conciliar saldo | 390×844 |
| `Planificar.dc.html` | Móvil · Proyección (simulador aparte) | 390×844 |
| `Escritorio.dc.html` | Escritorio · Inicio | fluido (1360) |
| `Cierre.dc.html` | Escritorio · Cierre de mes | fluido (1360) |
| `Reglas.dc.html` | Escritorio · Categorías y reglas | fluido (1360) |
| `Proyeccion.dc.html` | Escritorio · Proyección y escenarios | fluido (1360) |

`Validar.dc.html` (pantalla de Coincidencias) **se eliminó**: las coincidencias viven dentro de la importación.

## 2. Principios de UX

1. **Móvil primero** [decidido]. Escritorio para cierre y planificación.
2. **Carga diaria + cierre mensual** [decidido]. La carga diaria (Atajo o "Nuevo") alimenta el cierre.
3. **Dos estados, no tres** [decidido]: **Pendiente** (cargado, sin confirmar) → **Conciliado** (confirmado contra el extracto del banco). Todo cuenta en presupuesto y métricas **desde que se carga**; el estado solo dice cuánta confianza hay. "Falta categoría" es una alerta aparte ("Para completar"), no un estado.
4. **El banco es opcional** [decidido: Dani podría "matar el banco" por el trabajo extra]. Sin extracto, la app funciona igual; los movimientos quedan Pendientes y el cierre se puede hacer sin conciliar. Importar un extracto solo agrega confianza y encuentra lo que faltó cargar.
5. **Revisión por excepciones** [propuesto]: al importar, lo seguro entra con un botón; solo se revisan los dudosos.
6. **Monedas separadas** [decidido]: EUR, ARS, USD por separado; el total de referencia es aproximado.
7. **Datos en el Sheet de Dani** [decidido].
8. **Alertas del mes** solo si hay movimientos del mes cargados.
9. **Accesibilidad**: botones reales, contraste 4,5:1, táctiles ≥44 px, el estado nunca solo por color.

## 3. Modelo de datos

### 3.1 Esquema real de `Transacciones` (hoja existente)

A=ID, B=Fecha, C=Concepto, D=Monto, E=Moneda, F=Cuenta, G=Categoría, H=Subcategoría, I=Origen, J=Notas, K=Validado.
Otras pestañas: PresupuestoCategorias, Cuentas, Reglas, Presupuesto, Cotizaciones, Operaciones Acciones, Operaciones Crypto, Cotizaciones Manuales.
**No existe** una columna "Mes de pago", "TC del día" ni "Monto final" (eran supuestos del Excel viejo); si se quiere mes de pago, es una columna nueva a decidir.

### 3.2 Columnas nuevas (aditivas, al final)

- **L `Grupo`**: vacío = gasto solo de Dani; "Pareja" por defecto en compartidos.
- **M `Mi parte`**: misma moneda que el monto; vacío = todo es de Dani.
- **N `Conciliado`**: marca que un extracto lo confirmó (valor p. ej. fecha o "Sí"; nombre y valores a decidir).
- `Origen` puede valer `atajo` y `banco`.
- Estados derivados: **Pendiente** = N vacío; **Conciliado** = N con valor. `Validado` (K) se conserva por compatibilidad y deja de ser un paso del flujo del usuario (se escribe "Sí" al cargar; decisión de implementación).
- **Para completar** = movimiento sin categoría.

### 3.3 Cruce con extractos (Coincidencias dentro de la importación)

- Al importar, cada fila del banco se busca contra movimientos **Pendientes** de la misma cuenta, mismo monto y fecha ±2/3 días.
- Coincidencia segura → se muestra como par "lo que cargaste / lo del banco" con **Fusionar** o **Son distintos**; varios candidatos → lista para elegir.
- Al fusionar queda **un** movimiento: conserva concepto y categoría de Dani, toma fecha y monto del banco, queda **Conciliado**.
- Lo del banco que no estaba cargado se ofrece como nuevo (con sugerencia de categoría). Determinista, sin IA.
- En móvil está en `Revisar` (tarjeta "Coincide"); en escritorio, en `Cierre` (chip "Coincide" + panel "Coincidencias · ver pares").

### 3.4 Compartidos y Por cobrar (vida en pareja)

- Un pago puede tener `Grupo` y `Mi parte` (por defecto monto ÷ N, editable). Saldos de cuentas usan el monto pagado; presupuesto y gráficos usan `Mi parte`.
- Tipo **Reembolso** (de un Grupo): no cuenta como ingreso ni gasto; solo cierra deuda. Ej.: el Bizum de tu pareja.
- **Por cobrar** por grupo = suma(Monto − Mi parte) − reembolsos recibidos. Grupos típicos: **Pareja** (continuo, 50/50), Viaje, Cumple de Marcos.
- Reembolso en ARS se convierte a EUR al cambio del día de la transferencia; las diferencias de redondeo se aceptan o se cierran con "Ajuste Splitwise".
- Lo histórico no se migra: sigue neteando por categoría.

### 3.5 Escenarios (Proyección aparte)

- La Proyección es un **simulador separado** [decidido: "es algo aparte, para jugar con gastos futuros"]. Los escenarios no tocan los datos reales.
- Se guardan como Pagos futuros marcados **"hipotético"** (activo sí/no) en una pestaña `Escenarios` o `Pagos futuros` con flag [propuesto]: id, nombre, fecha, monto (− gasto, + ingreso), cuotas, cuenta, activo.
- Presupuesto por mes y categoría: `PresupuestoCategorias` / `Presupuesto`. Hoy está deshabilitado en `getBootstrap()` por un bug (devuelve null): reactivarlo antes de la Proyección. Abierto: mover el presupuesto editable fuera de Proyección a Categorías.

### 3.6 Otros

- Unificar Cash/Efectivo y confirmar Ualá. Categorías se leen del Sheet.

## 4. Design tokens

Tipografía: **Bricolage Grotesque** (700) títulos y cifras grandes; **Figtree** (400–700) el resto. Cifras con `tabular-nums`. Español rioplatense; montos es-ES (`1.234,56 €`, `$ 3.480.000`, `US$ 1.920`).

| Token | Valor | Uso |
| --- | --- | --- |
| Fondo | `#F3F4EF` | Pantalla |
| Superficie | `#FFFFFF` | Tarjetas, barra inferior |
| Línea | `#E3E6DE` (suave `#EEF0E9`, controles `#C9CEC4`) | Bordes |
| Texto | `#17211C` | Principal |
| Texto secundario | `#566159` | Etiquetas |
| Verde | `#0E6B4D` / `#DDEFE5` | Acción, ok, ingresos, EUR |
| Ámbar | `#A8480A` / `#FCE9D2` (tenue `#FFF8EE`) | Pendiente, alerta |
| Azul | `#1F4F99` / `#E1EAF7` | Transferencias propias, reglas, ARS |
| Pista | `#E8EBE3` / `#EEF0E9` | Barras |

Moneda: EUR verde, ARS azul, USD gris. Radios 18–20 tarjetas, 12–16 botones. Móvil 390 px, gutter 20, barra inferior de 4 pestañas + "+" de 52 px. Escritorio: barra lateral 232 px + contenido fluido (`flex-wrap`).

## 5. Pantallas

### Móvil

1. **Inicio** (`Main`): presupuesto del mes, aviso de tarjeta, tarjetas Pendientes y Por cobrar, "Septiembre sin cerrar", patrimonio por moneda.
2. **Nuevo movimiento** (`Nuevo`): Gasto / Ingreso / Entre cuentas / Reembolso; monto y moneda primero; cuenta (última usada primero); categoría recientes + "Todas"; bloque **Compartido** con Grupo "Pareja" por defecto y Mi parte editable. **Guardado optimista**: la pantalla confirma al instante y sincroniza en segundo plano (Apps Script tiene arranque en frío). Mes de pago y cuotas siguen disponibles como filas desplegables (no dibujadas).
3. **Movimientos** (`Pendientes`): contadores Pendiente / Conciliado, lista con alerta "Para completar" (falta categoría), sin paso de validación manual obligatorio.
4. **Cierre de mes** (`CierreMovil`, nueva): estado del mes por cuenta (cargado, conciliado con banco o no), "Subir extracto" **opcional**, "Cerrar mes sin banco" disponible.
5. **Revisar importación** (`Revisar`): pestañas Para revisar / Listos / Propias; tarjeta **Coincide** (par cargado/banco con Fusionar), reembolso de la pareja, categoría dudosa (AMZN); "Importar N listos".
6. **Por cobrar** (`Cobrar`): total; grupos **Pareja** (continuo), Viaje, Cumple de Marcos; pagado, tu parte, recibido, pendiente; "Marcar reembolso", "Ver pagos", "Ajuste Splitwise".
7. **Cuentas** (`Cuentas`): saldos por moneda; "No cuadra" con **Conciliar saldo** [propuesto].
8. **Proyección** (`Planificar`): simulador aparte; saldo final con/sin escenarios; lista "Y si…" con interruptores e indicador "hipotético".

### Escritorio

9. **Inicio** (`Escritorio`): presupuesto por categoría, Pendientes, coincidencias, Por cobrar, patrimonio, Cierre de septiembre, Pagos futuros.
10. **Cierre de mes** (`Cierre`): Subir → Revisar → Confirmar; tabla con categoría editable; fila "REST. EL XAMPANYET = tu carga del 18 sep" con chip "Coincide"; panel "Qué va a pasar"; "Aprender de tus cambios".
11. **Categorías y reglas** (`Reglas`): reglas ordenadas, duplicadas, probador, unificar Cash/Efectivo.
12. **Proyección** (`Proyeccion`): gráfico de saldo con/sin escenarios, desglose, presupuesto editable, lista "Y si…" con "hipotético".

## 6. Navegación

- **Móvil (barra inferior)**: Inicio · Movimientos · "+" · Cierre · Cuentas. **Por cobrar sale de la barra** (se llega desde la tarjeta de Inicio) para dar lugar a Cierre.
- **Escritorio (lateral)**: Inicio · Movimientos · Cierre de mes · Por cobrar · Cuentas · Acciones y cripto · Categorías y reglas · separador **"Aparte"** · Proyección.

## 7. Cambios de backend

Mantener nombres y forma de las llamadas existentes; anotar cada cambio.

- `getBootstrap()`: devolver `grupo`, `miParte`, `conciliado`, presupuesto reactivado, escenarios activos.
- Acciones: editar categoría, fusionar coincidencia, marcar "son distintos", conciliar.
- Cruce de extractos contra Pendientes (3.3).
- Reembolsos y Por cobrar por grupo; ajuste Splitwise.
- Cuentas: conciliar saldo → movimiento de ajuste.
- Proyección: saldo día a día (inicial + entradas − pagos conocidos − variables ± escenarios activos).
- **`doPost` del Atajo** con clave secreta: inserta con `Origen = 'atajo'`. Debe aceptar un **ID único por envío** (generado en el iPhone) para ser **idempotente**: si el Atajo reintenta, no duplica.
- **`LockService`** en toda escritura concurrente (Atajo + app a la vez).
- Dos despliegues (/dev y /exec): usar siempre el de /exec para el Atajo.
- Reglas: limpiar duplicadas, probar, reordenar.

## 8. Orden de implementación (cortes verticales)

Cada corte deja algo usable de punta a punta:

1. **Corte 1 — Cargar y ver**: tokens + componentes + Inicio + Nuevo movimiento + Movimientos contra el Sheet real; columnas L–N creadas. Guardado optimista + `LockService`.
2. **Corte 2 — Atajo**: `doPost` con clave e ID único (idempotente); entra a Movimientos como Pendiente.
3. **Corte 3 — Compartidos**: Grupo / Mi parte / Reembolso / Por cobrar (Pareja). Presupuesto reactivado.
4. **Corte 4 — Cierre y banco opcional**: Cierre móvil/escritorio, importación con Coincidencias, estado Conciliado. Cerrar mes sin banco.
5. **Corte 5 — Cuentas**: conciliar saldo.
6. **Corte 6 — Proyección** aparte con escenarios hipotéticos.
7. **Corte 7 — Reglas** (limpieza, probador), rendimiento (caché, carga progresiva).
8. **Corte 8 — Acciones y cripto**, aviso de tarjeta, perfiles BBVA y Trade Republic.

## 9. Decisiones abiertas

- Nombre y valores de la columna `Conciliado`; qué pasa con `Validado` (K) en lo existente.
- Mes de pago: no es columna real hoy; decidir si se agrega.
- Qué cuentas forman el **saldo líquido** de la Proyección; origen del sueldo esperado; cálculo del "promedio de 3 meses".
- Dónde vive el presupuesto editable (Proyección vs Categorías).
- Umbral de alerta de presupuesto (75%, supuesto).
- Si Dani abandona el banco: qué queda del cruce (nada obligatorio) y cómo se valida el saldo (Conciliar saldo en Cuentas).
- Del roadmap: Atajo con clave vs Google Form; categoría del ingreso de 810 €; IA para sugerir categorías (por defecto no).

## 10. Lo que NO está diseñado

- Acciones y cripto; edición de un movimiento existente; alta/edición de pagos recurrentes.
- Versión móvil de Reglas; estados vacíos, de carga, error y sin conexión (el guardado optimista necesita un estado "sincronizando / falló, reintentar").
- Modo oscuro, tablet, onboarding; el Atajo y su configuración de claves.
