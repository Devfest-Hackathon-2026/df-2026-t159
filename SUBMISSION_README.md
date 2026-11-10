# CarePact（ケアパクト）

## 概要

親の要介護化に直面した家族が、介護保険の区分支給限度額や自己負担額をリアルタイムで確認しながら、週間スケジュールボード上で全員が納得できる持続可能な介護分担を合意形成するための家族向け意思決定支援ボードです。
退院サマリーや家族のメモ等の自然文から Gemini が制約や希望を構造化し、単位数・費用の厳密計算エンジンと連携して、無理のないケアプラン下書き・代替案を提示します。
正式なケアプラン作成（ケアマネジャーの業務）の代替ではなく、家族内の合意を可視化し、ケアマネジャーとの円滑な面談・相談を支援することを目的としています。

## 起動方法

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
