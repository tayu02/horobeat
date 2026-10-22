// 相手を AI にする（依頼者の指示 2026-10-22「AIが対戦相手にしてくれるように」。シミュレーター内蔵のAI）
// AI が決めるのは、プレイヤーが選ぶことだけ（引き直す・エナチャージ・どのホロビトをどこへ・ワザ／ブースト・トリガー・効果で選ぶカード）。
// ルールが未確定でシミュレーターが聞くことは、AI の番でも人に聞く。
// 強さは2つ（2026-10-22「3です」= トークンを使わずに強くする）: 「かんたん」（その場でいちばん伸びる出し方）と「ふつう」（バトルの結果を見通す）。
// 2〜8 は「かんたん」の考え方を、11 は「ふつう」の考え方（引き分け狙い・ワザの配分・負けラインへの重ね・トドメ）を確かめる。
// 強さの比較は tools/ai-bench.cjs（AI どうしの対戦の勝率）、重みの探索は tools/ai-tune.cjs
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch, full){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  const q=()=>p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  const sheetOpen=()=>p.evaluate(()=>sheetWrap.classList.contains('on'));
  const top=(s,pi,li)=>{ const st=s.players[pi].line[li]; return st[st.length-1]; };
  // 条件がそろうまで待つ（AI は少し待ってから動くため）
  const until=async(fn,ms,arg)=>{ const t0=Date.now(); while(Date.now()-t0<(ms||5000)){ if(await p.evaluate(fn,arg)) return true; await wait(30); } return false; };
  const aiIdle=()=>until(()=>!aiBusy&&!aiTimer,5000);
  // バトルの結果の画面（「続ける」）は人が押して進める
  const settle=async()=>{ for(let i=0;i<12;i++){ await aiIdle(); await wait(60); if(!(await p.$('#sheet [data-kind="result"]'))) return; await wait(450); await p.click('#sheet [data-kind="result"] button[data-fxa="0"]'); await wait(120); } };
  // 盤面を組む（ここだけスクリプト）。heart は数（裏向きの未確定カード）か、カードの配列
  const setup=async(me,opp,ex)=>{
    await p.evaluate(([me,opp,ex])=>{
      let n=0; const mk=(k,o,e)=>Object.assign({uid:'I'+(n++),owner:o,key:k,up:true,turned:false,note:''},e||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<(spec.deckN===undefined?10:spec.deckN);i++) pl.deck.push(mk(null,o,{up:false}));
        const hs=spec.heart===undefined?5:spec.heart;
        if(typeof hs==='number') for(let i=0;i<hs;i++) pl.heart.push(mk(null,o,{up:false}));
        else hs.forEach(k=>pl.heart.push(typeof k==='string'?mk(k,o,{up:false}):mk(k.k,o,Object.assign({up:false},k))));
        for(const z of ['hand','ena','grave','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        Object.assign(pl, spec.flags||{});
        return pl; };
      aiEpoch++; if(aiTimer){ clearTimeout(aiTimer); aiTimer=null; } aiBusy=false; aiPaused=false; aiMemo={};
      state=Object.assign({v:3,round:1,phase:1,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]},ex||{});
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet();
      document.querySelectorAll('details.doc').forEach(d=>d.open=false); render();
    },[me,opp,ex||{}]);
  };
  const delay=ms=>p.evaluate(ms=>{ AI_DELAY=ms; },ms);
  // 上部の「相手: …」から選ぶ（シートが開いて 0.4 秒は押しても効かない）
  const pickAi=async lv=>{ await p.click('#btnAi'); await wait(450); await p.click(`#sheet button[data-ailv="${lv}"]`); await wait(80); };

  // ---- 1. 切り替え ----
  ok((await p.textContent('#btnAi'))==='相手: 人' && !(await p.evaluate(()=>ui.ai)),'はじめは「相手: 人」（AI は動かない）');
  await p.click('#btnAi'); await wait(450);
  ok(await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-ailv]')].map(b=>b.dataset.ailv).join())===',normal,easy','押すと、相手を「人／AI ふつう／AI かんたん」から選ぶシートが開く');
  ok((await p.textContent('#sheet')).includes('AI の番でもあなたに聞きます'),'シートに、ルールが未確定のことは AI の番でも人に聞くと書いてある');
  await p.click('#sheet button[data-ailv="normal"]'); await wait(80);
  ok((await p.textContent('#btnAi'))==='相手: AI ふつう' && await p.evaluate(()=>ui.ai==='normal'),'「AI ふつう」を選ぶと「相手: AI ふつう」になる');
  ok((await log()).includes('AI の番でもあなたに聞きます'),'記録にも、ルールが未確定のことは AI の番でも人に聞く、と出る');
  await p.reload(); await wait(150);
  ok((await p.textContent('#btnAi'))==='相手: AI ふつう','再読み込みしても AI のまま（この端末の設定）');
  // 以前の保存（相手を AI にするかどうかだけ）は「ふつう」として読む
  await p.evaluate(()=>{ localStorage.setItem('horobeat-sim-ui', JSON.stringify({view:'play',deckPi:0,f:{},ai:true})); });
  await p.reload(); await wait(150);
  ok((await p.textContent('#btnAi'))==='相手: AI ふつう','以前の保存（ai: true）は「AI ふつう」として読む');
  await pickAi('easy');
  ok((await p.textContent('#btnAi'))==='相手: AI かんたん' && await p.evaluate(()=>ui.ai==='easy'),'「AI かんたん」も選べる（2〜8 は「かんたん」で確かめる）');
  await delay(40);

  // ---- 2. 準備④: 引き直すか ----
  await setup({hand:['HD01-004']},{hand:['HD02-004','HD02-007','HD02-008','HD02-011','HD02-014','HB01-061']},{phase:-1,prep:'mull'});
  ok(await until(()=>!!state.players[1].mull),'準備④: AI は自分で引き直すかを決める');
  let s=await S();
  ok(s.players[1].mull==='redraw' && (await log()).includes('コスト2以下のホロビトがないので、引き直す'),'コスト2以下のホロビトが手札になければ引き直す');
  ok(!s.players[0].mull && await p.$('#flow button[data-prep="mull"][data-pi="0"]'),'自分（人）の分は自分で選ぶ（ボタンが残る）');
  await setup({hand:['HD01-004']},{hand:['HD02-003','HB01-061']},{phase:-1,prep:'mull'});
  ok(await until(()=>!!state.players[1].mull) && (await S()).players[1].mull==='keep','コスト2以下のホロビトがあれば引き直さない');

  // ---- 3. 召喚フェイズ（AI が先手）: エナチャージ → 出す → フェイズ送り ----
  await delay(300);
  await setup({},{hand:['HD02-003','HD02-004','HB01-061'], ena:['HD02-001']},{phase:0,first:1});
  ok((await p.textContent('#flow')).includes('（AI）の召喚フェイズ') && (await p.textContent('#flow')).includes('考えています'),'AI の番は「相手（AI）の召喚フェイズ：考えています…」と出る');
  ok(await p.evaluate(()=>document.getElementById('btnPhase').disabled),'AI の番は「フェイズ送り」を押せない');
  ok(await until(()=>state.phase===1,6000),'AI は自分の召喚フェイズを終えると、自分でフェイズを送る');
  s=await S();
  ok(s.players[1].ena.some(c=>c.key==='HB01-061') && s.players[1].enaCharged,'エナチャージ: しばらく出せない高いカード（コスト10）をエナにする');
  ok(top(s,1,0)&&top(s,1,0).key==='HD02-003' && s.players[1].ena.filter(c=>c.turned).length===2,'出せるホロビト（つくものジャンボ・コスト2）を第1ラインに出し、エナ2枚を使用済みにする');
  ok(s.players[1].hand.length===1 && s.players[1].hand[0].key==='HD02-004','エナが足りないカード（コスト3）は出さない');
  const L=await log();
  ok(L.includes('（AI）：エナチャージ') && L.includes('（AI）：「つくものジャンボ」を第1ラインに出す') && L.includes('召喚フェイズを終える'),'AI が何をしたかが記録に残る（フェイズを送っても消えない）');
  ok(await p.evaluate(()=>!document.getElementById('btnPhase').disabled) && (await p.textContent('#flow')).includes('自分の番'),'自分（人）の番になると「フェイズ送り」を押せる');
  await delay(40);

  // ---- 4. オーバービート: どのラインにも重ねられる。ダウンしているホロビトを選ぶ（よくある質問・入門⑫）----
  await setup({},{hand:['HD02-004'], ena:['HD02-001','HD02-001','HD02-001'], line:[['HD02-003'],['HD02-001'],[{k:'HD02-009',turned:true}],['HD02-002'],['HD02-003']], flags:{enaCharged:true}},{phase:0,first:1});
  ok(await until(()=>state.phase===1,6000),'AI が召喚フェイズを終える');
  s=await S();
  ok(s.players[1].line[2].length===2 && top(s,1,2).key==='HD02-004' && !s.players[1].line[2][0].turned,'ラインが埋まっていれば、ダウンしているホロビト（第3ライン）の上にオーバービートし、ダウンが解ける');
  ok((await log()).includes('第3ラインに「すやすやジャンボ」の上にオーバービートで出す'),'記録: どのラインのどのホロビトに重ねたか');

  // ---- 5. バトル: ワザ・ブースト（AI が先手なので先に使う）----
  // 4000 対 4000: 上回れるもののうち、いちばん安いもの（ブースト 1エナ +2000）を使う
  await setup({line:[['HD01-004']]},{line:[['HD02-003']], hand:['HD02-008','HD02-009'], ena:['HD02-001','HD02-001']},{phase:1,first:1});
  await p.click('#btnPhase'); await settle();
  s=await S();
  ok((await log()).includes('ブースト「すやすやジャンボ」を使う') && !s.players[1].hand.some(c=>c.key==='HD02-009') && s.players[1].hand.some(c=>c.key==='HD02-008'),'同じパワーなら、上回れるもののうちいちばん安いブーストを使う（ワザは残す）');
  ok(top(s,0,0).turned && s.players[0].heart[4].turned && !top(s,1,0).turned,'AI が勝ち、自分のホロビトとハートがダメージを受ける');
  // 上回っていれば使わない
  await setup({line:[['HD01-004']]},{line:[['HD02-004']], hand:['HD02-008'], ena:['HD02-001','HD02-001']},{phase:1,first:1});
  await p.click('#btnPhase'); await settle();
  s=await S();
  ok((await log()).includes('パワーで上回っている') && s.players[1].hand.some(c=>c.key==='HD02-008'),'パワーで上回っていれば、ワザは使わない');
  // 届かなければ使わない
  await setup({line:[['HB01-061']]},{line:[['HD02-003']], hand:['HD02-008'], ena:['HD02-001','HD02-001']},{phase:1,first:1});
  await p.click('#btnPhase'); await settle();
  ok((await log()).includes('使っても上回れない') && (await S()).players[1].hand.some(c=>c.key==='HD02-008'),'使っても上回れない（4000+5000 対 18000）ならワザは使わない');
  // 人の番は人が選ぶ（自分が先手なら、ワザの質問が自分に出る）
  await setup({line:[['HD01-004']], hand:['PR-013'], ena:['HD01-001','HD01-001']},{line:[['HD02-003']]},{phase:1,first:0,prep:'done'});
  await p.evaluate(()=>{ state.phase=0; state.first=0; render(); });  // 自分が先手の召喚フェイズ → 送ると AI（後手）の召喚フェイズ
  await p.click('#btnPhase');
  ok(await until(()=>state.phase===2,6000),'AI（後手）が召喚フェイズを終えると、バトルフェイズに入る');
  ok(await until(()=>sheetWrap.classList.contains('on'),3000) && (await q()).includes('いまは自分の番'),'バトルのワザの番が自分なら、自分に聞く');
  await p.click('#sheet button[data-fxa="-1"]'); await wait(100);

  // ---- 6. ハートのトリガー（AI のハートが破壊された）----
  // ドロートリガー: 使う（墓地へ置き、3枚引く）。AI（後手）の召喚フェイズから自分でフェイズを送ってバトルへ
  await setup({line:[['HB01-001']]},{line:[['HD02-001']], heart:['HD02-003','HD02-003','HD02-003','HD02-003',{k:'HD02-008',turned:true}], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを送る');
  await settle();
  s=await S();
  ok(s.players[1].grave.some(c=>c.key==='HD02-008') && s.players[1].hand.length===3 && (await log()).includes('ドロートリガー'),'AI のハートが破壊されたら、ドロートリガーを使う（墓地へ置き、3枚引く）');
  // トリガーを使わない（山札が少ないのでドロートリガーを使わない）: 相手に見せずに手札に加える（依頼者の判断 2026-10-22）。
  // AI の手札を伏せているので、記録にもカードの名前とトリガーの種類を出さない
  await setup({line:[['HB01-001']]},{line:[['HD02-001']], deckN:2, heart:['HD02-003','HD02-003','HD02-003','HD02-003',{k:'HD02-008',turned:true}], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを送る');
  await settle();
  s=await S();
  const L6=await log();
  ok(s.players[1].hand.some(c=>c.key==='HD02-008') && L6.includes('トリガーは使わずに、ハートのカードを手札に加える'),'山札が少ないと、ドロートリガーは使わずに手札に加える');
  ok(!L6.includes('翠炎よ') && !L6.includes('ドロートリガーは使わず'),'トリガーを使わないときは、相手に見せない（記録にカードの名前もトリガーの種類も出さない）');
  // エントリートリガー: 空いているラインに出す（質問は出さない）
  await setup({line:[['HB01-001']]},{line:[['HD02-001'],['HD02-001']], heart:['HD02-003','HD02-003','HD02-003','HD02-003',{k:'HD02-004',turned:true}], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを送る');
  await settle();
  s=await S();
  ok(top(s,1,2)&&top(s,1,2).key==='HD02-004' && (await log()).includes('エントリートリガー'),'エントリートリガー: 空いているラインの1番前（第3ライン）に出す');
  // オーバートリガー: ダウンしているホロビトの上に重ねる
  await setup({line:[['HB01-061'],['HB01-061']]},{line:[['HD02-001'],[{k:'HD02-003',turned:true}],['HD02-001'],['HD02-001'],['HD02-001']], heart:['HD02-003','HD02-003','HD02-003','HD02-003',{k:'HD02-005',turned:true}], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを送る');
  await settle();
  s=await S();
  ok((await log()).includes('「ヒトダマモルン」を「つくものジャンボ」の上にオーバービートで出す'),'オーバートリガー: ダウンしているホロビト（つくものジャンボ）の上に重ねる');

  // ---- 7. ルールが未確定のことは、AI の番でも人に聞く ----
  await setup({line:[['HB01-061']]},{line:[['HD02-001',{k:'HD02-004',turned:true}]], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを送る');
  await settle();   // バトルの結果（人が「続ける」を押す）
  ok(await until(()=>sheetWrap.classList.contains('on')&&document.querySelector('#sheet .fxq')?.textContent.includes('下に 1 枚'),6000),'AI のホロビト（束）が破壊されるとき、下のカードの扱い（未確定）は人に聞く');
  await wait(400);
  ok(await sheetOpen() && (await q()).includes('未確定'),'AI はその質問に答えない（しばらく待っても開いたまま）');
  await p.waitForTimeout(450); await p.locator('#sheet button[data-fxa]',{hasText:'一番上だけ'}).click(); await settle();
  ok((await S()).players[1].line[0].length===1,'人が答えると続く（一番上だけ墓地へ）');

  // ---- 8. 「戻す」のあと、AI の番なら止める（「AIを進める」で続ける）----
  await delay(500);
  await setup({},{hand:['HD02-003','HD02-004','HB01-061'], ena:['HD02-001']},{phase:0,first:1});
  ok(await until(()=>state.players[1].enaCharged,4000),'AI がエナチャージする');
  await p.click('#btnUndo'); await wait(80);
  ok(await p.evaluate(()=>aiPaused) && (await p.textContent('#flow')).includes('止めています') && await p.$('#flow button[data-flow="ai"]'),'「戻す」で AI の番に戻ると、AI は止まり「AIを進める」が出る');
  ok(!(await S()).players[1].enaCharged,'エナチャージが取り消されている');
  ok(await p.evaluate(()=>!document.getElementById('btnPhase').disabled),'止めている間は「フェイズ送り」を押せる（人が代わりに進められる）');
  await wait(900);
  ok(!(await S()).players[1].enaCharged,'止めている間、AI は動かない');
  await delay(40);
  await p.click('#flow button[data-flow="ai"]');
  ok(await until(()=>state.phase===1,6000) && (await S()).players[1].enaCharged,'「AIを進める」で続きを行う');

  // ---- 8b. AI の手札を伏せる（既定）。触れない。見せるにもできる。勝敗が決まったら見せる ----
  await setup({},{hand:['HD02-003','HD02-004','HB01-061'], ena:['HD02-001']},{phase:1,first:1});
  let hid=await p.evaluate(()=>({ n:document.querySelectorAll('#side-1 .z-hand .card.hid').length, names:document.querySelector('#side-1 .z-hand').textContent }));
  ok(hid.n===3 && !hid.names.includes('つくものジャンボ') && !hid.names.includes('樹霊千年'),'AI の手札は伏せて（裏向きで）表示し、名前は出さない');
  ok(await p.evaluate(()=>!!state.players[1].hand.every(c=>c.up)),'伏せるのは表示だけ（カードの向きは変えない）');
  await p.locator('#side-1 .z-hand .card.hid').first().click(); await wait(300);
  ok(!(await sheetOpen()),'伏せた AI の手札をタップしても中身は出ない');
  await p.click('#btnAi'); await wait(450);
  ok(await p.$('#sheet button[data-aihide="1"].primary'),'相手を選ぶシートに「AI の手札: 伏せる／見せる」がある（いまは伏せる）');
  await p.click('#sheet button[data-aihide="0"]'); await wait(80);
  ok((await p.textContent('#side-1 .z-hand')).includes('つくものジャンボ') && await p.evaluate(()=>ui.aiHide===false),'「見せる」にすると AI の手札が見える');
  await p.click('#btnAi'); await wait(450); await p.click('#sheet button[data-aihide="1"]'); await wait(80);
  await p.evaluate(()=>{ state.winner=0; state.winWhy='試験'; render(); });
  ok((await p.textContent('#side-1 .z-hand')).includes('つくものジャンボ'),'勝敗が決まったら AI の手札を見せる');
  await p.evaluate(()=>{ delete state.winner; render(); });

  // ---- 9. 人に戻すと動かない ----
  await pickAi('');
  ok((await p.textContent('#btnAi'))==='相手: 人','「人」を選ぶと「相手: 人」に戻る');
  await setup({},{hand:['HD02-003'], ena:['HD02-001','HD02-001']},{phase:0,first:1});
  await wait(500);
  s=await S();
  ok(s.phase===0 && !s.players[1].enaCharged && !s.players[1].line[0].length && !(await p.textContent('#flow')).includes('AI'),'相手が人なら、相手の番でも自動では動かない');

  // ---- 11. 「ふつう」: バトルの結果を見通して選ぶ ----
  await pickAi('normal');
  // 勝てないが、ブーストで引き分けにできる（4000+2000 対 6000）→ 使う（ハートへのダメージを防ぐ）。「かんたん」は上回れないので使わない
  await setup({line:[['HD01-012']]},{line:[['HD02-003']], hand:['HD02-009'], ena:['HD02-001']},{phase:1,first:1});
  await p.click('#btnPhase'); await settle();
  s=await S();
  ok((await log()).includes('引き分けにする') && !s.players[1].hand.some(c=>c.key==='HD02-009'),'「ふつう」: 勝てなくても、ブーストで引き分けにできるなら使う');
  ok(s.players[1].heart.every(c=>!c.turned) && top(s,0,0).turned && top(s,1,0).turned,'引き分けなので AI のハートはダメージを受けず、お互いのホロビトがダウンする');
  // ワザ・ブーストの配分: 1枚しかないブースト（+2000）を、引き分けにしかならない第1ライン（4000 対 6000）ではなく、
  // 勝ちに変えられる第2ライン（4000 対 5000）に回す
  await setup({line:[['HD02-007'],['HD02-004']]},{line:[['HD02-003'],['HD02-003']], hand:['HD02-009'], ena:['HD02-001']},{phase:1,first:1});
  await p.click('#btnPhase'); await settle();
  s=await S();
  ok((await log()).includes('あとのラインに回す'),'「ふつう」: 第1ラインでは使わず、あとのラインに回す');
  ok(!s.players[1].hand.some(c=>c.key==='HD02-009') && top(s,0,1).turned && !top(s,1,1).turned,'第2ラインでブーストを使って勝つ（相手の第2ラインのホロビトがダウン）');
  ok(top(s,1,0).turned && s.players[0].heart.filter(c=>c.turned).length===1,'第1ラインは負け、第2ラインの勝ちで相手のハートにダメージ');
  // 出し方: 負けているラインに重ねて勝ちに変える（不戦勝のラインに重ねるより伸びる）
  await setup({line:[['HB01-001']]},{hand:['HD02-004'], ena:['HD02-001'], line:[['HD02-001'],['HD02-003']], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを終える');
  s=await S();
  ok(s.players[1].line[0].length===2 && top(s,1,0).key==='HD02-004','「ふつう」: 負けている第1ライン（2000 対 4000）に重ねて勝ちに変える（5000）');
  await p.evaluate(()=>{ fxAsk=null; closeSheet(); state.battle=null; render(); });
  // トドメ: 相手のハートが0枚なら、勝てる出し方を選ぶ（空いたラインに出せば不戦勝でトドメ）
  await setup({line:[['HB01-061']], heart:0},{hand:['HD02-001'], ena:['HD02-001','HD02-001'], line:[['HD02-003']], flags:{enaCharged:true}},{phase:1,first:0});
  ok(await until(()=>state.phase===2,6000),'AI が召喚フェイズを終える');
  s=await S();
  ok(top(s,1,1)&&top(s,1,1).key==='HD02-001','「ふつう」: 相手のハートが0枚なので、空いた第2ラインに出す（不戦勝でトドメになる）');
  await settle();
  ok((await S()).winner===1,'AI の勝ち（ハートが0枚のときのダメージ）');

  // ---- 10. 1ゲーム通して遊ぶ（自分の側は同じ考え方でスクリプトが動かす）----
  if(full){
    await p.evaluate(()=>{ AI_DELAY=15; state=newState(); undoStack=[]; loadStarter(0,'HB-SD01'); loadStarter(1,'HB-SD02'); fxClear(); render(); });
    await p.click('#flow button[data-prep="deal"][data-first="0"]');
    await p.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="0"]');
    const seen=new Set(); let steps=0;
    for(; steps<1500; steps++){
      await wait(25);
      const st=await p.evaluate(()=>({w:state.winner, ph:state.phase, act:activeOf(), sheet:sheetWrap.classList.contains('on'), pick:!!picking, busy:aiBusy||!!aiTimer,
        flow:document.getElementById('flow').textContent, opts:[...document.querySelectorAll('#sheet button[data-fxa]')].map(b=>b.textContent), log:fxLines.slice()}));
      st.log.forEach(x=>{ if(x.includes('（AI）')) seen.add(x.replace(/「[^」]*」/g,'「」').replace(/[0-9]+/g,'N')); });
      if(st.w!==undefined) break;
      if(st.sheet){
        await wait(420);
        if(await p.$('#sheet button[data-cfm]')){ await p.click('#sheet button[data-cfm]'); continue; }
        if(!st.opts.length){ const cl=await p.$('#sheet button[data-close="1"]'); if(cl) await cl.click(); continue; }
        let i=st.opts.findIndex(t=>t.includes('ワザの使用を終えて')); if(i<0) i=0;
        await p.click(`#sheet button[data-fxa="${i}"]`); continue;
      }
      if(st.pick){ await p.evaluate(()=>{ const u=Object.keys(picking.set)[0]; const pk=picking; picking=null; render(); pk.pick(u); }); continue; }
      if(st.busy) continue;
      if(st.ph===2 && st.flow.includes('バトルを続ける')){ await p.click('#flow button[data-flow="resume"]'); continue; }
      if(st.act===0){
        // 自分の召喚フェイズ: AI と同じ考え方で出してから送る
        await p.evaluate(()=>{ const P=state.players[0];
          if(!P.enaCharged&&!P.mainStarted){ const ch=aiChargePick(0); if(ch) enaCharge(ch.c.uid,0); }
          for(let k=0;k<6;k++){ const mv=aiBestPlay(0); if(!mv) break; aiMemoNow().bad[mv.c.uid+'@'+mv.idx]=true; playFromHand(mv.c.uid,0,mv.idx,true); if(fxAsk||picking) break; } });
        if(await p.evaluate(()=>!!(fxAsk||picking||sheetWrap.classList.contains('on')))) continue;
      }
      if(st.act===0 || st.ph===2 || st.ph===3){
        if(await p.evaluate(()=>!document.getElementById('btnPhase').disabled)){ await p.click('#btnPhase'); await wait(40); if(await p.$('#sheet button[data-cfm]')){ await wait(430); await p.click('#sheet button[data-cfm]'); } }
      }
    }
    s=await S();
    ok(s.winner!==undefined,'AI と1ゲーム通して遊べる（勝敗が決まる。'+(s.winner===1?'AI':'自分')+'の勝ち・ラウンド '+s.round+'・'+steps+' 手）');
    const kinds=[...seen];
    ok(['エナチャージ','出す','召喚フェイズを終える'].every(k=>kinds.some(x=>x.includes(k))),'AI がエナチャージし、ホロビトを出し、フェイズを送った');
    console.log('    AI の記録の種類: '+kinds.length+' 種'); if(process.env.AI_KINDS) console.log(kinds.join('\n'));
  }
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'横にはみ出さない');
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:900},false,true);
  await run('iphone',{width:390,height:844},true,false);
  await H.finish();
})();
