// ルールどおりに自動で行う操作（依頼者の指示 2026-10-04）
// - 引き直しは準備手順の④で、一度だけ（ティザー④・入門④）
// - エンドフェイズ: 余った（未使用の）エナの数だけエナドローし、使用済みのエナを未使用に戻す（ティザー⑤⑥⑦）
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
  const btn=pi=>p.evaluate(pi=>{ const e=document.querySelector('.setrow button[data-act="redraw"][data-pi="'+pi+'"]'); return {dis:e.disabled, t:e.textContent}; },pi);
  const log=()=>p.evaluate(()=>fxLines.join(' / '));

  // --- 引き直し ---
  await p.evaluate(()=>{ runAction('reset',2); render(); });
  ok((await btn(0)).dis,'手札がないうちは引き直せない');
  await p.evaluate(()=>{ document.querySelectorAll('details.doc').forEach(d=>d.open=true); runAction('setupAll',2); render(); });
  ok(!(await btn(0)).dis,'準備のあとは引き直せる');
  const h0=(await S()).players[0].hand.map(c=>c.uid).join();
  await p.evaluate(()=>{ snap(); runAction('redraw',0); render(); });
  let s=await S();
  ok(s.players[0].hand.length===6 && s.players[0].redrawn===true,'引き直すと手札は6枚');
  ok((await btn(0)).dis && (await btn(0)).t.includes('済み'),'一度引き直すとボタンは押せず「引き直し済み」になる');
  ok(!(await btn(1)).dis,'相手はまだ引き直せる（プレイヤーごと）');
  const h1=(await S()).players[0].hand.map(c=>c.uid).join();
  await p.evaluate(()=>{ runAction('redraw',0); render(); });
  ok((await S()).players[0].hand.map(c=>c.uid).join()===h1 && (await log()).includes('一度だけ'),'二度目は引き直せず、理由が出る');
  await p.click('#btnUndo'); await wait(50);
  ok(!(await S()).players[0].redrawn && !(await btn(0)).dis,'「戻す」で引き直しを取り消すと、また引き直せる');
  await p.click('#btnPhase'); await wait(50);
  ok((await btn(1)).dis,'ラウンドが始まったら（準備が終わったら）引き直せない');
  await p.evaluate(()=>{ runAction('redraw',1); render(); });
  ok((await log()).includes('準備手順'),'理由として「準備手順の④でだけ」が出る');

  // --- エンドフェイズ ---
  await p.evaluate(()=>{
    let n=0; const mk=(k,o,ex)=>Object.assign({uid:'R'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
    const pl=o=>({heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}});
    const me=pl(0), op=pl(1);
    for(let i=0;i<10;i++) me.deck.push(mk(null,0,{up:false}));
    op.deck.push(mk(null,1,{up:false}));
    me.ena.push(mk('HD01-001',0,{turned:true}), mk('HD01-001',0,{turned:true}), mk('HD01-001',0), mk('HD01-001',0));
    op.ena.push(mk('HD02-001',1), mk('HD02-001',1), mk('HD02-001',1));
    state={round:1,phase:1,first:0,fxAuto:true,players:[me,op]}; undoStack=[]; fxClear(); render();
  });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(await p.textContent('#phaseLbl')==='エンドフェイズ','エンドフェイズに入る');
  ok(s.players[0].hand.length===2 && s.players[0].deck.length===8,'自分: 未使用のエナ2枚 → 2枚エナドロー（図の例と同じ: 4枚中 使用済み2）');
  ok(s.players[0].ena.every(c=>!c.turned),'自分: 使用済みのエナが未使用（縦向き）に戻る');
  ok(s.players[1].hand.length===1 && (await log()).includes('山札が足りない'),'相手: 未使用3枚でも山札が1枚なら1枚だけ引き、足りないことを知らせる（尽きたときの扱いは未確定）');
  ok((await log()).includes('使用済みのエナ 2 枚を未使用に戻した'),'記録に戻した枚数が出る');
  await p.click('#btnUndo'); await wait(50);
  s=await S();
  ok(s.phase===1 && s.players[0].hand.length===0 && s.players[0].ena.filter(c=>c.turned).length===2,'「戻す」でフェイズ送りごと取り消せる');
  // エンドフェイズ以外では何もしない
  await p.evaluate(()=>{ state.phase=0; render(); });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.phase===1 && s.players[0].hand.length===0,'バトルフェイズに入るときはエナドローしない');

  // --- 手引書（2026-10-09）: ドローステップ・スライドステップ・ワザゾーンの片付け ---
  await p.evaluate(()=>{
    let n=0; const mk=(k,o,ex)=>Object.assign({uid:'D'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
    const pl=o=>({heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}});
    const me=pl(0), op=pl(1);
    for(let i=0;i<5;i++) me.deck.push(mk(null,0,{up:false}));
    me.line[1].push(mk('HB01-001',0)); me.line[3].push(mk('HD01-001',0), mk('HB01-033',0));
    me.waza.push(mk('PR-013',0,{turned:true}));
    state={round:1,phase:1,first:0,fxAuto:true,players:[me,op]}; undoStack=[]; fxClear(); render();
  });
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].line[0][0].key==='HB01-001' && s.players[0].line[1].length===2 && s.players[0].line[1][1].key==='HB01-033' && !s.players[0].line[2].length,
    'スライドステップ: 第2・第4ラインのホロビト（束ごと）が第1・第2ラインに詰まる');
  ok(s.players[0].waza.length===0 && s.players[0].grave.some(c=>c.key==='PR-013'),'エンドフェイズまでに、ワザゾーンの使ったカードは墓地へ（バトルが終わったとき墓地。手引書）');
  ok((await log()).includes('スライドステップ'),'記録にスライドステップが出る');
  const d0=s.players[0].deck.length, hd0=s.players[0].hand.length;
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.round===2 && s.phase===0 && s.players[0].hand.length===hd0+1 && s.players[0].deck.length===d0-1,'新しいラウンドの召喚フェイズに入ると、ドローステップで1枚引く');
  ok((await log()).includes('相手：ドローステップで山札が0枚のため引けない') && (await log()).includes('勝利条件②'),'山札が0枚の相手は引けず、負けになることを知らせる（勝利条件②）');
  // 最初のラウンドはお互いドローなし
  await p.evaluate(()=>{ runAction('reset',2); runAction('setupAll',2); render(); });
  const hr1=(await S()).players[0].hand.length;
  await p.click('#btnPhase'); await wait(50);
  s=await S();
  ok(s.round===1 && s.phase===0 && s.players[0].hand.length===hr1,'最初のラウンド（準備のあとの召喚フェイズ）はドローしない');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
