// 全カードの効果を、画面の操作だけで1枚ずつ動かして、印字どおりに動くかを確かめる
// （2026-10-09 依頼者の問い「君の方で動かして、効果通りの動きをしてるか確認した？」から）
//
// - 盤面の初期配置だけはスクリプトで並べる（シャッフルに左右されないように）
// - そこから先は、カードをタップ → メニューのボタン → 光ったカードをタップ → 質問のボタン、
//   という利用者と同じ操作だけで進める（内部の関数は呼ばない）
// - 期待値は能力欄の印字から決める。未確定の部分は「聞く／手で処理するよう案内する」ことを期待値にする
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const b=await H.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:1000}});
  const p=await ctx.newPage(); H.watch(p, 'pc'); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);

  // ---- 盤面を並べる（ここだけスクリプト）----
  const setup=async(me,opp)=>{
    await p.evaluate(([me,opp])=>{
      let n=0; const mk=(k,o,ex)=>Object.assign({uid:'T'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        for(const z of ['hand','ena','grave','heart','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state={round:1,phase:0,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]};
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet(); render();
    },[me||{},opp||{}]);
  };
  // ---- 読むだけ ----
  const S=()=>p.evaluate(()=>state);
  const top=async(pi,li)=>{ const st=(await S()).players[pi].line[li]; return st[st.length-1].uid; };
  const inZone=async(pi,zone,key)=>(await S()).players[pi][zone].find(c=>c.key===key).uid;
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  const q=()=>p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  const sheet=()=>p.evaluate(()=>document.getElementById('sheet').textContent);
  const picks=()=>p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  // 盤面の印。表示されている（on / q / wz）ものだけ
  const badges=(pi,li)=>p.evaluate(([pi,li])=>[...document.querySelectorAll('#side-'+pi+' .lineslot[data-idx="'+li+'"] .fxb span')]
    .filter(s=>getComputedStyle(s).display!=='none').map(s=>s.textContent).join(','),[pi,li]);
  const hand=async pi=>(await S()).players[pi].hand.length;
  // ---- 画面の操作だけ ----
  const tap=async uid=>{ const el=p.locator(`.card[data-cid="${uid}"]`); await el.scrollIntoViewIfNeeded(); await el.click(); await wait(460); };
  const click=async sel=>{ await wait(460); await p.click('#sheet '+sel); await wait(120); };
  const fxbtn=async text=>{ await wait(460); await p.locator('#sheet button.fxbtn',{hasText:text}).first().click(); await wait(120); };
  const ans=async i=>click(`button[data-fxa="${i}"]`);
  const close=async()=>{ if(await p.isVisible('#sheet button[data-close="1"]')) await click('button[data-close="1"]'); };
  const moveTo=async(uid,zone,idx)=>{ await tap(uid); await click(`button[data-mv="${zone}"]`+(idx!==undefined?`[data-idx="${idx}"]`:'')); await wait(120); };
  const useWaza=async(wuid,huid)=>{ await tap(wuid); await click('button[data-wzuse]'); await wait(150); await tap(huid); };
  const R=c=>'HD01-001';  // 赤のホロビト（レオまる）
  const shots=[];
  const shot=async name=>{ const f=H.out('play-'+name+'.png'); await p.screenshot({path:f}); shots.push(f); };

  // ===== 常時の効果（盤面の印）=====
  // HB01-033 自分の赤のホロビトが4体以上ラインに出ているなら +5000
  await setup({line:[['HB01-033'],['HB01-001'],['HD01-001'],['HD01-003']]});
  let bd=await badges(0,0);
  ok(bd.includes('+5000') && bd.includes('ダブルダメージ'),'HB01-033: 赤4体 → +5000 とダブルダメージ（'+bd+'）');
  await setup({line:[['HB01-033'],['HB01-001'],['HD01-001'],['HD02-001']]});
  bd=await badges(0,0);
  ok(!bd.includes('+5000') && bd.includes('ダブルダメージ'),'HB01-033: 赤3体＋緑1体 → +5000 は付かない（'+bd+'）');

  // HB01-049 第1〜2ラインのホロビトの下のカードの合計が3枚以上なら +3000・ダブルダメージを得る
  await setup({line:[['HD01-001','HD01-001','HD01-001'],['HD01-001','HD01-001'],['HB01-049']]});
  bd=await badges(0,2);
  ok(bd.includes('+3000') && bd.includes('ダブルダメージ'),'HB01-049: 下のカードの合計 2+1=3 → +3000 とダブルダメージ（'+bd+'）');
  await setup({line:[['HD01-001','HD01-001'],['HD01-001'],['HB01-049']]});
  bd=await badges(0,2);
  ok(!bd.includes('+3000'),'HB01-049: 合計1 → 付かない（'+bd+'）');

  // HD02-017 このホロビトの下にカードが2枚以上あるなら +3000
  await setup({line:[['HD02-001','HD02-001','HD02-017']]});
  bd=await badges(0,0);
  ok(bd.includes('+3000') && bd.includes('ダブルダメージ'),'HD02-017: 下に2枚 → +3000（'+bd+'）');
  await setup({line:[['HD02-001','HD02-017']]});
  bd=await badges(0,0);
  ok(!bd.includes('+3000'),'HD02-017: 下に1枚 → 付かない（'+bd+'）');

  // HD01-005 第2〜5ラインにいるなら +2500
  await setup({line:[[],['HD01-005']]});
  ok((await badges(0,1)).includes('+2500'),'HD01-005: 第2ライン → +2500');
  await setup({line:[['HD01-005']]});
  ok(!(await badges(0,0)).includes('+2500'),'HD01-005: 第1ライン → 付かない');

  // HD01-015 自分のホロビトが4体以上（色を問わない）なら +4000
  await setup({line:[['HD01-015'],['HD02-001'],['HD02-002'],['HB01-001']]});
  ok((await badges(0,0)).includes('+4000'),'HD01-015: 色の違う4体 → +4000');
  await setup({line:[['HD01-015'],['HD02-001'],['HB01-001']]});
  ok(!(await badges(0,0)).includes('+4000'),'HD01-015: 3体 → 付かない');

  // HD01-011 エナ詠み③（赤3枚以上）・ダウンしていないなら +3000
  await setup({line:[['HD01-011']], ena:[R(),R(),R()]});
  ok((await badges(0,0)).includes('+3000'),'HD01-011: 赤のエナ3枚・縦向き → +3000');
  await setup({line:[[{k:'HD01-011',turned:true}]], ena:[R(),R(),R()]});
  ok(!(await badges(0,0)).includes('+3000'),'HD01-011: ダウンしている → 付かない');
  await setup({line:[['HD01-011']], ena:[R(),R(),'HD02-001']});
  ok(!(await badges(0,0)).includes('+3000'),'HD01-011: 赤のエナ2枚 → 付かない');

  // ラインに出ているなら、コストは1大きくなる（3枚）
  for(const k of ['HB01-034','HD02-001','HD02-014']){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes('コスト+1'),k+': ラインに出ている → コスト+1');
  }
  // キーワード・破壊されない（印だけ）
  for(const [k,t] of [['HD02-002','1バリア'],['HD02-005','1バリア'],['HD02-010','1バリア'],['HD02-006','ダブルダメージ'],['HD01-016','ダブルダメージ'],['HD01-017','破壊されない'],['HD01-007','破壊されない']]){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes(t),k+': 「'+t+'」の印');
  }
  // ブースト（シミュレーターが追いかけない状態）: 印を出さず、メニューで手で確認するよう案内
  for(const [k,n] of [['HD02-012','+2000'],['HD01-012','+3000']]){
    await setup({line:[[k]]});
    ok(!(await badges(0,0)).includes(n),k+': ブーストの '+n+' は盤面に印を出さない');
    await tap(await top(0,0));
    const sh=await sheet();
    ok(sh.includes(n) && sh.includes('手で確認'),k+': メニューで「判定しない（手で確認）」と '+n+' を示す');
    await close();
  }

  // ===== 出たとき（手札からラインへ動かす）=====
  // HD01-001 出たとき、カードを1枚引く
  await setup({hand:['HD01-001']});
  await moveTo(await inZone(0,'hand','HD01-001'),'line',0);
  let s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].hand.length===1 && s.players[0].deck.length===9,'HD01-001: ラインに出す → 1枚引く');
  // HD01-010 出たとき、下にカードがないなら1枚引く
  await setup({hand:['HD01-010']});
  await moveTo(await inZone(0,'hand','HD01-010'),'line',0);
  ok((await S()).players[0].deck.length===9,'HD01-010: 空のラインに出す → 1枚引く');
  await setup({hand:['HD01-010'], line:[['HD01-001']]});
  await moveTo(await inZone(0,'hand','HD01-010'),'line',0);
  ok((await S()).players[0].deck.length===10,'HD01-010: 束の上に出す → 引かない');
  // HD01-006 出たとき、自分のホロビトを1体選び、回復する（回復＝ダウンしているカードを縦向きに。手引書）
  await setup({hand:['HD01-006'], line:[[],[{k:'HD01-001',turned:true}]]});
  await moveTo(await inZone(0,'hand','HD01-006'),'line',0);
  let pk=await picks(); s=await S();
  ok(pk.length===2 && pk.includes(s.players[0].line[1][0].uid),'HD01-006: 自分のラインのホロビトが光る（出た七尾自身も含む）');
  await tap(s.players[0].line[1][0].uid);
  ok(!(await S()).players[0].line[1][0].turned,'HD01-006: 選んだダウンしているホロビトが縦向きになる（回復）');
  let lg;
  // HD02-011 エナ詠み③（緑）・出たとき、手札からコスト7以上のホロビトを1体見せてもよい。そうしたなら1枚引く
  await setup({hand:['HD02-011','HB01-065','HD02-001'], ena:['HD02-001','HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  pk=await picks(); s=await S();
  ok(pk.length===1 && pk[0]===s.players[0].hand.find(c=>c.key==='HB01-065').uid,'HD02-011: 見せる候補はコスト7以上のホロビト（コスト9の HB01-065）だけ');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].hand.length===3 && s.players[0].hand.some(c=>c.key==='HB01-065'),'HD02-011: 見せると1枚引く。見せたカードは手札に残る');
  await setup({hand:['HD02-011','HB01-065'], ena:['HD02-001','HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  await p.click('#pickCancel'); await wait(150);
  ok((await S()).players[0].deck.length===10 && (await log()).includes('見せなかった'),'HD02-011: 見せなければ引かない');
  await setup({hand:['HD02-011','HB01-065'], ena:['HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  ok((await S()).players[0].deck.length===10 && (await picks()).length===0,'HD02-011: 緑のエナ2枚 → エナ詠みを満たさず何もしない');

  // ===== オーバービートされるとき・ダウンしたとき =====
  // HD02-009 オーバービートされるとき、ダウンしているなら1枚引く（そのあとダウンは解除される）
  await setup({hand:['HB01-001'], line:[[{k:'HD02-009',turned:true}]]});
  s=await S();
  await moveTo(await inZone(0,'hand','HB01-001'),'line',0);
  s=await S();
  ok(s.players[0].deck.length===9 && !s.players[0].line[0][0].turned,'HD02-009: ダウン中に重ねられる → 1枚引き、そのあとダウンが解除される');
  await setup({hand:['HB01-001'], line:[['HD02-009']]});
  await moveTo(await inZone(0,'hand','HB01-001'),'line',0);
  ok((await S()).players[0].deck.length===10,'HD02-009: ダウンしていなければ引かない');
  // HD02-016 ダウンしたとき、カードを2枚引く
  await setup({line:[['HD02-016']]});
  await tap(await top(0,0)); await click('button[data-tg]'); await wait(150);
  s=await S();
  ok(s.players[0].line[0][0].turned && s.players[0].hand.length===2,'HD02-016: 横向き（ダウン）にする → 2枚引く');

  // ===== バトルの出来事（メニューのボタンで知らせる）=====
  // HB01-065 バトルに勝ったとき、パワーが正面の2倍以上なら、正面のホロビトを破壊する
  await setup({line:[['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await q()).includes('2倍以上'),'HB01-065: パワーの比は計算せず聞く');
  await ans(0);
  s=await S();
  ok(s.players[1].line[0].length===0 && s.players[1].grave.some(c=>c.key==='HD01-001') && (await log()).includes('相手の第1ライン'),'HB01-065: 正面（相手の同じ番号のライン）が破壊され相手の墓地へ');
  await setup({line:[[],['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,1)); await fxbtn('バトルに勝ったとき'); await ans(0);
  ok((await S()).players[1].line[0].length===1,'HB01-065: 第2ラインにいて、相手の第2ラインが空なら何もしない（第1ラインは正面ではない）');
  await setup({line:[['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(1);
  ok((await S()).players[1].line[0].length===1,'HB01-065: 2倍以上でないと答える → 破壊しない');
  // 正面が「このホロビトは破壊されない」を持つとき
  await setup({line:[['HB01-065']]},{line:[['HD01-017']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(0);
  s=await S();
  ok(s.players[1].line[0].length===1 && s.players[1].grave.length===0,'HB01-065 → HD01-017: 「このホロビトは破壊されない」を持つ正面は破壊しない');
  ok((await log()).includes('破壊されない'),'HB01-065 → HD01-017: 破壊しない理由が記録に出る');
  await setup({line:[['HB01-065']]},{line:[['HD01-007']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(0);
  ok((await S()).players[1].line[0].length===1,'HB01-065 → HD01-007: 破壊されない');

  // HB01-063 エナ詠み③（緑）・バトルに勝ったとき、第1〜2ラインにいるなら、相手は手札を1枚選んで捨てる
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-001','HD02-001']},{hand:['HD02-003','HD01-001']});
  ok((await badges(0,0)).includes('エナ詠み'),'HB01-063: 緑のエナ3枚 → エナ詠みの印');
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  pk=await picks(); s=await S();
  ok(pk.length===2 && s.players[1].hand.every(c=>pk.includes(c.uid)),'HB01-063: 相手の手札が光る（選ぶのは相手）');
  await tap(pk[0]);
  ok((await log()).includes('捨てるカード') && (await sheet()).includes('移動'),'HB01-063: 選ぶと、置き場所は未確定なのでそのカードのメニューを開く');
  await close();
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-001']},{hand:['HD02-003']});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await picks()).length===0 && (await log()).includes('満たしていない'),'HB01-063: 緑のエナ2枚 → 発動しない');
  await setup({line:[[],[],['HB01-063']], ena:['HD02-001','HD02-001','HD02-001']},{hand:['HD02-003']});
  await tap(await top(0,2)); await fxbtn('バトルに勝ったとき');
  ok((await picks()).length===0 && (await log()).includes('第1〜2ライン'),'HB01-063: 第3ライン → 発動しない');

  // HB01-031 バトルが終わったとき、自分の赤のエナを1枚選ぶ。それを未使用にし、このホロビトを回復する
  await setup({line:[[{k:'HB01-031',turned:true}]], ena:[{k:'HD01-001',turned:true},{k:'HD02-001',turned:true}]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  pk=await picks(); s=await S();
  ok(pk.length===1 && pk[0]===s.players[0].ena[0].uid,'HB01-031: 候補は赤のエナだけ（緑は光らない）');
  await tap(pk[0]);
  s=await S();
  ok(!s.players[0].ena[0].turned && s.players[0].ena[1].turned,'HB01-031: 選んだ赤のエナが未使用（縦向き）になる');
  ok(!s.players[0].line[0][0].turned && (await log()).includes('回復した'),'HB01-031: 「このホロビトを回復する」→ ダウンしていた七尾が縦向きになる');

  // HD01-014 バトルが終わったとき、自分のホロビトを1体選び、回復する
  await setup({line:[[{k:'HD01-014',turned:true}]]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  await tap((await picks())[0]);
  ok(!(await S()).players[0].line[0][0].turned,'HD01-014: 自分（ダウン中）を選ぶ → 回復して縦向きになる');

  // HD01-009 バトルに勝ったとき、第2〜5ラインにいるなら1枚引く
  await setup({line:[[],['HD01-009']]});
  await tap(await top(0,1)); await fxbtn('バトルに勝ったとき');
  ok((await hand(0))===1,'HD01-009: 第2ライン → 1枚引く');
  await setup({line:[['HD01-009']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await hand(0))===0 && (await log()).includes('満たさない'),'HD01-009: 第1ライン → 引かない');

  // バトルに勝ったとき、カードを1枚引く（2枚）
  for(const k of ['HD02-012','HD02-015']){
    await setup({line:[[k]]});
    await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
    ok((await hand(0))===1,k+': バトルに勝ったとき → 1枚引く');
  }

  // ===== ワザ =====
  // HD01-013 共鳴：ライガ／使ったとき1枚引く／このワザのパワーを+1000する
  await setup({hand:['HD01-013'], line:[['HB01-001']], ena:[R()]});
  await useWaza(await inZone(0,'hand','HD01-013'), await top(0,0));
  ok((await q()).includes('コスト 1（赤）'),'HD01-013: コスト1（赤）の支払いを聞く'); await ans(0);
  ok((await q()).includes('ライガ・ファミリー'),'HD01-013: 共鳴は使ったホロビトの種族（カード名の下の行）を示して聞く'); await ans(0);
  s=await S();
  ok(s.players[0].hand.length===1 && s.players[0].ena[0].turned && s.players[0].waza.length===1 && s.players[0].waza[0].turned,'HD01-013: 赤のエナ1枚を使用済みにし、ワザゾーンに横向きで置き、1枚引く');
  ok((await log()).includes('左辺の +2000') ,'HD01-013: 「このワザのパワーを+1000する」はワザのパワー（左辺）を示して手で扱うよう案内する');
  ok((await badges(0,0)).includes('ワザ+2000'),'HD01-013: 使ったホロビトに「ワザ+2000」の印');
  await shot('waza');

  // HD02-013 共鳴：スザク／使ったとき相手は手札を1枚選んで捨てる／このバトルに勝ったとき自分は1枚引く
  await setup({hand:['HD02-013'], line:[['HD02-001']], ena:['HD02-001']},{hand:['HD02-003']});
  await useWaza(await inZone(0,'hand','HD02-013'), await top(0,0));
  await ans(0);
  ok((await q()).includes('スザク・ブラッド'),'HD02-013: 共鳴は使ったホロビトの種族を示して聞く'); await ans(0);
  pk=await picks();
  ok(pk.length===1,'HD02-013: 使ったとき → 相手の手札が光る'); await tap(pk[0]); await close();
  await tap(await inZone(0,'waza','HD02-013')); await fxbtn('このバトルに勝ったとき');
  ok((await q()).includes('しなずいさま'),'HD02-013: あとから「勝ったとき」を処理するとき、使ったホロビトを覚えている'); await ans(0);
  ok((await hand(0))===1,'HD02-013: このバトルに勝ったとき → 自分は1枚引く');

  // HB01-097 2つ目のワザを使ったとき、正面のホロビトのコストが8以下なら、その一番上のカードを手札に戻す
  await setup({hand:['HD02-008','PR-013'], line:[['HB01-097']], ena:[R(),R(),R(),R()]},{line:[['HB01-001','HD01-001']]});
  await useWaza(await inZone(0,'hand','HD02-008'), await top(0,0)); await ans(0);
  ok(!(await log()).includes('2つ目'),'HB01-097: 1枚目では発動しない');
  await useWaza(await inZone(0,'hand','PR-013'), await top(0,0)); await ans(0);
  ok((await log()).includes('2つ目のワザを使った'),'HB01-097: 2枚目で発動する');
  ok((await q()).includes('8以下') && (await log()).includes('相手の第1ライン'),'HB01-097: 正面（相手の第1ライン）のコストを聞く'); await ans(0);
  ok((await q()).includes('誰の手札'),'HB01-097: 誰の手札に戻すかを聞く'); await ans(0);
  s=await S();
  ok(s.players[1].hand.some(c=>c.key==='HD01-001') && s.players[1].line[0].length===1,'HB01-097: 一番上だけが持ち主の手札に戻り、下のカードは残る');
  ok((await badges(0,0)).match(/ワザ\+5000/g).length===2,'HB01-097: 「ワザ+5000」の印が2つ');

  // 合術 うつし身の撃: このワザは自分がこのバトルで他のワザを使っているときのみ使える
  await setup({hand:['UNKNOWN-utsushimi'], line:[['HB01-001']], ena:[R(),R()]});
  await useWaza(await inZone(0,'hand','UNKNOWN-utsushimi'), await top(0,0));
  ok((await q()).includes('他のワザを使っていますか'),'うつし身の撃: 使う前に制限を聞く'); await ans(1);
  ok((await S()).players[0].hand.length===1 && (await log()).includes('使えない'),'うつし身の撃: 満たさない → 使えず手札に残る');
  await useWaza(await inZone(0,'hand','UNKNOWN-utsushimi'), await top(0,0)); await ans(0);
  ok((await q()).includes('コスト 2'),'うつし身の撃: 満たす → コスト2の支払いへ（青のエナがないので手で払う）'); await ans(0);
  ok((await log()).includes('このバトルに勝ったなら') && (await log()).includes('手で'),'うつし身の撃: 「勝ったなら…ダメージ+1」は手で扱うよう案内する');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
  await H.finish();
})();
