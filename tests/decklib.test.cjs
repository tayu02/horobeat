// デッキを保存する・共有する（依頼者の指示 2026-10-22「デッキの保存も共有は欲しい。呼び起こしに画像でデッキリストも見れるように」）
// 保存・一覧（画像つき）・開く（画像のデッキリスト）・自分／相手のデッキにする・デッキコード（書き出し・読み込み・間違いの検出）・名前・削除・再読み込み
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const SD=require(H.ROOT+'/data/starter-decks.json').decks;
const sdCards=sd=>Object.fromEntries(sd.cards.map(c=>[c.key,c.count]));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const same=(a,b)=>JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]))===JSON.stringify(Object.keys(b).sort().map(k=>[k,b[k]]));
  const sheetBtn=async sel=>{ await wait(450); await p.click('#sheet '+sel); await wait(80); };
  const libLen=()=>p.evaluate(()=>{ try { return JSON.parse(localStorage.getItem('horobeat-decks')).decks.length; } catch(e){ return -1; } });
  const sheetText=()=>p.textContent('#sheet');

  await p.evaluate(()=>{ loadStarter(0,'HB-SD01'); render(); });
  await p.click('.navbtn[data-view="deck"]');
  ok((await p.textContent('#viewDeck .libbar')).includes('保存したデッキ（0）'),'デッキの画面に「保存」「保存したデッキ（0）」「コードから読み込む」がある');

  // ---- 保存 → 開くと画像のデッキリスト ----
  await p.click('#viewDeck button[data-lib="save"]'); await wait(80);
  ok(await p.evaluate(()=>document.getElementById('libName').value)==='スタートデッキ レオジン（赤）','名前の初めの値は、スタートデッキならその名前');
  await sheetBtn('button[data-lib="dosave"]');
  ok(await libLen()===1,'保存すると、この端末のブラウザに残る');
  ok((await sheetText()).includes('スタートデッキ レオジン（赤）') && (await sheetText()).includes('50 枚'),'保存したら、そのデッキを開く（名前と枚数）');
  const img=await p.evaluate(()=>{ const t=[...document.querySelectorAll('#sheet .libimgs .ctile')]; return { n:t.length, sum:t.reduce((s,e)=>s+(+e.querySelector('.ctn').textContent),0), imgs:t.filter(e=>e.querySelector('img')).length, buttons:document.querySelectorAll('#sheet .libimgs button').length }; });
  ok(img.n===SD[0].cards.length && img.sum===50,'デッキリストを画像で並べる（'+img.n+' 種類・枚数の札の合計 50）');
  ok(img.buttons===0,'デッキリストは見るだけ（−／＋ はない）');
  ok(await p.evaluate(()=>{ const b=document.querySelector('#sheet button[data-lib="use"]'), g=document.querySelector('#sheet .libimgs'); return b.getBoundingClientRect().top < g.getBoundingClientRect().top; }),'「自分のデッキにする」などのボタンは、デッキリストの画像より上にある');
  // 同じ名前でもう一度 → 上書きを確かめる
  await p.click('#sheet button[data-close="1"]').catch(()=>{}); await p.evaluate(()=>closeSheet());
  await p.click('#viewDeck button[data-lib="save"]'); await wait(80);
  await sheetBtn('button[data-lib="dosave"]');
  ok((await sheetText()).includes('上書きしますか'),'同じ名前があれば、上書きするか確かめる');
  await H.confirmYes(p); await wait(80);
  ok(await libLen()===1,'上書きしても1つのまま');
  // 中身を変えて別の名前で保存
  await p.evaluate(()=>{ closeSheet(); const dl=state.players[0].decklist; dl['HD01-004']=1; delete dl['HD01-001']; render(); });
  await p.click('#viewDeck button[data-lib="save"]'); await wait(80);
  await p.fill('#libName','テスト|赤'); await sheetBtn('button[data-lib="dosave"]');
  ok(await libLen()===2 && await p.evaluate(()=>lib[0].name)==='テスト／赤','別の名前で保存できる（「|」は使えないので「／」に置き換える）');
  ok((await p.textContent('#viewDeck .libbar')).includes('保存したデッキ（2）'),'数が増える');

  // ---- 一覧（各デッキの画像を少し並べる）→ 再読み込みしても残る ----
  await p.reload(); await wait(150);
  await p.click('#viewDeck button[data-lib="list"]'); await wait(450);
  const rows=await p.evaluate(()=>[...document.querySelectorAll('#sheet .librow')].map(r=>({name:r.querySelector('b').textContent, th:r.querySelectorAll('.libth').length})));
  ok(rows.length===2 && rows[0].name==='テスト／赤' && rows.every(r=>r.th===8),'一覧: 再読み込みしても残る。新しいものが上。各デッキの画像を8枚まで並べる '+JSON.stringify(rows));

  // ---- 相手のデッキにする（盤面が空なら山札も組み直す）----
  const sd1Id=await p.evaluate(()=>lib.find(d=>d.name==='スタートデッキ レオジン（赤）').id);
  await p.click(`#sheet button[data-lib="open"][data-id="${sd1Id}"]`); await wait(450);
  await p.click('#sheet button[data-lib="use"][data-pi="1"]'); await wait(100);
  let s=await S();
  const cnt={}; s.players[1].deck.forEach(c=>{ if(c.key) cnt[c.key]=(cnt[c.key]||0)+1; });
  ok(same(s.players[1].decklist,sdCards(SD[0])) && same(cnt,sdCards(SD[0])),'「相手のデッキにする」: 相手のデッキと山札がそのデッキになる');
  ok(await p.evaluate(()=>ui.deckPi)===1 && (await p.textContent('#viewDeck .dknow')).includes('HB-SD01'),'デッキの画面は相手のデッキに切り替わる');
  // 盤面にカードがあるときは、デッキだけ変える
  await p.evaluate(()=>{ runAction('setupAll',2); render(); });
  const handBefore=(await S()).players[0].hand.length;
  await p.click('#viewDeck button[data-lib="list"]'); await wait(450);
  await p.click(`#sheet button[data-lib="open"]`); await wait(450);
  await p.click('#sheet button[data-lib="use"][data-pi="0"]'); await wait(100);
  s=await S();
  ok(s.players[0].hand.length===handBefore && s.players[0].decklist['HD01-004']===1 && (await p.evaluate(()=>fxLines.join(' '))).includes('配るか組み直すと反映'),'盤面にカードがあるときは、デッキだけ変えて盤面は消さない');
  await p.evaluate(()=>{ runAction('reset',2); render(); });

  // ---- デッキコード（書き出し）----
  const tId=await p.evaluate(()=>lib[0].id);
  await p.click('#viewDeck button[data-lib="list"]'); await wait(450);
  await p.click(`#sheet button[data-lib="open"][data-id="${tId}"]`); await wait(450);
  await p.click('#sheet button[data-lib="code"]'); await wait(450);
  const code=await p.evaluate(()=>document.getElementById('libCode').value);
  ok(/^HBD1\|テスト／赤\|[A-Z0-9-]+x\d+(,[A-Z0-9-]+x\d+)*$/.test(code),'デッキコード: 「HBD1|名前|番号x枚数,…」 '+code.slice(0,60)+'…');
  const back=await p.evaluate(c=>parseDeckCode(c),code);
  ok(back.errs.length===0 && same(back.cards,await p.evaluate(()=>lib[0].cards)),'コードを読み直すと同じデッキになる');
  await p.click('#sheet button[data-lib="copy"]'); await wait(300);
  ok((await p.textContent('#libMsg')).length>0,'「コピーする」: コピーしたか、できなければ文字を選んで知らせる（'+(await p.textContent('#libMsg'))+'）');

  // ---- 名前を変える・削除 ----
  await p.click(`#sheet button[data-lib="open"][data-id="${tId}"]`); await wait(450);
  await p.click('#sheet button[data-lib="rename"]'); await wait(450);
  await p.fill('#libName','赤の試し');
  await p.click('#sheet button[data-lib="dorename"]'); await wait(450);
  ok(await p.evaluate(()=>lib[0].name)==='赤の試し' && (await sheetText()).includes('赤の試し'),'名前を変えられる');
  await p.click('#sheet button[data-lib="del"]'); await wait(80);
  ok((await sheetText()).includes('削除しますか'),'削除は確かめる');
  await H.confirmYes(p); await wait(80);
  ok(await libLen()===1 && !(await p.evaluate(()=>lib.some(d=>d.name==='赤の試し'))),'削除すると一覧から消える');
  await p.evaluate(()=>closeSheet());

  // ---- コードから読み込む ----
  const code2='HBD1|緑の試し|'+SD[1].cards.map(c=>c.key+'x'+c.count).join(',');
  await p.click('#viewDeck button[data-lib="import"]'); await wait(450);
  await p.fill('#libCode',code2); await p.click('#sheet button[data-lib="doimport"]'); await wait(450);
  ok((await sheetText()).includes('緑の試し') && await p.evaluate(()=>document.querySelectorAll('#sheet .libimgs .ctile').length)===SD[1].cards.length,'読み込む前に、名前と画像のデッキリストを見せる');
  await p.click('#sheet button[data-lib="usepending"][data-pi="0"]'); await wait(100);
  ok(same((await S()).players[0].decklist,sdCards(SD[1])),'「自分のデッキにする」で読み込める');
  await p.click('#viewDeck button[data-lib="import"]'); await wait(450);
  await p.fill('#libCode',code2); await p.click('#sheet button[data-lib="doimport"]'); await wait(450);
  await p.click('#sheet button[data-lib="savepending"]'); await wait(450);
  ok(await libLen()===2 && await p.evaluate(()=>lib[0].name)==='緑の試し','「保存する」で保存したデッキに加わる');
  await p.evaluate(()=>closeSheet());
  // 間違ったコード
  const bad=async (c,want,msg)=>{ await p.click('#viewDeck button[data-lib="import"]'); await wait(450); await p.fill('#libCode',c); await p.click('#sheet button[data-lib="doimport"]'); await wait(450);
    const t=await sheetText(); ok(t.includes(want) && !(await p.$('#sheet button[data-lib="usepending"]')),msg); await p.evaluate(()=>closeSheet()); };
  await bad('こんにちは','デッキコードの形ではありません','形が違うコードは読み込まない');
  await bad('HBD1|多い|HD02-001x3,HB01-034x2','「しなずいさま」が 5 枚','同名が4枚を超えるコードは読み込まない（番号が違っても名前で数える）');
  await bad('HBD1|多い|HD02-003x4,HD02-004x4,HD02-005x4,HD02-006x4,HD02-007x4,HD02-008x4,HD02-009x4,HD02-010x4,HD02-011x4,HD02-012x4,HD02-013x4,HD02-014x4,HD02-015x4','合計が 52 枚','50枚を超えるコードは読み込まない');
  // カードデータにない番号: 外して読み込めることを知らせる
  await p.click('#viewDeck button[data-lib="import"]'); await wait(450);
  await p.fill('#libCode','HBD1|新弾|HD02-003x2,XX99-001x3'); await p.click('#sheet button[data-lib="doimport"]'); await wait(450);
  ok((await sheetText()).includes('XX99-001 ×3') && await p.$('#sheet button[data-lib="usepending"]'),'カードデータにない番号は、外して読み込めると知らせる（空きは未確定カード）');
  await p.click('#sheet button[data-lib="usepending"][data-pi="1"]'); await wait(100);
  ok(same((await S()).players[1].decklist,{'HD02-003':2}),'カードデータにある分だけ読み込む');

  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'横にはみ出さない');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:900},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
