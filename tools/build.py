"""gas/Index.html（Apps Script 用の画面）から、GitHub Pages 用のファイル一式をリポジトリ直下に作る。
使い方: python3 tools/build.py
gas/Index.html を直したら必ず実行して、gas/ と生成されたファイルを一緒にコミットする。"""
import json, os, pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'gas' / 'Index.html'
OUT = ROOT  # GitHub Pages はリポジトリ直下を公開している
VERSION = '9'  # 画面を更新したら数字を上げると、iPhone側のキャッシュが入れ替わる

s = SRC.read_text(encoding='utf-8')

def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)

# --- head：ホーム画面アプリ用の設定 ---
rep('<base target="_top">\n', '')
rep('<meta charset="utf-8">', '''<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>家計簿</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="家計簿">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" href="icon-192.png">''')

# --- Apps Script のテンプレート部分を置き換え ---
rep("  const KEY = '<?= key ?>';", r"""  // ===== 接続設定（この端末だけに保存。GitHub には置かない） =====
  const CFG = (() => { try { return JSON.parse(localStorage.getItem('kakeibo:cfg')) || {}; } catch (_) { return {}; } })();
  const KEY = CFG.key || '';

  // google.script.run と同じ書き方で、Apps Script の API（doPost）を呼ぶ
  var google = { script: { run: makeRun() } };
  function makeRun(ok, ng) {
    return new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return f => makeRun(f, ng);
      if (name === 'withFailureHandler') return f => makeRun(ok, f);
      return (...args) => callApi(name, args).then(r => { if (ok) ok(r); }, e => { if (ng) ng(e); else console.error(e); });
    } });
  }
  async function callApi(fn, args) {
    let res;
    try {
      res = await fetch(CFG.api, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 余計な事前確認（CORS）を起こさない
        body: JSON.stringify({ fn, args }),
      });
    } catch (e) { throw new Error('通信できませんでした'); }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('サーバーの応答を読めませんでした（URLを確認してください）'); }
    if (!j.ok) throw new Error(j.error === 'unauthorized' ? '合言葉が違います（接続設定をやり直してください）' : j.error);
    return j.result;
  }

  // 初回の接続設定
  function saveSetup() {
    const v = document.getElementById('setupUrl').value.trim();
    let u;
    try { u = new URL(v); } catch (_) { alert('URLの形が正しくありません'); return; }
    const key = u.searchParams.get('key');
    if (!/\/exec$/.test(u.pathname) || !key) { alert('末尾が「/exec?key=…」の家計簿のURLを貼り付けてください'); return; }
    try { localStorage.setItem('kakeibo:cfg', JSON.stringify({ api: u.origin + u.pathname, key })); }
    catch (_) { alert('この端末に保存できませんでした（プライベートブラウズでは保存できません）'); return; }
    location.reload();
  }
  function resetConnection() {
    if (!confirm('この端末の接続設定を消して、最初からやり直しますか？\n（家計簿のデータは消えません）')) return;
    try { localStorage.removeItem('kakeibo:cfg'); } catch (_) {}
    location.reload();
  }""")
rep("  let startAdd = '<?= add ?>';", "  let startAdd = ['income', 'expense'].includes(new URLSearchParams(location.search).get('add')) ? new URLSearchParams(location.search).get('add') : '';")
rep("  const INITIAL = <?!= initial ?>;", "  const INITIAL = null;")
rep("""  if (INITIAL && INITIAL.ym) { receive(INITIAL); cacheSet('current', INITIAL); openStartAdd(); }
  else load();""", """  if (!KEY || !CFG.api) document.getElementById('setup').style.display = 'flex';
  else if (INITIAL && INITIAL.ym) { receive(INITIAL); cacheSet('current', INITIAL); openStartAdd(); }
  else load();

  // 画面ファイルを端末に保存して、次回から一瞬で開けるようにする
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    // 画面は保存した版をすぐ出しているので、出したあとで新しい版がないか確認する
    const BUILD = '__BUILD__';
    const checkUpdate = async () => {
      if (!navigator.serviceWorker.controller) return;
      try {
        const r = await fetch('index.html?fresh=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const m = /<meta name="build" content="([^"]+)"/.exec(await r.text());
        if (!m || m[1] === BUILD) return;
        // 新しい版を保存できた。入力中でなければ、その場で1回だけ開き直す（入力中なら次に開いたとき）
        let done = ''; try { done = sessionStorage.getItem('kakeibo:reloaded'); } catch (_) {}
        if (done === m[1] || document.querySelector('dialog[open]')) return;
        try { sessionStorage.setItem('kakeibo:reloaded', m[1]); } catch (_) { return; }
        location.reload();
      } catch (_) {}
    };
    setTimeout(checkUpdate, 1500);
  }""")

