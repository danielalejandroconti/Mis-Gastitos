/**
 * MIS GASTITOS — backend real (Google Apps Script)
 *
 * Pegá el ID de tu Google Sheet acá abajo. Lo sacás de la URL:
 * https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit
 */
// Despliegue: cada push a main publica en HEAD (/dev) y, si hay DEPLOYMENT_ID, en /exec.
const SHEET_ID = '1_UPXULf7J7wIIhdpYx76QidfC36ljOBpKu4B79lAAJ8';

function doGet(e) {
  // Si activaste el Atajo del iPhone, existe una "ventanilla" pública (acceso: Cualquier persona) para recibir los pagos.
  // Esa URL NO debe mostrar la app: solo la abre quien entró con tu cuenta de Google.
  if (PropertiesService.getScriptProperties().getProperty('VENTANILLA_ACTIVA') === 'si') {
    const yo = Session.getEffectiveUser().getEmail();
    const quien = Session.getActiveUser().getEmail();
    if (!quien || !yo || quien !== yo) {
      return ContentService.createTextOutput('Mis gastitos: ventanilla del Atajo. Acá no hay nada para ver.');
    }
  }
  const vieja = e && e.parameter && e.parameter.v === 'old';
  return HtmlService.createTemplateFromFile(vieja ? 'IndexViejo' : 'Index')
    .evaluate()
    .setTitle('Mis gastitos')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('No existe la pestaña "' + name + '" en el Sheet. Revisá SETUP.md.');
  return sh;
}

function rowsToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter((r) => r.join('') !== '')
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i]));
      return obj;
    });
}

function formatDate_(d) {
  if (!(d instanceof Date)) return d;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function parseFechaDDMMYYYY_(str) {
  const partes = String(str).split('/');
  if (partes.length !== 3) return null;
  return new Date(partes[2], partes[1] - 1, partes[0]);
}

/**
 * Normaliza un importe que puede venir en distintos formatos según el banco:
 * - Con signo menos "raro" (−, U+2212) en vez de guión normal (Santander lo usa).
 * - Con coma como separador decimal y punto como separador de miles (es-ES: "1.234,56").
 * - Con punto como separador decimal directamente (Revolut: "1234.56").
 * - Con coma como separador de miles y punto como decimal (en-US: "1,234.56") — pasa, por
 *   ejemplo, cuando un Excel de Santander se sube a Google Drive y se vuelve a descargar como CSV
 *   con la hoja en configuración regional en inglés: los números se re-formatean a ese estilo.
 * - Con símbolos de moneda (€, $) que hay que descartar.
 */
function normalizeImporte_(raw) {
  let s = String(raw).trim();
  s = s.replace(/−/g, '-'); // signo menos unicode → guión normal
  s = s.replace(/[€$\s]/g, '');
  const tieneComa = s.indexOf(',') !== -1;
  const tienePunto = s.indexOf('.') !== -1;
  if (tieneComa && tienePunto) {
    // Vienen los dos separadores juntos: el que aparece último (más a la derecha) es el decimal,
    // el otro es el separador de miles. Así funciona tanto "1.175,18" (es-ES) como "1,175.18" (en-US).
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (tieneComa) {
    // Solo coma: es el separador decimal (es-ES sin miles, ej. "175,18").
    s = s.replace(',', '.');
  }
  // Solo punto, o ningún separador: ya viene en un formato que Number() interpreta bien.
  return Number(s) || 0;
}

function parseFechaPerfil_(raw, formato) {
  const s = String(raw).trim();
  if (formato === 'DD/MM/YYYY') {
    const [d, m, y] = s.split('/');
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  if (formato === 'YYYY-MM-DD') {
    return new Date(s.substring(0, 10).replace(' ', 'T'));
  }
  return new Date(s);
}

/* ============================ TRANSACCIONES ============================ */

function getTransacciones() {
  const sh = sheet_('Transacciones');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const esperados = ['ID', 'Fecha', 'Concepto', 'Monto', 'Moneda', 'Cuenta', 'Categoría', 'Subcategoría', 'Origen', 'Notas'];
  const faltan = esperados.filter((h) => headers.indexOf(h) === -1);
  if (faltan.length) {
    throw new Error(
      'La pestaña "Transacciones" no tiene los encabezados esperados en la fila 1 (faltan: ' +
      faltan.join(', ') + '). Revisá que la fila 1 diga exactamente: ' + esperados.join(' | ')
    );
  }

  const rows = rowsToObjects_(sh);
  return rows
    .map((r) => ({
      id: r['ID'],
      fecha: formatDate_(r['Fecha']),
      concepto: r['Concepto'] || '',
      monto: Number(r['Monto']) || 0,
      moneda: r['Moneda'] || '',
      cuenta: r['Cuenta'] || '',
      categoria: r['Categoría'] || '',
      subcategoria: r['Subcategoría'] || '',
      origen: r['Origen'] || '',
      notas: r['Notas'] || '',
      // Vacío = validado (todo el histórico). Solo 'No' es pendiente.
      validado: r['Validado'] !== 'No',
      // Corte 3 y 4 (compartidos / banco). Nunca devolver undefined (ver nota en getPresupuestoCategorias).
      grupo: r['Grupo'] || '',
      miParte: (r['Mi parte'] === '' || r['Mi parte'] === undefined) ? null : Number(r['Mi parte']),
      conciliado: r['Conciliado'] ? String(r['Conciliado']) : '',
    }))
    .sort((a, b) => parseFechaDDMMYYYY_(b.fecha) - parseFechaDDMMYYYY_(a.fecha));
}

// 'yyyy-mm-dd' (lo que manda un <input type="date">) -> Date armado a mano con los componentes
// (y, m, d) en vez de new Date(string), para evitar corrimientos de un día por huso horario.
function parseFechaISOInput_(str) {
  const partes = String(str).split('-');
  return partes.length === 3
    ? new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]))
    : new Date(str);
}

// Devuelve el número de columna (1-based) de "Validado" en Transacciones, creando el encabezado
// en la primera columna libre si todavía no existe — así no hace falta que Dani prepare nada a
// mano en el Sheet para que funcione la revisión de "sin validar".
function columnaValidado_(sh) {
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  let col = headers.indexOf('Validado');
  if (col === -1) {
    col = headers.length;
    sh.getRange(1, col + 1).setValue('Validado');
  }
  return col + 1;
}

function addTransaccionManual(tx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Transacciones');
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const col = (nombre) => headers.indexOf(nombre);
    const id = tx.id || Utilities.getUuid();

    const idCol = col('ID');
    const ultima = sh.getLastRow();
    if (ultima > 1) {
      const ids = sh.getRange(2, idCol + 1, ultima - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === id) return { ok: true, id: id, duplicado: true };
      }
    }

    const fila = headers.map(() => '');
    const poner = (nombre, valor) => { const c = col(nombre); if (c !== -1) fila[c] = valor; };
    poner('ID', id);
    poner('Fecha', parseFechaISOInput_(tx.fecha));
    poner('Concepto', tx.concepto);
    poner('Monto', Number(tx.monto));
    poner('Moneda', tx.moneda);
    poner('Cuenta', tx.cuenta);
    poner('Categoría', tx.categoria || '');
    poner('Subcategoría', tx.subcategoria || '');
    poner('Origen', tx.origen || 'manual');
    poner('Notas', tx.notas || '');
    poner('Validado', 'No');
    poner('Grupo', tx.grupo || '');
    poner('Mi parte', (tx.miParte === undefined || tx.miParte === null || tx.miParte === '') ? '' : Number(tx.miParte));

    sh.getRange(ultima + 1, 1, 1, fila.length).setValues([fila]);
    SpreadsheetApp.flush();
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

// Edición completa de una transacción ya cargada (no solo categoría/subcategoría) — para corregir
// cualquier campo mal cargado, por ejemplo si se seleccionó el banco/cuenta equivocado.
function actualizarTransaccionCompleta(id, campos) {
  const sh = sheet_('Transacciones');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const cols = {
    fecha: headers.indexOf('Fecha'),
    concepto: headers.indexOf('Concepto'),
    monto: headers.indexOf('Monto'),
    moneda: headers.indexOf('Moneda'),
    cuenta: headers.indexOf('Cuenta'),
    categoria: headers.indexOf('Categoría'),
    subcategoria: headers.indexOf('Subcategoría'),
    notas: headers.indexOf('Notas'),
  };
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] !== id) continue;
    const fila = i + 1;
    if (cols.fecha !== -1 && campos.fecha) sh.getRange(fila, cols.fecha + 1).setValue(parseFechaISOInput_(campos.fecha));
    if (cols.concepto !== -1) sh.getRange(fila, cols.concepto + 1).setValue(campos.concepto || '');
    if (cols.monto !== -1) sh.getRange(fila, cols.monto + 1).setValue(Number(campos.monto) || 0);
    if (cols.moneda !== -1) sh.getRange(fila, cols.moneda + 1).setValue(campos.moneda || '');
    if (cols.cuenta !== -1) sh.getRange(fila, cols.cuenta + 1).setValue(campos.cuenta || '');
    if (cols.categoria !== -1) sh.getRange(fila, cols.categoria + 1).setValue(campos.categoria || '');
    if (cols.subcategoria !== -1) sh.getRange(fila, cols.subcategoria + 1).setValue(campos.subcategoria || '');
    if (cols.notas !== -1 && campos.notas !== undefined) sh.getRange(fila, cols.notas + 1).setValue(campos.notas || '');
    return { ok: true };
  }
  return { ok: false, error: 'No se encontró esa transacción.' };
}

