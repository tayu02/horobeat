// 2人分の盤面（配置・移動・Undo・横スクロールなし）
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function run(label, viewport, touch){
  console.log('\n=== '+label+' ('+viewport.width+'x'+viewport.height+') ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}), viewport, hasTouch:!!touch, isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label);
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>({round:state.round,phase:state.phase,first:state.first,undo:undoStack.length,
    P:state.players.map(P=>({deck:P.deck.length,hand:P.hand.length,heart:P.heart.length,ena:P.ena.length,
      waza:P.waza.length,grave:P.grave.length,line:P.line.map(l=>l.length)}))}));

  let s=await S();
  ok(s.P[0].deck===50&&s.P[1].deck===50, '初期: 各プレイヤーの山札が50枚');
  ok(await p.evaluate(()=>state.players[0].deck[0].uid==="A-01"&&state.players[1].deck[0].uid==="B-01"), 'ID が A-xx / B-xx で分かれている');

  await p.click('button[data-act="setupAll"][data-pi="2"]');
  s=await S();
  ok(JSON.stringify(s.P[0])===JSON.stringify(s.P[1]), '両者まとめて準備で左右対称');
  ok(s.P[0].deck===38&&s.P[0].hand===6&&s.P[0].heart===5&&s.P[0].ena===1, '準備結果: 山札38/手札6/ハート5/エナ1');
  ok(await p.evaluate(()=>state.players[1].heart.every(c=>!c.up)&&state.players[1].ena.every(c=>c.up)), 'ハート裏向き / エナ表向き（相手側も）');
  ok(s.undo===1, '準備は1手でUndo可能');

  // 片側だけの操作
  await p.click('button[data-act="draw6"][data-pi="1"]');
  s=await S();
  ok(s.P[1].hand===12&&s.P[0].hand===6, '相手だけ6枚追加（自分に影響しない）');
  await p.click('#btnUndo');

  // タップ = メニュー、メニューから縦/横
  const sel = '#side-0 .z-ena .card';
  await p.locator(sel).first().scrollIntoViewIfNeeded();
  if (touch) await p.tap(sel); else await p.click(sel);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')), 'タップでメニューが開く');
  await wait(420);
  await p.click('#sheet button[data-tg]');
  const t1=await p.evaluate(()=>state.players[0].ena[0].turned);
  await p.evaluate(()=>openCardSheet(state.players[0].ena[0].uid));
  await wait(420);
  await p.click('#sheet button[data-tg]');
  const t2=await p.evaluate(()=>state.players[0].ena[0].turned);
  ok(t1===true&&t2===false, 'メニューから 縦向き⇄横向き');

  // メニュー: 自分の手札 -> 相手の第3ライン（相手の場へタブ）
  await p.evaluate(()=>openCardSheet(state.players[0].hand[0].uid));
  await wait(430);
  await p.click('#sheet button[data-tab="1"]');
  await wait(430);
  await p.click('#sheet button[data-mv="line"][data-idx="2"]');
  s=await S();
  ok(s.P[1].line[2]===1&&s.P[0].hand===5, 'メニューで自分の手札→相手の第3ラインへ移動');
  ok(await p.evaluate(()=>state.players[1].line[2][0].uid.startsWith('A-')), '移動しても所有元IDは変わらない');

  // オーバービート: 同じラインに重ねる
  await p.evaluate(()=>openCardSheet(state.players[1].hand[0].uid, 1));
  await wait(430);
  await p.click('#sheet button[data-mv="line"][data-idx="2"]');
  s=await S();
  ok(s.P[1].line[2]===2, '1ラインに2枚重ねられる（オーバービート想定・制限なし）');
  const stacked=await p.evaluate(()=>{
    const c=document.querySelectorAll('#side-1 .lineslot[data-idx="2"] .card');
    if(c.length<2) return null;
    const a=c[0].getBoundingClientRect(), b=c[1].getBoundingClientRect();
    return {overlap: a.bottom-b.top, second_lower: b.top>a.top};
  });
  ok(stacked&&stacked.second_lower&&stacked.overlap>10, '重なって表示される '+JSON.stringify(stacked));

  // ドラッグ: 相手の第3ライン -> 相手の墓地
  await p.evaluate(()=>document.querySelectorAll('details.doc').forEach(d=>d.open=false));
  const cb=await p.locator('#side-1 .lineslot[data-idx="2"] .card').last().boundingBox();
  const gb=await p.locator('#side-1 [data-drop="grave"]').boundingBox();
  if (cb&&gb&&gb.y>0&&gb.y<viewport.height){
    await p.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2);
    await p.mouse.down();
    await p.mouse.move(cb.x+cb.width/2,cb.y+cb.height/2-30,{steps:4});
    await p.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2,{steps:8});
    const over=await p.evaluate(()=>!!document.querySelector('.zone.over'));
    await p.mouse.up();
    s=await S();
    ok(over,'ドラッグ中にドロップ先がハイライト');
    ok(s.P[1].grave===1&&s.P[1].line[2]===1,'ドラッグで墓地へ移動');
  } else console.log('  SKIP ドラッグ（対象が画面外）');

  // フェイズ・先手
  const ph=[];
  for(let i=0;i<4;i++){ await p.click('#btnPhase'); ph.push(await p.textContent('#phaseLbl')); }
  ok(ph[0].startsWith('召喚')&&ph[2].startsWith('エンド')&&ph[3].startsWith('召喚')&&(await S()).round===2,'フェイズ手動送り→3巡でラウンド+1');
  await p.click('#firstOpp');
  ok((await S()).first===1 && await p.isVisible('#side-1 .sidehead .badge'),'先手の記録が相手側に表示される');

  // Undo
  const before=(await S()).undo;
  for(let i=0;i<6;i++) await p.click('#btnUndo');
  ok((await S()).undo===before-6,'Undoが1手ずつ戻る');

  // レイアウト
  const ov=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
  ok(ov.sw<=ov.cw+1,'横スクロールが発生しない ('+ov.sw+'<='+ov.cw+')');
  const adj=await p.evaluate(()=>{
    const o=document.querySelector('#side-1 .z-line').getBoundingClientRect();
    const m=document.querySelector('#side-0 .z-line').getBoundingClientRect();
    const zones=[...document.querySelectorAll('#side-1 .zone,#side-0 .zone')].map(z=>z.getBoundingClientRect());
    // 相手ラインと自分ラインの間に他ゾーンが挟まっていないか
    const between=zones.filter(r=>r.top>o.bottom-1&&r.bottom<m.top+1).length;
    return {oppLineBottom:Math.round(o.bottom), meLineTop:Math.round(m.top), gap:Math.round(m.top-o.bottom), between};
  });
  ok(adj.between===0 && adj.gap>=0 && adj.gap<120,'両者のバトルラインが中央で隣接 '+JSON.stringify(adj));
  // 広い画面は公式の手引書の「盤面見本」どおり（rules_confirmed.md §5）
  if(!touch){
    const L=await p.evaluate(()=>{ const r=(pi,c)=>document.querySelector('#side-'+pi+' .'+c).getBoundingClientRect();
      const o={}; for(const pi of [0,1]) for(const c of ['z-heart','z-line','z-waza','z-ena','z-hand','z-deck','z-grave']){ const b=r(pi,c); o[pi+c]={x:Math.round(b.left),y:Math.round(b.top),r:Math.round(b.right)}; } return o; });
    ok(L['0z-heart'].r<=L['0z-line'].x && L['0z-deck'].x>=L['0z-line'].r && L['0z-deck'].y<L['0z-grave'].y,'自分: 左にハートゾーン、右に山札（上）と墓地（下）');
    ok(L['0z-line'].y<L['0z-waza'].y && L['0z-waza'].y<L['0z-ena'].y && L['0z-ena'].y<L['0z-hand'].y,'自分: 中央は上からバトルライン→ワザ→エナ→手札');
    ok(L['1z-heart'].x>=L['1z-line'].r && L['1z-deck'].r<=L['1z-line'].x && L['1z-grave'].y<L['1z-deck'].y,'相手: 点対称（右にハートゾーン、左に墓地（上）と山札（下））');
    ok(L['1z-hand'].y<L['1z-ena'].y && L['1z-ena'].y<L['1z-waza'].y && L['1z-waza'].y<L['1z-line'].y,'相手: 中央は上から手札→エナ→ワザ→バトルライン');
  } else {
    const order=await p.evaluate(()=>[0,1].map(pi=>[...document.querySelectorAll('#side-'+pi+' .zone')].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top||a.getBoundingClientRect().left-b.getBoundingClientRect().left).map(z=>z.className.match(/z-(\w+)/)[1]).join('>')));
    ok(order[0]==='line>waza>ena>heart>deck>grave>hand' && order[1]==='hand>deck>grave>heart>ena>waza>line','狭い画面: 自分は上からライン→ワザ→エナ→ハート→山札・墓地→手札、相手はその逆順 '+JSON.stringify(order));
  }

  await p.evaluate(()=>{ window.scrollTo(0,0); });
  await p.screenshot({path:H.out('shot-'+label+'.png'),fullPage:true});
  ok(errs.length===0,'JSエラーなし '+(errs.length?JSON.stringify(errs):''));
  await b.close();
}

(async()=>{
  await run('iphone', {width:390,height:1800}, true);
  await run('pc',     {width:1280,height:1500}, false);
  await H.finish();
})();
