// simulator.html から Artifact 公開用の HTML を生成する。
// Artifact 側が <!doctype>/<html>/<head>/<body> を付けるため、
// <title> と <style> と body の中身だけを取り出す。
// simulator.html が唯一の原本であり、生成物を直接編集しないこと。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("simulator.html", "utf8");
const pick = (re, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`${label} が見つかりません`);
  return m[0];
};
const title = pick(/<title>[\s\S]*?<\/title>/, "<title>");
const style = pick(/<style>[\s\S]*?<\/style>/, "<style>");
const body = src.match(/<body>([\s\S]*)<\/body>/);
if (!body) throw new Error("<body> が見つかりません");

const out = `${title}\n${style}\n${body[1].trim()}\n`;

// <header> に誤爆しないよう、タグ名の直後が空白か > のときだけ検出する
if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(out)) {
  throw new Error("外側のタグが残っています");
}
mkdirSync("build", { recursive: true });
writeFileSync("build/simulator.artifact.html", out);
console.log(`generated build/simulator.artifact.html (${out.length} bytes)`);
