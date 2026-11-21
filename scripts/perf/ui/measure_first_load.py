# Usage: pw-venv/bin/python measure_first_load.py http://HOST:PORT  (needs chromium on 127.0.0.1:9223 + password file; read-only)
import sys, time, json, collections
from playwright.sync_api import sync_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else "http://192.168.1.45:18092"
pw=open('/home/stims/.hermes/cache/scratch/preview-pw').read().strip()
with sync_playwright() as p:
    b=p.chromium.connect_over_cdp('http://127.0.0.1:9223')
    ctx=b.new_context(viewport={'width':1400,'height':900}); pg=ctx.new_page()
    pg.goto(BASE+"/",wait_until='domcontentloaded'); pg.wait_for_timeout(2500)
    if pg.locator('input[type=password]').count():
        pg.fill('input[type=email],input[type=text]','preview-many@example.com'); pg.fill('input[type=password]',pw)
        pg.keyboard.press('Enter'); pg.wait_for_timeout(3000)
    # cold load of /items (cache disabled in new context -> cold)
    reqs=[]
    def on(r): reqs.append((r.method,r.url.replace(BASE,''),r.resource_type))
    resp=[]
    def onr(r):
        try: resp.append((r.url.replace(BASE,''), len(r.body())))
        except Exception: pass
    pg.on('request',on)
    t=time.time(); pg.goto(BASE+"/items",wait_until='domcontentloaded'); pg.wait_for_timeout(5000)
    c=collections.Counter((m,u.split('?')[0]) for m,u,t_ in reqs)
    print("first load requests:",len(reqs))
    for k,v in sorted(c.items()): print(" ",v,k)
    print("image reqs:",sum(1 for m,u,t_ in reqs if u.startswith("/api/images")),"all non-image:",sum(1 for m,u,t_ in reqs if not u.startswith("/api/images")),"JS/CSS transfer bytes:",pg.evaluate("performance.getEntriesByType(\"resource\").filter(r=>/\\.(js|css)/.test(r.name)).reduce((a,r)=>a+r.encodedBodySize,0)"), "js count",pg.evaluate("performance.getEntriesByType(\"resource\").filter(r=>/\\.js/.test(r.name)).length"))
    print("rows:",pg.locator('tbody tr').count())
    print("perf:",pg.evaluate("JSON.stringify(performance.getEntriesByType('navigation')[0].toJSON(),(k,v)=>['domContentLoadedEventEnd','responseEnd','transferSize','encodedBodySize'].includes(k)?v:(typeof v==='object'?v:undefined))"))
    res=pg.evaluate("performance.getEntriesByType('resource').filter(r=>/assets|api/.test(r.name)).map(r=>[r.name.split('/').slice(3).join('/').slice(0,50),r.transferSize,r.encodedBodySize,Math.round(r.duration)])")
    for r in res: print(" ",r)
    reqs.clear()
    pg.click('a[href*="/settings"]') if pg.locator('a[href*="/settings"]').count() else None
    pg.wait_for_timeout(2500)
    c=collections.Counter((m,u.split('?')[0]) for m,u,t_ in reqs)
    print("route change (->settings) requests:",len(reqs))
    for k,v in sorted(c.items()): print(" ",v,k)
    ctx.close()
