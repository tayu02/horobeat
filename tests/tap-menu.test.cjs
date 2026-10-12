// タップでメニューが開く・横スワイプで誤作動しない
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await H.launch();
  const ctx=await b.newContext({...devices['iPhone 13'],viewport:{width:390,height:1500},hasTouch:true,isMobile:true});
  const p=await ctx.newPage(); H.watch(p, 'iphone'); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const cdp=await ctx.newCDPSession(p);
  const touch=(t,x,y)=>cdp.send('Input.dispatchTouchEvent',{type:t,touchPoints:t==='touchEnd'?[]:[{x,y}]});
  const ctr=async sel=>{
    const l=p.locator(sel).first();
    // 画面の中央までスクロールする。scrollIntoViewIfNeeded は上部に固定したヘッダーを考えないので、
    // 要素がヘッダーの裏に隠れたまま「見えている」と判断することがある（2026-10-09 盤面の並びを変えて実際に落ちた）
    await l.evaluate(e=>e.scrollIntoView({block:'center'})); await new Promise(r=>setTimeout(r,60));
    const r=await l.boundingBox();
    return [r.x+r.width/2, r.y+r.height/2];
  };
  // スクロールせずに中心の座標を取る（ドラッグの行き先など、1つ目の座標を取ったあとで画面を動かしたくないとき）
  const pos=async sel=>{ const r=await p.locator(sel).first().boundingBox(); return [r.x+r.width/2, r.y+r.height/2]; };

  await H.prep(p);   // 召喚フェイズ（先手＝自分）。自分の側だけ操作できる
  await p.evaluate(()=>document.querySelectorAll('details.doc').forEach(d=>d.open=false));

  // タップ = メニュー（横向きにならない）
  let [hx,hy]=await ctr('#side-0 .z-hand .card');
  const u0=await p.evaluate(()=>undoStack.length);
  await touch('touchStart',hx,hy); await touch('touchEnd',hx,hy); await wait(80);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'タップでメニューが開く');
  ok(await p.evaluate(()=>state.players[0].hand[0].turned)===false,'タップで横向きにならない');
  ok(await p.evaluate(()=>undoStack.length)===u0,'タップだけでは状態を変えない（Undo が増えない）');

  // メニューの先頭が「移動先」
  const firstSect=await p.evaluate(()=>document.querySelector('#sheet .sect').textContent.trim());
  ok(firstSect==='移動先','メニューの先頭が移動先 ('+firstSect+')');

  // 移動できる
  await wait(420);
  await p.click('#sheet button[data-mv="line"][data-idx="0"]');
  ok(await p.evaluate(()=>state.players[0].line[0].length)===1,'メニューから第1ラインへ移動');
  ok(await p.evaluate(()=>state.players[0].hand.length)===5,'手札から減る');

  // 向きはメニューから変えられる
  await p.evaluate(()=>openCardSheet(state.players[0].line[0][0].uid));
  await wait(420);
  await p.click('#sheet button[data-tg]');
  ok(await p.evaluate(()=>state.players[0].line[0][0].turned)===true,'メニューから横向きにできる');

  // ドラッグは従来どおり
  await ctr('#side-0 [data-drop="ena"]');   // ライン（上）と墓地（下）の両方が画面に入る位置まで動かす
  const [cx,cy]=await pos('#side-0 .lineslot[data-idx="0"] .card');
  const [gx,gy]=await pos('#side-0 [data-drop="grave"]');
  ok(cy>260 && gy<1500-20,'ドラッグの元と行き先が両方とも画面内（ヘッダーの下）にある '+JSON.stringify([cy,gy]));
  await touch('touchStart',cx,cy);
  await touch('touchMove',cx,cy-18);
  await touch('touchMove',cx,cy-45);
  const dragging=await p.evaluate(()=>!!document.getElementById('ghost'));
  await touch('touchMove',gx,gy);
  await touch('touchEnd',gx,gy); await wait(60);
  ok(dragging,'ドラッグでゴーストが出る');
  ok(await p.evaluate(()=>state.players[0].grave.length)===1,'ドラッグで移動できる');
  ok(!await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'ドラッグ後にメニューが開かない');

  // 横スワイプは移動もメニューも起こさない
  [hx,hy]=await ctr('#side-0 .z-hand .card');
  const before=await p.evaluate(()=>undoStack.length);
  await touch('touchStart',hx,hy); await touch('touchMove',hx-32,hy); await touch('touchEnd',hx-32,hy); await wait(80);
  ok(await p.evaluate(()=>undoStack.length)===before,'横スワイプで状態が変わらない');
  ok(!await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'横スワイプでメニューが開かない');

  // 山札タップ
  let [dx,dy]=await ctr('#side-0 [data-pile]');
  await touch('touchStart',dx,dy); await touch('touchEnd',dx,dy); await wait(100);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'山札タップでメニューが開く');
  await wait(420); await p.click('#sheet button[data-close="1"]');
  // 自分の召喚フェイズ中は、相手の山札は開かない（相手の側は操作できない）
  [dx,dy]=await ctr('#side-1 [data-pile]');
  await touch('touchStart',dx,dy); await touch('touchEnd',dx,dy); await wait(100);
  ok(!await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')) && (await p.evaluate(()=>fxLines.join())).includes('操作できません'),
    '自分の召喚フェイズ中は、相手の山札をタップしても開かず、理由が出る');
  // 相手の手札のカードは、タップで見るだけ（移動先が出ない）
  [dx,dy]=await ctr('#side-1 .z-hand .card');
  await touch('touchStart',dx,dy); await touch('touchEnd',dx,dy); await wait(100);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on') && !document.querySelector('#sheet button[data-mv]') && document.querySelector('#sheet').textContent.includes('見るだけ')),
    '相手のカードはタップで見るだけ（移動・向きのボタンが出ない）');
  await wait(420); await p.click('#sheet button[data-close="1"]');
  // 相手のカードはドラッグしても動かない
  [dx,dy]=await ctr('#side-1 .z-hand .card');
  const h1=await p.evaluate(()=>state.players[1].hand.length);
  const [ex,ey]=await pos('#side-1 [data-drop="ena"]');
  await touch('touchStart',dx,dy); await touch('touchMove',dx,dy+18); await touch('touchMove',dx,dy+45);
  const ghost1=await p.evaluate(()=>!!document.getElementById('ghost'));
  await touch('touchMove',ex,ey); await touch('touchEnd',ex,ey); await wait(80);
  ok(!ghost1 && await p.evaluate(()=>state.players[1].hand.length)===h1,'相手のカードはドラッグしても動かない（ゴーストも出ない）');

  ok(errs.length===0,'JSエラーなし '+(errs.length?JSON.stringify(errs):''));
  await b.close();
  await H.finish();
})();
