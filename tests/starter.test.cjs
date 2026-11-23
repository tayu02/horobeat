// スタートデッキを選んで使う（依頼者の指示 2026-10-10）
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SD=require(H.ROOT+'/data/starter-decks.json').decks;
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const count=(deck)=>{ const m={}; deck.forEach(c=>m[c.key]=(m[c.key]||0)+1); return m; };
  const same=(m,sd)=>sd.cards.every(c=>m[c.key]===c.count) && Object.keys(m).length===sd.cards.length;

  ok(await p.evaluate(()=>STARTERS.length)===2,'スタートデッキ2種が埋め込まれている');
  // はじめかたのプルダウン（盤面が空なので確かめずに読み込む）。2026-11-23 からボタンは出さず、プルダウンだけ（依頼者の指示）
  ok(!(await p.$('#guideStarters button')) && !(await p.$('#viewDeck .dktabs')),'スタートデッキはボタンとして外に出さない（プルダウンの中だけ）');
  await p.selectOption('#guideStarters select.dkpick[data-pi="0"]','s:HB-SD01'); await wait(80);
  await p.selectOption('#guideStarters select.dkpick[data-pi="1"]','s:HB-SD02'); await wait(80);
  let s=await S();
  ok(s.players[0].deck.length===50 && same(count(s.players[0].deck),SD[0]),'自分の山札がレオジン（赤）の50枚になる（未確定カードなし）');
  ok(s.players[1].deck.length===50 && same(count(s.players[1].deck),SD[1]),'相手の山札が不死火翔（緑）の50枚になる');
  ok(await p.evaluate(()=>document.querySelector('#guideStarters select.dkpick[data-pi="0"]').value)==='s:HB-SD01','選んだスタートデッキがプルダウンに出たままになる');
  // 「📋 デッキ」の画面のプルダウン（自分のデッキを開いている）
  await p.click('.navbtn[data-view="deck"]');
  const opts=await p.evaluate(()=>[...document.querySelectorAll('#viewDeck select.dkpick[data-pi="0"] option')].map(o=>o.textContent));
  ok(opts.includes('スタートデッキ レオジン（赤）') && opts.includes('スタートデッキ 不死火翔（緑）') && opts[opts.length-1]==='空から組む（登録なし）',
     'デッキの画面のプルダウンに「スタートデッキ レオジン（赤）／不死火翔（緑）」と、最後に「空から組む（登録なし）」がある '+JSON.stringify(opts));
  ok((await p.evaluate(()=>document.querySelector('#viewDeck .dknow').textContent)).includes('HB-SD01'),'「いまのデッキ: スタートデッキ レオジン（赤）（HB-SD01）そのまま」と出る');
  // ＋で変えると「自分で組んだデッキ」になる
  await p.evaluate(()=>{ const dl=state.players[0].decklist; dl['HD01-016']=2; render(); });
  ok((await p.evaluate(()=>document.querySelector('#viewDeck .dknow').textContent)).includes('自分で組んだ'),'枚数を変えると「自分で組んだデッキ」になる');
  // 盤面にカードがあるとき: デッキの画面のプルダウンはデッキ（登録）だけを変え、盤面は消さない（−／＋ と同じ）。
  // 以前はブラウザの確認窓で聞いていたが、公開先では確認窓が出ずに「いいえ」になり、押しても何も起きなかった（2026-10-19 依頼者の報告）
  await p.evaluate(()=>{ runAction('setupAll',2); render(); });
  const pile0=JSON.stringify((await S()).players[0].deck.map(c=>c.key));
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','s:HB-SD02'); await wait(80);
  s=await S();
  ok(!await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'盤面にカードがあっても、デッキの画面のプルダウンで選ぶと確かめずにすぐ切り替わる');
  ok(same(s.players[0].decklist,SD[1]),'デッキ（登録）が不死火翔（緑）の構成になる');
  ok(s.players[0].hand.length===6&&JSON.stringify(s.players[0].deck.map(c=>c.key))===pile0,'盤面（手札・山札）はそのまま');
  ok(await p.evaluate(()=>document.querySelector('#viewDeck select.dkpick[data-pi="0"]').value)==='s:HB-SD02'&&(await p.textContent('#viewDeck .dknow')).includes('HB-SD02'),'選んだデッキがプルダウンに出たままになり、「いまのデッキ」に出る');
  ok(await p.evaluate(()=>{ const c=document.querySelectorAll('#viewDeck .ctile'); return c.length>0&&[...c].every(e=>e.dataset.color==='緑'); }),'デッキの画面に不死火翔（緑）のカードが並ぶ');
  ok((await p.textContent('#viewDeck .dkold')).includes('まだ前のデッキのまま'),'盤面がまだ前のデッキだと知らせる');
  // 組み直す: 画面の中で確かめる（やめる → 変えない／組み直す → 盤面を消して組み直す）
  await p.click('#viewDeck button[data-act="rebuild"][data-pi="0"]');
  ok((await p.textContent('#sheet')).includes('盤面を消して'),'「組み直す」は画面の中のシートで確かめる');
  await H.confirmNo(p); await wait(80);
  s=await S();
  ok(s.players[0].hand.length===6,'「やめる」なら何も変えない');
  await p.click('#viewDeck button[data-act="rebuild"][data-pi="0"]');
  await H.confirmYes(p); await wait(80);
  s=await S();
  ok(s.players[0].hand.length===0 && same(count(s.players[0].deck),SD[1]),'「組み直す」なら盤面を消して不死火翔（緑）で組み直す');
  ok(!await p.$('#viewDeck .dkold'),'組み直したら「前のデッキのまま」の知らせは消える');
  await p.click('#btnUndo2'); await wait(60);
  s=await S();
  ok(s.players[0].hand.length===6,'「戻す」で取り消せる');
  // 空から組む（盤面はそのまま）
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','e:'); await wait(80);
  s=await S();
  ok(Object.keys(s.players[0].decklist).length===0 && s.players[0].hand.length===6,'「空から組む」で登録なしになる（盤面はそのまま）');
  // 盤面が空なら、プルダウンで選ぶとそのまま山札も組み直す
  await p.evaluate(()=>{ runAction('reset',2); render(); });
  await p.selectOption('#viewDeck select.dkpick[data-pi="0"]','s:HB-SD01'); await wait(80);
  s=await S();
  ok(same(count(s.players[0].deck),SD[0])&&!await p.$('#viewDeck .dkold'),'盤面が空なら、プルダウンで選ぶと山札もレオジン（赤）の50枚になる');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  // 検証（tools/validate-cards.mjs の checkStarters）が、壊れたデッキを止めること
  const fs=require('fs'), os=require('os'), path=require('path');
  const V=await import(H.ROOT+'/tools/validate-cards.mjs');
  const cards=require(H.ROOT+'/data/cards.json').cards;
  const tmp=path.join(os.tmpdir(),'starter-'+process.pid+'.json');
  const bad=JSON.parse(JSON.stringify(require(H.ROOT+'/data/starter-decks.json')));
  bad.decks[0].cards[0].count=5;               // 雷合 レオジン 5枚 → 合計52・同名5枚
  bad.decks[1].cards.push({key:'XX-999',count:1});
  fs.writeFileSync(tmp,JSON.stringify(bad));
  const errs=V.checkStarters(cards,tmp); fs.unlinkSync(tmp);
  ok(errs.some(e=>e.includes('合計が 52 枚')) && errs.some(e=>e.includes('5 枚（同名4枚まで）')) && errs.some(e=>e.includes('XX-999')),'検証が「50枚でない・同名5枚・登録されていないカード」を止める');
  ok(V.checkStarters(cards).length===0,'いまの data/starter-decks.json は検証を通る');
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
