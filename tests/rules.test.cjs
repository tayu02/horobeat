// ルールどおりに自動で行う進行（依頼者の指示 2026-10-04・2026-10-12）
// - 準備: 先手を選んで配る（①②③）→ 両者が引き直すか決める（④。一度だけ）→ ⑤⑥ → 自動で召喚フェイズ（先手）へ
// - ラウンド: 召喚フェイズ（先手）→ 召喚フェイズ（後手）→ バトルフェイズ → エンドフェイズ（手引書 ラウンドの進行）
// - ドローステップ: 自分の召喚フェイズの初めに1枚。最初のラウンドはお互いドローなし。引けなければ負け（勝利条件②）
// - エンドフェイズ: スライド → エナドロー（未使用のエナの数）→ エナリフレッシュ
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  const flow=()=>p.textContent('#flow');
  const phase=()=>p.textContent('#phaseLbl');
  const closeSheet=()=>p.evaluate(()=>{ fxAsk=null; picking=null; closeSheet(); render(); });

  // ---- 準備 ----
  await p.evaluate(()=>{ runAction('reset',2); render(); });
  ok(await phase()==='準備' && (await flow()).includes('先手を決めて配る') && !(await p.$('#flow button[data-prep="mull"]')),'準備: はじめは先手を選ぶボタンだけが出る（引き直しのボタンはまだない）');
  ok(await p.evaluate(()=>document.getElementById('btnPhase').disabled),'準備中は「フェイズ送り」を押せない（準備は自動で終わる）');
  await p.click('#flow button[data-prep="deal"][data-first="1"]');
  let s=await S();
  ok(s.first===1 && s.players.every(P=>P.hand.length===6 && P.deck.length===44 && !P.heart.length && !P.ena.length),'相手を先手にして配る: 両者6枚（ハート・エナはまだ）');
  ok((await p.$$('#flow button[data-prep="mull"]')).length===4,'両者に「引き直す」「このまま」が出る');
  ok(await p.evaluate(()=>document.querySelector('#side-1 .sidehead .badge').textContent)==='先手','相手の側に「先手」と出る');
  const h0=s.players[0].hand.map(c=>c.uid).join();
  await p.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="1"]');
  s=await S();
  ok(s.players[0].hand.length===6 && s.players[0].redrawn===true && s.players[0].mull==='redraw','自分は引き直す → 手札は6枚');
  ok(!(await p.$('#flow button[data-prep="mull"][data-pi="0"]')) && (await flow()).includes('引き直した'),'決めた側のボタンは消え、「引き直した」と出る');
  ok(s.phase===-1,'片方だけ決めても、まだ準備のまま');
  await p.evaluate(()=>{ runAction('redraw',0); render(); });
  ok((await log()).includes('一度だけ'),'二度目は引き直せず、理由が出る');
  await p.click('#btnUndo'); await wait(50);
  ok(!(await S()).players[0].mull && !!(await p.$('#flow button[data-prep="mull"][data-pi="0"]')),'「戻す」で取り消すと、また選べる');
  await p.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="0"]');
  await p.click('#flow button[data-prep="mull"][data-pi="1"][data-redraw="0"]');
  s=await S();
  ok(s.phase===0 && s.round===1 && await phase()==='召喚フェイズ（先手）','両者が決めたら、自動で召喚フェイズ（先手）に進む');
  ok(s.players.every(P=>P.heart.length===5 && P.heart.every(c=>!c.up) && P.ena.length===1 && P.ena.every(c=>c.up && !c.turned)),'⑤ハート5枚（裏向き）⑥エナ1枚（表向き・縦向き）を自動で置く');
  ok(s.players.every(P=>P.hand.length===6) && (await log()).includes('ドローなし'),'最初のラウンドはドローしない');
  ok((await flow()).includes('相手の番') && await p.evaluate(()=>!!document.querySelector('#side-1 .badge.turn') && !document.querySelector('#side-0 .badge.turn')),'先手（相手）の番と出る');
  ok(await p.evaluate(()=>document.querySelectorAll('#side-0 .zone.locked').length>0 && !document.querySelector('#side-1 .zone.locked')),'番でない側（自分）は暗くなる（操作できない）');
  await p.evaluate(()=>{ runAction('redraw',1); render(); });
  ok((await log()).includes('準備手順'),'準備が終わったら引き直せない');

  // ---- フェイズの順 ----
  const ph=[];
  // バトルの途中で送るときは画面の中で確かめる（「エンドフェイズへ進む」を押す）
  for(let i=0;i<4;i++){ await p.click('#btnPhase'); await wait(60); if(await p.$('#sheet button[data-cfm]')) await H.confirmYes(p); await wait(60); await closeSheet(); ph.push(await phase()); }
  ok(ph.join()==='召喚フェイズ（後手）,バトルフェイズ,エンドフェイズ,召喚フェイズ（先手）' && (await S()).round===2,'フェイズ: 召喚（先手）→召喚（後手）→バトル→エンド→次のラウンドの召喚（先手） '+ph.join());

  // ---- ドローステップ: 自分の召喚フェイズの初めに1枚（2ラウンド目から） ----
  await p.evaluate(()=>{
    let n=0; const mk=(k,o,ex)=>Object.assign({uid:'D'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
    const pl=()=>({heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}});
    const me=pl(), op=pl();
    for(let i=0;i<5;i++){ me.deck.push(mk(null,0,{up:false})); op.deck.push(mk(null,1,{up:false})); }
    state={v:3,round:1,phase:3,first:0,fxAuto:true,players:[me,op]}; undoStack=[]; fxClear(); render();
  });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.round===2 && s.phase===0 && s.players[0].hand.length===1 && s.players[1].hand.length===0,'2ラウンド目の召喚フェイズ（先手）: 先手だけが1枚引く（後手はまだ）');
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.phase===1 && s.players[1].hand.length===1 && s.players[0].hand.length===1,'召喚フェイズ（後手）に入ると、後手が1枚引く');
  // 山札が0枚で引けなければ負け（勝利条件②）
  await p.evaluate(()=>{ state.phase=3; state.players[0].deck=[]; render(); });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.winner===1 && (await flow()).includes('相手の勝利') && (await flow()).includes('勝利条件②'),'山札が0枚の先手はドローステップで引けず、相手の勝利（勝利条件②）');
  ok(await p.evaluate(()=>document.getElementById('btnPhase').disabled),'勝敗が決まったら「フェイズ送り」は押せない');
  await p.click('#btnUndo'); await wait(50);
  ok((await S()).winner===undefined && (await S()).phase===3,'「戻す」で勝敗の前に戻れる');

  // ---- 次の先手: 第1ラインのバトルの結果で決まり、次のラウンドの初めに入れ替わる ----
  await p.evaluate(()=>{ state.phase=3; state.first=0; state.nextFirst=1; render(); });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.first===1 && s.nextFirst===undefined && (await log()).includes('先手が入れ替わり'),'バトルで決まった次の先手（相手）が、次のラウンドの先手になる');
  ok(s.players[1].hand.length===2 && s.players[0].hand.length===1,'新しい先手（相手）が先にドローする');

  // ---- エンドフェイズ ----
  await p.evaluate(()=>{
    let n=0; const mk=(k,o,ex)=>Object.assign({uid:'R'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
    const pl=()=>({heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}});
    const me=pl(), op=pl();
    for(let i=0;i<10;i++) me.deck.push(mk(null,0,{up:false}));
    op.deck.push(mk(null,1,{up:false}));
    me.ena.push(mk('HD01-001',0,{turned:true}), mk('HD01-001',0,{turned:true}), mk('HD01-001',0), mk('HD01-001',0));
    op.ena.push(mk('HD02-001',1), mk('HD02-001',1), mk('HD02-001',1));
    state={v:3,round:1,phase:2,first:0,fxAuto:true,players:[me,op]}; undoStack=[]; fxClear(); render();
  });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(await phase()==='エンドフェイズ','エンドフェイズに入る');
  ok(s.players[0].hand.length===2 && s.players[0].deck.length===8,'自分: 未使用のエナ2枚 → 2枚エナドロー（図の例と同じ: 4枚中 使用済み2）');
  ok(s.players[0].ena.every(c=>!c.turned),'自分: 使用済みのエナが未使用（縦向き）に戻る');
  ok(s.players[1].hand.length===1 && (await log()).includes('山札が足りない'),'相手: 未使用3枚でも山札が1枚なら1枚だけ引き、足りないことを知らせる（尽きたときの扱いは未確定）');
  ok((await log()).includes('使用済みのエナ 2 枚を未使用に戻した'),'記録に戻した枚数が出る');
  await p.click('#btnUndo'); await wait(50);
  s=await S();
  ok(s.phase===2 && s.players[0].hand.length===0 && s.players[0].ena.filter(c=>c.turned).length===2,'「戻す」でフェイズ送りごと取り消せる');
  // エンドフェイズ以外では何もしない
  await p.evaluate(()=>{ state.phase=1; render(); });
  await p.click('#btnPhase'); await wait(50); await closeSheet();
  s=await S();
  ok(s.phase===2 && s.players[0].hand.length===0,'バトルフェイズに入るときはエナドローしない');

  // ---- スライドステップ・ワザゾーンの残り ----
  await p.evaluate(()=>{
    let n=0; const mk=(k,o,ex)=>Object.assign({uid:'D'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
    const pl=()=>({heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}});
    const me=pl(), op=pl();
    for(let i=0;i<5;i++) me.deck.push(mk(null,0,{up:false}));
    me.line[1].push(mk('HB01-001',0)); me.line[3].push(mk('HD01-001',0), mk('HB01-033',0));
    me.waza.push(mk('PR-013',0,{turned:true}));
    state={v:3,round:1,phase:2,first:0,fxAuto:true,players:[me,op]}; undoStack=[]; fxClear(); render();
  });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].line[0][0].key==='HB01-001' && s.players[0].line[1].length===2 && s.players[0].line[1][1].key==='HB01-033' && !s.players[0].line[2].length,
    'スライドステップ: 第2・第4ラインのホロビト（束ごと）が第1・第2ラインに詰まる');
  ok(s.players[0].waza.length===0 && s.players[0].grave.some(c=>c.key==='PR-013'),'ワザゾーンに残っていたカードは墓地へ（バトルが終わったとき墓地。手引書）');
  ok((await log()).includes('スライドステップ'),'記録にスライドステップが出る');

  // ---- 以前の保存（フェイズが3つ）を読み込むと、フェイズの番号を合わせる ----
  await p.evaluate(()=>{ const s=JSON.parse(JSON.stringify(state)); delete s.v; s.phase=1; localStorage.setItem(STORE_KEY, JSON.stringify(s)); });
  await p.reload(); await wait(100);
  ok(await phase()==='バトルフェイズ' && (await S()).v===3,'以前の保存の「バトルフェイズ」（番号1）は、バトルフェイズ（番号2）として読み込む');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