// Marca como validadas (columna "Validado" = 'Sí') una o varias transacciones — se usa cuando
// Dani termina de revisar lo recién importado/cargado a mano en el porlet "Sin validar".
function marcarValidadas(ids) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Transacciones');
    const colValidado = columnaValidado_(sh);
    const values = sh.getDataRange().getValues();
    const idCol = values[0].indexOf('ID');
    const idSet = {};
    (ids || []).forEach((id) => { idSet[id] = true; });
    let marcadas = 0;
    for (let i = 1; i < values.length; i++) {
      if (idSet[values[i][idCol]]) {
        sh.getRange(i + 1, colValidado).setValue('Sí');
        marcadas++;
      }
    }
    return { ok: true, marcadas: marcadas };
  } finally {
    lock.releaseLock();
  }
}

function actualizarCategoria(id, categoria, subcategoria) {
  const sh = sheet_('Transacciones');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const catCol = headers.indexOf('Categoría');
  const subCol = headers.indexOf('Subcategoría');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      sh.getRange(i + 1, catCol + 1).setValue(categoria);
      sh.getRange(i + 1, subCol + 1).setValue(subcategoria);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró esa transacción.' };
}

// Igual que actualizarCategoria pero para varias transacciones a la vez (un solo recorrido de la
// hoja en vez de uno por cada ID) — usado por la categorización en lote de Transacciones.
function actualizarCategoriaLote(ids, categoria, subcategoria) {
  const sh = sheet_('Transacciones');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const catCol = headers.indexOf('Categoría');
  const subCol = headers.indexOf('Subcategoría');
  const idSet = {};
  (ids || []).forEach((id) => { idSet[id] = true; });
  let actualizadas = 0;
  for (let i = 1; i < values.length; i++) {
    if (idSet[values[i][idCol]]) {
      sh.getRange(i + 1, catCol + 1).setValue(categoria);
      sh.getRange(i + 1, subCol + 1).setValue(subcategoria);
      actualizadas++;
    }
  }
  return { ok: true, actualizadas: actualizadas };
}

// Misma llamada de siempre, ahora con candado (varias escrituras a la vez no se pisan al correr las filas).
function eliminarTransaccion(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return eliminarFilaPorId_('Transacciones', id);
  } finally {
    lock.releaseLock();
  }
}

// Herramienta de limpieza manual: corré esto UNA SOLA VEZ desde el editor de Apps Script
// (elegí "eliminarDuplicadosExactos" en el desplegable de funciones y apretá ▶) si notás
// transacciones duplicadas en la pestaña — por ejemplo por un doble click en "Confirmar
// importación" antes de este arreglo. Borra las filas que son un duplicado EXACTO (misma fecha,
// concepto, monto y cuenta) de una fila anterior, dejando una sola copia de cada una. No toca
// nada que no sea un duplicado exacto.
function eliminarDuplicadosExactos() {
  const sh = sheet_('Transacciones');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const fechaCol = headers.indexOf('Fecha');
  const conceptoCol = headers.indexOf('Concepto');
  const montoCol = headers.indexOf('Monto');
  const cuentaCol = headers.indexOf('Cuenta');

  const vistos = {};
  const filasABorrar = [];
  for (let i = 1; i < values.length; i++) {
    const fechaRaw = values[i][fechaCol];
    const fechaStr = fechaRaw instanceof Date
      ? Utilities.formatDate(fechaRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(fechaRaw);
    const clave = [
      fechaStr,
      String(values[i][conceptoCol]).trim().toLowerCase(),
      (Number(values[i][montoCol]) || 0).toFixed(2),
      values[i][cuentaCol],
    ].join('|');
    if (vistos[clave]) {
      filasABorrar.push(i + 1); // número de fila real en la hoja (1-based, la fila 1 es el header)
    } else {
      vistos[clave] = true;
    }
  }

  // Borramos de abajo hacia arriba para que los números de fila de las que faltan no se corran.
  filasABorrar.sort((a, b) => b - a).forEach((fila) => sh.deleteRow(fila));

  return { ok: true, borradas: filasABorrar.length };
}

// Reemplaza una transacción por 2 o más, repartiendo el mismo monto total entre ellas — para
// separar, por ejemplo, una transferencia de la pareja que junta alquiler + compras, o un
// resumen de tarjeta que en realidad son varios gastos distintos. Cada parte puede llevar su
// propio concepto, categoría y subcategoría; fecha, cuenta, moneda y estado de validación se
// heredan de la transacción original.
function dividirTransaccion(id, partes) {
  if (!partes || partes.length < 2) {
    return { ok: false, error: 'Hacen falta al menos 2 partes para dividir.' };
  }
  const sh = sheet_('Transacciones');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const fechaCol = headers.indexOf('Fecha');
  const monedaCol = headers.indexOf('Moneda');
  const cuentaCol = headers.indexOf('Cuenta');
  const origenCol = headers.indexOf('Origen');
  const notasCol = headers.indexOf('Notas');
  const montoCol = headers.indexOf('Monto');
  const validadoCol = headers.indexOf('Validado');

  let filaOriginal = -1;
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) { filaOriginal = i; break; }
  }
  if (filaOriginal === -1) return { ok: false, error: 'No se encontró esa transacción.' };

  const montoOriginal = Number(values[filaOriginal][montoCol]) || 0;
  const sumaPartes = Math.round(partes.reduce((s, p) => s + (Number(p.monto) || 0), 0) * 100) / 100;
  if (Math.abs(sumaPartes - Math.round(montoOriginal * 100) / 100) >= 0.01) {
    return {
      ok: false,
      error: 'La suma de las partes (' + sumaPartes.toFixed(2) + ') no coincide con el monto original (' + montoOriginal.toFixed(2) + ').',
    };
  }

  const fechaOriginal = values[filaOriginal][fechaCol];
  const monedaOriginal = values[filaOriginal][monedaCol];
  const cuentaOriginal = values[filaOriginal][cuentaCol];
  const origenOriginal = origenCol !== -1 ? values[filaOriginal][origenCol] : '';
  const notasOriginal = notasCol !== -1 ? values[filaOriginal][notasCol] : '';
  const validadoOriginal = validadoCol !== -1 ? values[filaOriginal][validadoCol] : '';

  sh.deleteRow(filaOriginal + 1);

  const nuevasFilas = partes.map((p) => [
    Utilities.getUuid(),
    fechaOriginal,
    p.concepto || '',
    Number(p.monto) || 0,
    monedaOriginal,
    cuentaOriginal,
    p.categoria || '',
    p.subcategoria || '',
    (origenOriginal ? origenOriginal + ':' : '') + 'dividido',
    notasOriginal || '',
  ]);
  const filaInicio = sh.getLastRow() + 1;
  sh.getRange(filaInicio, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);

  // Las partes nuevas heredan el estado de validación de la original: si ya estaba validada, las
  // partes también; si todavía estaba en el porlet "Sin validar", las partes siguen ahí.
  if (validadoOriginal) {
    const colValidado = columnaValidado_(sh);
    sh.getRange(filaInicio, colValidado, nuevasFilas.length, 1).setValues(nuevasFilas.map(() => [validadoOriginal]));
  }

  return { ok: true, agregadas: nuevasFilas.length };
}

/* ============================ REGLAS ============================ */

function getReglas() {
  return rowsToObjects_(sheet_('Reglas')).map((r) => ({
    patron: String(r['Patrón']).toLowerCase(),
    categoria: r['Categoría'],
    subcategoria: r['Subcategoría'],
  }));
}

function agregarRegla(patron, categoria, subcategoria) {
  sheet_('Reglas').appendRow([String(patron).toLowerCase(), categoria, subcategoria]);
  return { ok: true };
}

function eliminarRegla(patron) {
  const sh = sheet_('Reglas');
  const values = sh.getDataRange().getValues();
  const buscado = String(patron).toLowerCase();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === buscado) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró esa regla.' };
}

function categorizar_(concepto, reglas) {
  const texto = String(concepto).toLowerCase();
  for (let i = 0; i < reglas.length; i++) {
    const r = reglas[i];
    if (r.patron && texto.indexOf(r.patron) !== -1) {
      return { categoria: r.categoria, subcategoria: r.subcategoria };
    }
  }
  return null;
}

