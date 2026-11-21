// 登録済みのデッキ（第一弾の赤単・青単・緑単）と、デッキを選ぶプルダウン（依頼者の指示 2026-11-21）
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SD=require(H.ROOT+'/data/starter-decks.json').decks;
const PD=require(H.ROOT+'/data/preset-decks.json').decks;
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const count=(deck)=>{ const m={}; deck.forEach(c=>m[c.key]=(m[c.key]||0)+1); return m; };
  const same=(m,sd)=>sd.cards.every(c=>m[c.key]===c.count) && Object.keys(m).length===sd.cards.length;
  const red=PD.find(d=>d.id==='P01-RED'), blue=PD.find(d=>d.id==='P01-BLUE'), green=PD.find(d=>d.id==='P01-GREEN');

  ok(await p.evaluate(()=>PRESETS.map(d=>d.name).join())==='赤単(第一弾),青単(第一弾),緑単(第一弾)','第一弾のデッキ3つ（赤単・青単・緑単）が埋め込まれている');

  // ---- 「はじめかた」のプルダウン（盤面が空なので、確かめずに山札まで組む）----
  const gsel=pi=>`#guideStarters select.dkpick[data-pi="${pi}"]`;
  const groups=await p.evaluate(s=>[...document.querySelectorAll(s+' optgroup')].map(g=>g.label+':'+[...g.querySelectorAll('option')].map(o=>o.textContent).join('/')),gsel(0));
  ok(groups[0]==='スタートデッキ（公式）:スタートデッキ レオジン（赤）/スタートデッキ 不死火翔（緑）' && groups[1]==='第一弾のデッキ:赤単(第一弾)/青単(第一弾)/緑単(第一弾)',
     'はじめかたのプルダウンに、スタートデッキ（公式）と第一弾のデッキが並ぶ '+JSON.stringify(groups));
  await p.selectOption(gsel(0),'p:P01-RED'); await wait(80);
  await p.selectOption(gsel(1),'p:P01-BLUE'); await wait(80);
  let s=await S();
  ok(s.players[0].deck.length===50 && same(count(s.players[0].deck),red),'自分の山札が赤単(第一弾)の50枚になる（未確定カードなし）');
  ok(s.players[1].deck.length===50 && same(count(s.players[1].deck),blue),'相手の山札が青単(第一弾)の50枚になる');
  ok(await p.evaluate(s=>document.querySelector(s).value,gsel(0))==='p:P01-RED','選んだデッキがプルダウンに出たままになる');

  // 配ると「はじめかた」は隠れる（プルダウンも見えなくなる）。配ったあとにデッキを変えるのは「📋 デッキ」の画面
  await H.prep(p);
  ok(!await p.isVisible(gsel(0)),'配ると「はじめかた」のプルダウンは隠れる');
  // 盤面にカードがあるときに、組み直す側のプルダウン（はじめかた）で選んだときの処理: 画面の中で確かめる
  //（やめる → 変えない／組み直す → 盤面を消して組み直す。はじめかたのボタンと同じ）
  const hand0=(await S()).players[0].hand.length;
  await p.evaluate(()=>deckPickApply(0,'p:P01-GREEN',false));
  ok((await p.textContent('#sheet')).includes('盤面を消して') && (await p.textContent('#sheet')).includes('緑単(第一弾)'),'盤面にカードがあると、組み直してよいかを画面の中で確かめる');
  await H.confirmNo(p); await wait(80);
  s=await S();
  ok(same(s.players[0].decklist,red) && s.players[0].hand.length===hand0,'「やめる」なら何も変えない');
  ok(await p.evaluate(s=>document.querySelector(s).value,gsel(0))==='p:P01-RED','「やめる」とプルダウンの表示も元に戻る');
  await p.evaluate(()=>deckPickApply(0,'p:P01-GREEN',false));
  await H.confirmYes(p); await wait(80);
  s=await S();
  ok(s.players[0].hand.length===0 && s.players[0].deck.length===50 && same(count(s.players[0].deck),green),'「組み直す」なら盤面を消して緑単(第一弾)の50枚で組み直す');

  // ---- 「📋 デッキ」の画面のプルダウン（デッキの登録だけを変える。タブと同じ）----
  await p.evaluate(()=>{ runAction('setupAll',2); render(); });
  await p.click('.navbtn[data-view="deck"]');
  const pile0=JSON.stringify((await S()).players[0].deck.map(c=>c.key));
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','p:P01-BLUE'); await wait(80);
  s=await S();
  ok(!await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'デッキの画面では、盤面にカードがあっても確かめずにすぐ切り替わる');
  ok(same(s.players[0].decklist,blue) && JSON.stringify(s.players[0].deck.map(c=>c.key))===pile0,'デッキ（登録）が青単(第一弾)になり、盤面（山札）はそのまま');
  ok((await p.textContent('#viewDeck .dknow')).includes('「青単(第一弾)」そのまま'),'「いまのデッキ: 「青単(第一弾)」そのまま」と出る');
  ok(await p.evaluate(()=>{ const c=document.querySelectorAll('#viewDeck .ctile'); return c.length>0&&[...c].every(e=>e.dataset.color==='青'); }),'デッキの画面に青単(第一弾)のカードが並ぶ');
  // スタートデッキもプルダウンから選べる
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','s:HB-SD02'); await wait(80);
  ok(same((await S()).players[0].decklist,SD[1]),'スタートデッキ（不死火翔）もプルダウンから選べる');
  await p.click('#btnUndo2'); await wait(60);
  ok(same((await S()).players[0].decklist,blue),'「戻す」で取り消せる');

  // ---- 保存したデッキもプルダウンに出て、選べる ----
  await p.evaluate(()=>{ lib.push({id:'T1', name:'試しのデッキ', cards:{'HB01-001':4,'HB01-002':4}}); libStore(); render(); });
  const libOpts=await p.evaluate(()=>[...document.querySelectorAll('#viewDeck select.dkpick optgroup')].map(g=>g.label+':'+[...g.querySelectorAll('option')].map(o=>o.textContent).join('/')));
  ok(libOpts[2]==='保存したデッキ（この端末）:試しのデッキ（8枚）','保存したデッキも「保存したデッキ（この端末）」として並ぶ '+JSON.stringify(libOpts));
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','l:T1'); await wait(80);
  s=await S();
  ok(s.players[0].decklist['HB01-001']===4 && s.players[0].decklist['HB01-002']===4 && Object.keys(s.players[0].decklist).length===2,'保存したデッキを選ぶと、その構成になる');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  // 検証（tools/validate-cards.mjs の checkStarters）を、登録済みのデッキにも使っている
  const V=await import(H.ROOT+'/tools/validate-cards.mjs');
  const cards=require(H.ROOT+'/data/cards.json').cards;
  ok(V.checkStarters(cards,H.ROOT+'/data/preset-decks.json').length===0,'data/preset-decks.json は検証を通る（登録済みのカードだけ・50枚・同名4枚まで）');
  ok(PD.every(d=>d.source && d.received && Array.isArray(d.notes)),'どのデッキにも出典・受け取った日・注記がある');
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
