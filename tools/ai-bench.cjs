// AI の強さを測る: AI どうしを何度も対戦させて勝率を数える（依頼者の指示 2026-10-22「3です」= トークンを使わずに内蔵のAIを強くする）。
//
//   npm run ai:bench                    … 「ふつう」対「かんたん」を 400 局
//   npm run ai:bench -- 800             … 局数を指定
//   npm run ai:bench -- 400 easy easy   … 組み合わせを指定（左が A、右が B）
//   AI_WA='{"plan":0}' npm run ai:bench -- 800 normal normal
//                                       … A の側だけ「ふつう」の重みを変えて、ふつうどうしで比べる（AI_WB は B の側、AI_W は両方）
//   AI_WORKERS=4                        … 同時に動かすブラウザの数（既定 3）
//
// 公平にするため、A と B の「どちらの側か」「どちらのスタートデッキか」「どちらが先手か」を順に入れ替える（8通り）。
// ルールが未確定でシミュレーターが人に聞くこと（束の下のカードの扱い など）は、この測定の中だけ、いつも最初の選択肢で答える
// （両者に同じ答え方をするので勝率の比較には影響しない。ルールの答えとして使うものではない）。
// 捨てる効果の「捨てる先」（未確定）も、この測定の中だけ墓地に置く。
// ワザ・ブーストの使用がいつ終わるか（未確定。B-1）は、ふだんは人が「使用を終える」を押して決める。両方が AI だと誰も押さないので、
// この測定の中だけ、両者が続けて「使わない」を選んだら終える。
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const URL = "file://" + path.join(ROOT, "simulator.html");
const PINNED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// ページの中で、渡された番号の局をすべて行う
async function pageGames(idx, A, B, WA, WB){
  render = function(){ aiKick(); };        // 速くするため、画面の描き直しをやめ、AI を進めるところだけ残す
  fxShowLog = function(){};
  save = function(){};
  var origOpen = openCardSheet;
  openCardSheet = function(uid, pi, force, after){
    if (force){ var f = findCard(uid); if (f) moveCard(uid, f.card.owner, "grave"); if (after) setTimeout(after, 0); return; }
    return origOpen.apply(null, arguments);
  };
  AI_DELAY = 0;
  var origWaza = aiWazaChoice, lastPass = {};
  aiWazaChoice = function(p, acts, oppCan){
    var i = origWaza(p, acts, oppCan), key = state.round + "-" + state.battle.line;
    if (i === acts.length && oppCan){ if (lastPass[key] === 1 - p) return acts.length + 1; lastPass[key] = p; }
    else lastPass[key] = null;
    return i;
  };
  var tick = function(){ return new Promise(function(r){ setTimeout(r, 0); }); };
  var decks = ["HB-SD01", "HB-SD02"];
  async function game(lv, ws, dk, first){
    aiEpoch++; aiForce = lv; aiWSide = ws; aiMemo = {}; aiPaused = false; aiBusy = false; if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
    undoStack = []; picking = null; fxAsk = null; closeSheet(); fxLines = [];
    state = newState(); loadStarter(0, dk[0]); loadStarter(1, dk[1]);
    prepDeal(first); render();
    var still = 0, last = "";
    for (var step = 0; step < 200000; step++){
      await tick();
      if (state.winner !== undefined) return { w:state.winner, r:state.round };
      if (state.round > 40) return { w:-1, r:state.round, why:"round" };
      var sig = JSON.stringify([state.phase, state.round, state.battle && state.battle.line, state.battle && state.battle.stage, fxLines.length]);
      if (sig === last){ if (++still > 2000) return { w:-1, r:state.round, why:"stuck " + sig + " " + fxLines.slice(-3).join(" / ") }; }
      else { still = 0; last = sig; }
      if (aiBusy || aiTimer) continue;
      if (fxAsk){ var a = fxAsk; fxAsk = null; closeSheet(); a.cb(0); continue; }
      if (picking){ var pk = picking, u = Object.keys(pk.set)[0]; picking = null; pk.pick(u); continue; }
      if (sheetWrap.classList.contains("on")){ closeSheet(); continue; }
      if (state.phase === 2 && state.battle){ battleRun(); continue; }
      if (state.phase === 2 || state.phase === 3){ snap(); nextPhase(); render(); continue; }
    }
    return { w:-1, r:state.round, why:"steps" };
  }
  var out = [];
  for (var k = 0; k < idx.length; k++){
    var g = idx[k], aSide = g % 2, swapDeck = (g >> 1) % 2, first = (g >> 2) % 2;
    var lv = {}, ws = {}; lv[aSide] = A; lv[1 - aSide] = B;
    ws[aSide] = Object.assign({}, AI_W, WA || {}); ws[1 - aSide] = Object.assign({}, AI_W, WB || {});
    var dk = swapDeck ? [decks[1], decks[0]] : [decks[0], decks[1]];
    var r = await game(lv, ws, dk, first);
    out.push({ g:g, aSide:aSide, aDeck:dk[aSide], first:first, w: r.w === aSide ? "A" : r.w === 1 - aSide ? "B" : "-", r:r.r, why:r.why });
  }
  aiForce = null; aiWSide = null;
  return out;
}