/* ============================ IMPORTAR (por perfil de banco) ============================ */

/**
 * Cada banco exporta distinto. En vez de asumir un único formato de columnas,
 * cada cuenta del Sheet tiene un "Perfil de importación" (columna en la pestaña
 * Cuentas) que le dice a esta función cómo leer su CSV: separador, en qué
 * columna está cada dato, y en qué formato viene la fecha.
 *
 * Santander: exportalo como CSV desde Excel/Sheets (separador ";", decimal con coma).
 * Revolut: el CSV que descargás directo de la app/web ya sirve tal cual.
 * MyInvestor: el CSV que descargás directo ya sirve tal cual (separador ";").
 * Mercado Pago: viene en PDF, no en CSV — no tiene perfil acá. Se carga a mano
 * (ver "Carga manual de Mercado Pago" en SETUP.md).
 */
const PERFILES_IMPORTACION = {
  santander: {
    delimiter: ';',
    headerMatch: 'fecha operación',
    col: { fecha: 0, concepto: 2, monto: 3 },
    fechaFormato: 'DD/MM/YYYY',
  },
  revolut: {
    delimiter: ',',
    headerMatch: 'tipo',
    col: { fecha: 2, concepto: 4, monto: 5, fee: 6, estado: 8 },
    fechaFormato: 'YYYY-MM-DD',
  },
  myinvestor: {
    delimiter: ';',
    headerMatch: 'fecha de operación',
    col: { fecha: 0, concepto: 2, monto: 3 },
    fechaFormato: 'DD/MM/YYYY',
  },
};

// Algunos bancos exportan el estado de la transacción en español ("COMPLETADO"),
// otros en inglés según el idioma de la cuenta (Revolut exporta "COMPLETED" si la
// cuenta está en inglés) — aceptamos ambos para no descartar filas válidas.
const ESTADOS_COMPLETADO_ = new Set(['COMPLETADO', 'COMPLETED']);

function getPerfilesImportacion() {
  return Object.keys(PERFILES_IMPORTACION);
}

/**
 * El separador "real" de un CSV puede variar según cómo lo bajaste: la exportación directa
 * del banco a veces usa ";", pero si pasaste por "Archivo → Descargar → CSV" en Google Sheets
 * (como sugiere el SETUP para Santander/MyInvestor), Sheets exporta siempre con ",". En vez de
 * asumir uno fijo por perfil, miramos la primera línea del archivo y usamos el que aparezca.
 */
function detectarDelimitador_(csvTexto) {
  const primeraLinea = String(csvTexto).split('\n')[0];
  return primeraLinea.indexOf(';') !== -1 ? ';' : ',';
}

/**
 * perfil: una de las claves de PERFILES_IMPORTACION ('santander' | 'revolut' | 'myinvestor')
 * csvTexto: contenido crudo del archivo, tal cual lo descargaste del banco.
 */
function importarCsv(perfil, cuentaNombre, moneda, csvTexto) {
  const conf = PERFILES_IMPORTACION[perfil];
  if (!conf) {
    return { ok: false, error: 'Perfil de importación desconocido: "' + perfil + '". Revisá SETUP.md.' };
  }

  const delimiter = detectarDelimitador_(csvTexto);
  const filas = Utilities.parseCsv(csvTexto, delimiter);
  if (!filas.length) return { ok: false, error: 'El archivo está vacío.' };

  let inicio = filas.findIndex((f) => f[0] && String(f[0]).trim().toLowerCase() === conf.headerMatch);
  if (inicio === -1) inicio = 0; // fallback: asumimos que ya viene sin filas de metadata
  const datos = filas.slice(inicio + 1);

  const reglas = getReglas();
  const sh = sheet_('Transacciones');
  const existentes = {};
  rowsToObjects_(sh).forEach((r) => {
    existentes[hashTx_(r['Fecha'], r['Concepto'], r['Monto'])] = true;
  });

  let agregados = 0,
    pendientes = 0,
    duplicados = 0,
    omitidosPorEstado = 0;
  const nuevasFilas = [];

  datos.forEach((f) => {
    if (!f[conf.col.fecha]) return;
    if (conf.col.estado !== undefined && f[conf.col.estado] &&
        !ESTADOS_COMPLETADO_.has(String(f[conf.col.estado]).trim().toUpperCase())) {
      omitidosPorEstado++; // ej: pagos "PENDIENTE" en Revolut — se importan cuando confirmen
      return;
    }

    const fecha = parseFechaPerfil_(f[conf.col.fecha], conf.fechaFormato);
    const concepto = f[conf.col.concepto];
    let monto = normalizeImporte_(f[conf.col.monto]);
    if (conf.col.fee !== undefined && f[conf.col.fee]) {
      monto -= normalizeImporte_(f[conf.col.fee]);
    }
    if (isNaN(fecha.getTime()) || !concepto) return;

    const hash = hashTx_(fecha, concepto, monto);
    if (existentes[hash]) {
      duplicados++;
      return;
    }
    existentes[hash] = true;

    const match = categorizar_(concepto, reglas);
    const id = Utilities.getUuid();
    nuevasFilas.push([
      id,
      fecha,
      concepto,
      monto,
      moneda,
      cuentaNombre,
      match ? match.categoria : '',
      match ? match.subcategoria : '',
      'importado:' + perfil,
      '',
    ]);
    if (match) agregados++;
    else pendientes++;
  });

  if (nuevasFilas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
  }

  return {
    ok: true,
    agregados: agregados,
    pendientes: pendientes,
    duplicados: duplicados,
    omitidosPorEstado: omitidosPorEstado,
    total: nuevasFilas.length,
  };
}

/**
 * Como importarCsv() de arriba, pero NO escribe nada en el Sheet: solo parsea, categoriza
 * y devuelve las filas para que el usuario las revise/corrija en pantalla antes de que
 * impacten. El commit real lo hace confirmarImportacion() con las filas ya validadas.
 */
function previsualizarCsv(perfil, csvTexto) {
  const conf = PERFILES_IMPORTACION[perfil];
  if (!conf) {
    return { ok: false, error: 'Perfil de importación desconocido: "' + perfil + '". Revisá SETUP.md.' };
  }

  const delimiter = detectarDelimitador_(csvTexto);
  const filas = Utilities.parseCsv(csvTexto, delimiter);
  if (!filas.length) return { ok: false, error: 'El archivo está vacío.' };

  let inicio = filas.findIndex((f) => f[0] && String(f[0]).trim().toLowerCase() === conf.headerMatch);
  if (inicio === -1) inicio = 0;
  const datos = filas.slice(inicio + 1);

  const reglas = getReglas();
  const existentes = {};
  rowsToObjects_(sheet_('Transacciones')).forEach((r) => {
    existentes[hashTx_(r['Fecha'], r['Concepto'], r['Monto'])] = true;
  });

  const filasPreview = [];
  let duplicados = 0,
    omitidosPorEstado = 0;

  datos.forEach((f) => {
    if (!f[conf.col.fecha]) return;
    if (conf.col.estado !== undefined && f[conf.col.estado] &&
        !ESTADOS_COMPLETADO_.has(String(f[conf.col.estado]).trim().toUpperCase())) {
      omitidosPorEstado++;
      return;
    }

    const fecha = parseFechaPerfil_(f[conf.col.fecha], conf.fechaFormato);
    const concepto = f[conf.col.concepto];
    let monto = normalizeImporte_(f[conf.col.monto]);
    if (conf.col.fee !== undefined && f[conf.col.fee]) {
      monto -= normalizeImporte_(f[conf.col.fee]);
    }
    if (isNaN(fecha.getTime()) || !concepto) return;

    const hash = hashTx_(fecha, concepto, monto);
    if (existentes[hash]) {
      duplicados++;
      return;
    }

    const match = categorizar_(concepto, reglas);
    filasPreview.push({
      fecha: formatDate_(fecha),
      concepto: concepto,
      monto: monto,
      categoria: match ? match.categoria : '',
      subcategoria: match ? match.subcategoria : '',
      autoDetectado: !!match,
    });
  });

  return { ok: true, perfil: perfil, filas: filasPreview, duplicados: duplicados, omitidosPorEstado: omitidosPorEstado };
}

/**
 * Escribe en Transacciones las filas que ya pasaron por la pantalla de revisión (con la
 * categoría que el usuario confirmó o corrigió). Las que el usuario tildó "Recordar regla"
 * también se agregan a la pestaña Reglas para la próxima importación.
 */
