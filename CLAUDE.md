# 家計簿（Gmail のカード速報 → スプレッドシート）

利用者とのやりとりは**日本語**で行う。

## 構成
- `gas/Code.gs` … Apps Script のサーバー側。スプレッドシートの「支出」シートが本体のデータ。
- `gas/Index.html` … 画面のもと（Apps Script のウェブアプリ用テンプレート。`<?= key ?>` などを含む）。
- `tools/build.py` … `gas/Index.html` から GitHub Pages 用の `index.html`・`sw.js`・`manifest.webmanifest` をリポジトリ直下に作る。
- リポジトリ直下の `index.html` など … GitHub Pages で公開しているホーム画面アプリ（PWA）。**直接編集しない**（build.py で作る）。
- `.github/workflows/deploy-gas.yml` … `gas/` が main に入ると、clasp で Apps Script に送り、ウェブアプリを新バージョンで再デプロイする。

## 変更の手順
1. `gas/Code.gs` / `gas/Index.html` を編集する。
2. `python3 tools/build.py` を実行して、直下のファイルを作り直す。
3. 構文チェック（`<script>` の中身と Code.gs を `node --check`）をしてから、`gas/` と生成されたファイルを一緒にコミットして main にプッシュする。
   - GitHub Pages（画面）は数分で更新される。iPhone はアプリを開き直すと切り替わる。
   - Apps Script は GitHub Actions が反映する（Secrets 未設定ならスキップ）。

## 注意
- 合言葉（accessKey）や家計簿のデータはリポジトリに入れない（公開リポジトリ）。
- 明細の操作は行番号ではなく ID（F列）で行う。
- Apps Script を呼ぶ関数を増やしたら、`API_FUNCS_`（外部画面から呼べる一覧）や `ACTIONS_`（保存系）にも追加する。
