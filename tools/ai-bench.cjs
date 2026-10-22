// AI の強さを測る: AI どうしを何度も対戦させて勝率を数える（依頼者の指示 2026-10-22「3です」= トークンを使わずに内蔵のAIを強くする）。
//
//   npm run ai:bench                 … 「ふつう」対「かんたん」を 200 局
//   npm run ai:bench -- 400          … 局数を指定
//   npm run ai:bench -- 200 easy easy … 組み合わせを指定（左が A、右が B）
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
const N = parseInt(process.argv[2], 10) || 200;
const A = process.argv[3] || "normal", B = process.argv[4] || "easy";

(async () => {
  const browser = await chromium.launch(fs.existsSync(PINNED) ? { executablePath: PINNED } : {});
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(URL);
  const t0 = Date.now();
  // 試しに重みを変える: AI_W='{"board":1}' npm run ai:bench（「ふつう」の考え方の重み。両者が「ふつう」なら両方に効く）
  const W = process.env.AI_W ? JSON.parse(process.env.AI_W) : null;
  const res = await page.evaluate(async ({ N, A, B, W }) => {
    if (W) Object.assign(AI_W, W);
    // 速くするため、画面の描き直しをやめ、AI を進めるところだけ残す
    render = function(){ aiKick(); };
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
    async function game(lv, dk, first){
      aiEpoch++; aiForce = lv; aiMemo = {}; aiPaused = false; aiBusy = false; if (aiTimer){ clearTimeout(aiTimer); aiTimer = null; }
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
    var out = { games:[], winsA:0, winsB:0, other:0, rounds:0 };
    for (var g = 0; g < N; g++){
      var aSide = g % 2, swapDeck = (g >> 1) % 2, first = (g >> 2) % 2;
      var lv = {}; lv[aSide] = A; lv[1 - aSide] = B;
      var dk = swapDeck ? [decks[1], decks[0]] : [decks[0], decks[1]];
      var r = await game(lv, dk, first);
      var winA = r.w === aSide, winB = r.w === 1 - aSide;
      if (winA) out.winsA++; else if (winB) out.winsB++; else out.other++;
      out.rounds += r.r;
      out.games.push({ aSide:aSide, aDeck:dk[aSide], first:first, w: winA ? "A" : winB ? "B" : "-", r:r.r, why:r.why });
    }
    aiForce = null;
    return out;
  }, { N, A, B, W });
  await browser.close();
  // 勝率と 95% の幅（ウィルソン）。引き分け・打ち切りは除いて数える
  const n = res.winsA + res.winsB, ph = n ? res.winsA / n : 0, z = 1.96;
  const den = 1 + z * z / n, mid = (ph + z * z / (2 * n)) / den, half = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den;
  const by = (f) => { const m = {}; res.games.forEach(g => { const k = f(g); m[k] = m[k] || { A:0, B:0, "-":0 }; m[k][g.w]++; }); return m; };
  if (W) console.log("重み:", JSON.stringify(W));
  console.log(`A=${A} 対 B=${B}  ${N} 局（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  console.log(`A の勝ち ${res.winsA} / B の勝ち ${res.winsB} / 決着せず ${res.other}  平均 ${(res.rounds / N).toFixed(1)} ラウンド`);
  console.log(`A の勝率 ${(ph * 100).toFixed(1)}%（95% の幅 ${((mid - half) * 100).toFixed(1)}〜${((mid + half) * 100).toFixed(1)}%）`);
  console.log("A のデッキ別:", JSON.stringify(by(g => g.aDeck)));
  console.log("先手別:", JSON.stringify(by(g => g.aSide === g.first ? "A が先手" : "B が先手")));
  const odd = res.games.filter(g => g.why);
  if (odd.length) console.log("決着しなかった局:", JSON.stringify(odd.slice(0, 5)));
  if (errs.length) { console.log("JSエラー:", errs.slice(0, 5).join(" | ")); process.exitCode = 1; }
})();