function confirmarImportacion(perfil, cuentaNombre, moneda, filas) {
  const sh = sheet_('Transacciones');

  // Blindaje contra doble envío (p.ej. un doble click en "Confirmar importación" mientras se
  // espera la respuesta): si alguna de estas filas ya existe en la hoja (mismo hash que usa la
  // vista previa), la salteamos en vez de volver a agregarla.
  const existentes = {};
  rowsToObjects_(sh).forEach((r) => {
    existentes[hashTx_(r['Fecha'], r['Concepto'], r['Monto'])] = true;
  });

  let omitidosPorDuplicado = 0;
  const filasAImportar = filas.filter((f) => {
    const hash = hashTx_(parseFechaDDMMYYYY_(f.fecha), f.concepto, Number(f.monto));
    if (existentes[hash]) { omitidosPorDuplicado++; return false; }
    existentes[hash] = true; // también deduplica dentro de la misma tanda, por si vino repetida
    return true;
  });
  const nuevasFilas = filasAImportar.map((f) => [
    Utilities.getUuid(),
    parseFechaDDMMYYYY_(f.fecha),
    f.concepto,
    Number(f.monto),
    moneda,
    cuentaNombre,
    f.categoria || '',
    f.subcategoria || '',
    'importado:' + perfil,
    '',
  ]);

  if (nuevasFilas.length) {
    const filaInicio = sh.getLastRow() + 1;
    sh.getRange(filaInicio, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
    // Todo lo recién importado arranca sin validar, aunque ya venga con categoría sugerida por
    // las reglas — Dani quiere revisarlo una vez más en el porlet "Sin validar" de Transacciones
    // antes de considerarlo definitivo.
    const colValidado = columnaValidado_(sh);
    sh.getRange(filaInicio, colValidado, nuevasFilas.length, 1).setValues(nuevasFilas.map(() => ['No']));
  }

  // Solo agregamos reglas por las filas que realmente se importaron (no por duplicados salteados),
  // y evitamos agregar dos veces el mismo patrón si ya existe.
  const patronesExistentes = {};
  getReglas().forEach((r) => { patronesExistentes[r.patron] = true; });
  filasAImportar.forEach((f) => {
    const patron = (f.concepto || '').toLowerCase();
    if (f.recordarRegla && f.categoria && !patronesExistentes[patron]) {
      agregarRegla(patron, f.categoria, f.subcategoria || '');
      patronesExistentes[patron] = true;
    }
  });

  return { ok: true, agregados: nuevasFilas.length, omitidosPorDuplicado: omitidosPorDuplicado };
}

function hashTx_(fecha, concepto, monto) {
  const f = fecha instanceof Date ? Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd') : fecha;
  return f + '|' + String(concepto).trim().toLowerCase() + '|' + Number(monto).toFixed(2);
}

/* ============================ CUENTAS / DASHBOARD ============================ */

function getCuentas() {
  return rowsToObjects_(sheet_('Cuentas'));
}

function getDashboard() {
  const cuentas = getCuentas();
  const txs = getTransacciones();

  const saldoPorCuenta = {};
  cuentas.forEach((c) => (saldoPorCuenta[c['Nombre']] = 0));
  txs.forEach((t) => {
    if (saldoPorCuenta[t.cuenta] === undefined) saldoPorCuenta[t.cuenta] = 0;
    saldoPorCuenta[t.cuenta] += t.monto;
  });

  const porGrupo = {};
  cuentas.forEach((c) => {
    const grupo = c['Grupo'] || 'Otros';
    if (!porGrupo[grupo]) porGrupo[grupo] = { total: 0, moneda: c['Moneda'], cuentas: [] };
    const saldo = saldoPorCuenta[c['Nombre']] || 0;
    porGrupo[grupo].total += saldo;
    porGrupo[grupo].cuentas.push({ nombre: c['Nombre'], saldo: saldo });
  });

  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();
  const gastosPorCategoria = {};
  let ahorroNeto = 0;

  txs.forEach((t) => {
    const fecha = parseFechaDDMMYYYY_(t.fecha);
    if (!fecha || fecha.getMonth() !== mesActual || fecha.getFullYear() !== anioActual) return;
    ahorroNeto += t.monto;
    if (t.monto < 0) {
      const cat = t.categoria || 'Sin categoría';
      gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + Math.abs(t.monto);
    }
  });

  return { porGrupo: porGrupo, gastosPorCategoria: gastosPorCategoria, ahorroNeto: ahorroNeto };
}

/* ============================ PRESUPUESTO (fijo / único / cuotas + tarjeta) ============================ */

function getPresupuesto() {
  return rowsToObjects_(sheet_('Presupuesto')).map((r) => ({
    id: r['ID'],
    nombre: r['Nombre'],
    tipo: r['Tipo'],
    monto: Number(r['Monto']) || 0,
    mes: r['Mes'] || '',
    mesInicio: r['MesInicio'] || '',
    cuotas: Number(r['Cuotas']) || 1,
    confirmado: String(r['Confirmado']).toUpperCase() === 'TRUE' || r['Confirmado'] === true,
    origen: r['Origen'] || '',
    tarjeta: r['Tarjeta'] || '',
    categoria: r['Categoría'] || '',
  }));
}

function agregarPresupuesto(it) {
  const sh = sheet_('Presupuesto');
  const id = Utilities.getUuid();
  sh.appendRow([
    id, it.nombre, it.tipo, it.monto, it.mes || '', it.mesInicio || '',
    it.cuotas || 1, !!it.confirmado, it.origen || '', it.tarjeta || '', it.categoria || '',
  ]);
  return { ok: true, id: id };
}

/* ============================ PRESUPUESTO POR CATEGORÍA (tope mensual, editable mes a mes) ============================ */

function getPresupuestoCategorias() {
  const hoja = ss_().getSheetByName('PresupuestoCategorias');
  if (!hoja) return []; // todavía no corriste actualizarSheetParaPresupuestoCategorias()
  // OJO: nunca devolver "undefined" en ningún campo acá — Apps Script tiene un bug/comportamiento
  // donde si CUALQUIER valor de lo que le devolvés a google.script.run es undefined, en vez de
  // fallar con un error te devuelve TODA la respuesta como null (sin avisar). Por eso los || ''.
  return rowsToObjects_(hoja).map((r) => ({
    categoria: r['Categoría'] || '',
    anioMes: r['AnioMes'] || '',
    monto: Number(r['Monto']) || 0,
  }));
}

/** Crea/actualiza el tope de una categoría para un mes puntual ("2026-09"). */
function guardarPresupuestoCategoria(categoria, anioMes, monto) {
  const sh = sheet_('PresupuestoCategorias');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const catCol = headers.indexOf('Categoría');
  const mesCol = headers.indexOf('AnioMes');
  const montoCol = headers.indexOf('Monto');
  for (let i = 1; i < values.length; i++) {
    if (values[i][catCol] === categoria && values[i][mesCol] === anioMes) {
      sh.getRange(i + 1, montoCol + 1).setValue(monto);
      return { ok: true };
    }
  }
  sh.appendRow([categoria, anioMes, Number(monto) || 0]);
  return { ok: true };
}

/** Copia los topes de un mes a otro (para no tener que retipearlos cada mes). No pisa los que ya existan en el mes destino. */
function copiarPresupuestoCategorias(anioMesOrigen, anioMesDestino) {
  const sh = sheet_('PresupuestoCategorias');
  const filas = rowsToObjects_(sh);
  const yaExisten = new Set(filas.filter((f) => f['AnioMes'] === anioMesDestino).map((f) => f['Categoría']));
  filas.filter((f) => f['AnioMes'] === anioMesOrigen && !yaExisten.has(f['Categoría']))
    .forEach((f) => sh.appendRow([f['Categoría'], anioMesDestino, Number(f['Monto']) || 0]));
  return { ok: true };
}

/**
 * Corre esto UNA VEZ desde el editor de Apps Script (▶) para preparar tu Sheet existente
 * para el presupuesto por categoría: crea la pestaña "PresupuestoCategorias" si no existe,
 * y agrega la columna "Categoría" a "Presupuesto" si todavía no la tiene. Es seguro correrlo
 * más de una vez, no duplica nada.
 */
function actualizarSheetParaPresupuestoCategorias() {
  const ss = ss_();
  let hoja = ss.getSheetByName('PresupuestoCategorias');
  if (!hoja) {
    hoja = ss.insertSheet('PresupuestoCategorias');
    hoja.appendRow(['Categoría', 'AnioMes', 'Monto']);
  }
  const presu = ss.getSheetByName('Presupuesto');
  if (presu) {
    const headers = presu.getRange(1, 1, 1, presu.getLastColumn()).getValues()[0];
    if (headers.indexOf('Categoría') === -1) {
      presu.getRange(1, headers.length + 1).setValue('Categoría');
    }
  }
  Logger.log('¡Listo! Ya podés usar el presupuesto por categoría.');
}

function confirmarPresupuesto(id) {
  return actualizarCampoPorId_('Presupuesto', id, 'Confirmado', true);
}

function quitarPresupuesto(id) {
  return eliminarFilaPorId_('Presupuesto', id);
}

function actualizarCampoPorId_(nombreHoja, id, campo, valor) {
  const sh = sheet_(nombreHoja);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const campoCol = headers.indexOf(campo);
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      sh.getRange(i + 1, campoCol + 1).setValue(valor);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró esa fila (ID ' + id + ') en ' + nombreHoja + '.' };
}

function eliminarFilaPorId_(nombreHoja, id) {
  const sh = sheet_(nombreHoja);
  const values = sh.getDataRange().getValues();
  const idCol = values[0].indexOf('ID');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idCol] === id) {
      sh.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No se encontró esa fila (ID ' + id + ').' };
}

