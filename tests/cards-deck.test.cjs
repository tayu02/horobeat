// カードデータ・デッキ編集・同名4枚・表示・メモ・保存
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const EXPECTED_CARDS = require(H.ROOT+'/data/cards.json').cards.length;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const openFor=async uid=>{ await p.evaluate(u=>openCardSheet(u),uid); await wait(430); };
  const closeS=async()=>{ await p.click('#sheet button[data-close="1"]'); };

  // --- カードDB ---
  ok(await p.evaluate(()=>CARD_LIST.length)===EXPECTED_CARDS,'カードDBが cards.json と同じ '+EXPECTED_CARDS+' 枚埋め込まれている');
  ok(await p.evaluate(()=>CARDS['HB01-049'].abilities[0].includes('下にあるカード')),'能力文が印字どおり入っている');

  // --- デッキ編集: 4枚上限、50枚固定、未確定で埋める ---
  await p.evaluate(()=>{document.getElementById('deckPanel').open=true;});
  for(let i=0;i<5;i++) await p.click('button[data-dk="+"][data-pi="0"][data-key="HB01-001"]').catch(()=>{});
  ok((await S()).players[0].decklist['HB01-001']===4,'同名4枚で止まる');
  await p.click('button[data-dk="+"][data-pi="0"][data-key="HB01-097"]');
  await p.click('button[data-dk="+"][data-pi="0"][data-key="HB01-097"]');
  await p.click('button[data-dk="+"][data-pi="0"][data-key="UNKNOWN-utsushimi"]');
  p.once('dialog',d=>d.accept());
  await p.click('button[data-act="rebuild"][data-pi="0"]');
  let s=await S();
  const keys=s.players[0].deck.map(c=>c.key);
  ok(s.players[0].deck.length===50,'初期化後も50枚');
  ok(keys.filter(k=>k==='HB01-001').length===4&&keys.filter(k=>k==='HB01-097').length===2&&keys.filter(k=>k==='UNKNOWN-utsushimi').length===1,'登録枚数どおりに入る');
  ok(keys.filter(k=>k===null).length===43,'残り43枚は未確定(null)');
  ok(s.players[1].deck.every(c=>c.key===null),'相手には影響しない（全て未確定）');

  // --- 同名4枚はカード名で数える（HB01-034 と HD02-001 はどちらも「しなずいさま」） ---
  await p.evaluate(()=>{ state.players[1].decklist={}; render(); });
  for(let i=0;i<5;i++) await p.click('button[data-dk="+"][data-pi="1"][data-key="HB01-034"]').catch(()=>{});
  ok((await S()).players[1].decklist['HB01-034']===4,'HB01-034 を4枚入れられる');
  const dis=await p.evaluate(()=>document.querySelector('button[data-dk="+"][data-pi="1"][data-key="HD02-001"]').disabled);
  ok(dis,'同名の HD02-001 は追加できない（名前で合計4枚）');
  await p.click('button[data-dk="-"][data-pi="1"][data-key="HB01-034"]');
  ok(!await p.evaluate(()=>document.querySelector('button[data-dk="+"][data-pi="1"][data-key="HD02-001"]').disabled),'1枚減らせば同名の別番号を1枚入れられる');
  await p.click('button[data-dk="+"][data-pi="1"][data-key="HD02-001"]');
  let ss=await S();
  ok(ss.players[1].decklist['HB01-034']===3&&ss.players[1].decklist['HD02-001']===1,'合計4枚で止まる');
  ok(await p.evaluate(()=>document.querySelectorAll('.dkshare').length>=2),'同名のカードに印が出る');
  // 不正な保存データも安全側に丸める
  await p.evaluate(()=>{ state.players[1].decklist={'HB01-034':4,'HD02-001':4}; rebuildPlayer(1); render(); });
  const cnt=await p.evaluate(()=>state.players[1].deck.filter(c=>c.key&&CARDS[c.key]&&CARDS[c.key].name==='しなずいさま').length);
  ok(cnt===4,'壊れた構成を読み込んでも同名は4枚に丸められる ('+cnt+')');
  await p.evaluate(()=>{ state.players[1].decklist={}; rebuildPlayer(1); render(); });

  // --- 準備して表示 ---
  await p.click('button[data-act="setupAll"][data-pi="2"]');
  await p.evaluate(()=>document.querySelectorAll('details.doc').forEach(d=>d.open=false));
  s=await S();
  ok(s.players[0].hand.length===6&&s.players[0].heart.length===5&&s.players[0].ena.length===1,'準備手順が動く');
  // 既知カードの表示（手札のどこかに既知が来るよう、山札から既知を1枚手札へ）
  await p.evaluate(()=>{ const d=state.players[0].deck; const i=d.findIndex(c=>c.key==='HB01-097'); if(i>=0){ const c=d.splice(i,1)[0]; c.up=true; state.players[0].hand.push(c);} render(); });
  const known=await p.evaluate(()=>{ const uid=state.players[0].hand.find(c=>c.key==='HB01-097').uid; const el=document.querySelector('#side-0 .z-hand .card[data-cid="'+uid+'"]'); if(!el) return null;
    return {name:el.querySelector('.cname').textContent, cost:el.querySelector('.ccost').textContent, pow:el.querySelector('.cpow').textContent, color:el.dataset.color}; });
  ok(known&&known.name==='正義合身 義郎坊'&&known.cost==='6'&&known.pow==='6000'&&known.color==='青','既知カードに名前・コスト・パワー・色が出る '+JSON.stringify(known));
  const unk=await p.evaluate(()=>!!document.querySelector('#side-0 .z-hand .ci.unk'));
  ok(unk,'未確定カードは灰色の「未確定」で出る');

  // --- 詳細シート ---
  const gUid=await p.evaluate(()=>state.players[0].hand.find(c=>c.key==='HB01-097').uid);
  await openFor(gUid);
  const det=await p.evaluate(()=>document.querySelector('#sheet .cdetail').textContent);
  ok(det.includes('2つ目のワザ')&&det.includes('オーバーT')&&det.includes('ダブルダメージ'),'タップで能力文とトリガーが全文出る');
  ok(det.includes('KARUTA SHIKI')&&det.includes('chiam'),'版（SR/DR）が両方出る');
  ok(await p.evaluate(()=>!!document.querySelector('#sheet input#noteIn')),'メモ欄がある');
  // メモ保存
  await p.fill('#noteIn','+3000');
  await p.click('#sheet button[data-note]');
  ok(await p.evaluate(()=>state.players[0].hand.find(c=>c.key==='HB01-097').note)==='+3000','メモが保存される');
  ok(await p.evaluate(()=>{const uid=state.players[0].hand.find(c=>c.key==='HB01-097').uid; const e=document.querySelector('#side-0 .z-hand .card[data-cid="'+uid+'"]'); return e&&e.querySelector('.cnote')&&e.querySelector('.cnote').textContent==='+3000';}),'メモがカード上に出る');
  // unknown 表示
  // シャッフル次第でハート／エナに入ることがある（約12%）。山札だけを探すと別のカードを掴むので、全ゾーンから探す
  const uUid=await p.evaluate(()=>{ const P=state.players[0]; let c=P.hand.find(c=>c.key==='UNKNOWN-utsushimi');
    if(!c){ for(const z of ['deck','heart','ena','grave','waza']){ const i=P[z].findIndex(c=>c.key==='UNKNOWN-utsushimi'); if(i>=0){ c=P[z].splice(i,1)[0]; break; } } c.up=true; P.hand.push(c);} render(); return c.uid; });
  await openFor(uUid);
  const det2=await p.evaluate(()=>document.querySelector('#sheet .cdetail').innerHTML);
  ok(det2.includes('class="unk">unknown')&&det2.includes('他のワザを使っているときのみ'),'読めない項目は unknown と明示され、読めた文は出る');
  await closeS();
  // 未確定カードの詳細
  const nUid=await p.evaluate(()=>state.players[0].hand.find(c=>c.key===null).uid);
  await openFor(nUid);
  ok((await p.evaluate(()=>document.querySelector('#sheet .cdetail').textContent)).includes('空席'),'未確定カードは空席である旨が出る');
  await closeS();

  // 新しく追加されたカードも表示できる（HD01: 弾記号が2文字英字）
  const hdUid=await p.evaluate(()=>{ const P=state.players[0]; const c={uid:'A-99',owner:0,key:'HD01-017',up:true,turned:false,note:''}; P.hand.push(c); render(); return c.uid; });
  await openFor(hdUid);
  const hd=await p.evaluate(()=>document.querySelector('#sheet .cdetail').textContent);
  ok(hd.includes('破壊されない')&&hd.includes('ラストオーバーT')&&hd.includes('HD01')===false,'HD01-017 の能力文とトリガーが出る');
  await closeS();
  await p.evaluate(()=>{ const P=state.players[0]; P.hand=P.hand.filter(c=>c.uid!=='A-99'); render(); });
  // バリアの定義が入ったカード
  const bUid=await p.evaluate(()=>{ const P=state.players[0]; const c={uid:'A-98',owner:0,key:'HD02-002',up:true,turned:false,note:''}; P.hand.push(c); render(); return c.uid; });
  await openFor(bUid);
  const bt=await p.evaluate(()=>document.querySelector('#sheet .cdetail').textContent);
  ok(bt.includes('1バリア')&&bt.includes('プレイヤーが受けるダメージは1減る'),'バリアの定義文が出る');
  ok(bt.includes('ラシャ・ブラッド'),'新ファミリーが出る');
  await closeS();
  await p.evaluate(()=>{ const P=state.players[0]; P.hand=P.hand.filter(c=>c.uid!=='A-98'); render(); });

  // --- 束の枚数バッジ ---
  await p.evaluate(()=>{ const h=state.players[0].hand; moveCard(h[0].uid,0,'line',2,false); moveCard(h[0].uid,0,'line',2,false); moveCard(h[0].uid,0,'line',2,false); render(); });
  const badge=await p.evaluate(()=>{const e=document.querySelector('#side-0 .lineslot[data-idx="2"] .stackn'); return e?e.textContent:null;});
  ok(badge==='3枚','3枚重ねたラインに「3枚」バッジ');
  ok(await p.evaluate(()=>!document.querySelector('#side-0 .lineslot[data-idx="0"] .stackn')),'空のラインにはバッジなし');

  // --- エナのまとめ操作 ---
  await p.evaluate(()=>{ for(let i=0;i<5;i++) drawTo(0,1,'ena',true); render(); });
  ok((await S()).players[0].ena.length===6,'エナ6枚');
  await p.click('#side-0 .zlabel[data-zsheet="ena"]');
  await wait(430);
  await p.click('#sheet button[data-ena="tap"][data-arg="4"]');
  s=await S();
  ok(s.players[0].ena.filter(c=>c.turned).length===4&&s.players[0].ena.slice(0,4).every(c=>c.turned),'左から4枚が横向きになる');
  await p.click('#side-0 .zlabel[data-zsheet="ena"]'); await wait(430);
  const disabled5=await p.evaluate(()=>document.querySelector('#sheet button[data-ena="tap"][data-arg="3"]').disabled);
  ok(disabled5,'縦が2枚しかないとき3枚ボタンは押せない');
  await p.click('#sheet button[data-ena="untapAll"]');
  ok((await S()).players[0].ena.every(c=>!c.turned),'全て縦向きに戻る');

  // --- N枚引く ---
  await p.click('#side-1 .zlabel[data-zsheet="deck"]'); await wait(430);
  const h0=(await S()).players[1].hand.length;
  await p.click('#sheet button[data-act="drawN"][data-arg="3"]');
  ok((await S()).players[1].hand.length===h0+3,'山札から3枚引ける');

  // --- Undo がメモ・エナ操作・デッキ編集も戻す ---
  const u0=await p.evaluate(()=>undoStack.length);
  await p.click('#btnUndo');
  ok((await S()).players[1].hand.length===h0&&await p.evaluate(()=>undoStack.length)===u0-1,'Undoで3枚引くが戻る');

  // --- 保存と復元 ---
  const before=JSON.stringify(await S());
  await p.reload();
  await wait(100);
  const after=JSON.stringify(await S());
  ok(before===after,'再読み込みしても盤面が復元される');
  ok(!await p.isVisible('#guide'),'復元後はガイドが出ない');
  // リセットで消える
  await p.evaluate(()=>document.querySelectorAll('details.doc').forEach(d=>d.open=true));
  await p.click('button[data-act="reset"]');
  ok(await p.evaluate(()=>localStorage.getItem('horobeat-sim-v2')!==null),'リセット後も（空の）状態は保存される');
  s=await S();
  ok(s.players[0].deck.length===50&&s.players[0].hand.length===0,'リセットで盤面が空に');
  ok(s.players[0].decklist['HB01-001']===4,'リセットしてもデッキ構成は残る');
  await p.reload(); await wait(100);
  ok((await S()).players[0].hand.length===0&&await p.isVisible('#guide'),'リセット後に再読み込みしても空のまま・ガイドが出る');

  // --- レイアウト ---
  const ov=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
  ok(ov.sw<=ov.cw+1,'横スクロールなし ('+ov.sw+'<='+ov.cw+')');
  ok(errs.length===0,'JSエラーなし '+(errs.length?JSON.stringify(errs):''));

  // スクショ用: 既知カードを場に並べる
  await p.click('button[data-act="setupAll"][data-pi="2"]');
  await p.evaluate(()=>{
    const P=state.players[0]; const pick=k=>{const i=P.deck.findIndex(c=>c.key===k); return i>=0?P.deck.splice(i,1)[0]:null;};
    let c; c=pick('HB01-001'); if(c){c.up=true;P.line[0].push(c);} c=pick('HB01-097'); if(c){c.up=true;P.line[0].push(c);}
    c=pick('HB01-001'); if(c){c.up=true;c.turned=true;P.line[1].push(c);}
    c=pick('UNKNOWN-utsushimi'); if(c){c.up=true;c.note='+2000';P.hand.push(c);}
    P.ena[0].turned=true;
    document.querySelectorAll('details.doc').forEach(d=>d.open=false); render();
  });
  await p.evaluate(()=>window.scrollTo(0,0));
  await p.screenshot({path:H.out('cards-deck-'+label+'.png'),fullPage:true});
  await b.close();
}
(async()=>{
  await run('iphone',{width:390,height:1700},true);
  await run('pc',{width:1280,height:1600},false);
  await H.finish();
})();
