# AGENTS.md — CarePact 開発ルール（AIエージェント向け）

このリポジトリで作業するAIエージェント（Codex等）は、着手前にこのファイルと担当Issueを必ず読むこと。仕様の正本は各Issue本文（共通前提は Issue 0 の本文）。このファイルとIssueが食い違ったら Issue が正。

## プロダクト

CarePact：親の介護に直面した家族が、介護保険の数字を見ながら全員で納得して介護体制を決めるための家族専用意思決定ボード。正式なケアプラン作成（ケアマネの仕事）の代替ではない。「家族が合意を作る道具」。

## 技術構成（固定）

- Next.js（TypeScript、**App Router**）＋ **Tailwind CSS** の単一アプリを Cloud Run にデプロイ
- DB：Firestore。データの読み書きは Client SDK 直。ただし **membership の発行（ルーム作成・招待・参加確定）と Gemini 呼び出しだけはサーバー側（Route Handler ＋ Firebase Admin SDK）**
- AI：Gemini は Next.js のサーバー側（Route Handlers）経由でのみ呼ぶ（SDK は @google/genai、モデル名は環境変数 `GEMINI_MODEL`、既定値は gemini-3.5-flash-lite）。**計算はAIにさせない**。単位数の計算と検証はエンジンのコードで行う
- APIキーはサーバーの環境変数だけに置く。ブラウザへ配布される変数には絶対に入れない
- ログインは Firebase 匿名認証

## 人と権限（重要）

- 「ボードに載る家族（people）」と「ログインして編集する人（members）」は別物
  - people：`{ id, name, canProvideCare }`。ログインしない家族も含む。**被介護者本人は canProvideCare=false**。付き添いの配置と負担集計の対象は canProvideCare=true の人だけ。**people は初期登録後、変更不可**
  - members：`rooms/{roomId}/members/{uid}`（Firebase 匿名認証のUID）。role は family／careManager
- **members ドキュメントを作れるのはサーバーだけ**（クライアントからの直接作成・更新・削除はルールで禁止）
- 招待トークンは 128bit 以上のランダム値・有効24時間・1回のみ使用。サーバー側にハッシュ等を保存し、参加時は保存値だけを採用する（リクエストで送られた role は採用しない）
- 権限表（正本）：未参加者は全ルームデータを読めない。参加者（family／careManager）は people・placements・constraints・設定・summary・comments を閲覧できる。**入力の更新と確定は family のみ**。**コメントの作成は careManager のみ**（本文1〜1,000字、authorUid＝認証UID、createdAt＝サーバー時刻）。コメントの更新・削除・返信・通知は MVP 外
- Firestoreルールの合格条件：未参加者はそのルームを読めない／自分の role を昇格できない／他人の membership を変更できない／careManager はコメント作成以外の書き込みができない（開放ルールは禁止）
- 入力・デモはすべて架空データに限定。画像原本は保存しない。画像・メモ本文・制約本文・招待トークン・ID トークンをログに出さない

## 固定した設計判断（変えない）

- 要介護度はデモ・検証とも要介護3で固定（区分支給限度額 27,048単位）
- サービスは5種：訪問介護・通所介護・通所リハビリ・ショートステイ＋家族の付き添い
- 1単位＝10円固定。自己負担は1割／2割／3割を選択
- ボードは1時間刻み、6:00〜24:00、day は月=0〜日=6
- 家族別の比較は付き添い時間のみ（お金の家族別配分は扱わない。自己負担は月次の総額だけ）

## 共通データ形式（詳細は Issue 0 の共通前提が正本）