/* ============================ ACCIONES Y CRYPTO (operaciones + FIFO) ============================
 *
 * Estas dos categorías no son gasto/ingreso: son compras y ventas de activos. Guardamos cada
 * operación tal cual viene del CSV (nunca "posiciones" ya calculadas) y todo lo demás —cantidad
 * actual, costo base, ganancia realizada al vender, ganancia no realizada de lo que todavía
 * tenés— sale calculado a partir de ese historial, con método FIFO (cada venta se imputa contra
 * las compras más antiguas de ese ticker/cripto todavía no vendidas).
 */

const MESES_ES_ABREV = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11 };

/** "3 dic 2024, 10:53:16" → Date. Revolut Crypto exporta las fechas en español. */
function parseFechaCryptoRevolut_(raw) {
  const partes = String(raw).split(',');
  const fechaPartes = partes[0].trim().split(' '); // ['3', 'dic', '2024']
  const horaPartes = (partes[1] || '0:0:0').trim().split(':').map(Number);
  const dia = Number(fechaPartes[0]);
  const mes = MESES_ES_ABREV[String(fechaPartes[1]).toLowerCase()] || 0;
  const anio = Number(fechaPartes[2]);
  return new Date(anio, mes, dia, horaPartes[0] || 0, horaPartes[1] || 0, horaPartes[2] || 0);
}

/** "USD 123.98" o "EUR 50" → { moneda: 'USD', monto: 123.98 } */
function parseMontoConMoneda_(raw) {
  const s = String(raw || '').trim();
  const partes = s.split(' ');
  if (partes.length === 2) {
    return { moneda: partes[0], monto: Number(partes[1]) || 0 };
  }
  return { moneda: '', monto: Number(s) || 0 };
}

function hashOperacion_(fecha, simbolo, tipo, monto) {
  return Utilities.base64Encode(Utilities.newBlob(String(fecha) + '|' + simbolo + '|' + tipo + '|' + monto).getBytes()).substring(0, 24);
}

function getOperacionesAcciones() {
  return rowsToObjects_(sheet_('Operaciones Acciones'));
}

function getOperacionesCrypto() {
  return rowsToObjects_(sheet_('Operaciones Crypto'));
}

/**
 * CSV de Revolut Acciones: Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
 * Incluye filas de CASH TOP-UP / CASH WITHDRAWAL (movimientos de efectivo, no operaciones de un
 * ticker) — se guardan igual para tener el historial completo, pero se ignoran en el cálculo FIFO.
 */
function importarOperacionesAcciones(csvTexto) {
  const filas = Utilities.parseCsv(csvTexto, ',');
  if (!filas.length) return { ok: false, error: 'El archivo está vacío.' };
  const datos = filas.slice(1);

  const sh = sheet_('Operaciones Acciones');
  const existentes = {};
  rowsToObjects_(sh).forEach((r) => { existentes[r['ID']] = true; });

  let agregadas = 0, omitidas = 0;
  const nuevasFilas = [];

  datos.forEach((f) => {
    const fechaRaw = f[0];
    const ticker = f[1];
    const tipo = f[2];
    if (!fechaRaw || !tipo) return;

    const cantidad = f[3] ? Number(f[3]) : 0;
    const precioUnit = parseMontoConMoneda_(f[4]);
    const totalOperacion = parseMontoConMoneda_(f[5]);
    const moneda = f[6];
    const fx = Number(f[7]) || 1;
    const totalEUR = moneda === 'EUR' ? totalOperacion.monto : totalOperacion.monto / fx;

    const id = hashOperacion_(fechaRaw, ticker, tipo, totalOperacion.monto);
    if (existentes[id]) { omitidas++; return; }
    existentes[id] = true;

    nuevasFilas.push([id, new Date(fechaRaw), ticker || '', tipo, cantidad, precioUnit.monto, moneda, totalOperacion.monto, fx, totalEUR]);
    agregadas++;
  });

  if (nuevasFilas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
  }
  return { ok: true, agregadas: agregadas, omitidas: omitidas };
}

/**
 * CSV de Revolut Crypto: Symbol,Type,Quantity,Price,Value,Fees,Date
 * Los montos vienen como "2,17€" (decimal con coma, símbolo pegado). "Recompensa de Aprende" son
 * criptos que te regalan por leer contenido — no tienen Price/Value/Fees, entran con costo cero.
 */
function importarOperacionesCrypto(csvTexto) {
  const filas = Utilities.parseCsv(csvTexto, ',');
  if (!filas.length) return { ok: false, error: 'El archivo está vacío.' };
  const datos = filas.slice(1);

  const sh = sheet_('Operaciones Crypto');
  const existentes = {};
  rowsToObjects_(sh).forEach((r) => { existentes[r['ID']] = true; });

  let agregadas = 0, omitidas = 0;
  const nuevasFilas = [];

  datos.forEach((f) => {
    const symbol = f[0];
    const tipo = f[1];
    const fechaRaw = f[6];
    if (!symbol || !tipo || !fechaRaw) return;

    const cantidad = normalizeImporte_(f[2]);
    const precioUnitEUR = normalizeImporte_(f[3]);
    const valorEUR = normalizeImporte_(f[4]);
    const comisionEUR = normalizeImporte_(f[5]);
    const fecha = parseFechaCryptoRevolut_(fechaRaw);

    const id = hashOperacion_(fechaRaw, symbol, tipo, valorEUR);
    if (existentes[id]) { omitidas++; return; }
    existentes[id] = true;

    nuevasFilas.push([id, fecha, symbol, tipo, cantidad, precioUnitEUR, valorEUR, comisionEUR]);
    agregadas++;
  });

  if (nuevasFilas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
  }
  return { ok: true, agregadas: agregadas, omitidas: omitidas };
}

/**
 * FIFO genérico: recorre las operaciones en orden cronológico y mantiene, por símbolo, una cola
 * de "lotes" de compra (cantidad + costo unitario). Cada venta consume lotes desde el más viejo.
 * opts define cómo reconocer compra/venta/dividendo para ese set de datos, y si algún tipo de
 * "compra" en realidad tiene costo base cero (recompensas gratis).
 */
function calcularFifo_(operaciones, opts) {
  const porSimbolo = {};
  operaciones
    .slice()
    .sort((a, b) => a.fecha - b.fecha)
    .forEach((op) => {
      if (!porSimbolo[op.simbolo]) porSimbolo[op.simbolo] = { lotes: [], gananciaRealizadaEUR: 0, dividendosEUR: 0 };
      const pos = porSimbolo[op.simbolo];

      if (opts.esCompra(op.tipo)) {
        const costoUnit = op.cantidad > 0 ? op.totalEUR / op.cantidad : 0;
        pos.lotes.push({ cantidad: op.cantidad, costoUnitarioEUR: opts.costoBaseCero(op.tipo) ? 0 : costoUnit });
      } else if (opts.esVenta(op.tipo)) {
        let restante = op.cantidad;
        const precioVentaUnit = op.cantidad > 0 ? op.totalEUR / op.cantidad : 0;
        while (restante > 0.0000001 && pos.lotes.length) {
          const lote = pos.lotes[0];
          const usado = Math.min(lote.cantidad, restante);
          pos.gananciaRealizadaEUR += (precioVentaUnit - lote.costoUnitarioEUR) * usado;
          lote.cantidad -= usado;
          restante -= usado;
          if (lote.cantidad <= 0.0000001) pos.lotes.shift();
        }
      } else if (opts.esDividendo(op.tipo)) {
        pos.dividendosEUR += op.totalEUR;
      }
      // CASH TOP-UP / CASH WITHDRAWAL / cualquier otro tipo: se ignoran para la posición.
    });
  return porSimbolo;
}

function getCotizacionesManuales_() {
  const rows = rowsToObjects_(sheet_('Cotizaciones Manuales'));
  const map = {};
  rows.forEach((r) => { map[r['Símbolo']] = Number(r['Precio EUR']) || null; });
  return map;
}

