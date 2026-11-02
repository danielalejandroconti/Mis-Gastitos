"""Dividir un movimiento ya guardado (Movimientos → tocar fila → "Dividir en varias partes")."""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
src = open(os.path.join(os.path.dirname(__file__), 'ui_smoke.py'), encoding='utf-8').read()
MOCK = re.search(r'MOCK="""(.*?)"""', src, re.S).group(1)
html = open(os.path.join(os.path.dirname(__file__), '..', 'src', 'Index.html'), encoding='utf-8').read().replace('<?= ScriptApp.getService().getUrl() ?>', '#')
open('/tmp/t_index.html', 'w', encoding='utf-8').write(html)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script(MOCK); pg.goto('file:///tmp/t_index.html'); pg.wait_for_selector('#app:not([hidden])')
    pg.click('[data-go=mov] >> visible=true'); pg.wait_for_timeout(200)
    pg.click('button.row:has-text("Alquiler")'); pg.wait_for_selector('text=Dividir en varias partes')
    pg.click('text=Dividir en varias partes'); pg.wait_for_selector('[data-dp="0"][data-k="monto"]')
    assert 'Total del movimiento' in pg.inner_text('#overlay')
    pg.fill('[data-dp="0"][data-k="monto"]', '-1000'); pg.fill('[data-dp="0"][data-k="concepto"]', 'Alquiler'); pg.wait_for_timeout(50)
    assert pg.is_disabled('#div-ok'), 'con suma distinta debe estar deshabilitado'
    pg.fill('[data-dp="1"][data-k="monto"]', '-100'); pg.fill('[data-dp="1"][data-k="concepto"]', 'Súper del mes'); pg.wait_for_timeout(50)
    assert not pg.is_disabled('#div-ok'), 'suma exacta: habilitado'
    pg.select_option('[data-dp="1"][data-k="categoria"]', 'Vida Diaria')
    pg.fill('[data-dp="0"][data-k="monto"]', '-1000'); pg.fill('[data-dp="1"][data-k="monto"]', '-100'); pg.wait_for_timeout(50)
    pg.click('#div-ok'); pg.wait_for_timeout(500)
    call = pg.evaluate('window.__calls.filter(c=>c[0]=="dividirTransaccion")[0][1]')
    assert call[0] == '4' and len(call[1]) == 2 and abs(sum(x['monto'] for x in call[1]) + 1100) < 0.005, call
    assert all(x['id'] for x in call[1]), 'cada parte lleva ID generado en el cliente'
    txt = pg.inner_text('body')
    assert 'Súper del mes' in txt and 'Dividido en 2 partes' in txt, 'las partes aparecen y se avisa'
    print('OK dividir', call, 'errs', errs)
    assert not errs
    b.close()
