// 検証済みの data/cards.json を simulator.html の @@CARDS@@ ブロックへ埋め込む。
// simulator.html を単体で開けるようにするための工程。cards.json が正本。
import { readFileSync, writeFileSync } from "node:fs";
import { validateCards } from "./validate-cards.mjs";

const { data, errors } = validateCards();
if (errors.length) {
  console.error("cards.json が検証を通らないため埋め込みを中止します:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const BEGIN = "/* @@CARDS_BEGIN@@ */";
const END   = "/* @@CARDS_END@@ */";
const html = readFileSync("simulator.html", "utf8");
const a = html.indexOf(BEGIN), b = html.indexOf(END);
if (a < 0 || b < 0 || b < a) throw new Error("simulator.html に @@CARDS_BEGIN@@ / @@CARDS_END@@ がありません");

// _meta は埋め込まない（正本は cards.json）。</script> で壊れないようエスケープする。
const payload = JSON.stringify(data.cards).replace(/<\//g, "<\\/");
const block = `${BEGIN}\n// 生成物。編集しないこと。正本は data/cards.json、更新は npm run build:cards\nvar CARD_LIST = ${payload};\n${END}`;
let out = html.slice(0, a) + block + html.slice(b + END.length);

// 能力文の部品と、カードごとの分解結果も埋め込む（効果の自動処理が読む）。
// 正本は data/ability-parts.json と data/abilities.json。
const AB = "/* @@ABIL_BEGIN@@ */", AE = "/* @@ABIL_END@@ */";
const i = out.indexOf(AB), j = out.indexOf(AE);
if (i < 0 || j < 0 || j < i) throw new Error("simulator.html に @@ABIL_BEGIN@@ / @@ABIL_END@@ がありません");
const parts = JSON.parse(readFileSync("data/ability-parts.json", "utf8")).parts;
const abil = JSON.parse(readFileSync("data/abilities.json", "utf8"));
const enc = v => JSON.stringify(v).replace(/<\//g, "<\\/");
out = out.slice(0, i) + `${AB}\n// 生成物。編集しないこと。正本は data/ability-parts.json と data/abilities.json\n` +
  `var PARTS = ${enc(parts)};\nvar ABILITY_MAP = ${enc(abil)};\n${AE}` + out.slice(j + AE.length);

writeFileSync("simulator.html", out);
console.log(`embedded ${data.cards.length} cards and ${Object.keys(abil).length} ability maps into simulator.html`);
