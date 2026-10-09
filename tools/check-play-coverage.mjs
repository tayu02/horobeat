// 能力を持つカードが、画面の操作で効果を確かめる試験（tests/cards-play.test.cjs）に入っているかを調べる。
// 入っていないカードがあれば失敗にする（2026-10-09: 9枚が試験に一度も出てこなかったため）。
import { readFileSync } from "node:fs";
const abilities = JSON.parse(readFileSync("data/abilities.json", "utf8"));
const cards = JSON.parse(readFileSync("data/cards.json", "utf8")).cards;
const play = readFileSync("tests/cards-play.test.cjs", "utf8");
let fail = 0;
for (const key of Object.keys(abilities)) {
  const name = (cards.find(c => c.key === key) || {}).name;
  if (play.includes(`'${key}'`)) console.log(`  PASS ${key} ${name} は画面操作の試験に入っている`);
  else { fail++; console.log(`  FAIL ${key} ${name} の効果を画面の操作で確かめる試験がない（tests/cards-play.test.cjs に足すこと）`); }
}
process.exit(fail ? 1 : 0);
