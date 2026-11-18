// Writes screenshots/index.html listing every PNG (no scripts, no inline styles).
import { readdirSync, writeFileSync } from "node:fs";

const dir = process.argv[2] ?? "screenshots";
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "local";
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const items = files.map((f) => `<figure><a href="${esc(f)}"><img src="${esc(f)}" alt="${esc(f)}" loading="lazy"></a><figcaption>${esc(f)}</figcaption></figure>`).join("\n");
writeFileSync(
  `${dir}/index.html`,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self'">
<title>happy-web screenshots (${esc(sha)})</title><link rel="stylesheet" href="gallery.css"></head>
<body><h1>happy-web screenshots <small>${esc(sha)}</small></h1><main>${items}</main></body></html>\n`,
);
writeFileSync(
  `${dir}/gallery.css`,
  `body{font-family:system-ui,sans-serif;margin:24px;background:#f4f4f5}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px}
figure{margin:0;background:#fff;border-radius:10px;padding:10px;box-shadow:0 1px 3px #0002}img{width:100%;border-radius:6px;border:1px solid #e4e4e7}figcaption{font-size:13px;color:#52525b;margin-top:6px}\n`,
);
console.log(`gallery: ${files.length} screenshots`);
