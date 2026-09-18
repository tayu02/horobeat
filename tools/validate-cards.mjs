// data/cards.json を data/cards.schema.json で検証する。
// スキーマで表せない整合性（key の一意性、判読が高いのに unknown がある等）もここで見る。
import { readFileSync } from "node:fs";
import Ajv from "ajv";

export function validateCards(path = "data/cards.json") {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const schema = JSON.parse(readFileSync("data/cards.schema.json", "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: true });
  const ok = ajv.validate(schema, data);
  const errors = [];
  if (!ok) for (const e of ajv.errors) errors.push(`${e.instancePath || "/"} ${e.message}`);

  const seen = new Set();
  for (const c of data.cards) {
    if (seen.has(c.key)) errors.push(`${c.key}: key が重複`);
    seen.add(c.key);

    if (c.id === "unknown" && !c.key.startsWith("UNKNOWN-"))
      errors.push(`${c.key}: id が unknown なら key は UNKNOWN- で始める`);
    if (c.id !== "unknown" && c.key !== c.id)
      errors.push(`${c.key}: id が判明しているなら key は id と一致させる`);

    // ワザにパワー欄はない。ホロビトにはある。
    if (c.type === "ワザ" && c.power !== null)
      errors.push(`${c.key}: ワザの power は null（パワー欄が印字されない）`);
    if (c.type === "ホロビト" && c.power === null)
      errors.push(`${c.key}: ホロビトの power に null は使えない（存在するはずなので unknown か数値）`);

    // 高解像度で読めている版があるなら、unknown が残っているのはおかしい
    const hasHigh = c.printings.some(p => p.legibility === "high");
    if (hasHigh) {
      const unk = [];
      const walk = (v, path) => {
        if (v === "unknown") unk.push(path);
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
        else if (v && typeof v === "object") for (const k in v) walk(v[k], `${path}.${k}`);
      };
      for (const f of ["id","name_ruby","color_mark","cost","power","family","left_edge","abilities","flavor","trigger"]) walk(c[f], f);
      if (unk.length) errors.push(`${c.key}: legibility=high の版があるのに unknown が残っている: ${unk.join(", ")}`);
    }
  }
  return { data, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { data, errors } = validateCards();
  if (errors.length) {
    console.error(`NG: ${errors.length} 件`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`OK: ${data.cards.length} 枚、問題なし`);
}
