# Issue 2 の検証メモ（Firestore データモデルとルーム・招待の土台）

## このPRで検証できたこと（ローカル・実物確認済み）

- `npx tsc --noEmit`：エラーなし
- `npm run build`：成功（画面7つ＋API 3本が生成される）
- `npm test`（vitest）：commitRoomChange の書き込み計画（lib/room-change.ts）と
  招待トークン（lib/server/invite-token.ts）の単体テストが全件パス
  - revision 不一致で RevisionConflictError（expected／actual を保持し、保存しない）
  - 配置の追加→upsert、削除→delete、変更→upsert、同一内容→書き込みなし
  - 制約の一部更新は現在値で補って constraints/main の全文になる
  - careWindows／copayRate はルーム本体の項目としてだけ扱う
  - 招待トークンは256bitの乱数、ハッシュは SHA-256 で決定的、形式チェックが不正値を拒否

## 未検証（実 Firestore への接続確認ができていない）

この開発環境には Firebase の認証情報（サービスアカウント鍵／エミュレータ）がないため、
以下は **未検証**。本番プロジェクト（Issue 1 の carepact-devfest2026）または
Firestore エミュレータで、受け入れ条件の確認として実施すること。

- ルーム作成 API → Firestore に rooms・people・members・constraints/main が作られること
- 招待発行→参加の流れで、role が保存値どおりに決まること（family／careManager）
- commitRoomChange が実 Firestore の transaction で revision+1 と一括保存されること、
  および expectedRevision 不一致時に実際に保存が拒否されること
- Firestore ルールの合格条件4点（下記チェックリスト）

## 実 Firestore での確認手順（受け入れ条件チェック用）

前提：firestore.rules を対象プロジェクトへデプロイしておく
（`firebase deploy --only firestore:rules`、またはコンソールでルールを貼り付け）。

エミュレータで確認する場合は、lib/firebase.ts に一時的に
`connectFirestoreEmulator(db, "127.0.0.1", 8080)` と
`connectAuthEmulator(auth, "http://127.0.0.1:9099")` を追加し、
Admin SDK 側は `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST` を
設定して Route Handler を起動する（確認後は戻す）。

### チェックリスト

1. ルーム作成
   - [ ] /rooms/new から家族を登録して作成すると /rooms/{roomId} に遷移する
   - [ ] Firestore に rooms/{roomId}（creatorUid・isDemo=false・revision=0）、
         people、members/{自分のUID}（role=family）、constraints/main が存在する
2. 招待と参加
   - [ ] family で家族用リンクを発行し、別ブラウザ（別の匿名UID）で開くと参加でき、
         members に role=family で作られる
   - [ ] ケアマネ用リンクでは role=careManager になる
   - [ ] 同じリンクをもう一度使うと「使用済み」で参加できない
   - [ ] 発行から24時間経過したリンクは「期限切れ」で参加できない
   - [ ] careManager は招待リンクを発行できない（API が 403 を返す）
   - [ ] リクエストに role を細工しても、参加時の role は保存値どおりになる
3. 保存・取得（commitRoomChange）
   - [ ] 配置を変更すると revision が +1 され、リロードしても配置が残る
   - [ ] 古い revision を expectedRevision に渡すと RevisionConflictError で保存されない
   - [ ] コメントの作成では revision が増えない
4. 権限制御（ルールの合格条件）
   - [ ] 未参加者はそのルームの people・placements 等を読めない
   - [ ] クライアントから members ドキュメントを直接作れない・変更できない（role 昇格不可）
   - [ ] careManager は配置を作成・更新・削除できない
   - [ ] careManager はコメントを作成でき、family はコメントを作成できない
   - [ ] 他ルームのデータを読み書きできない
   - [ ] invites・rateLimits はクライアントから読み書きできない
   - [ ] people はクライアントから作成・変更・削除できない

## 実装上の注意（後続 Issue 向け）

- commitRoomChange の実装は lib/rooms.ts（型とシグネチャの宣言は lib/types.ts のまま）。
  import は `@/lib/rooms` から行うこと
- トランザクションの方式は Issue 2 で統一した形（整合スナップショットの事前取得＋
  トランザクション内での revision 検証＋一括書き込み）を Issue 14・15 でも使うこと
- 招待原本（トークン本体）はサーバーにも保存していない。保存値はハッシュのみ
- ログには requestId と結果コードだけを出す（トークン・本文・IDトークンは出さない）