function armarPosiciones_(porSimbolo) {
  const cotizaciones = getCotizacionesManuales_();
  return Object.keys(porSimbolo).map((simbolo) => {
    const pos = porSimbolo[simbolo];
    const cantidadActual = pos.lotes.reduce((s, l) => s + l.cantidad, 0);
    const costoBaseActualEUR = pos.lotes.reduce((s, l) => s + l.cantidad * l.costoUnitarioEUR, 0);
    const precioActualEUR = cotizaciones[simbolo] != null ? cotizaciones[simbolo] : null;
    const valorActualEUR = precioActualEUR !== null ? precioActualEUR * cantidadActual : null;
    return {
      simbolo: simbolo,
      cantidadActual: cantidadActual,
      costoBaseActualEUR: costoBaseActualEUR,
      gananciaRealizadaEUR: pos.gananciaRealizadaEUR,
      dividendosEUR: pos.dividendosEUR,
      valorActualEUR: valorActualEUR,
      gananciaNoRealizadaEUR: valorActualEUR !== null ? valorActualEUR - costoBaseActualEUR : null,
    };
  }).filter((p) => p.cantidadActual > 0.0000001 || p.gananciaRealizadaEUR !== 0);
}

function getPosicionesAcciones() {
  const ops = getOperacionesAcciones()
    .map((r) => ({
      fecha: r['Fecha'], simbolo: r['Ticker'], tipo: r['Tipo'],
      cantidad: Number(r['Cantidad']) || 0, totalEUR: Number(r['TotalEUR']) || 0,
    }))
    .filter((o) => o.simbolo);

  const porSimbolo = calcularFifo_(ops, {
    esCompra: (t) => /BUY/i.test(t),
    esVenta: (t) => /SELL/i.test(t),
    esDividendo: (t) => /DIVIDEND/i.test(t),
    costoBaseCero: () => false,
  });

  return armarPosiciones_(porSimbolo);
}

function getPosicionesCrypto() {
  const ops = getOperacionesCrypto()
    .map((r) => ({
      fecha: r['Fecha'], simbolo: r['Symbol'], tipo: r['Tipo'],
      cantidad: Number(r['Cantidad']) || 0, totalEUR: Number(r['ValorEUR']) || 0,
    }))
    .filter((o) => o.simbolo);

  const porSimbolo = calcularFifo_(ops, {
    esCompra: (t) => /compra/i.test(t) || /recompensa/i.test(t),
    esVenta: (t) => /venta/i.test(t),
    esDividendo: () => false,
    costoBaseCero: (t) => /recompensa/i.test(t),
  });

  return armarPosiciones_(porSimbolo);
}

/* ============================ PATRIMONIO / COTIZACIONES / META DE AHORRO ============================ */

/** Lee la pestaña "Cotizaciones" ({ ARSEUR: 0.0008, USDEUR: 0.92, ... }). */
function getCotizaciones_() {
  const rows = rowsToObjects_(sheet_('Cotizaciones'));
  const map = {};
  rows.forEach((r) => { map[r['Símbolo']] = Number(r['Cotización']) || null; });
  return map;
}

/**
 * Patrimonio total: saldo de cada grupo de cuentas (EUR/ARS/USD, según getDashboard) más el
 * valor actual de las posiciones de Acciones y Crypto, todo convertido a EUR con las
 * cotizaciones de GOOGLEFINANCE, y de ahí derivado también a USD.
 */
/**
 * SETUP DE UN SOLO USO: crea un Google Sheet nuevo con todas las pestañas, encabezados,
 * cuentas y reglas iniciales, y las fórmulas de GOOGLEFINANCE ya armadas. Corré esta función
 * UNA VEZ desde el editor (seleccioná "configurarSheetNuevo" en el desplegable de arriba y
 * apretá "Ejecutar"), autorizá el acceso cuando lo pida, y mirá el "Registro de ejecución"
 * (Ver → Registros, o Ctrl/Cmd+Enter) para copiar la URL/ID que te va a mostrar. Pegá ese ID
 * en la constante SHEET_ID de arriba de este archivo y ya está.
 */
function configurarSheetNuevo() {
  const ss = SpreadsheetApp.create('Mis gastitos');

  const transacciones = ss.getSheets()[0].setName('Transacciones');
  transacciones.appendRow(['ID', 'Fecha', 'Concepto', 'Monto', 'Moneda', 'Cuenta', 'Categoría', 'Subcategoría', 'Origen', 'Notas']);

  const cuentas = ss.insertSheet('Cuentas');
  cuentas.appendRow(['Nombre', 'Moneda', 'Grupo', 'Tipo', 'Perfil Importación']);
  [
    ['Santander', 'EUR', 'EUR', 'Corriente', 'santander'],
    ['Revolut', 'EUR', 'EUR', 'Corriente', 'revolut'],
    ['Mercado Pago', 'ARS', 'ARS', 'Billetera', 'manual'],
    ['MyInvestor', 'EUR', 'EUR', 'Remunerada', 'myinvestor'],
    ['Trade Republic', 'EUR', 'EUR', 'Remunerada', 'manual'],
    ['BBVA (ARG)', 'ARS', 'ARS', 'Corriente', 'manual'],
    ['Edenred Transporte', 'EUR', 'EUR', 'Tarjeta beneficio', 'manual'],
    ['Edenred Comida', 'EUR', 'EUR', 'Tarjeta beneficio', 'manual'],
    ['Cash', 'EUR', 'EUR', 'Efectivo', 'manual'],
  ].forEach((row) => cuentas.appendRow(row));

  const reglas = ss.insertSheet('Reglas');
  reglas.appendRow(['Patrón', 'Categoría', 'Subcategoría']);
  [
    ['mercadona', 'Vida Diaria', 'Súper'],
    ['condis', 'Vida Diaria', 'Súper'],
    ['bicing', 'Vida Diaria', 'Transporte'],
    ['cabify', 'Vida Diaria', 'Transporte'],
    ['farmaplus', 'Bienestar', 'Salud'],
    ['endesa', 'Vivienda', 'Luz/Gas/Agua'],
    ['digi', 'Vivienda', 'Internet'],
    ['netflix', 'Vivienda', 'Suscripciones'],
    ['spotify', 'Vivienda', 'Suscripciones'],
    ['tarifa plan santander', 'Vivienda', 'Comisiones bancarias'],
    ['bizum', 'Social/Ocio', 'Eventos/Salidas'],
    ['iberia', 'Social/Ocio', 'Viajes'],
    ['amazon', 'Compras', 'Ociosos'],
    ['lefties', 'Compras', 'Ropa'],
    ['interes', 'Ingresos', 'Rendimientos'],
    ['rendimiento', 'Ingresos', 'Rendimientos'],
    ['transferencia de software product creation', 'Ingresos', 'Sueldo'],
    ['liquidacion de las tarjetas', 'Tarjeta', 'Pago tarjeta'],
    ['trade republic', 'Ahorro/Inversión', 'Transferencia propia'],
    ['myinvestor', 'Ahorro/Inversión', 'Transferencia propia'],
  ].forEach((row) => reglas.appendRow(row));

  const presupuesto = ss.insertSheet('Presupuesto');
  presupuesto.appendRow(['ID', 'Nombre', 'Tipo', 'Monto', 'Mes', 'MesInicio', 'Cuotas', 'Confirmado', 'Origen', 'Tarjeta', 'Categoría']);

  const presupuestoCategorias = ss.insertSheet('PresupuestoCategorias');
  presupuestoCategorias.appendRow(['Categoría', 'AnioMes', 'Monto']);

  const cotizaciones = ss.insertSheet('Cotizaciones');
  cotizaciones.appendRow(['Símbolo', 'Cotización']);
  cotizaciones.appendRow(['ARSEUR', '=GOOGLEFINANCE("CURRENCY:ARSEUR")']);
  cotizaciones.appendRow(['USDEUR', '=GOOGLEFINANCE("CURRENCY:USDEUR")']);

  const opAcciones = ss.insertSheet('Operaciones Acciones');
  opAcciones.appendRow(['ID', 'Fecha', 'Ticker', 'Tipo', 'Cantidad', 'PrecioUnitario', 'Moneda', 'TotalOperacion', 'TipoCambio', 'TotalEUR']);

  const opCrypto = ss.insertSheet('Operaciones Crypto');
  opCrypto.appendRow(['ID', 'Fecha', 'Symbol', 'Tipo', 'Cantidad', 'PrecioUnitarioEUR', 'ValorEUR', 'ComisionEUR']);

  const cotizacionesManuales = ss.insertSheet('Cotizaciones Manuales');
  cotizacionesManuales.appendRow(['Símbolo', 'Precio EUR', 'Notas']);
  [
    ['NVDA', '=GOOGLEFINANCE("NASDAQ:NVDA")', ''],
    ['GOOGL', '=GOOGLEFINANCE("NASDAQ:GOOGL")', ''],
    ['MCD', '=GOOGLEFINANCE("NYSE:MCD")', ''],
    ['BTC', '=GOOGLEFINANCE("CURRENCY:BTCEUR")', ''],
    ['CBUQ', '', 'ETF en euros que Revolut identifica con su propio código interno — precio manual'],
    ['C43', '', 'ETF/fondo con ticker interno de Revolut — precio manual'],
    ['VUAA', '', 'ETF/fondo con ticker interno de Revolut — precio manual'],
  ].forEach((row) => cotizacionesManuales.appendRow(row));

  Logger.log('¡Listo! Tu Sheet nuevo es: ' + ss.getUrl());
  Logger.log('Copiá este ID y pegalo en la constante SHEET_ID arriba de Code.gs: ' + ss.getId());
  return { url: ss.getUrl(), id: ss.getId() };
}

