// 能力欄に印字された表現を機械的に切り出して索引にする。
//
// 何をしているか:
//   印字文を「。」で文に割り、各文を「とき、」「なら、」の位置で切るだけ。
//   切り出した断片は**印字どおりの文字列**であり、意味の解釈はしていない。
//   「とき」で終わる断片を契機、「なら」で終わる断片を条件、残りを効果として
//   並べているが、これは文の切れ目による分類であって、ルール上の分類ではない。
//   同じ断片を持つカードをまとめ、カード番号を添える。
//
// 使い方: node tools/ability-index.mjs          → 標準出力に Markdown
//         node tools/ability-index.mjs --write  → rules_confirmed.md の
//                                                 マーカー間を置き換える
import { readFileSync, writeFileSync } from "node:fs";

const BEGIN = "<!-- @@ABILITY_INDEX_BEGIN@@ -->";
const END = "<!-- @@ABILITY_INDEX_END@@ -->";

const cards = JSON.parse(readFileSync("data/cards.json", "utf8")).cards;

const trigger = new Map(); // 「〜とき」
const cond = new Map();    // 「〜なら」
const effect = new Map();  // 残り
const put = (m, frag, key) => {
  if (!frag) return;
  if (!m.has(frag)) m.set(frag, []);
  if (!m.get(frag).includes(key)) m.get(frag).push(key);
};

let unknownCards = [];
for (const c of cards) {
  if (c.abilities === "unknown") { unknownCards.push(c.key); continue; }
  for (const raw of c.abilities) {
    for (const line of raw.split("\n")) {
      for (const sentence of line.split("。")) {
        const s = sentence.trim();
        if (!s) continue;
        let rest = s;
        // 「〜とき、」を先頭から切る
        const t = rest.match(/^(.*?とき)、/);
        if (t) { put(trigger, t[1], c.key); rest = rest.slice(t[0].length); }
        // 「〜なら、」を繰り返し切る
        for (;;) {
          const n = rest.match(/^(.*?なら)、/);
          if (!n) break;
          put(cond, n[1], c.key);
          rest = rest.slice(n[0].length);
        }
        put(effect, rest.trim(), c.key);
      }
    }
  }
}

const table = (m, head) => {
  const rows = [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ja"));
  return [`| ${head} | 枚数 | カード |`, "|---|---|---|",
    ...rows.map(([frag, keys]) => `| ${frag} | ${keys.length} | ${keys.join(" / ")} |`)].join("\n");
};

const out = [
  BEGIN,
  "",
  `**この節は \`node tools/ability-index.mjs --write\` が生成する。手で書き換えない。**`,
  "",
  "切り出しの方法: 能力欄の印字文を「。」で文に割り、各文を「とき、」「なら、」の",
  "位置で切っているだけである。断片は**印字どおりの文字列**で、意味の解釈はしていない。",
  "「とき」「なら」という語の位置による機械的な分類であって、",
  "**ルール上の「発動条件」「適用条件」の区別ではない**（そのような区別が",
  "存在するかどうかも `unknown`）。トリガー欄は対象外（→ §11-2）。",
  "",
  `対象: \`data/cards.json\` の ${cards.length} 枚（能力欄が \`unknown\` のカード: ${unknownCards.length ? unknownCards.join(" / ") : "なし"}）`,
  "",
  "#### 「〜とき」で終わる断片",
  "",
  table(trigger, "印字"),
  "",
  "#### 「〜なら」で終わる断片",
  "",
  table(cond, "印字"),
  "",
  "#### 残りの部分",
  "",
  table(effect, "印字"),
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
} else {
  console.log(out);
}
