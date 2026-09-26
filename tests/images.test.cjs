// カード画像の表示
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 for (const [label,vp,touch] of [['iphone',{width:390,height:844},true],['pc',{width:1280,height:1000},false]]){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport:vp});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const open=async key=>{ await p.evaluate(k=>{ const c={uid:'IMG-'+k,owner:0,key:k,up:true,turned:false,note:''}; state.players[0].hand.push(c); render(); openCardSheet(c.uid); },key); await wait(600); };
  await open('HD01-010');
  const img=await p.evaluate(()=>{ const i=document.querySelector('#sheet img.cimg'); return i?{src:i.getAttribute('src'),w:i.naturalWidth,h:i.naturalHeight,shown:i.getBoundingClientRect().width,alt:i.alt}:null; });
  ok(img && img.src==='images/cards/HD01-010.webp' && img.w===480,'HD01-010: メニューにカード画像が出る（480px の WebP を読み込めている）'+JSON.stringify(img));
  ok(img && img.alt==='ウキウキ学生 アカナー','画像の alt にカード名');
  ok(img && img.shown>200 && img.shown<=340,'表示幅が画面に収まる（'+(img&&Math.round(img.shown))+'px）');
  const order=await p.evaluate(()=>{ const s=document.getElementById('sheet'); const a=s.querySelector('.cimgwrap'), d=s.querySelector('.cdetail'); return a && d && (a.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'img-before-text':'other'; });
  ok(order==='img-before-text','画像は印字の文字情報の上に出る');
  await p.evaluate(()=>closeSheet());
  await open('HB01-034');
  const pend=await p.evaluate(()=>({img:!!document.querySelector('#sheet img.cimg'), txt:document.querySelector('#sheet .cimgnone')?.textContent||''}));
  ok(!pend.img && pend.txt.includes('イベント会場の写真しかない'),'保留のカード（しなずいさま HB01-034）は画像を出さず理由を表示');
  await p.evaluate(()=>closeSheet());
  await open('HD02-001');
  ok(await p.evaluate(()=>!!document.querySelector('#sheet img.cimg')),'同名でも番号が違う HD02-001 には画像が出る');
  await p.evaluate(()=>closeSheet());
  // 画像ファイルが無い（手元に無い）ときは枠ごと消えて、エラーにならない
  await p.evaluate(()=>{ CARD_IMAGES['HD01-001']='images/cards/__missing__.webp'; });
  await open('HD01-001');
  ok(await p.evaluate(()=>!document.querySelector('#sheet .cimgwrap')),'画像が読み込めないときは枠ごと消える');
  await p.evaluate(()=>closeSheet());
  // 裏向き・未確定カードには出さない
  await p.evaluate(()=>{ const c={uid:'DOWN',owner:0,key:'HD01-010',up:false,turned:false,note:''}; state.players[0].hand.push(c); render(); openCardSheet('DOWN'); }); await wait(500);
  ok(await p.evaluate(()=>!document.querySelector('#sheet .cimgwrap')),'裏向きのカードには画像を出さない');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  if(label==='iphone'){ await p.evaluate(()=>closeSheet()); await open('HD02-011'); await p.screenshot({path:H.out('images-sheet.png')}); }
  await b.close();
 }
  await H.finish();
})();
