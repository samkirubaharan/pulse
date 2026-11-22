// Renders DESIGN.md -> DESIGN.html with GitHub-like styling.
// Uses marked loaded from CDN; no npm install required.
// Re-run any time DESIGN.md changes:  node render.js

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'DESIGN.md');
const out = path.join(__dirname, 'DESIGN.html');
const md = fs.readFileSync(src, 'utf8');

const head = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Drift Dashboard — Design</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<style>
  :root { color-scheme: light; }
  html, body { background: #ffffff; }
  body {
    max-width: 880px;
    margin: 40px auto;
    padding: 0 24px 80px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #1f2328;
    line-height: 1.6;
    font-size: 16px;
  }
  h1, h2, h3, h4 { margin-top: 1.6em; margin-bottom: 0.4em; font-weight: 600; }
  h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; margin-top: 0; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: .3em; }
  h3 { font-size: 1.2em; }
  h4 { font-size: 1.05em; }
  p, ul, ol { margin: 0.6em 0; }
  code {
    background: rgba(175,184,193,0.2);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 85%;
  }
  pre {
    background: #f6f8fa;
    padding: 14px 16px;
    border-radius: 6px;
    overflow-x: auto;
    line-height: 1.45;
  }
  pre code { background: none; padding: 0; font-size: 90%; }
  table {
    border-collapse: collapse;
    margin: 1em 0;
    display: block;
    overflow-x: auto;
    max-width: 100%;
  }
  th, td { border: 1px solid #d1d9e0; padding: 8px 14px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  blockquote {
    border-left: 4px solid #d1d9e0;
    padding: 0 16px;
    color: #59636e;
    margin: 1em 0;
  }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  hr { border: none; border-top: 1px solid #d1d9e0; margin: 2em 0; }
  .meta {
    font-size: 13px;
    color: #59636e;
    border: 1px solid #d1d9e0;
    background: #f6f8fa;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 24px;
  }
</style>
</head>
<body>
<div class="meta">Rendered locally from <code>DESIGN.md</code>. Re-run <code>node render.js</code> to refresh.</div>
<article id="content"></article>
<script id="src" type="text/markdown">
`;

const tail = `
</script>
<script>
  marked.setOptions({ gfm: true, breaks: false });
  const raw = document.getElementById('src').textContent;
  document.getElementById('content').innerHTML = marked.parse(raw);
</script>
</body>
</html>`;

// String concatenation (not template literal interpolation) so backticks
// and ${} inside the markdown never get re-interpreted by JS.
const html = head + md + tail;

fs.writeFileSync(out, html);
console.log('Wrote ' + out + ' (' + html.length + ' bytes)');
