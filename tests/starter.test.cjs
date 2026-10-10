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
  // はじめかたのボタン（盤面が空なので確かめずに読み込む）
  await p.click('#guideStarters button[data-starter="HB-SD01"][data-pi="0"]'); await wait(80);
  await p.click('#guideStarters button[data-starter="HB-SD02"][data-pi="1"]'); await wait(80);
  let s=await S();
  ok(s.players[0].deck.length===50 && same(count(s.players[0].deck),SD[0]),'自分の山札がレオジン（赤）の50枚になる（未確定カードなし）');
  ok(s.players[1].deck.length===50 && same(count(s.players[1].deck),SD[1]),'相手の山札が不死火翔（緑）の50枚になる');
  ok(await p.evaluate(()=>document.querySelector('#guideStarters button.on[data-pi="0"]').dataset.starter)==='HB-SD01','選んだスタートデッキのボタンが選択中になる');
  // デッキ編集のタブ
  await p.evaluate(()=>{ document.getElementById('deckPanel').open=true; });
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('#deckcols .deckcol:first-child .dktabs button')].map(b=>b.textContent));
  ok(tabs.join()==='レオジン（赤）,不死火翔（緑）,空から組む','デッキ編集にタブ「レオジン（赤）／不死火翔（緑）／空から組む」 '+JSON.stringify(tabs));
  ok((await p.evaluate(()=>document.querySelector('#deckcols .dknow').textContent)).includes('HB-SD01'),'「いまのデッキ: スタートデッキ レオジン（赤）（HB-SD01）そのまま」と出る');
  // ＋で変えると「自分で組んだデッキ」になる
  await p.evaluate(()=>{ const dl=state.players[0].decklist; dl['HD01-016']=2; render(); });
  ok((await p.evaluate(()=>document.querySelector('#deckcols .dknow').textContent)).includes('自分で組んだ'),'枚数を変えると「自分で組んだデッキ」になる');
  // 盤面にカードがあるときは確かめる（いいえ → 変えない）
  await p.evaluate(()=>{ runAction('setupAll',2); render(); });
  let asked=''; p.once('dialog',d=>{ asked=d.message(); d.dismiss(); });
  await p.click('#deckcols .deckcol:first-child button[data-starter="HB-SD02"]'); await wait(80);
  s=await S();
  ok(asked.includes('盤面を消して') && s.players[0].hand.length===6,'盤面にカードがあるときは確かめ、「いいえ」なら何も変えない');
  p.once('dialog',d=>d.accept());
  await p.click('#deckcols .deckcol:first-child button[data-starter="HB-SD02"]'); await wait(80);
  s=await S();
  ok(s.players[0].hand.length===0 && same(count(s.players[0].deck),SD[1]),'「はい」なら盤面を消して不死火翔（緑）で組み直す');
  await p.click('#btnUndo'); await wait(60);
  s=await S();
  ok(s.players[0].hand.length===6,'「戻す」で取り消せる');
  // 空から組む
  p.once('dialog',d=>d.accept());
  await p.click('#deckcols .deckcol:first-child button[data-starter=""]'); await wait(80);
  s=await S();
  ok(Object.keys(s.players[0].decklist).length===0 && s.players[0].deck.every(c=>c.key===null),'「空から組む」で登録なし（すべて未確定カード）になる');
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
