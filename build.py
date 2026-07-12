import re

SRC = "/home/user/site/src"
OUT = "/home/user/site/index.html"

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()

css = read(f"{SRC}/css/style.css")
brand_mark_b64 = read(f"{SRC}/images/brand_mark_webp_b64.txt").strip()
inter_font_b64 = read(f"{SRC}/fonts/InterVariable_b64.txt").strip()

# No 3D/Three.js dependency in the "Clean Tech Minimalist" design — every
# visual is a flat 2D chart or card rendered from real trade data.
js_files = [
    "utils.js", "icons.js", "seed_trades_data.js", "store.js", "analytics.js", "charts.js",
    "strike_engine.js", "app.js"
]
js_bundle = "\n\n".join(f"/* ==== {f} ==== */\n" + read(f"{SRC}/js/{f}") for f in js_files)

# Remove the google fonts @import (network dependency) from css; keep as graceful fallback fonts only
css_no_import = re.sub(r"@import url\([^)]*\);\s*", "", css)

# Embed the actual Inter variable font (all weights, one file, ~340KB) as a
# base64 data URI @font-face. This is what makes the typography match the
# target design pixel-for-pixel regardless of what fonts happen to be
# installed on the viewer's system — the earlier build only requested
# Google Fonts over the network (which silently fails in any offline/
# sandboxed preview) and fell back to whatever generic sans-serif/serif
# the OS provided, which is why headings looked inconsistent before.
font_face_css = f"""
@font-face {{
  font-family: 'InterVar';
  src: url(data:font/woff2;base64,{inter_font_b64}) format('woff2-variations'), url(data:font/woff2;base64,{inter_font_b64}) format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}}
"""
css_no_import = font_face_css + css_no_import

# Safety net: install a global window.onerror handler *before* any app code
# runs. Unlike wrapping the bundle in a bare try/catch block (which would
# incorrectly turn all top-level `const`/`class` declarations into
# block-scoped bindings invisible to later scripts — a real bug we hit and
# fixed), a window-level error listener catches uncaught synchronous errors
# during script parsing/execution without touching variable scope at all.
# If any app module throws while loading, the user sees a readable message
# instead of a silently blank page.
fatal_handler = """
<script>
  window.__AUREUM_FATAL_SHOWN__ = false;
  window.addEventListener('error', function(e) {
    if (window.__AUREUM_FATAL_SHOWN__) return;
    // Only trip the fatal-error UI for genuine script errors, not e.g.
    // resource load failures on optional assets.
    if (!e || (e.message === undefined && !e.error)) return;
    window.__AUREUM_FATAL_SHOWN__ = true;
    var err = e.error || new Error(e.message || 'Unknown error');
    console.error('Aureum Journal: uncaught error during load:', err);
    function showFatal() {
      // If the app already managed to render real content (e.g. the error
      // happened after a successful boot, like a later interaction bug),
      // don't nuke a working page — only show the fallback if the app
      // never signaled a successful start.
      if (window.__AUREUM_APP_STARTED__) return;
      document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:30px;font-family:InterVar,Inter,sans-serif;background:#f7f7fb;color:#181825;">' +
        '<div style="max-width:480px;text-align:center;">' +
        '<div style="width:48px;height:48px;border-radius:16px;margin:0 auto 18px;background:linear-gradient(135deg,#ff6b5b,#14b8a6);"></div>' +
        '<h2 style="font-family:InterVar,Inter,sans-serif;font-size:24px;font-weight:800;margin-bottom:10px;">Aureum Journal could not load</h2>' +
        '<p style="color:#6b6b7d;font-size:13.5px;line-height:1.6;">This preview environment may be restricting a browser feature the app needs. Try opening this file directly in a full browser tab, or download it and open it locally.</p>' +
        '<p style="color:#9797a8;font-size:11.5px;margin-top:14px;">Technical detail: ' + String((err && err.message) || err).replace(/</g,'&lt;') + '</p>' +
        '</div></div>';
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showFatal);
    else showFatal();
  });
</script>
"""

template = read(f"{SRC}/index_template.html")

# Expose the brand mark (a small embedded WEBP, ~2-3KB) as a global data URI
# so app.js can assign it wherever the logo is needed (sidebar, landing)
# without any extra network request or external file dependency.
brand_mark_script = f'<script>window.AUREUM_BRAND_MARK = "data:image/webp;base64,{brand_mark_b64}";</script>'

html = template.replace("/*__CSS__*/", css_no_import)
html = html.replace("/*__APP_JS__*/", js_bundle)
# Insert the fatal-error handler as early as possible, right after <head> opens.
html = html.replace("<head>", "<head>\n" + fatal_handler, 1)
# Brand mark must be available before app.js runs (renderNav uses it).
html = html.replace("<body>", "<body>\n" + brand_mark_script, 1)

with open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)

print("Bundled ->", OUT, len(html), "bytes")
