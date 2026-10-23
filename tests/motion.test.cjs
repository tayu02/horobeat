// 盤面の動き（依頼者の指示 2026-10-23）: 攻撃する・攻撃を受ける・ドロー・手札に入れる・手札から出す・墓地へ
// ほかの試験は「動きを減らす」設定で開く（harness.cjs）。この試験だけ、動きのある設定で開く。
// 配る（山札→手札。裏返りながら）→ ⑤⑥ → エナチャージ・ラインに出す（手札から抜き取る）→ 墓地へ → 手札に戻す → ドロー → 山札に戻す →
// ドラッグで置く → 一度にたくさん動くときは動かさない → バトル（攻撃 → 結果の画面は動き終わってから → 攻撃を受ける → 破壊されて墓地へ）→
// 伏せた手札も動く → 動き終わったら本物だけが残る → 動いている途中に開く画面は、動き終わってから → AI は動き終わってから次の手 →
// 「動きを減らす」設定では動かない
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)){ if (await fn()) return true; await wait(30); } return false; }

async function run(label, viewport, touch){
  console.log('\n=== ' + label + ' ===');
  const b = await H.launch();
  const ctx = await b.newContext({ ...(touch ? devices['iPhone 13'] : {}), viewport, hasTouch:!!touch, isMobile:!!touch, reducedMotion:'no-preference' });
  const p = await ctx.newPage(); H.watch(p, label); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(H.URL);
  const ev = (f, x) => p.evaluate(f, x);
  // 写しが作られた瞬間に、ページの中で記録する（試験の側が覗くのが遅れても、ほかの検査と同時に動かして混んでいても、同じ結果になるように）。
  // 動き方（data-kind）・裏返るか・動きの区切りの数・始まるまでの待ち・そのときの手札の隠し方・画面（シート）の出方・横のはみ出し
  await ev(() => {
    window.__mlog = [];
    new MutationObserver(recs => {
      const add = [].concat(...recs.map(r => [...r.addedNodes])).filter(n => n.classList);
      if (!add.length) return;
      const at = { hiddenHand:document.querySelectorAll('#side-0 .z-hand .card.mhide').length, sheetOn:sheetWrap.classList.contains('on'), pending:mo.sheetPending,
                   wide:document.documentElement.scrollWidth <= window.innerWidth + 1, bursts:document.querySelectorAll('#motion .burst').length,
                   heartTurn:[...document.querySelectorAll('#side-1 .z-heart .card.turned .ci')].reduce((n, e) => n + e.getAnimations().length, 0) };
      add.filter(n => n.classList.contains('mg')).forEach(g => { const a = g.getAnimations()[0];
        window.__mlog.push(Object.assign({ k:g.dataset.kind, flip:g.classList.contains('flip'), n:a ? a.effect.getKeyframes().length : 0, delay:a ? a.effect.getTiming().delay : 0 }, at)); });
    }).observe(document.getElementById('motion'), { childList:true });
  });
  // 前の操作のあとに作られた写し（次の描画を待ってから読む）
  const ghosts = async () => { await until(() => ev(() => !mo.raf)); await wait(20); return ev(() => window.__mlog.splice(0)); };
  const settled = () => until(() => ev(() => !document.querySelector('#motion .mg, #motion .burst') && !document.querySelector('.mhide') && motionLeft() === 0), 6000);
  const wide = () => ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // 1回の操作をして、それで動き始めたものを返す
  const act = async (f, x) => { await ev(() => { window.__mlog = []; }); await ev(f, x); return ghosts(); };

  await ev(() => { loadStarter(0, 'HB-SD01'); loadStarter(1, 'HB-SD02'); render(); document.querySelectorAll('details.doc').forEach(d => d.open = false); });
  ok(await ev(() => motionOK()), '動きのある設定では、動かす');

  // ---- 配る: 山札から手札へ、裏返りながら1枚ずつ ----
  await ev(() => { window.__mlog = []; });
  await p.click('#flow button[data-prep="deal"][data-first="0"]');
  let g = await ghosts();
  ok(g.length === 12 && g.every(x => x.k === 'draw' && x.flip), '配ると、両者の6枚ずつが山札から手札へ飛ぶ（ドロー。裏から表に返りながら）');
  ok(new Set(g.map(x => x.delay)).size >= 6, '1枚ずつ少しずつずらして飛ぶ');
  ok(g.length && g[0].hiddenHand === 6, '飛んでいる間は、手札の本物は隠しておく');
  ok(g.length && g.every(x => x.wide), '飛んでいる間も、横にはみ出さない');
  ok(await settled(), '動き終わると、写しは消え、本物だけが残る');
  // ⑤⑥: 山札から裏向きでハートへ、表向きでエナへ
  await p.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="0"]'); await ghosts();
  await p.click('#flow button[data-prep="mull"][data-pi="1"][data-redraw="0"]');
  g = await ghosts();
  ok(g.filter(x => x.k === 'move' && !x.flip).length === 10 && g.filter(x => x.k === 'move' && x.flip).length === 2, '⑤⑥: ハート5枚は裏向きのまま、エナ1枚は表に返りながら、山札から置き場へ');
  await settled();

  // ---- 手札から抜き取る（使うために出す）・墓地へ・手札に戻す・ドロー・山札に戻す ----
  g = await act(() => { enaCharge(state.players[0].hand[0].uid, 0); render(); });
  ok(g.some(x => x.k === 'pull' && x.n >= 3), 'エナチャージ: 手札から抜き取って（持ち上げてから）エナへ');
  await settled();
  const holo = await ev(() => state.players[0].hand.find(c => cardDef(c) && cardDef(c).type === 'ホロビト').uid);
  g = await act(u => { snap(); moveCard(u, 0, 'line', 0); render(); }, holo);
  ok(g.length >= 1 && g[0].k === 'pull', 'ラインに出す: 手札から抜き取ってラインへ');
  await settled();
  g = await act(u => { snap(); moveCard(u, 0, 'grave'); render(); }, holo);
  ok(g.length === 1 && g[0].k === 'grave', '場から墓地へ（傾きながら落ちる）');
  await settled();
  g = await act(u => { snap(); moveCard(u, 0, 'hand'); render(); }, holo);
  ok(g.length === 1 && g[0].k === 'tohand', '墓地から手札へ（手札に入れる）');
  await settled();
  g = await act(u => { snap(); moveCard(u, 0, 'grave'); render(); }, holo);
  ok(g.length === 1 && g[0].k === 'grave', '手札から墓地へ');
  await settled();
  g = await act(() => { drawTo(0, 1, 'hand', true); render(); });
  ok(g.length === 1 && g[0].k === 'draw' && g[0].flip, 'ドロー: 山札の上から、裏から表に返りながら手札へ');
  await settled();
  g = await act(() => { const c = state.players[0].hand[0]; snap(); moveCard(c.uid, 0, 'deck'); c.up = false; render(); });
  ok(g.length === 1 && g[0].k === 'vanish' && g[0].flip, '手札から山札へ: 表から裏に返りながら山札へ吸い込まれる（山札は1枚ずつ描かないので、写しだけが動く）');
  await settled();
  ok(await ev(() => document.querySelectorAll('#side-0 .z-hand .card').length === state.players[0].hand.length), '山札へ行ったカードは、手札から消えている');
  // ドラッグで置く（PC）: 指を離したところから
  if (!touch){
    const src = await ev(() => { const e = document.querySelector('#side-0 .z-hand .card'); e.scrollIntoView({ block:'center' }); const r = e.getBoundingClientRect(); return { x:r.left + r.width / 2, y:r.top + r.height / 2, u:e.dataset.cid }; });
    const dst = await ev(() => { const r = document.querySelector('#side-0 .z-grave .strip').getBoundingClientRect(); return { x:r.left + 20, y:r.top + 20 }; });
    await ev(() => { window.__mlog = []; });
    await p.mouse.move(src.x, src.y); await p.mouse.down(); await p.mouse.move(src.x + 10, src.y + 10, { steps:2 });
    await p.mouse.move(dst.x, dst.y, { steps:4 }); await p.mouse.up();
    g = await ghosts();
    ok(g.length === 1 && g[0].k === 'move', 'ドラッグで置いたカードは、指を離したところから置き場へ収まる（持ち上げ・戻りの動きはしない）');
    await settled();
  }
  // 一度にたくさん動くときは動かさない
  g = await act(() => { const P = state.players[0]; P.deck.splice(0, 35).forEach(c => { c.up = true; P.grave.push(c); }); render(); });
  ok(g.length === 0, '一度に30枚より多く動くとき（記録を大きく飛ばしたとき など）は動かさない');

  // ---- バトル: 攻撃 → 結果の画面は動き終わってから → 攻撃を受ける ----
  const setup = (me, opp, ex) => ev(([me, opp, ex]) => {
    let n = 0; const mk = (k, o, e) => Object.assign({ uid:'M' + (n++), owner:o, key:k, up:true, turned:false, note:'' }, e || {});
    const P = (line, o) => { const pl = { heart:[], waza:[], ena:[], hand:[], grave:[], deck:[], line:[[], [], [], [], []], decklist:{} };
      for (let i = 0; i < 10; i++) pl.deck.push(mk(null, o, { up:false })); for (let i = 0; i < 5; i++) pl.heart.push(mk(null, o, { up:false }));
      line.forEach((st, i) => st.forEach(k => pl.line[i].push(typeof k === 'string' ? mk(k, o) : mk(k.k, o, k)))); return pl; };
    state = Object.assign({ v:3, round:1, phase:1, first:1, fxAuto:true, players:[P(me, 0), P(opp, 1)] }, ex || {});
    undoStack = []; picking = null; fxAsk = null; fxClear(); closeSheet(); motionStop(); render();
    document.querySelector('#side-1 .lineslot[data-idx="0"]').scrollIntoView({ block:'center' });
    // 画面（シート）が出たときに、動きの残りが何ミリ秒あったかを記録する
    window.__mt = { sheet:[] };
    new MutationObserver(() => { if (sheetWrap.classList.contains('on')) window.__mt.sheet.push(motionLeft()); }).observe(sheetWrap, { attributes:true, attributeFilter:['class'] });
    window.__mlog = [];
  }, [me, opp, ex || {}]);
  // 第1ライン: 自分 4000 対 相手 2000（相手はダウンしている → 破壊されて墓地へ）。第2ライン: 自分 2000 対 相手 4000
  await setup([['HB01-001'], ['HD01-001']], [[{ k:'HD01-001', turned:true }], ['HB01-001']]);
  await wait(200);
  await p.click('#btnPhase');
  g = await ghosts();
  ok(g.length === 1 && g[0].k === 'attack', 'バトルの結果が出ると、勝ったホロビトが相手のホロビトに飛び込む（攻撃）');
  ok(g.length && g[0].bursts >= 1, '当たるところで火花が出る');
  ok(g.length && !g[0].sheetOn && g[0].pending, '攻撃している間は、結果の画面をまだ出さない');
  await p.waitForSelector('#sheet [data-kind="result"]');
  let mt = await ev(() => window.__mt.sheet.splice(0));
  ok(mt.length && mt[0] < 60, '結果の画面は、攻撃の動きが終わってから出る（出たときの動きの残り ' + Math.round(mt[0]) + 'ms）');
  await wait(450);
  await ev(() => { window.__mlog = []; });
  await p.click('#sheet [data-kind="result"] button[data-fxa="0"]');
  g = await ghosts();
  const grave = g.find(x => x.k === 'grave');
  ok(grave && grave.n >= 8, 'ダウンしていた相手のホロビトは、攻撃を受けて揺れてから墓地へ落ちる（破壊）');
  ok(g.length && g[0].bursts >= 2, '攻撃を受けたホロビトとハートに火花');
  ok(g.length && g[0].heartTurn >= 2, '攻撃を受けたハートは、赤く光ってから横向きになる');
  const atk2 = g.find(x => x.k === 'attack');
  ok(atk2 && atk2.delay >= 500, '次のライン（第2ライン）の攻撃は、第1ラインのダメージを見せてから（同じ処理の中で続けて起きても、起きた順に見せる）');
  await p.waitForSelector('#sheet [data-kind="result"]');
  mt = await ev(() => window.__mt.sheet.splice(0));
  ok(mt.length && mt[0] < 60, '第2ラインの結果の画面も、動き終わってから出る（出たときの動きの残り ' + Math.round(mt[0]) + 'ms）');
  await wait(450); await p.click('#sheet [data-kind="result"] button[data-fxa="0"]');
  ok(await settled(), 'バトルの動きが終わると、写しは消え、本物だけが残る');
  ok(await ev(() => document.querySelector('#side-0 .lineslot[data-idx="1"] .card.turned') && state.players[1].grave.length === 1), '盤面は、動きのない設定と同じ結果（自分の第2ラインはダウン、相手の第1ラインは墓地）');

  // ---- 伏せた手札（AI）も動く。伏せたカードは触れない（data-cid を付けない） ----
  await ev(() => { aiPaused = true; ui.ai = 'normal'; render(); });
  g = await act(() => { drawTo(1, 1, 'hand', true); render(); });
  ok(g.length === 1 && g[0].k === 'draw' && !g[0].flip && await ev(() => { const e = document.querySelector('#side-1 .z-hand .card.hid'); return !!e && !e.dataset.cid && !!e.dataset.mcid; }),
     'AI の伏せた手札にも、山札から裏向きのまま飛ぶ（伏せたカードには触れない印のまま）');
  await settled();
  // AI は動き終わってから次の手を指す
  const aiT = await ev(() => new Promise(res => { aiForce = { 1:'normal' }; AI_DELAY = 50; mo.until = performance.now() + 500; const t0 = performance.now();
    aiLater(() => { aiForce = null; res(performance.now() - t0); }); }));
  ok(aiT >= 480, 'AI は、盤面が動いている間は次の手を指さない（' + Math.round(aiT) + 'ms 待った）');
  await ev(() => { ui.ai = false; aiPaused = false; AI_DELAY = 700; render(); });
  await settled();

  // ---- 動いている途中に開く画面は、動き終わってから。開いたあとは押せる ----
  await ev(() => { drawTo(0, 1, 'hand', true); render(); openSheet('<h3>試験</h3><div class="sgrid c1"><button data-close="1">閉じる</button></div>'); });
  ok(await ev(() => !sheetWrap.classList.contains('on') && mo.sheetPending), '動いている途中に開いた画面は、すぐには出さない');
  ok(await until(() => ev(() => sheetWrap.classList.contains('on'))) && await ev(() => motionLeft() < 60), '動き終わったら出る');
  await wait(450); await p.click('#sheet button[data-close="1"]');
  ok(await ev(() => !sheetWrap.classList.contains('on') && !mo.sheetPending), '出た画面は、いつもどおり閉じられる');
  await settled();
  ok(await wide(), '横にはみ出さない');
  ok(errs.length === 0, 'JSエラーなし ' + errs.join(' | '));
  await ctx.close();

  // ---- 「動きを減らす」設定では動かさない ----
  const ctx2 = await b.newContext({ ...(touch ? devices['iPhone 13'] : {}), viewport, hasTouch:!!touch, isMobile:!!touch, reducedMotion:'reduce' });
  const q = await ctx2.newPage(); H.watch(q);
  await q.goto(H.URL);
  await q.evaluate(() => { loadStarter(0, 'HB-SD01'); loadStarter(1, 'HB-SD02'); render(); });
  await q.click('#flow button[data-prep="deal"][data-first="0"]'); await wait(40);
  ok(await q.evaluate(() => !motionOK() && !document.querySelector('#motion .mg') && !document.querySelector('.mhide')), '「動きを減らす」設定（iPhone の「視差効果を減らす」など）では、カードを動かさない');
  await q.evaluate(() => openSheet('<h3>試験</h3>'));
  ok(await q.evaluate(() => sheetWrap.classList.contains('on')), 'そのときは、画面もすぐに出す');
  await b.close();
}
(async () => {
  await run('pc', { width:1280, height:900 }, false);
  await run('iphone', { width:390, height:844 }, true);
  await H.finish();
})();