- Placement：`{ id, day: 0-6, startHour, endHour, kind: "visit"|"daycare"|"dayrehab"|"shortstay"|"family", serviceId?, personId?, note? }`。**時間は半開区間 [startHour, endHour)**、endHour の最大は24。kind が family 以外は serviceId 必須、family は personId 必須（canProvideCare=true の人のみ）。家族の付き添いは単位数を数えない。IDは作る側が `crypto.randomUUID()` で採番
- ショートステイは終日ブロック（6:00〜24:00固定、専用 serviceId、perDay、同日1件のみ。日をまたぐ場合は日ごとに1ブロック）
- ValidationResult：`{ ok, weeklyUnits, monthlyUnits, limitUnits, overUnits, selfPayYen, selfPayBreakdown: {withinYen, overYen}, gaps, memberHours, overloads, hardViolations, validationErrors }`
  - memberHours は canProvideCare=true の家族全員分（配置がない人も0時間）。週20時間超は overloads
  - 単位を一部でも算出できない場合、weeklyUnits・monthlyUnits・overUnits・selfPayYen・selfPayBreakdown は **null**（未計算を0にしない）。算出不可の項目は UI で「未判定」と表示する
  - hardViolations は配置の違反（unavailableOverlap／overlap／unknownId／ineligibleCareProvider／invalidRange／duplicateShortstay）、validationErrors は計算・判定ができなかったもの（code: unsupportedBand／missingCareWindows／incompleteConstraint／invalidMaster 等）
  - ok は「hardViolations・validationErrors・overloads・gaps がすべて空で overUnits=0」のときだけ true
- 制約（保存時）：`{ constraints: [{ personId, type: "work"|"hope"|"unavailable"|"other", detail, days, startHour?, endHour? }], hopes: string[], unknowns: string[] }`。構造化の下書きは名前でよいが、保存時は必ず personId に結びつける。書かれていないことは unknowns に入れ、推測で埋めない
- careWindows：`{ day, startHour, endHour }[]`（支援が必要な時間帯）。「空白」はこの中で配置も付き添いもない時間だけ
- **週と月の換算**：限度額は月単位（要介護3＝27,048単位）。月換算単位 ＝ 週の合計単位 × 30 ÷ 7（四捨五入してから枠内／超過に分ける）。これは30日の月を仮定した概算で、画面とまとめシートには「概算であり実際の請求額ではない」「食費・居住費・各種加算は含まない」と表示する。**限度額を超えた分は保険が効かず全額自己負担**
- 単位数マスター（`data/units.json`）：perUse は所要時間から serviceId 内で一意な band を選ぶ（min 省略=0、max 省略=上限なし、band 重複禁止）。訪問介護は身体介護・生活援助を別 serviceId に分ける。perDay（ショートステイ）は単一 band の units を1日分として適用し、時間の引き当てはしない。どの band にも合わない時間は validationErrors（unsupportedBand）
- 版番号（revision）：配置・制約・careWindows・負担割合を変える書き込みは共通関数 `commitRoomChange(roomId, expectedRevision, change)` を経由し、全入力変更と revision の +1 を同一 transaction で保存する（不一致なら保存しない）。コメントと summary の作成は revision を増やさない。リセットでも revision は 0 に戻さない
- 確定：「確定済み」と言えるのは summary.confirmedRevision ＝ 現在の room.revision のときだけ。確定は expectedRevision 付き transaction で、再検証が ok=true・validationErrors なし・制約の unknowns が空のときだけ
- 変更の適用：`applyChanges(placements, changes)` は保存しない純粋関数。代替案の試し適用（Issue 8）と本適用（Issue 14）は必ず同じ関数を使う
- コンテンツ（`data/columns.json`）：decision／column／service の union 型。sceneId は overLimit／careGap／caregiverOverload／hardViolation／validationUnavailable の5種に固定

## 作業ルール

- Issueごとにブランチを切り、PRで出す。mainへ直接書かない（例外：Issue 0 の初期投入のみ。雛形・AGENTS.md・README の初回投入はがっちゃんが main へ入れてよい）
- 完成の確認は2段構え：(1) ぽんがIssueの「受け入れ条件」を1つずつ実物で確認し、合格／不合格と根拠を出す (2) がっちゃんが最終確認してマージを決める。**受け入れ条件を満たさないPRはマージしない**。ぽんの確認は重点PR（権限・計算・AI連携・統合）に限る
- APIキー・秘密情報はリポジトリに置かない（環境変数で渡す）
- 迷ったら「小さく作って一本の流れを通す」を優先する。範囲外の機能を足さない
- 介護制度の数字を書くときは出典を確認する。確認できない数字は「目安」と明記する
- コミットメッセージとコメントは日本語でよい

## マイルストーン

- 11/7夜：固定データ・仮実装で入力からまとめシートまで一本接続
- 11/8夜：実際の Gemini・Firestore・計算エンジンへ置換
- 11/9：機能完成・公開URLで通し確認
- 11/10：不具合対応と提出のみ（提出完了の目標 18:00、公式フリーズ 19:00 は予備）
