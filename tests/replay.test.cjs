// 対戦の記録を見返す（依頼者の指示 2026-10-22。2「対戦の記録を見返す」）
// 配った直後から操作ごとに記録 → 見返す（最初・戻る・進む・最後・つまみ・矢印キー）→ 触れない・保存を書き換えない・AI が動かない →
// 閉じるといまの盤面 → 「戻す」で記録からも消える → 再読み込みしても残る → 次のゲームを配ると「1つ前のゲーム」になる
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>JSON.stringify(state));
  const R=()=>p.evaluate(()=>replay?{i:replay.i,n:replay.steps.length}:null);
  const openRec=async which=>{ await p.click('#btnRec'); await wait(450); await p.click(`#sheet button[data-recopen="${which||'cur'}"]`); await wait(100); };

  await p.evaluate(()=>{ loadStarter(0,'HB-SD01'); loadStarter(1,'HB-SD02'); render(); });
  await p.click('#btnRec'); await wait(450);
  ok((await p.textContent('#sheet')).includes('まだ記録がありません'),'配る前は「まだ記録がありません」');
  await p.click('#sheet button[data-close="1"]'); await wait(300);

  // ---- 配って、何手か進める ----
  await H.prep(p, 0);
  await p.evaluate(()=>{ enaCharge(state.players[0].hand[0].uid,0); });
  await p.click('#btnPhase'); await wait(80);
  await p.evaluate(()=>{ enaCharge(state.players[1].hand[0].uid,1); });
  const live=await S();
  const n0=await p.evaluate(()=>rec.d.length);
  ok(n0>=4,'配った直後から、操作ごとに記録している（'+n0+' 手）');

  // ---- 見返す ----
  await openRec('cur');
  let r=await R();
  ok(r && r.i===r.n-1 && (await S())===live,'開くと最後（いまの盤面）を見せる（'+r.n+' 手）');
  ok(await p.evaluate(()=>document.getElementById('replaybar').classList.contains('on') && document.body.classList.contains('replaying')),'下に記録の操作の欄が出る');
  ok((await p.textContent('#flow')).includes('記録を見ています') && await p.evaluate(()=>document.getElementById('btnPhase').disabled && document.getElementById('btnUndo').disabled),'見ている間は「フェイズ送り」「戻す」を押せない');
  await p.click('#replaybar button[data-rb="first"]'); await wait(60);
  let st=JSON.parse(await S());
  ok(st.phase===-1 && st.prep==='mull' && st.players.every(P=>P.hand.length===6) && (await R()).i===0,'⏮: 配った直後の盤面（準備④・手札6枚ずつ）');
  ok((await p.textContent('#replaybar .rblog')).includes('準備：先手は自分'),'その時点で何が起きたかを出す（配った直後は「準備：先手は自分…」）');
  await p.click('#replaybar button[data-rb="next"]'); await wait(60);
  ok((await R()).i===1,'▶: 1つ進む');
  await p.click('#replaybar button[data-rb="prev"]'); await wait(60);
  ok((await R()).i===0,'◀: 1つ戻る');
  await p.click('#replaybar button[data-rb="last"]'); await wait(60);
  ok((await R()).i===(await R()).n-1 && (await S())===live,'⏭: 最後（いまの盤面）');
  await p.evaluate(()=>{ const e=document.getElementById('rbrange'); e.value='1'; e.dispatchEvent(new Event('input',{bubbles:true})); }); await wait(60);
  ok((await R()).i===1,'つまみを動かすと、その手に移る');
  if(!touch){ await p.keyboard.press('ArrowRight'); await wait(60); ok((await R()).i===2,'PC は → キーで進む（← で戻る）'); }
  // 触れない・保存を書き換えない
  const saved=await p.evaluate(()=>localStorage.getItem('horobeat-sim-v2'));
  const box=await p.evaluate(()=>{ const e=document.querySelector('#side-0 .z-hand .card'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; });
  await p.mouse.click(box.x,box.y); await wait(450);
  ok(!(await p.evaluate(()=>sheetWrap.classList.contains('on'))),'見ている間は、盤面のカードをタップしてもメニューは出ない');
  await p.click('#replaybar button[data-rb="first"]'); await wait(60);
  ok(await p.evaluate(()=>localStorage.getItem('horobeat-sim-v2'))===saved,'見ている間は、いまの盤面の保存を書き換えない');
  // 閉じる
  await p.click('#replaybar button[data-rb="close"]'); await wait(60);
  ok(!(await R()) && (await S())===live && !(await p.evaluate(()=>document.body.classList.contains('replaying'))),'閉じると、いまの盤面に戻る');

  // ---- 「戻す」で記録からも消える ----
  await p.click('#btnUndo'); await wait(60);
  ok(await p.evaluate(()=>rec.d.length)===n0-1,'「戻す」で取り消した操作は、記録からも消える');
  await openRec('cur');
  r=await R();
  ok((await S())===await p.evaluate(()=>JSON.stringify(replay.live)),'見返したときの最後は、戻したあとのいまの盤面');
  await p.click('#replaybar button[data-rb="close"]'); await wait(60);

  // ---- 再読み込みしても残る ----
  const n1=await p.evaluate(()=>rec.d.length);
  await p.reload(); await wait(150);
  ok(await p.evaluate(()=>rec && rec.d.length)===n1,'再読み込みしても記録は残る（この端末のブラウザ）');
  await openRec('cur'); r=await R();
  ok(r && r.n>=3,'再読み込みのあとも見返せる');
  // 見ている間に別の画面へ行くと、閉じてから切り替わる
  await p.click('.navbtn[data-view="deck"]'); await wait(60);
  ok(!(await R()) && await p.evaluate(()=>ui.view)==='deck','見ている間に「📋 デッキ」へ行くと、記録を閉じてから切り替わる');
  await p.click('.navbtn[data-view="play"]'); await wait(60);

  // ---- 次のゲームを配ると「1つ前のゲーム」になる ----
  await p.evaluate(()=>{ runAction('reset',2); render(); });
  await H.prep(p, 1);
  await p.click('#btnRec'); await wait(450);
  const rows=await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-recopen]')].map(b=>b.dataset.recopen));
  ok(rows.join()==='cur,prev','次のゲームを配ると、前のゲームは「1つ前のゲーム」として残る');
  await p.click('#sheet button[data-recopen="prev"]'); await wait(100);
  r=await R();
  ok(r && r.n>=3 && await p.evaluate(()=>replay.which)==='prev','1つ前のゲームも見返せる（'+r.n+' 手。同じ盤面が続くところは1つにまとめる）');
  await p.click('#replaybar button[data-rb="close"]'); await wait(60);

  // ---- 見ている間は AI が動かない ----
  await openRec('cur');
  await p.evaluate(()=>{ AI_DELAY=40; ui.ai='normal'; saveUI(); render(); });   // 見ている間に AI にする（いまは AI＝相手の召喚フェイズ）
  await wait(600);
  ok(await p.evaluate(()=>replay.live.phase===0 && replay.live.players[1].enaCharged!==true && !state.players[1].enaCharged),'見ている間は、AI の番でも AI は動かない');
  await p.click('#replaybar button[data-rb="close"]');
  ok(await (async()=>{ for(let i=0;i<100;i++){ if(await p.evaluate(()=>state.phase===1)) return true; await wait(50); } return false; })(),'閉じると AI が続きを行う');
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'横にはみ出さない');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:900},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
