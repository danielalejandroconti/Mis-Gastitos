"""Filtros de Movimientos: cuenta, meses, tipo y monto (+ resumen del resultado)."""
import os, re
from playwright.sync_api import sync_playwright
here = os.path.dirname(__file__)
src = open(os.path.join(here, 'ui_smoke.py'), encoding='utf-8').read()
MOCK = re.search(r'MOCK="""(.*?)"""', src, re.S).group(1)
html = open(os.path.join(here, '..', 'src', 'Index.html'), encoding='utf-8').read().replace('<?= ScriptApp.getService().getUrl() ?>', '#')
open('/tmp/t_index.html', 'w', encoding='utf-8').write(html)

def filas(pg): return pg.locator('#lista button.row').count()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK); pg.goto('file:///tmp/t_index.html'); pg.wait_for_selector('#app:not([hidden])')
    pg.click('[data-go=mov] >> visible=true'); pg.wait_for_timeout(200)
    assert filas(pg) == 5 and pg.locator('#resumen').count() == 0, 'sin filtros: 5 filas y sin resumen'
    pg.click('text=Filtros'); pg.wait_for_selector('#f-cuenta')
    # cuenta
    pg.select_option('#f-cuenta', 'Santander'); pg.wait_for_timeout(50)
    assert filas(pg) == 3, filas(pg)
    r = pg.inner_text('#resumen'); assert '3 movimientos' in r.lower() and 'EUR' in r, r
    pg.select_option('#f-cuenta', 'Mercado Pago'); pg.wait_for_timeout(50)
    assert filas(pg) == 1 and 'ARS' in pg.inner_text('#resumen')
    pg.select_option('#f-cuenta', ''); pg.wait_for_timeout(50)
    assert filas(pg) == 5
    # meses: el mock tiene 3 movimientos de hoy/ayer y 2 de hace 3-4 días (pueden caer en el mes anterior)
    opts = pg.eval_on_selector_all('#f-desde option', 'os=>os.map(o=>o.value).filter(Boolean)')
    assert len(opts) >= 1, opts
    mes_actual = opts[0]
    pg.select_option('#f-desde', mes_actual); pg.wait_for_timeout(50)
    n_mes = filas(pg); assert 1 <= n_mes <= 5
    pg.select_option('#f-hasta', mes_actual); pg.wait_for_timeout(50)
    assert filas(pg) == n_mes, 'desde = hasta = mes actual'
    pg.select_option('#f-desde', ''); pg.select_option('#f-hasta', ''); pg.wait_for_timeout(50)
    assert filas(pg) == 5
    # tipo
    pg.click('#panel-filtros .seg >> text=Ingresos'); pg.wait_for_selector('#f-min'); 
    assert filas(pg) == 1, 'un solo ingreso'
    pg.click('#panel-filtros .seg >> text=Gastos'); pg.wait_for_selector('#f-min')
    assert filas(pg) == 4
    # monto (valor absoluto, mezcla monedas: 52000 ARS y 1100 EUR)
    pg.fill('#f-min', '1.000'); pg.wait_for_timeout(50)
    assert filas(pg) == 2, filas(pg)          # -1100 EUR y -52000 ARS
    pg.fill('#f-max', '2000'); pg.wait_for_timeout(50)
    assert filas(pg) == 1, filas(pg)          # solo -1100
    assert 'Filtros · 3 activos' in pg.inner_text('body')
    # limpiar
    pg.click('text=Limpiar filtros'); pg.wait_for_timeout(100)
    assert filas(pg) == 5 and pg.locator('#resumen').count() == 0 and 'Filtros ·' not in pg.inner_text('body')
    # tocar una fila abre la edición (el filtro no rompe nada)
    pg.click('button.row >> nth=0'); pg.wait_for_selector('text=Editar movimiento')
    print('OK filtros; errores JS:', errs); assert not errs
    b.close()
