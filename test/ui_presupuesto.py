# Prueba: editar fecha de un movimiento + solapa Presupuesto (simulación). Uso: python3 test/ui_presupuesto.py
import os, json
from playwright.sync_api import sync_playwright
html=open(os.path.join(os.path.dirname(__file__),'..','src','Index.html'),encoding='utf-8').read().replace('<?= ScriptApp.getService().getUrl() ?>','#')
open('/tmp/t_index2.html','w',encoding='utf-8').write(html)
MOCK="""
(function(){
 var today=new Date(), txs=[], n=0;
 function fm(back,day){ var x=new Date(today.getFullYear(), today.getMonth()-back, day); return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0')+'/'+x.getFullYear(); }
 function add(back,day,c,m,cat,sub,val){ txs.push({id:'t'+(++n),fecha:fm(back,day),concepto:c,monto:m,moneda:'EUR',cuenta:'Santander',categoria:cat,subcategoria:sub,origen:'excel-historico',notas:'',validado:val!==false,grupo:'',miParte:null,conciliado:''}); }
 for (var b=0;b<=6;b++){
   add(b,1,'ALQUILER PISO',-1100,'Vivienda','Alquiler');
   add(b,5,'NETFLIX.COM',-13.99,'Social/Ocio','Suscripciones');
   add(b,8,'GIMNASIO BASIC FIT '+(100+b),-29.99,'Bienestar','Gimnasio');
   add(b,10,'ENDESA LUZ',-(40+b*9),'Vivienda','Luz');
   for (var k=0;k<6;k++) add(b,2+k*4,'MERCADONA BCN',-(30+k*3),'Vida Diaria','Súper');
   add(b,25,'NOMINA EMPRESA',2600,'Ingresos','Sueldo');
 }
 txs.sort(function(a,c){ function p(f){var q=f.split('/');return new Date(q[2],q[1]-1,q[0]);} return p(c.fecha)-p(a.fecha); });
 txs[0].validado=false; window.__id0=txs[0].id; window.__f0=txs[0].fecha;
 var boot={cuentas:[{Nombre:'Santander',Moneda:'EUR'}],reglas:[],patrimonio:{grupos:[{grupo:'EUR',moneda:'EUR',total:8000}],totalEUR:8000},metaAhorro:3000};
 window.__calls=[]; window.__sim=[];
 function runner(ok,fail){ return new Proxy({}, {get:function(_,name){
   if(name==='withSuccessHandler') return function(h){return runner(h,fail);};
   if(name==='withFailureHandler') return function(h){return runner(ok,h);};
   return function(){ var a=[].slice.call(arguments); window.__calls.push([name,a]); setTimeout(function(){
      if(name==='getBootstrapLiviano') ok&&ok(boot); else if(name==='getTransacciones') ok&&ok(txs);
      else if(name==='getSimulador') ok&&ok(window.__sim);
      else ok&&ok({ok:true}); }, 100); };
 }});}
 window.google={script:{run:runner()}};
})();
"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,vp in [('m',{'width':390,'height':844}),('d',{'width':1280,'height':800})]:
        pg=b.new_page(viewport=vp); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.add_init_script(MOCK); pg.goto('file:///tmp/t_index2.html'); pg.wait_for_selector('#app:not([hidden])')
        # --- Presupuesto
        pg.click('.seg.s4 button:has-text("Presupuesto")'); pg.wait_for_selector('#sim-ahorro',state='attached'); pg.wait_for_timeout(300)
        print(name,'fijos',pg.inner_text('#sim-fijos'),'ahorro',pg.inner_text('#sim-ahorro'),'12m',pg.inner_text('#sim-ahorro12'))
        print(name,'filas fijos',[t for t in pg.inner_text('#content').split('\n') if 'Se repite' in t or t.isupper()][:20])
        pg.screenshot(path=f'/tmp/shot_{name}_presu.png',full_page=True)
        if name=='m':
            # destildar el alquiler → los fijos bajan 1100
            antes=pg.inner_text('#sim-fijos')
            pg.locator('input[type=checkbox]').first.click(); pg.wait_for_timeout(150)
            print('tras destildar el 1ro:',antes,'->',pg.inner_text('#sim-fijos'))
            pg.fill('#sim-ing','3000'); print('ahorro con ingreso 3000:',pg.inner_text('#sim-ahorro'))
            pg.click('text=+ Agregar un gasto'); pg.fill('#sim-nom','Seguro coche'); pg.fill('#sim-mon','45,5'); pg.click('text=Agregar >> nth=-1'); pg.wait_for_timeout(1200)
            sv=[c for c in pg.evaluate('window.__calls') if c[0]=='guardarSimulador']
            print('guardarSimulador llamado',len(sv),'veces; ultima:',json.dumps(sv[-1][1][0],ensure_ascii=False)[:400])
            print('scrollWidth',pg.evaluate('document.documentElement.scrollWidth'))
            # --- editar fecha
            pg.click('[data-go=mov] >> visible=true'); pg.wait_for_timeout(200)
            pg.locator('.row').first.click(); pg.wait_for_selector('#e-fecha')
            f=pg.input_value('#e-fecha'); print('fecha actual en input',f)
            pg.fill('#e-fecha','2026-01-15'); pg.click('text=Guardar >> nth=0'); pg.wait_for_timeout(300)
            c=[c for c in pg.evaluate('window.__calls') if c[0]=='actualizarMovimiento']
            print('actualizarMovimiento',json.dumps(c[-1][1],ensure_ascii=False))
            pg.screenshot(path='/tmp/shot_m_editar.png')
        print(name,'errs',errs)
    b.close()