function getPatrimonio() {
  const dash = getDashboard();
  const cot = getCotizaciones_();

  const posAcciones = getPosicionesAcciones();
  const posCrypto = getPosicionesCrypto();
  const valorAcciones = posAcciones.reduce((s, p) => s + (p.valorActualEUR != null ? p.valorActualEUR : p.costoBaseActualEUR), 0);
  const valorCrypto = posCrypto.reduce((s, p) => s + (p.valorActualEUR != null ? p.valorActualEUR : p.costoBaseActualEUR), 0);

  const grupos = Object.keys(dash.porGrupo).map((g) => {
    const info = dash.porGrupo[g];
    const tasaEUR = g === 'EUR' ? 1 : (cot[g + 'EUR'] != null ? cot[g + 'EUR'] : null);
    return {
      grupo: g,
      moneda: info.moneda,
      total: info.total,
      totalEUR: tasaEUR != null ? info.total * tasaEUR : null,
      cuentas: info.cuentas, // detalle por banco/cuenta, para el widget "Cuentas" del dashboard
    };
  });

  grupos.push({ grupo: 'Acciones', moneda: 'EUR', total: valorAcciones, totalEUR: valorAcciones });
  grupos.push({ grupo: 'Crypto', moneda: 'EUR', total: valorCrypto, totalEUR: valorCrypto });

  const totalEUR = grupos.reduce((s, g) => s + (g.totalEUR || 0), 0);
  const usdEur = cot['USDEUR'];
  const totalUSD = usdEur ? totalEUR / usdEur : null;

  return { grupos: grupos, totalEUR: totalEUR, totalUSD: totalUSD };
}

/** La meta de ahorro se guarda como propiedad del script (no hace falta una pestaña aparte). */
function getMetaAhorro() {
  const v = PropertiesService.getScriptProperties().getProperty('metaAhorro');
  return v ? Number(v) : 3000;
}

function guardarMetaAhorro(monto) {
  PropertiesService.getScriptProperties().setProperty('metaAhorro', String(Number(monto) || 0));
  return { ok: true };
}

/**
 * Un único round-trip al abrir la app para todo lo "liviano" (cuentas, reglas, presupuesto,
 * posiciones, patrimonio, etc). Las transacciones NO van acá: con cientos de filas reales el
 * paquete se vuelve pesado y el puente de comunicación de Apps Script (google.script.run) puede
 * devolver una respuesta vacía/null en vez de fallar con un error claro. Por eso se piden aparte
 * con getTransacciones(), en un segundo round-trip (ver cargarBootstrap() en Index.html).
 */
function getBootstrap() {
  return {
    cuentas: getCuentas(),
    reglas: getReglas(),
    presupuesto: getPresupuesto(),
    // Presupuesto por categoría: DESACTIVADO temporalmente (2026-10-01). Algo en la pestaña
    // "PresupuestoCategorias" hace que google.script.run devuelva toda la respuesta como null
    // (no es un error de ejecución — el server corre bien — es un problema de transporte al
    // navegador). Hasta que se arregle esa pestaña, mandamos vacío para no bloquear el resto
    // de la app. Ver getPresupuestoCategorias() más abajo para reactivarlo.
    presupuestoCategorias: [],
    presupuestoCategoriasDisponible: false,
    posicionesAcciones: getPosicionesAcciones(),
    posicionesCrypto: getPosicionesCrypto(),
    patrimonio: getPatrimonio(),
    metaAhorro: getMetaAhorro(),
    perfilesImportacion: getPerfilesImportacion(),
  };
}

// Versión liviana de getBootstrap() para la app nueva: solo lo que pinta Inicio/Cuentas.
// (getBootstrap() calculaba las posiciones de acciones/cripto dos veces: una directa y otra dentro de getPatrimonio.)
function getBootstrapLiviano() {
  return {
    cuentas: getCuentas(),
    reglas: getReglas(),
    patrimonio: getPatrimonio(),
    metaAhorro: getMetaAhorro(),
  };
}

/* ============================ ATAJO DEL iPHONE (Apple Pay → movimiento pendiente) ============================ */
// El Atajo hace un POST con JSON: { clave, comercio, monto, cuenta, tarjeta?, moneda?, fecha?, id? }.
// Solo INSERTA un movimiento pendiente (Validado 'No', Origen 'atajo'); no lee ni devuelve datos tuyos.

function claveAtajo_() {
  const p = PropertiesService.getScriptProperties();
  let k = p.getProperty('ATAJO_CLAVE');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '').slice(0, 20); p.setProperty('ATAJO_CLAVE', k); }
  return k;
}

/** La app la llama al abrir "Atajo del iPhone": muestra la clave y activa la protección de la ventanilla. */
function getConfigAtajo() {
  PropertiesService.getScriptProperties().setProperty('VENTANILLA_ACTIVA', 'si');
  return { clave: claveAtajo_(), cuentas: getCuentas().map((c) => String(c['Nombre'] || '')).filter(Boolean) };
}

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return respuestaJson_({ ok: false, error: 'El pedido no es JSON válido.' }); }
  if (!b || String(b.clave || '') !== claveAtajo_()) return respuestaJson_({ ok: false, error: 'Clave incorrecta.' });
  try { return respuestaJson_(registrarPagoAtajo_(b)); }
  catch (err) { return respuestaJson_({ ok: false, error: String(err && err.message || err) }); }
}

// "12,50 €", "€12.50", "1.234,56", "US$ 9.99" -> { valor: 12.5, moneda: 'EUR' } (valor siempre positivo)
function parseMontoAtajo_(v) {
  if (typeof v === 'number') return { valor: Math.abs(v), moneda: '' };
  let s = String(v || '');
  const moneda = /US\$|USD/i.test(s) ? 'USD' : /ARS|AR\$/i.test(s) ? 'ARS' : /€|EUR/i.test(s) ? 'EUR' : '';
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return { valor: 0, moneda: moneda };
  const lc = s.lastIndexOf(','), lp = s.lastIndexOf('.');
  if (lc !== -1 && lp !== -1) {
    s = lc > lp ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc !== -1) {
    s = (s.split(',').length > 2) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lp !== -1) {
    const trasPunto = s.length - lp - 1;
    if (s.split('.').length > 2 || trasPunto === 3) s = s.replace(/\./g, '');
  }
  return { valor: Math.abs(Number(s)) || 0, moneda: moneda };
}

function resolverCuentaAtajo_(cuenta, tarjeta) {
  const nombres = getCuentas().map((c) => String(c['Nombre'] || '')).filter(Boolean);
  const buscar = (t) => {
    const x = String(t || '').toLowerCase().trim();
    if (!x) return '';
    const exacta = nombres.filter((n) => n.toLowerCase() === x)[0];
    if (exacta) return exacta;
    return nombres.filter((n) => x.indexOf(n.toLowerCase()) !== -1)[0] || '';
  };
  return buscar(cuenta) || buscar(tarjeta) || String(cuenta || tarjeta || 'Sin cuenta');
}

function registrarPagoAtajo_(b) {
  const m = parseMontoAtajo_(b.monto);
  if (!m.valor) return { ok: false, error: 'No pude leer el monto: "' + b.monto + '".' };
  const comercio = String(b.comercio || '').trim() || 'Pago con tarjeta';
  const cuenta = resolverCuentaAtajo_(b.cuenta, b.tarjeta);
  // Moneda: la que mande el Atajo, o la que detecte en el monto, o la de la cuenta (Cuentas → Moneda), o EUR.
  const filaCuenta = getCuentas().filter((c) => String(c['Nombre']) === cuenta)[0];
  const moneda = String(b.moneda || m.moneda || (filaCuenta && filaCuenta['Moneda']) || 'EUR').toUpperCase();
  const ahora = new Date();
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || '')) ? String(b.fecha) : Utilities.formatDate(ahora, 'Europe/Madrid', 'yyyy-MM-dd');
  // ID estable dentro del mismo minuto: si el Atajo reintenta, no duplica.
  const base = comercio + '|' + m.valor + '|' + cuenta + '|' + Utilities.formatDate(ahora, 'Europe/Madrid', 'yyyyMMddHHmm');
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base)
    .map((x) => ('0' + (x < 0 ? x + 256 : x).toString(16)).slice(-2)).join('');
  const id = b.id ? String(b.id) : 'atajo-' + hash;
  const cat = categorizar_(comercio, getReglas()) || { categoria: '', subcategoria: '' };
  const r = addTransaccionManual({
    id: id, fecha: fecha, concepto: comercio, monto: -m.valor, moneda: moneda, cuenta: cuenta,
    categoria: cat.categoria || '', subcategoria: cat.subcategoria || '', origen: 'atajo', notas: '',
  });
  return { ok: true, id: id, duplicado: !!r.duplicado, concepto: comercio, monto: -m.valor, moneda: moneda, cuenta: cuenta, categoria: cat.categoria || '' };
}