# 設定画面に「接続設定をやり直す」を追加
rep("""group(['<div class="cell red" onclick="resetSettings()">初期値に戻す</div>']);""",
    """group(['<div class="cell red" onclick="resetSettings()">初期値に戻す</div>'])
        + group(['<div class="cell link" style="justify-content:center;color:var(--accent)" onclick="resetConnection()">この端末の接続設定をやり直す</div>']);""")

# 初回の接続設定画面（スクリプトより前に置く）
rep('<body>', '''<body>
  <div id="setup" class="setup" style="display:none">
    <div class="setup-box">
      <div style="font-size:20px;font-weight:700;margin-bottom:8px">家計簿の接続設定</div>
      <div class="hint" style="font-size:14px;color:var(--text)">いつも使っている家計簿のURL（末尾が <b>/exec?key=…</b> のもの）を貼り付けてください。</div>
      <input id="setupUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec?key=…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="primary" style="width:100%;padding:12px;border:none;border-radius:10px;font-size:16px" onclick="saveSetup()">保存して始める</button>
      <div class="hint" style="margin-top:12px">URLはこの端末の中だけに保存され、外には送られません。合言葉入りのURLは人に教えないでください。</div>
    </div>
  </div>''')
rep('  .legend {', '''  .setup { position:fixed; inset:0; z-index:100; background:var(--bg); align-items:center; justify-content:center; padding:24px; }
  .setup-box { background:var(--card); border-radius:16px; padding:20px; width:min(100%, 420px); }
  .setup-box input { width:100%; font-size:16px; padding:10px; margin:12px 0; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--text); }
  .legend {''')

import hashlib
BUILD = hashlib.sha1(s.encode('utf-8')).hexdigest()[:12]
s = s.replace('__BUILD__', BUILD).replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="build" content="' + BUILD + '">', 1)
(OUT / 'index.html').write_text(s, encoding='utf-8')

# --- manifest ---
(OUT / 'manifest.webmanifest').write_text(json.dumps({
    'name': '家計簿', 'short_name': '家計簿', 'lang': 'ja',
    'start_url': './', 'scope': './', 'display': 'standalone',
    'background_color': '#000000', 'theme_color': '#000000',
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
    ],
}, ensure_ascii=False, indent=2), encoding='utf-8')

# --- service worker ---
# 画面（index.html）は端末に保存した版をすぐ返す（通信を待たないので起動が速い）。
# 新しい版の確認は、画面を出したあとで画面側から「?fresh」付きで行い、あれば保存し直す。
# アイコンなどは保存した版を使う。データ通信（Apps Script）は素通し。
(OUT / 'sw.js').write_text(f"""const CACHE = 'kakeibo-v{VERSION}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {{ cache: 'reload' }})))));
  self.skipWaiting();
}});
self.addEventListener('activate', e => {{
  e.waitUntil((async () => {{
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // 開いている画面を新しい版で開き直す
    const cs = await self.clients.matchAll({{ type: 'window' }});
    cs.forEach(c => c.navigate(c.url).catch(() => {{}}));
  }})());
}});
self.addEventListener('fetch', e => {{
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage && url.searchParams.has('fresh')) {{
    // 更新の確認：必ずネットから取り、取れたら保存し直す
    e.respondWith((async () => {{
      const r = await fetch(url.pathname, {{ cache: 'no-store' }});
      if (r.ok) (await caches.open(CACHE)).put('./index.html', r.clone());
      return r;
    }})());
    return;
  }}
  if (isPage) {{
    e.respondWith((async () => {{
      const c = await caches.open(CACHE);
      return (await c.match('./index.html')) || fetch(req, {{ cache: 'no-store' }});
    }})());
    return;
  }}
  e.respondWith(caches.match(req, {{ ignoreSearch: true }}).then(hit => hit || fetch(req)));
}});
""", encoding='utf-8')

# --- アイコン（オレンジの角丸に白い「¥」） ---
def icon(size, path, rounded):
    if (OUT / path).exists():  # アイコンは一度作ったら作り直さない
        return
    scale = 4
    S = size * scale
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top, bottom = (247, 166, 76), (232, 120, 30)
    for y in range(S):  # 縦のグラデーション
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    if rounded:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.putalpha(mask)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(S * 0.62))
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), '¥', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1]), '¥', font=font, fill=(255, 255, 255, 255))
    img.resize((size, size), Image.LANCZOS).save(OUT / path)

icon(192, 'icon-192.png', True)
icon(512, 'icon-512.png', True)
icon(180, 'apple-touch-icon.png', False)  # iPhone は自分で角を丸めるので四角のまま
print('作成しました: index.html, manifest.webmanifest, sw.js（build ' + BUILD + '）')
