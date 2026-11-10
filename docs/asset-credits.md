# アセットの出どころ（著作権シート転記用）

## トップページの背景写真

- ファイル：`public/carepact-family-chatgpt.png`
- 出どころ：ChatGPT生成・平林さん作成。Issue #89で指定された確定済みの家族写真。
- 受領時のファイル名：`家族写真の自然な足元と手元.png`
- 確認先：[Discord #開発の指定投稿](https://discord.com/channels/1567541077949550652/1567541131338580199/1569341239944421456)
- 受領方法：依頼者がチャットで指定したローカルファイル。元画像と同一のPNGを配置。
- 使用箇所：トップページの装飾用背景。CSSで薄く表示し、本文の読みやすさを確保。

## M PLUS Rounded 1c

- 配置先：`app/fonts/mplus-rounded-1c/`
- ファイル：`MPLUSRounded1c-{Regular,Medium,Bold,ExtraBold,Black}.woff2`（400・500・700・800・900）
- 出どころ：[Google Fonts公式リポジトリ](https://github.com/google/fonts/tree/84efd8ad78c3710ad14bd909e3bc407151885628/ofl/mplusrounded1c)。同コミットの同名TTFをWOFF2に形式圧縮して同梱。
- 著作権表示：Copyright 2016 The Rounded M+ Project Authors.
- ライセンス：SIL Open Font License 1.1。同フォルダの`OFL.txt`に著作権表示と[公式ライセンス本文](https://openfontlicense.org/documents/OFL.txt)を同梱。
- 変換：fontTools 4.68.0／Brotli 1.2.1。字形・対応文字・字幅は変更せず、サブセット化もしていない。
- 使用箇所：全ページの見出しと本文。`next/font/local`で配信し、ビルド時・利用時のGoogle Fontsへの外部接続は不要。
