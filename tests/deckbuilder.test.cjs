// デッキを作る画面（依頼者の指示 2026-10-16「こういうデッキを作るのが欲しい」）
// 上の「🔍 カード」「📋 デッキ」「🎮 試遊」の切り替え、絞り込み、−／＋、同名4枚・50枚、相手のデッキ、
// カードの詳細、デッキの集計、組み直し、戻す、表示の設定の保存、はみ出しがないこと
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const CARDS=require(H.ROOT+'/data/cards.json').cards;
const SD=require(H.ROOT+'/data/starter-decks.json').decks;
// 期待する件数は、画面の作りとは別に cards.json から数える
const where=fn=>CARDS.filter(fn).map(d=>d.key).sort();
const str=v=>typeof v==='string'?v:'';
const nameText=d=>[d.name,d.name_ruby,d.family].map(str).join(' ');
const fxText=d=>(Array.isArray(d.abilities)?d.abilities.join(' '):'')+' '+(d.trigger&&d.trigger!=='unknown'?str(d.trigger.keyword)+' '+str(d.trigger.text):'');
const trigOf=d=>d.trigger==='unknown'?'unknown':d.trigger.keyword;
const preOf=d=>d.id==='unknown'?'unknown':String(d.id).split('-')[0];
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const vis=sel=>p.evaluate(s=>{ const e=document.querySelector(s); return !!e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden'; },sel);
  const shown=()=>p.evaluate(()=>[...document.querySelectorAll('#cgrid .ctile')].map(e=>e.dataset.key));
  const shownSorted=async()=>(await shown()).slice().sort();
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const noHScroll=()=>p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
  const pick=async(id,v)=>{ await p.selectOption('#'+id,v); await wait(30); };
  const clear=async()=>{ await p.click('#fClear'); await wait(30); };

  // --- 切り替え ---
  ok(await p.evaluate(()=>document.body.className)==='view-play'&&await vis('#viewPlay')&&!await vis('#viewCards'),'はじめは「🎮 試遊」（盤面）が出ている');
  ok(await vis('#btnPhase')&&!await vis('#btnUndo2'),'試遊では盤面の操作の行が出て、デッキ用の「戻す」は隠れる');
  await p.click('.navbtn[data-view="cards"]');
  ok(await vis('#viewCards')&&!await vis('#viewPlay')&&!await vis('#viewDeck'),'「🔍 カード」でカードの一覧に切り替わる');
  ok(await p.evaluate(()=>document.querySelector('.navbtn.on').dataset.view)==='cards','押した切り替えボタンが選択中になる');
  ok(!await vis('#btnPhase')&&!await vis('#flow')&&await vis('#btnUndo2'),'カードの画面では盤面の操作の行が隠れ、「戻す」が出る');
  ok(same(await shownSorted(),CARDS.map(d=>d.key).sort()),'絞り込みなしで全 '+CARDS.length+' 種類が並ぶ');
  ok((await p.textContent('#cres')).includes(CARDS.length+' 種類（全 '+CARDS.length+' 種類）'),'件数が出る');
  ok((await p.textContent('#deckCount'))==='自分 0枚','上に「自分 0枚」と出る');
  ok(await p.evaluate(()=>[...document.querySelectorAll('#viewCards .deckseg button')].map(b=>b.textContent).join())==='自分のデッキ（0枚）,相手のデッキ（0枚）','自分／相手のデッキを選ぶボタンがある');
  // 1行に4枚（iPhone）／画面の幅に応じて（PC）
  const cols=await p.evaluate(()=>{ const t=[...document.querySelectorAll('#cgrid .ctile')]; const top=t[0].getBoundingClientRect().top; return t.filter(e=>Math.abs(e.getBoundingClientRect().top-top)<2).length; });
  ok(touch?cols===4:cols>=4,'1行に並ぶ枚数 '+cols+(touch?'（iPhone は4枚）':'（PC は4枚以上）'));
  ok(await noHScroll(),'カードの画面で横にはみ出さない');

  // --- 絞り込み: 文字 ---
  await p.fill('#fQ','しなずいさま'); await wait(30);
  ok(same(await shownSorted(),['HB01-034','HD02-001']),'名前で絞り込める（しなずいさま → 2種類）');
  ok(await p.evaluate(()=>document.getElementById('fQ').classList.contains('on')),'使っている絞り込みに印が付く');
  await p.fill('#fQ','ライガ'); await wait(30);
  ok(same(await shownSorted(),where(d=>nameText(d).includes('ライガ'))),'種族の文字でも絞り込める（ライガ → '+where(d=>nameText(d).includes('ライガ')).length+'種類）');
  await p.fill('#fQ','zzzz'); await wait(30);
  ok((await shown()).length===0&&(await p.textContent('#cgrid')).includes('条件に合うカードがありません'),'合うものがないときはそう出る');
  await p.fill('#fQ',''); await p.fill('#fFx','ダブルダメージ'); await wait(30);
  const dd=where(d=>fxText(d).includes('ダブルダメージ'));
  ok(dd.length>0&&same(await shownSorted(),dd),'効果テキストで絞り込める（ダブルダメージ → '+dd.length+'種類）');
  await p.fill('#fFx','オーバーT'); await wait(30);
  ok(same(await shownSorted(),where(d=>fxText(d).includes('オーバーT'))),'トリガーの文も効果テキストに含まれる');
  await clear();

  // --- 絞り込み: 選ぶ項目（選択肢は印字から写した値だけ。読めない値は unknown として選べる） ---
  const cases=[
    ['fType','ワザ',d=>d.type==='ワザ'],
    ['fColor','緑',d=>d.color_mark==='緑'],
    ['fColor','青',d=>d.color_mark==='青'],
    ['fCost','2',d=>String(d.cost)==='2'],
    ['fTrig','ドローT',d=>trigOf(d)==='ドローT'],
    ['fTrig','unknown',d=>trigOf(d)==='unknown'],
    ['fPre','PR',d=>preOf(d)==='PR'],
    ['fIll','teo',d=>d.printings.some(x=>x.illustrator==='teo')],
    ['fIll','unknown',d=>d.printings.some(x=>x.illustrator==='unknown')],
    ['fFam','スザク・ブラッド',d=>d.family==='スザク・ブラッド'],
    ['fFam','unknown',d=>d.family==='unknown'],
    ['fRar','SR',d=>d.printings.some(x=>x.rarity_mark==='SR')],
  ];
  for(const [id,v,fn] of cases){
    await pick(id,v);
    const exp=where(fn);
    ok(exp.length>0&&same(await shownSorted(),exp),id+' = '+v+' で '+exp.length+' 種類に絞れる');
    await clear();
  }
  const opts=await p.evaluate(()=>[...document.querySelectorAll('#fTrig option')].map(o=>o.textContent));
  ok(opts[0]==='トリガー'&&opts.includes('トリガー: unknown（読めない）')&&opts.includes('トリガー: エントリーT'),'選択肢に「…: unknown（読めない）」がある '+JSON.stringify(opts));
  const costOpts=await p.evaluate(()=>[...document.querySelectorAll('#fCost option')].slice(1).map(o=>o.value));
  ok(same(costOpts,[...new Set(CARDS.map(d=>String(d.cost)))].sort((a,b)=>a-b)),'コストの選択肢はデータにある値だけ（小さい順） '+costOpts.join(','));
  ok(await p.evaluate(()=>[...document.querySelectorAll('#fFam option')].every(o=>o.value!=='null')),'種族がない（null）カードの値は選択肢に出さない');
  // 組み合わせ
  await pick('fColor','緑'); await pick('fType','ワザ');
  ok(same(await shownSorted(),where(d=>d.color_mark==='緑'&&d.type==='ワザ')),'色と種別を組み合わせられる');
  await p.fill('#fQ','x');
  await clear();
  ok((await shown()).length===CARDS.length&&await p.evaluate(()=>['fQ','fFx','fType','fColor','fCost','fTrig','fPre','fIll','fFam','fRar'].every(id=>!document.getElementById(id).value&&!document.getElementById(id).classList.contains('on'))),'「クリア」ですべての絞り込みが外れる');

  // --- 並び ---
  const byKey=Object.fromEntries(CARDS.map(d=>[d.key,d]));
  const nondec=(arr,f)=>arr.every((k,i)=>i===0||f(byKey[arr[i-1]])<=f(byKey[k]));
  const num=v=>typeof v==='number'?v:Infinity;
  await pick('fSort','cost');
  ok(nondec(await shown(),d=>num(d.cost)),'コスト順に並べ替えられる');
  await pick('fSort','power');
  ok(nondec(await shown(),d=>num(d.power)),'パワー順に並べ替えられる（読めない値は最後）');
  await pick('fSort','no');
  const ids=(await shown()).map(k=>byKey[k].id==='unknown'?'~':byKey[k].id);
  ok(ids.every((v,i)=>i===0||ids[i-1]<=v)&&byKey[(await shown()).slice(-1)[0]].id==='unknown','番号順（番号の読めないカードは最後）');

  // --- −／＋ ---
  await p.click('#cgrid button[data-dk="+"][data-key="HB01-001"]');
  let s=await S();
  ok(s.players[0].decklist['HB01-001']===1,'＋で自分のデッキに1枚入る');
  ok(await p.evaluate(()=>{ const t=document.querySelector('#cgrid .ctile[data-key="HB01-001"]'); return t.classList.contains('in')&&t.querySelector('.ctn').textContent==='1'&&t.querySelector('.dkn').textContent==='1'; }),'入れたカードは枠が金色になり、枚数が出る');
  ok((await p.textContent('#deckCount'))==='自分 1枚','上の枚数が増える');
  ok(await p.evaluate(()=>!document.getElementById('btnUndo2').disabled),'「戻す」が押せるようになる');
  await p.click('#cgrid button[data-dk="-"][data-key="HB01-001"]');
  s=await S();
  ok(!('HB01-001' in s.players[0].decklist),'−で0枚に戻すと登録から消える');
  ok(await p.evaluate(()=>document.querySelector('#cgrid button[data-dk="-"][data-key="HB01-001"]').disabled),'0枚のときは−を押せない');
  await p.click('#cgrid button[data-dk="+"][data-key="HB01-097"]');
  await p.click('#btnUndo2');
  ok(!('HB01-097' in (await S()).players[0].decklist),'「戻す」で直前の＋を取り消せる');
  // 同名4枚（番号が違っても名前で数える）
  await p.fill('#fQ','しなずいさま'); await wait(30);
  for(let i=0;i<4;i++) await p.click('#cgrid button[data-dk="+"][data-key="HB01-034"]');
  ok(await p.evaluate(()=>document.querySelector('#cgrid button[data-dk="+"][data-key="HB01-034"]').disabled&&document.querySelector('#cgrid button[data-dk="+"][data-key="HD02-001"]').disabled),'同名で4枚入れると、同じ番号も別の番号も＋を押せない');
  ok(await p.evaluate(()=>document.querySelectorAll('#cgrid .dkshare').length===2),'同名のカードに「同名」の印が付く');
  await p.evaluate(()=>{ delete state.players[0].decklist['HB01-034']; render(); });
  await clear();
  // 50枚まで
  await p.evaluate(()=>{ loadStarter(0,'HB-SD01'); render(); });
  ok((await p.textContent('#deckCount'))==='自分 50枚','スタートデッキを入れると50枚');
  ok(await p.evaluate(()=>document.querySelectorAll('#cgrid button[data-dk="+"]:not([disabled])').length===0),'50枚になると、どのカードも＋を押せない');
  const before=JSON.stringify((await S()).players[0].decklist);
  ok(await p.evaluate(()=>deckAdjust(0,'HB01-097','+'))===false&&JSON.stringify((await S()).players[0].decklist)===before,'50枚のときは増やす処理も何も変えない');

  // --- 相手のデッキ ---
  await p.click('#viewCards button[data-deckpi="1"]');
  ok((await p.textContent('#deckCount'))==='相手 0枚'&&await p.evaluate(()=>document.querySelector('#viewCards .deckseg button.on').dataset.deckpi)==='1','「相手のデッキ」に切り替えると上の枚数も相手のものになる');
  await p.click('#cgrid button[data-dk="+"][data-key="HD02-010"]').catch(async()=>{ await p.click('#cgrid button[data-dk="+"]'); });
  s=await S();
  ok(Object.values(s.players[1].decklist).reduce((a,b)=>a+b,0)===1&&JSON.stringify(s.players[0].decklist)===before,'相手のデッキにだけ入り、自分のデッキは変わらない');
  await p.evaluate(()=>{ state.players[1].decklist={}; render(); });

  // --- カードの詳細（画像をタップ） ---
  await p.click('#cgrid .ctimg[data-detail="HB01-097"]'); await wait(430);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'画像をタップすると詳細が開く');
  const det=await p.textContent('#sheet');
  ok(det.includes('正義合身 義郎坊')&&det.includes('2つ目のワザ')&&det.includes('ダブルダメージ'),'印字の全文が出る');
  ok(det.includes('相手のデッキに入れる枚数（いま 0 枚）'),'いま組んでいるデッキ（相手）に入れる枚数が出る');
  await p.click('#sheet button[data-dk="+"]'); await wait(80);
  ok((await S()).players[1].decklist['HB01-097']===1,'詳細の＋でも入れられる');
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')&&document.querySelector('#sheet .dkn').textContent==='1'),'詳細は開いたまま、枚数が1になる');
  await p.click('#sheet button[data-dk="+"]');   // 続けてすぐ押しても消えない（開き直して待ちが入ると消えていた）
  ok((await S()).players[1].decklist['HB01-097']===2&&await p.evaluate(()=>document.querySelector('#sheet .dkn').textContent==='2'),'詳細の＋を続けて押すと、押した分だけ入る');
  await p.click('#sheet button[data-dk="-"]'); await p.click('#sheet button[data-dk="-"]'); await wait(80);
  ok(!('HB01-097' in (await S()).players[1].decklist),'詳細の−で減らせる');
  await p.click('#sheet button[data-close="1"]'); await wait(300);

  // --- デッキの画面: 集計・スタートデッキ・組み直し ---
  await p.click('#viewCards button[data-deckpi="0"]');
  await p.click('.navbtn[data-view="deck"]');
  ok(await vis('#viewDeck')&&!await vis('#viewCards'),'「📋 デッキ」でいまのデッキの画面に切り替わる');
  const sum=await p.textContent('#viewDeck .dsum');
  const sd=SD[0], sdKeys=sd.cards.map(c=>c.key);
  const typeN=t=>sd.cards.filter(c=>byKey[c.key].type===t).reduce((a,c)=>a+c.count,0);
  ok(sum.includes('50 枚 ＋ 未確定カード 0 枚 ＝ 50 枚'),'合計と未確定カードの枚数が出る');
  ok(sum.includes('ホロビト '+typeN('ホロビト')+'枚')&&sum.includes('ワザ '+typeN('ワザ')+'枚'),'種別ごとの枚数が出る');
  const costs=[...new Set(sd.cards.map(c=>String(byKey[c.key].cost)))];
  ok(await p.evaluate(()=>document.querySelectorAll('#viewDeck .curve .cv').length)===costs.length,'コスト別の棒が、デッキにあるコストの数だけ出る（'+costs.length+'本）');
  ok(same((await p.evaluate(()=>[...document.querySelectorAll('#viewDeck .ctile')].map(e=>e.dataset.key))).sort(),sdKeys.slice().sort()),'デッキに入っているカードだけが並ぶ');
  ok((await p.textContent('#viewDeck .dknow')).includes('HB-SD01'),'いまのデッキがスタートデッキそのままだと出る');
  ok(await noHScroll(),'デッキの画面で横にはみ出さない');
  // 組み直す（盤面が空なら山札だけ作り直す）
  p.once('dialog',d=>d.accept());
  await p.click('#viewDeck button[data-act="rebuild"][data-pi="0"]'); await wait(80);
  s=await S();
  const m={}; s.players[0].deck.forEach(c=>m[c.key]=(m[c.key]||0)+1);
  ok(s.players[0].deck.length===50&&sd.cards.every(c=>m[c.key]===c.count),'「このデッキで自分の盤面を組み直す」で山札がこのデッキの50枚になる');
  // 空のデッキ
  await p.click('#viewDeck button[data-deckpi="1"]');
  ok((await p.textContent('#viewDeck')).includes('まだカードが入っていません')&&(await p.textContent('#viewDeck .dsum')).includes('0 枚 ＋ 未確定カード 50 枚'),'空のデッキは「まだカードが入っていません」と未確定カード50枚が出る');

  // --- 表示の設定は再読み込みしても残る（盤面の状態とは別） ---
  await p.click('.navbtn[data-view="cards"]');
  await pick('fColor','赤');
  await p.reload(); await wait(150);
  ok(await vis('#viewCards')&&await p.evaluate(()=>document.getElementById('fColor').value)==='赤'&&await p.evaluate(()=>ui.deckPi)===1,'再読み込みしても、開いていた画面・絞り込み・組んでいるデッキが残る');
  ok(same(await shownSorted(),where(d=>d.color_mark==='赤')),'残った絞り込みで一覧が出る');
  await clear();

  // --- 試遊に戻る ---
  await p.click('.navbtn[data-view="play"]');
  ok(await vis('#viewPlay')&&await vis('#btnPhase')&&!await vis('#viewCards'),'「🎮 試遊」で盤面に戻る');
  await H.prep(p);
  s=await S();
  const m2={}; s.players[0].hand.concat(s.players[0].deck,s.players[0].heart,s.players[0].ena).forEach(c=>m2[c.key]=(m2[c.key]||0)+1);
  ok(s.phase===0&&sd.cards.every(c=>m2[c.key]===c.count),'作ったデッキで準備して遊べる');
  ok(await noHScroll(),'試遊でも横にはみ出さない');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:900},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
