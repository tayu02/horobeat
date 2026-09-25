// data/cards.json から「数えれば分かること」を集計して doc に書き込む。
//
// なぜ必要か:
//   カード番号の一覧、能力欄が空のカードの枚数、ファミリーごとの枚数——
//   こういう台帳を手で書くと、カードが増えるたびに壊れる。実際に
//   「能力欄が空のカード」の通し番号を3枚数え落としていた（2026-09-22 訂正）。
//   数えて出せるものは数えて出す。ここに書かれているのは
//   **data/cards.json に入っている値の集計だけ**で、解釈も推測も含まない。
//
// 使い方: node tools/card-index.mjs [--write]
import { readFileSync, writeFileSync } from "node:fs";

const BEGIN = "<!-- @@CARD_INDEX_BEGIN@@ -->";
const END = "<!-- @@CARD_INDEX_END@@ -->";
const cards = JSON.parse(readFileSync("data/cards.json", "utf8")).cards;

const esc = v => v === null ? "—" : v === "unknown" ? "`unknown`" : String(v);
const tally = (fn) => {
  const m = new Map();
  for (const c of cards) {
    const k = fn(c);
    if (k === undefined) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c.key);
  }
  return [...m].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0]), "ja"));
};
const rows = (head, list) => [`| ${head} | 枚数 | カード |`, "|---|---|---|",
  ...list.map(([k, keys]) => `| ${esc(k)} | ${keys.length} | ${keys.join(" / ")} |`)].join("\n");

// 弾記号ごとの番号と、その範囲の欠番
const sets = new Map();
for (const c of cards) {
  const m = c.id.match(/^([A-Z]{2}[0-9]{2}|PR)-([0-9]{3})$/);
  if (!m) continue;
  if (!sets.has(m[1])) sets.set(m[1], []);
  sets.get(m[1]).push(Number(m[2]));
}
const setLines = [...sets].sort().map(([s, ns]) => {
  ns.sort((a, b) => a - b);
  const pad = n => String(n).padStart(3, "0");
  const min = ns[0], max = ns[ns.length - 1];
  const have = new Set(ns);
  // 連番は範囲に畳む。88個の数字が並んでも読めない。
  const ranges = [];
  for (let i = min; i <= max; i++) {
    if (have.has(i)) continue;
    let j = i;
    while (j + 1 <= max && !have.has(j + 1)) j++;
    ranges.push(i === j ? pad(i) : `${pad(i)}–${pad(j)}`);
    i = j;
  }
  return `| \`${s}\` | ${ns.length} | ${ns.map(pad).join(" / ")} | ${ranges.length ? ranges.join(" / ") : "なし"} |`;
});

const noId = cards.filter(c => c.id === "unknown").map(c => c.key);

const out = [
  BEGIN, "",
  "**この節は `node tools/card-index.mjs --write` が生成する。手で書き換えない。**",
  "",
  `\`data/cards.json\` に入っている値を数えただけのもの。解釈は含まない。対象 ${cards.length} 枚。`,
  "",
  "#### 弾記号ごとのカード番号",
  "",
  "| 弾記号 | 枚数 | 確認済みの番号 | 確認済みの範囲内で未確認の番号 |",
  "|---|---|---|---|",
  ...setLines,
  "",
  `「未確認の番号」は、確認できた最小と最大の間で手元にない番号。**欠番という意味ではない**（単に未公開／未受領）。`,
  noId.length ? `カード番号を読めていないカード: ${noId.join(" / ")}` : "カード番号を読めていないカードはない。",
  "",
  "#### 色",
  "",
  rows("color_mark", tally(c => c.color_mark)),
  "",
  "#### 色とファミリー",
  "",
  rows("色 / カード名下の行", tally(c => c.family === null ? undefined : `${esc(c.color_mark)} / ${esc(c.family)}`)),
  "",
  "カード名下の行が印字されないカード（ワザ）: " +
    (cards.filter(c => c.family === null).map(c => c.key).join(" / ") || "なし"),
  "",
  "#### 左下の記号",
  "",
  rows("記号", tally(c => c.printings.map(p => p.rarity_mark).join(" + "))),
  "",
  "#### 左辺の印字",
  "",
  rows("左辺", tally(c => c.left_edge === null ? "印字なし"
    : c.left_edge === "unknown" ? "`unknown`"
    : `${c.left_edge.modifier}${c.left_edge.cost === null ? "（丸数字なし）" : ` / 丸内 ${c.left_edge.cost}`}`)),
  "",
  "#### トリガー",
  "",
  rows("キーワード", tally(c => c.trigger.keyword)),
  "",
  "#### 能力欄",
  "",
  rows("状態", tally(c => c.abilities === "unknown" ? "`unknown`（判読不能）"
    : c.abilities.length === 0 ? "空（●で始まる能力の印字がない）"
    : `●が ${c.abilities.length} 個`)),
  "",
  "#### イラストレーター",
  "",
  rows("Illus", tally(c => c.printings.map(p => p.illustrator).join(" / "))),
  "",
  END,
].join("\n");

if (process.argv.includes("--write")) {
  const p = "docs/rules_confirmed.md";
  const doc = readFileSync(p, "utf8");
  const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
  if (i < 0 || j < 0) { console.error("マーカーが見つからない"); process.exit(1); }
  writeFileSync(p, doc.slice(0, i) + out + doc.slice(j + END.length));
  console.log(`wrote ${p}`);
} else console.log(out);