/* ============================ EDITAR MOVIMIENTO (fecha + categoría) — app v2 ============================ */

/**
 * Cambia fecha y/o categoría/subcategoría de UN movimiento (por ID), con candado. Solo toca los campos
 * que vienen en `campos` (fecha en formato ISO "2026-10-19", categoria, subcategoria). No toca Validado.
 */
function actualizarMovimiento(id, campos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_('Transacciones');
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const idCol = headers.indexOf('ID');
    const col = (n) => headers.indexOf(n);
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) !== String(id)) continue;
      const fila = i + 1;
      if (campos && campos.fecha && col('Fecha') !== -1) sh.getRange(fila, col('Fecha') + 1).setValue(parseFechaISOInput_(campos.fecha));
      if (campos && campos.categoria !== undefined && col('Categoría') !== -1) sh.getRange(fila, col('Categoría') + 1).setValue(campos.categoria || '');
      if (campos && campos.subcategoria !== undefined && col('Subcategoría') !== -1) sh.getRange(fila, col('Subcategoría') + 1).setValue(campos.subcategoria || '');
      SpreadsheetApp.flush();
      return { ok: true };
    }
    return { ok: false, error: 'No se encontró esa transacción.' };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ SIMULADOR DE PRESUPUESTO (pestaña "Simulador") ============================ */
// Es solo una simulación: guarda tus ajustes en su propia pestaña y NO toca Transacciones ni ningún total.
// Filas: Clave | Nombre | Monto | Activo | Manual. Claves especiales: "_ingreso" y "_variables".

function getSimulador() {
  const hoja = ss_().getSheetByName('Simulador');
  if (!hoja || hoja.getLastRow() < 2) return [];
  return rowsToObjects_(hoja).map((r) => ({
    clave: String(r['Clave'] || ''),
    nombre: String(r['Nombre'] || ''),
    monto: Number(r['Monto']) || 0,
    activo: !(r['Activo'] === false || String(r['Activo']).toUpperCase() === 'FALSE'),
    manual: (r['Manual'] === true || String(r['Manual']).toUpperCase() === 'TRUE'),
  }));
}

/** Reemplaza todos los ajustes del simulador por `filas` ([{clave,nombre,monto,activo,manual}]). */
function guardarSimulador(filas) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = ss_();
    let hoja = ss.getSheetByName('Simulador');
    if (!hoja) { hoja = ss.insertSheet('Simulador'); hoja.appendRow(['Clave', 'Nombre', 'Monto', 'Activo', 'Manual']); }
    const lim = Math.max(hoja.getLastRow(), 2);
    hoja.getRange(2, 1, lim - 1, 5).clearContent();
    const datos = (filas || []).slice(0, 300).map((f) => [
      String(f.clave || ''), String(f.nombre || ''), Number(f.monto) || 0, f.activo !== false, !!f.manual,
    ]);
    if (datos.length) hoja.getRange(2, 1, datos.length, 5).setValues(datos);
    SpreadsheetApp.flush();
    return { ok: true, guardadas: datos.length };
  } finally {
    lock.releaseLock();
  }
}

/* ============================ CIERRE: EXTRACTO CON COINCIDENCIAS ============================ */

function diasEntre_(a, b) { return Math.round((a.getTime() - b.getTime()) / 86400000); }

/**
 * Como previsualizarCsv(), pero además busca, entre los movimientos PENDIENTES de esa cuenta (Validado = 'No'
 * y sin Conciliado), los que podrían ser el mismo que cada fila del banco: mismo monto y fecha a ±3 días.
 * No escribe nada. Una coincidencia única se propone ya fusionada (fusionarCon); varias, se elige en pantalla.
 */
function previsualizarExtracto(perfil, cuentaNombre, csvTexto) {
  const base = previsualizarCsv(perfil, csvTexto);
  if (!base.ok) return base;
  const pend = rowsToObjects_(sheet_('Transacciones'))
    .filter((r) => r['Validado'] === 'No' && !r['Conciliado'] && r['Cuenta'] === cuentaNombre)
    .map((r) => ({
      id: String(r['ID']),
      fecha: formatDate_(r['Fecha']),
      concepto: String(r['Concepto'] || ''),
      monto: Number(r['Monto']) || 0,
      categoria: String(r['Categoría'] || ''),
      subcategoria: String(r['Subcategoría'] || ''),
    }));
  const usados = {};
  base.filas.forEach((f) => {
    const fecha = parseFechaDDMMYYYY_(f.fecha);
    f.candidatos = pend.filter((p) => Math.abs(p.monto - f.monto) < 0.005 && Math.abs(diasEntre_(parseFechaDDMMYYYY_(p.fecha), fecha)) <= 3);
    f.fusionarCon = '';
    if (f.candidatos.length === 1 && !usados[f.candidatos[0].id]) {
      f.fusionarCon = f.candidatos[0].id;
      usados[f.candidatos[0].id] = true;
    }
  });
  return base;
}

/**
 * Escribe el resultado de la revisión. Las filas con fusionarCon NO crean un movimiento nuevo: actualizan el
 * que Dani ya había cargado (fecha y monto del banco, concepto y categoría suyos) y lo dejan confirmado y conciliado.
 * El resto entra como movimiento nuevo, conciliado; si no tiene categoría queda pendiente ('Validado' = 'No').
 */
function confirmarExtracto(perfil, cuentaNombre, moneda, filas) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_('Transacciones');
    const values = sh.getDataRange().getValues();
    const headers = values[0];
    const col = (n) => headers.indexOf(n);
    const idCol = col('ID');
    const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const filaPorId = {};
    for (let i = 1; i < values.length; i++) filaPorId[values[i][idCol]] = i + 1;

    const existentes = {};
    rowsToObjects_(sh).forEach((r) => { existentes[hashTx_(r['Fecha'], r['Concepto'], r['Monto'])] = true; });

    const colVal = columnaValidado_(sh);
    const headers2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const col2 = (n) => headers2.indexOf(n);

    let fusionados = 0, omitidosPorDuplicado = 0;
    const nuevas = [];
    const aRecordar = [];

    filas.forEach((f) => {
      const fecha = parseFechaDDMMYYYY_(f.fecha);
      if (f.fusionarCon && filaPorId[f.fusionarCon]) {
        const fila = filaPorId[f.fusionarCon];
        sh.getRange(fila, col('Fecha') + 1).setValue(fecha);
        sh.getRange(fila, col('Monto') + 1).setValue(Number(f.monto));
        if (f.categoria && !values[fila - 1][col('Categoría')]) {
          sh.getRange(fila, col('Categoría') + 1).setValue(f.categoria);
          sh.getRange(fila, col('Subcategoría') + 1).setValue(f.subcategoria || '');
        }
        sh.getRange(fila, colVal).setValue('Sí');
        if (col2('Conciliado') !== -1) sh.getRange(fila, col2('Conciliado') + 1).setValue(hoy);
        fusionados++;
        if (f.recordarRegla && f.categoria) aRecordar.push(f);
        return;
      }
      const hash = hashTx_(fecha, f.concepto, Number(f.monto));
      if (existentes[hash]) { omitidosPorDuplicado++; return; }
      existentes[hash] = true;
      const fila = headers2.map(() => '');
      const poner = (n, v) => { const c = col2(n); if (c !== -1) fila[c] = v; };
      poner('ID', Utilities.getUuid());
      poner('Fecha', fecha);
      poner('Concepto', f.concepto);
      poner('Monto', Number(f.monto));
      poner('Moneda', moneda);
      poner('Cuenta', cuentaNombre);
      poner('Categoría', f.categoria || '');
      poner('Subcategoría', f.subcategoria || '');
      poner('Origen', 'importado:' + perfil);
      poner('Validado', f.categoria ? 'Sí' : 'No');
      poner('Conciliado', hoy);
      nuevas.push(fila);
      if (f.recordarRegla && f.categoria) aRecordar.push(f);
    });

    if (nuevas.length) {
      sh.getRange(sh.getLastRow() + 1, 1, nuevas.length, headers2.length).setValues(nuevas);
    }

    const patrones = {};
    getReglas().forEach((r) => { patrones[r.patron] = true; });
    aRecordar.forEach((f) => {
      const patron = String(f.concepto || '').toLowerCase();
      if (patron && !patrones[patron]) { agregarRegla(patron, f.categoria, f.subcategoria || ''); patrones[patron] = true; }
    });

    SpreadsheetApp.flush();
    return { ok: true, agregados: nuevas.length, fusionados: fusionados, omitidosPorDuplicado: omitidosPorDuplicado };
  } finally {
    lock.releaseLock();
  }
}
