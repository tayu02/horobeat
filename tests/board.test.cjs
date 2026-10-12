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

  await H.prep(p);
  s=await S();
  ok(JSON.stringify(s.P[0])===JSON.stringify(s.P[1]), '準備で左右対称');
  ok(s.P[0].deck===38&&s.P[0].hand===6&&s.P[0].heart===5&&s.P[0].ena===1, '準備結果: 山札38/手札6/ハート5/エナ1');
  ok(await p.evaluate(()=>state.players[1].heart.every(c=>!c.up)&&state.players[1].ena.every(c=>c.up)), 'ハート裏向き / エナ表向き（相手側も）');
  ok(s.undo===3, '準備は「配る」「引き直すか（自分）」「引き直すか（相手）」の3手で、1手ずつ戻せる');

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

  // 召喚フェイズ中は「相手の場へ」が出ない（相手の側は操作できない）
  await p.evaluate(()=>openCardSheet(state.players[0].hand[0].uid));
  await wait(430);
  ok(await p.evaluate(()=>!document.querySelector('#sheet button[data-tab]')), '召喚フェイズ中は「相手の場へ」が出ない');
  await p.click('#sheet button[data-close="1"]');
  // エンドフェイズ（どちらの番でもない）なら、相手の場へも動かせる（手で処理するため）
  await p.evaluate(()=>{ state.phase=3; render(); });
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

  // 先手の表示
  const fb=await p.evaluate(()=>[document.querySelector('#side-1 .sidehead .badge').textContent, document.querySelector('#side-0 .sidehead .badge').textContent]);
  ok((await S()).first===0 && fb[0]==='後手' && fb[1]==='先手','先手（自分）・後手（相手）が両者の見出しに出る '+JSON.stringify(fb));

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
  // PC も iPhone も、公式の手引書の「盤面見本」どおりの1枚の盤（rules_confirmed.md §5）
  const L=await p.evaluate(()=>{ const r=(pi,c)=>document.querySelector('#side-'+pi+' .'+c).getBoundingClientRect();
    const o={}; for(const pi of [0,1]) for(const c of ['z-heart','z-line','z-waza','z-ena','z-hand','z-deck','z-grave','sidehead']){ const b=r(pi,c); o[pi+c]={x:Math.round(b.left),y:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom)}; }
    const f=document.getElementById('facingMark').getBoundingClientRect(); o.lab={x:Math.round(f.left),y:Math.round(f.top),r:Math.round(f.right),b:Math.round(f.bottom)};
    // ライン番号の帯と、両者のライン枠の列がそろっているか（中心のずれ）
    const cx=e=>{ const b=e.getBoundingClientRect(); return (b.left+b.right)/2; };
    const labs=[...document.querySelectorAll('#facingMark .lnlab')], s0=[...document.querySelectorAll('#side-0 .lineslot')], s1=[...document.querySelectorAll('#side-1 .lineslot')];
    o.align=Math.max(...labs.map((l,i)=>Math.max(Math.abs(cx(l)-cx(s0[i])),Math.abs(cx(l)-cx(s1[i])))));
    o.labText=labs.map(l=>l.textContent).join(',');
    return o; });
  ok(L['0z-heart'].r<=L['0z-line'].x && L['0z-deck'].x>=L['0z-line'].r && L['0z-deck'].y<L['0z-grave'].y,'自分: 左にハートゾーン、右に山札（上）と墓地（下）');
  ok(L['0z-line'].y<L['0z-waza'].y && L['0z-waza'].y<L['0z-ena'].y && L['0z-ena'].y<L['0z-hand'].y,'自分: 中央は上からバトルライン→ワザ→エナ→手札');
  ok(L['1z-heart'].x>=L['1z-line'].r && L['1z-deck'].r<=L['1z-line'].x && L['1z-grave'].y<L['1z-deck'].y,'相手: 点対称（右にハートゾーン、左に墓地（上）と山札（下））');
  ok(L['1z-hand'].y<L['1z-ena'].y && L['1z-ena'].y<L['1z-waza'].y && L['1z-waza'].y<L['1z-line'].y,'相手: 中央は上から手札→エナ→ワザ→バトルライン');
  ok(L.lab.y>=L['1z-line'].b-1 && L.lab.b<=L['0z-line'].y+1 && L.labText==='第1ライン,第2ライン,第3ライン,第4ライン,第5ライン','ライン番号の帯は1本だけで、両者のバトルラインの間にある');
  ok(L.align<=2,'ライン番号と両者のライン枠の列がそろっている（ずれ '+L.align+'px）');
  ok(L['1sidehead'].r<=L.lab.x && L['0sidehead'].x>=L.lab.r,'ライン番号の左に相手（後手/先手）、右に自分の表示');
  ok(L['1z-hand'].y<L['1z-ena'].y && L['0z-hand'].b>L['0z-ena'].b,'手札は盤の上端（相手）と下端（自分）');

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
