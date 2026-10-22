// 「ふつう」の重み（simulator.html の AI_W）を、AI どうしの対戦で探す（依頼者の指示 2026-10-22: より強くする）。
//
//   node tools/ai-tune.cjs            … 既定: 1 回の比べ合いは 600 局、全部の重みを 2 周
//   node tools/ai-tune.cjs 800 3      … 局数と周回数を指定
//
// やり方: いまのいちばん（最初は simulator.html の AI_W）から重みを1つだけ半分・倍にした「挑戦者」を作り、
// いまのいちばんと直接対戦させる（tools/ai-bench.cjs。側・デッキ・先手を入れ替える）。
// 挑戦者の勝率の 95% の幅の下の端が 50% を超えたときだけ乗り換える（たまたま勝っただけのものは採らない）。
// 見つけた重みは表示するだけ。simulator.html には手で写し、写したあとで試験と測定をやり直す。
const { bench, pct } = require("./ai-bench.cjs");
const N = parseInt(process.argv[2], 10) || 600, ROUNDS = parseInt(process.argv[3], 10) || 2;
const KEYS = ["down", "destroy", "cost", "board", "draw", "card"];   // hit（10）を物差しにし、kill（トドメ）・plan・fx は変えない
(async () => {
  // いまの重みをページから読む
  const { chromium } = require("playwright");
  const fs = require("node:fs"), path = require("node:path");
  const PINNED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const b = await chromium.launch(fs.existsSync(PINNED) ? { executablePath: PINNED } : {});
  const p = await b.newPage(); await p.goto("file://" + path.join(__dirname, "..", "simulator.html"));
  let best = await p.evaluate(() => Object.assign({}, AI_W)); await b.close();
  console.log("はじめ:", JSON.stringify(best));
  for (let round = 1; round <= ROUNDS; round++){
    let moved = false;
    for (const k of KEYS){
      for (const f of [0.5, 2]){
        const cand = Object.assign({}, best, { [k]: +(best[k] * f).toFixed(3) });
        const r = await bench({ N, A:"normal", B:"normal", WA:cand, WB:best, workers:3 });
        const ok = r.lo > 0.5;
        console.log(`周回${round} ${k}×${f} (${best[k]}→${cand[k]}): 挑戦者 ${pct(r.rate)}（${pct(r.lo)}〜${pct(r.hi)}）${ok ? " → 乗り換え" : ""}${r.errs.length ? " JSエラーあり" : ""}`);
        if (ok){ best = cand; moved = true; break; }
      }
    }
    console.log(`周回${round} のあと:`, JSON.stringify(best));
    if (!moved) break;
  }
  console.log("見つけた重み:", JSON.stringify(best));
})();
