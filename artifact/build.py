# Builds a single-file version of the app for a Claude artifact.
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
page_url = sys.argv[1] if len(sys.argv) > 1 else "__PAGE_URL__"
html = (root/"public/index.html").read_text()
css = (root/"public/style.css").read_text()
js = lambda p: (root/p).read_text()
backend = js("artifact/backend-artifact.js").replace("__PAGE_URL__", page_url)
html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{css}</style>")
html = html.replace('<script src="qrcode.js"></script>', f"<script>\n{js('public/qrcode.js')}</script>")
html = html.replace('<script src="i18n.js"></script>', f"<script>\n{js('public/i18n.js')}</script>")
html = html.replace('<script src="backend.js"></script>', f"<script>\n{backend}</script>")
html = html.replace('<script src="app.js"></script>', f"<script>\n{js('public/app.js')}</script>")
assert "<script src=" not in html.split("<body>")[1], "unresolved script"
out = root/"artifact/disc-artifact.html"
out.write_text(html)
print(out, len(html))
