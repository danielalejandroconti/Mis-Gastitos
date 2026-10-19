import re, json
from playwright.sync_api import sync_playwright
html=open(__import__('os').path.join(__import__('os').path.dirname(__file__),'..','src','Index.html'),encoding='utf-8').read().replace('<?= ScriptApp.getService().getUrl() ?>','#')
open('/tmp/t_index.html','w',encoding='utf-8').write(html)
MOCK="""
(function(){
 var today=new Date(); function f(d){var x=new Date(today); x.setDate(x.getDate()-d); return String(x.getDate()).padStart(2,'0')+'/'+String(x.getMonth()+1).padStart(2,'0')+'/'+x.getFullYear();}
 var txs=[
  {id:'1',fecha:f(0),concepto:'MERCADONA BCN',monto:-42.3,moneda:'EUR',cuenta:'Santander',categoria:'Vida Diaria',subcategoria:'Súper',origen:'atajo',notas:'',validado:false,grupo:'',miParte:null,conciliado:''},
  {id:'2',fecha:f(0),concepto:'AMZN Mktp',monto:-23.99,moneda:'EUR',cuenta:'Revolut',categoria:'',subcategoria:'',origen:'atajo',notas:'',validado:false,grupo:'',miParte:null,conciliado:''},
  {id:'3',fecha:f(1),concepto:'Bizum de tu pareja',monto:60,moneda:'EUR',cuenta:'Santander',categoria:'Social/Ocio',subcategoria:'Salidas',origen:'manual',notas:'',validado:true,grupo:'',miParte:null,conciliado:''},
  {id:'4',fecha:f(3),concepto:'Alquiler',monto:-1100,moneda:'EUR',cuenta:'Santander',categoria:'Vivienda',subcategoria:'Alquiler',origen:'excel-historico',notas:'',validado:true,grupo:'',miParte:null,conciliado:''},
  {id:'5',fecha:f(4),concepto:'Super Coto',monto:-52000,moneda:'ARS',cuenta:'Mercado Pago',categoria:'Vida Diaria',subcategoria:'Súper',origen:'manual',notas:'',validado:true,grupo:'',miParte:null,conciliado:''}];
 var boot={cuentas:[{Nombre:'Santander',Moneda:'EUR'},{Nombre:'Revolut',Moneda:'EUR'},{Nombre:'Mercado Pago',Moneda:'ARS'}],reglas:[{patron:'x',categoria:'Vida Diaria',subcategoria:'Súper'}],
  patrimonio:{grupos:[{grupo:'EUR',moneda:'EUR',total:8420.5},{grupo:'ARS',moneda:'ARS',total:3480000},{grupo:'Acciones',moneda:'EUR',total:1920}],totalEUR:11000}};
 window.__calls=[];
 function runner(ok,fail){ return new Proxy({}, {get:function(_,name){
   if(name==='withSuccessHandler') return function(h){return runner(h,fail);};
   if(name==='withFailureHandler') return function(h){return runner(ok,h);};
   return function(){ var a=[].slice.call(arguments); window.__calls.push([name,a]); setTimeout(function(){
      if(name==='getBootstrap') ok&&ok(boot); else if(name==='getTransacciones') ok&&ok(txs);
      else if(name==='addTransaccionManual') { if(window.__fail) fail&&fail({message:'x'}); else ok&&ok({ok:true,id:a[0].id}); }
      else ok&&ok({ok:true}); }, 150); };
 }});}
 window.google={script:{run:runner()}};
})();
"""
with sync_playwright() as p:
    b=p.chromium.launch()
    for name,vp in [('m',{'width':390,'height':844}),('d',{'width':1280,'height':800})]:
        pg=b.new_page(viewport=vp); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.add_init_script(MOCK); pg.goto('file:///tmp/t_index.html'); pg.wait_for_selector('#app:not([hidden])')
        pg.screenshot(path=f'shot_{name}_inicio.png')
        pg.click('[data-go=mov] >> visible=true'); pg.wait_for_timeout(200); pg.screenshot(path=f'shot_{name}_mov.png')
        if name=='m':
            pg.click('#fab'); pg.wait_for_selector('#n-monto'); pg.fill('#n-monto','12,50'); pg.fill('#n-conc','Café test')
            pg.select_option('#n-cat','Vida Diaria'); pg.wait_for_selector('#n-sub'); pg.screenshot(path='/tmp/shot_m_nuevo.png')
            pg.click('text=Guardar >> nth=0'); pg.wait_for_timeout(50); pg.screenshot(path='/tmp/shot_m_guardando.png'); pg.wait_for_timeout(400)
            print('calls',[c[0] for c in pg.evaluate('window.__calls')], pg.evaluate('window.__calls.filter(c=>c[0]=="addTransaccionManual")[0][1][0]'))
            pg.click('text=Pendientes'); pg.wait_for_timeout(100); pg.screenshot(path='/tmp/shot_m_pend.png')
            print('overflowX', pg.evaluate('document.documentElement.scrollWidth'), 'errs', errs)
        else: print('desk errs',errs)
    b.close()
