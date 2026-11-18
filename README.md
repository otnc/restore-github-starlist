# restore-github-starlist

モバイル版 GitHub のリポジトリページで、Star ボタンの横に「リストに追加」の ▽ ボタンを復活させるユーザースクリプト。

A userscript that restores the "Add to list" caret button next to the Star button on GitHub repository pages in the mobile web UI.

## 背景

GitHub のモバイル Web では、リポジトリページの Star ボタン横にあったリスト追加の導線がなくなり、スターを付けてから Stars ページへ移動しないとリストに入れられなくなりました。このスクリプトは、デスクトップ版と同じ見た目の分割ボタン（Star + ▽）をモバイル Web に戻します。

## インストール

ユーザースクリプトが動く環境が必要です。

- **iPhone / iPad (Safari)**: [Userscripts](https://github.com/quoid/userscripts) アプリを入れ、このスクリプトを追加
- **デスクトップブラウザ**: Tampermonkey / Violentmonkey など

スクリプト本体: [`restore-github-starlist.user.js`](./restore-github-starlist.user.js)

## 使い方

1. GitHub のリポジトリページを開く（ログイン済みのこと）
2. Star ボタンの右に ▽ ボタンがくっついて表示される
3. ▽ を押すと自分のスター・リストがチェックボックスで開く
4. チェックを付け外しすると、その場で保存される

デスクトップ版と同じ挙動に合わせています。

- リストに入れるとスターも付く（ボタンの星が金色に変わる）
- 全てのリストから外してもスターは外れない
- パネルを開いている間はリストの並び順は変わらない（次に開いたときに新しい並びになる）

## 仕組み

- ページ内の Star ボタンを複製して ▽ ボタンにすることで、サイズ・色・ダークモード追随を GitHub 本来の見た目に一致させています
- リストの取得と保存は GitHub 自身の `/{owner}/{repo}/lists` 断片と、そのフォームの送信先を使っており、外部サーバーへの通信は一切しません
- React の再描画でボタンが消えた場合は自動で付け直します

## ライセンス

MIT — [LICENSE](./LICENSE) を参照。
