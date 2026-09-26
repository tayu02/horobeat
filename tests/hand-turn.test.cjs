// 手札のカードは横向きにできない（A-16）
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await H.launch();
  const ctx=await b.newContext({...devices['iPhone 13'],viewport:{width:390,height:1500},hasTouch:true,isMobile:true});
  const p=await ctx.newPage(); H.watch(p, 'iphone'); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  await p.locator('#guide .big').click();
  const openFor=async id=>{ await p.evaluate(i=>openCardSheet(i),id); await wait(420); };
  const hasTurn=()=>p.evaluate(()=>!!document.querySelector('#sheet button[data-tg]'));
  const turnLabel=()=>p.evaluate(()=>{const b=document.querySelector('#sheet button[data-tg]');return b?b.textContent.trim():null;});

  // 手札: 横向きにする が出ない
  await openFor(await p.evaluate(()=>state.players[0].hand[0].uid));
  ok(!await hasTurn(), '手札のメニューに向きの切り替えが出ない');
  ok(await p.evaluate(()=>!!document.querySelector('#sheet button[data-fl]')), '手札でも表裏は切り替えられる');
  ok(await p.evaluate(()=>!!document.querySelector('#sheet button[data-mv]')), '手札でも移動先は出る');
  await p.click('#sheet button[data-close="1"]');

  // 既に横向きの手札は「縦向きに戻す」が出る（救済）
  await p.evaluate(()=>{ state.players[0].hand[0].turned = true; render(); });
  await openFor(await p.evaluate(()=>state.players[0].hand[0].uid));
  ok(await turnLabel()==='縦向きに戻す', '横向きの手札には縦向きに戻すが出る');
  await p.click('#sheet button[data-tg]');
  ok(await p.evaluate(()=>state.players[0].hand[0].turned)===false, '縦向きに戻せる');
  await openFor(await p.evaluate(()=>state.players[0].hand[0].uid));
  ok(!await hasTurn(), '戻したあとは再び出なくなる');
  await p.click('#sheet button[data-close="1"]');

  // 他のゾーンでは従来どおり出る
  await openFor(await p.evaluate(()=>state.players[0].ena[0].uid));
  ok(await turnLabel()==='横向きにする', 'エナでは横向きにするが出る');
  await p.click('#sheet button[data-close="1"]');
  await openFor(await p.evaluate(()=>state.players[0].heart[0].uid));
  ok(await turnLabel()==='横向きにする', 'ハートでは横向きにするが出る');
  await p.click('#sheet button[data-close="1"]');

  // 手札へ移動しても、移動そのものは制限しない
  await p.evaluate(()=>{ const c=state.players[0].ena[0]; c.turned=true; moveCard(c.uid,0,'hand',0,false); render(); });
  ok(await p.evaluate(()=>state.players[0].hand.some(c=>c.turned)), '横向きのまま手札へ移動できる（移動は制限しない）');
  await openFor(await p.evaluate(()=>state.players[0].hand.find(c=>c.turned).uid));
  ok(await turnLabel()==='縦向きに戻す', 'その札も縦向きに戻せる');

  ok(errs.length===0,'JSエラーなし '+(errs.length?JSON.stringify(errs):''));
  await b.close();
  await H.finish();
})();