// N 局を workers 個のブラウザに分けて行う。返すのは { winsA, winsB, other, rate, lo, hi, games, sec, errs }
async function bench({ N = 400, A = "normal", B = "easy", W = null, WA = null, WB = null, workers = 3 } = {}){
  const t0 = Date.now(), errs = [];
  const wa = Object.assign({}, W || {}, WA || {}), wb = Object.assign({}, W || {}, WB || {});
  const parts = Array.from({ length: workers }, (_, k) => Array.from({ length: N }, (_, g) => g).filter(g => g % workers === k));
  const results = await Promise.all(parts.map(async idx => {
    if (!idx.length) return [];
    const browser = await chromium.launch(fs.existsSync(PINNED) ? { executablePath: PINNED } : {});
    try {
      const page = await browser.newPage();
      page.on("pageerror", e => errs.push(String(e)));
      await page.goto(URL);
      return await page.evaluate(`(${pageGames.toString()})(${JSON.stringify(idx)}, ${JSON.stringify(A)}, ${JSON.stringify(B)}, ${JSON.stringify(wa)}, ${JSON.stringify(wb)})`);
    } finally { await browser.close(); }
  }));
  const games = results.flat().sort((x, y) => x.g - y.g);
  const winsA = games.filter(g => g.w === "A").length, winsB = games.filter(g => g.w === "B").length;
  // 勝率と 95% の幅（ウィルソン）。決着しなかった局は除いて数える
  const n = winsA + winsB, ph = n ? winsA / n : 0, z = 1.96;
  const den = 1 + z * z / n, mid = (ph + z * z / (2 * n)) / den, half = n ? z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den : 0;
  return { A, B, wa, wb, N, winsA, winsB, other: games.length - n, rate: ph, lo: mid - half, hi: mid + half, games,
           rounds: games.reduce((s, g) => s + g.r, 0) / (games.length || 1), sec: (Date.now() - t0) / 1000, errs };
}
function pct(x){ return (x * 100).toFixed(1) + "%"; }
function report(r){
  const by = f => { const m = {}; r.games.forEach(g => { const k = f(g); m[k] = m[k] || { A:0, B:0, "-":0 }; m[k][g.w]++; }); return m; };
  if (Object.keys(r.wa).length || Object.keys(r.wb).length) console.log("重み: A", JSON.stringify(r.wa), " B", JSON.stringify(r.wb));
  console.log(`A=${r.A} 対 B=${r.B}  ${r.N} 局（${r.sec.toFixed(0)} 秒）`);
  console.log(`A の勝ち ${r.winsA} / B の勝ち ${r.winsB} / 決着せず ${r.other}  平均 ${r.rounds.toFixed(1)} ラウンド`);
  console.log(`A の勝率 ${pct(r.rate)}（95% の幅 ${pct(r.lo)}〜${pct(r.hi)}）`);
  console.log("A のデッキ別:", JSON.stringify(by(g => g.aDeck)));
  console.log("先手別:", JSON.stringify(by(g => g.aSide === g.first ? "A が先手" : "B が先手")));
  const odd = r.games.filter(g => g.why);
  if (odd.length) console.log("決着しなかった局:", JSON.stringify(odd.slice(0, 5)));
  if (r.errs.length) console.log("JSエラー:", r.errs.slice(0, 5).join(" | "));
}
module.exports = { bench, report, pct };

if (require.main === module){
  const env = k => process.env[k] ? JSON.parse(process.env[k]) : null;
  bench({ N: parseInt(process.argv[2], 10) || 400, A: process.argv[3] || "normal", B: process.argv[4] || "easy",
          W: env("AI_W"), WA: env("AI_WA"), WB: env("AI_WB"), workers: parseInt(process.env.AI_WORKERS, 10) || 3 })
    .then(r => { report(r); if (r.errs.length) process.exitCode = 1; });
}
