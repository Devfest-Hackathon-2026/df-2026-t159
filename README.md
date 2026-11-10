# CarePact（ケアパクト）

**公開URL： https://carepact-a7yte2outq-an.a.run.app**（アカウント登録不要。公開URLからそのまま全機能を確認できます）

## 概要

親の要介護化に直面した家族が、介護保険の区分支給限度額や自己負担額をリアルタイムで確認しながら、週間スケジュールボード上で全員が納得できる持続可能な介護分担を合意形成するための家族向け意思決定支援ボードです。
退院サマリーや家族のメモ等の自然文から Gemini が制約や希望を構造化し、単位数・費用の厳密計算エンジンと連携して、無理のないケアプラン下書き・代替案を提示します。
背景にある課題：日本では年間約10万人が介護を理由に離職し、仕事と介護を両立する「ビジネスケアラー」は2030年に約318万人、経済損失は約9兆円に達すると試算されています（経済産業省試算）。また介護経験者の約41%が、介護をめぐって家族間トラブルを経験しています。本アプリは、この「決める前」の混乱と不公平感に焦点を当てています。

正式なケアプラン作成（ケアマネジャーの業務）の代替ではなく、家族内の合意を可視化し、ケアマネジャーとの円滑な面談・相談を支援することを目的としています。

## 使い方（利用者向けの操作フロー）

1. 公開URLを開き、「デモルームを作成」から開始します（アカウント登録は不要です）。
2. ルーム作成者が発行する招待リンク（有効24時間・1回限り）で家族が参加します。ケアマネジャーは閲覧とコメントのみ可能です。
3. 入力画面で家族構成を登録し、退院サマリー等の書類写真や家族の事情メモを投入すると、Gemini が制約・希望を構造化します（内容は家族が確認してから保存します）。
4. 週間ボードにサービスを配置すると、月換算単位数・限度額の残り・自己負担見込みと、空白時間・過労などの警告がその場で表示されます。
5. プランが破綻している場合は「代替案を取得する」から検証済みの代替案を採用でき、確定後はまとめシートを印刷してケアマネジャーとの面談に持参できます。

## 起動方法（開発者向け）

**前提環境：Node.js 20以上、npm**

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` を参考に、ローカル開発環境では `.env.local` を作成して必要な環境変数を設定してください。
（詳細は後述の「必要な環境変数」セクションを参照）

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いて動作を確認します。

### 4. プロダクションビルド

```bash
npm run build
npm run start
```

## 必要な環境変数

本アプリケーションのコード内で実際に参照されている環境変数の一覧です。セキュリティ保護のため、値はコミットせず `.env.local` またはホスティング環境（Cloud Run 等）の環境変数設定に登録してください。

| 変数名 | 用途 | 必須区分 | 参照箇所・補足 |
| :--- | :--- | :---: | :--- |
| `GEMINI_API_KEY` | Gemini API のアクセスキー | **必須** | Route Handlers（サーバーサイド）でのみ使用。事情文の構造化・代替案生成に利用。 |
| `GEMINI_MODEL` | Gemini のモデル名指定 | 任意 | 未設定時の既定値は `gemini-3.5-flash-lite`。 |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web Client SDK 初期化用 API キー | **必須** | クライアント側の Firestore 接続および匿名認証に使用。 |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase Authentication ドメイン | **必須** | クライアント側の Firebase 認証構成。 |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase プロジェクト ID | **必須** | クライアント側接続およびサーバー側 Admin SDK のフォールバックに利用。 |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase Storage バケット名 | **必須** | クライアント側の Firebase 初期化構成。 |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging 送信者 ID | **必須** | クライアント側の Firebase 初期化構成。 |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase アプリケーション ID | **必須** | クライアント側の Firebase 初期化構成。 |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウント秘密鍵 JSON ファイルのパス | 任意 | ローカル環境で Firebase Admin SDK を動作させる場合に指定。Cloud Run 等の ADC（Application Default Credentials）稼働環境では自動認識されるため不要。 |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Admin SDK 用プロジェクト ID | 任意 | Admin SDK 初期化時にプロジェクトIDを明示的に指定する場合に使用。未設定時は `NEXT_PUBLIC_FIREBASE_PROJECT_ID` または `GOOGLE_CLOUD_PROJECT` から自動解決。 |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud プロジェクト ID | 任意 | Cloud Run 等のプラットフォーム環境で自動提供されるプロジェクト識別子。 |

## 技術構成

- **フロントエンド / バックエンド**: Next.js 15（App Router, TypeScript, React 19）+ Tailwind CSS v4
- **データベース / 認証**: Firebase Firestore（Client SDK によるリアルタイム同期、Admin SDK による権限管理・招待発行）、Firebase Authentication（匿名認証）
- **生成AI**: Google Gemini API（`@google/genai`、サーバー側 Route Handlers からのみ呼び出し。制約・希望の自然文構造化および代替案の提示に使用し、数値・単位数・費用の計算は専用 TypeScript エンジンが担当）
- **インフラ**: Google Cloud Run（コンテナデプロイ）

## AI（Gemini）の利用方針

- **使用箇所（1）事情の構造化**：退院サマリー等の書類写真と家族の事情メモ（自然文）を Gemini API に渡し、勤務時間・対応不可時間・希望を構造化JSONへ変換します。理由は、画像と自由文という非定型情報をプログラムが扱える制約データに変える処理がマルチモーダルのLLMの得意領域だからです。書かれていないことは推測で埋めず「不明事項」として出し、家族が確認して初めて保存します。
- **使用箇所（2）代替案の提示**：プランが限度額超過・空白・過労などで破綻したとき、現在の配置と破綻理由を Gemini に渡し、変更候補を分かりやすい文章で提示させます。
- **AIに任せない範囲**：単位数・限度額・自己負担額の計算と制約違反の判定は、すべて専用の TypeScript 計算・検証エンジンが行います。金額の誤差は利用者の家計に直結するため、確率的に出力が揺れるLLMには計算させません。代替案も提示前に必ずエンジンで再検証し、制約を満たした案だけを「検証済み」として表示します。
- **設定方法**：Gemini の呼び出しはサーバー側（Route Handlers）からのみ行い、APIキーは環境変数 `GEMINI_API_KEY` で渡します。モデル名は環境変数 `GEMINI_MODEL` で指定でき、未設定時の既定値は `gemini-3.5-flash-lite` です（詳細は「必要な環境変数」参照）。

## テストの実行方法

Vitest による単体・統合テスト、および TypeScript の型チェックが用意されています。

```bash
# 全テストスイートの実行
npm test

# 型チェック（TypeScript noEmit）
npm run typecheck
# または
npx tsc --noEmit
```

## チーム

経営工プログラミング部（佐藤和賀・吉村光瑛・平林賢人・清武志功）。第三者ライブラリ・素材のライセンスは、提出物の著作物利用シートおよびリポジトリ内 `docs/asset-credits.md` に記載しています。
