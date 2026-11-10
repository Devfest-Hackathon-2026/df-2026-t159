/**
 * CarePact 共通型定義（Issue 0 で固定。全 Issue の前提）
 *
 * 正本は GitHub Issue #2（仕様 Issue 0）の「全Issue共通の前提」。
 * このファイルと Issue が食い違う場合は Issue が正。
 * 型を変更するときは、必ず Issue 0 の担当（がっちゃん）経由で全員に共有すること。
 *
 * このファイルに置くのは「型と関数のシグネチャ」まで。
 * - commitRoomChange の実装・ルール・テストは Issue 2 の担当
 * - applyChanges の実装は Issue 6 の担当
 */

import type { Timestamp } from "firebase/firestore";

// ---------------------------------------------------------------------------
// 基本
// ---------------------------------------------------------------------------

/** 曜日。月=0 〜 日=6 */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * 時刻の範囲。時間はすべて半開区間 [startHour, endHour) で表す。
 * startHour・endHour は整数時間。
 */
export interface TimeRange {
  day: DayIndex;
  startHour: number;
  endHour: number;
}

/** ボードの表示・配置範囲（6:00〜24:00、1時間刻み） */
export const BOARD_START_HOUR = 6;
export const BOARD_END_HOUR = 24;

/** 要介護3の区分支給限度額（単位／月）。要介護度はデモ・検証とも要介護3で固定 */
export const LIMIT_UNITS_CARE_LEVEL_3 = 27048;

/** 1単位あたりの金額（円）。固定 */
export const UNIT_PRICE_YEN = 10;

/** 負担の過多（overloads）と判定する週あたり付き添い時間の目安（時間） */
export const OVERLOAD_HOURS_PER_WEEK = 20;

// ---------------------------------------------------------------------------
// 人（people）と編集者（members）
// ---------------------------------------------------------------------------

/**
 * 家族の区分（Issue #72）。
 * - recipient: 介護を受ける人（被介護者本人、ちょうど1人必須）
 * - caregiver: 付き添いができる家族（1人以上必須）
 * - family: 付き添いはできない家族
 */
export type CareRole = "recipient" | "caregiver" | "family";

/**
 * 家族（ボードに載る人）。ログインする人とは別物で、ログインしない家族も含む。
 * 配置と負担集計の対象は canProvideCare=true の人だけ。
 * 被介護者本人は canProvideCare=false。
 */
export interface Person {
  id: string;
  name: string;
  canProvideCare: boolean;
  careRole?: CareRole;
  icon?: string;
}

/** 編集者（members）の役割 */
export type MemberRole = "family" | "careManager";

/**
 * 編集者（membership）。Firebase 匿名認証の UID で識別する。
 * members ドキュメントを作れるのはサーバーだけ（クライアントからの直接作成・更新・削除は禁止）。
 */
export interface Member {
  uid: string;
  role: MemberRole;
}

// ---------------------------------------------------------------------------
// 配置（Placement）
// ---------------------------------------------------------------------------

/** 配置の種別。サービスの4種＋家族の付き添い */
export type PlacementKind = "visit" | "daycare" | "dayrehab" | "shortstay" | "family";

/**
 * 週間ボード上の配置1件。
 * - 時間は半開区間 [startHour, endHour)。6 ≦ startHour ＜ endHour ≦ 24、整数時間
 * - kind が family 以外のとき serviceId が必須
 * - kind が family のとき personId が必須で、canProvideCare=true の人の ID だけが有効
 * - 家族の付き添いは単位数を数えない（時間だけを数える）
 * - ショートステイは終日ブロック（6:00〜24:00固定、同日1件まで）
 * - id は作る側が crypto.randomUUID() で採番してから保存する
 */
export interface Placement {
  id: string;
  day: DayIndex;
  startHour: number;
  endHour: number;
  kind: PlacementKind;
  serviceId?: string;
  personId?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// 制約（Constraint）と支援必要時間（careWindows）
// ---------------------------------------------------------------------------

export type ConstraintType = "hope" | "unavailable" | "other";

interface ConstraintBase {
  /** people の ID（保存時は必ず personId に結びつける） */
  personId: string;
  detail: string;
}

/**
 * 時刻を必須とする制約（対応不可）。
 * days は非空、各 day=0〜6、整数時間で 0 ≦ startHour ＜ endHour ≦ 24 を必須とする。
 * 日またぎは日別に分割して表す。不完全なものは検証で incompleteConstraint になる。
 * 検証エンジンは unavailable を「その人が対応できない時間」として扱う。
 */
export interface TimedConstraint extends ConstraintBase {
  type: "unavailable";
  days: DayIndex[];
  startHour: number;
  endHour: number;
}

/** 時刻を持たない（または任意の）制約（希望・その他） */
export interface FreeformConstraint extends ConstraintBase {
  type: "hope" | "other";
  days: DayIndex[];
  startHour?: number;
  endHour?: number;
}

/** 制約1件（判別共用体） */
export type Constraint = TimedConstraint | FreeformConstraint;

/** 保存時の制約一式（rooms/{roomId}/constraints/main の中身） */
export interface RoomConstraints {
  constraints: Constraint[];
  /** 家族の希望（自由記述） */
  hopes: string[];
  /** 書かれていないこと・分からないこと。推測で埋めず、ここに入れる */
  unknowns: string[];
}

/**
 * Gemini 構造化の直後の下書き用制約（Issue 7）。
 * 下書きでは personId の代わりに名前（memberName）でよいが、
 * 保存するときは必ず personId に結びつけた Constraint に変換する。
 */
export interface ConstraintDraft {
  memberName: string;
  type: ConstraintType;
  detail: string;
  days: DayIndex[];
  startHour?: number;
  endHour?: number;
}

/** 介護が必要な時間帯（ルーム設定に持つ）。「空白」はこの中で配置も付き添いもない時間だけを指す */
export type CareWindow = TimeRange;

// ---------------------------------------------------------------------------
// ルーム設定・スナップショット・書き込み
// ---------------------------------------------------------------------------

/** 自己負担割合（1割／2割／3割） */
export type CopayRate = 1 | 2 | 3;

/** ルームの設定（rooms/{roomId} 本体に持つ項目のうち、入力に効くもの） */
export interface RoomSettings {
  careWindows: CareWindow[];
  /** 要介護度。MVP では 3 で固定 */
  careLevel: 3;
  copayRate: CopayRate;
}

/**
 * 入力一式の整合スナップショット。
 * Client SDK で読む場合は root の revision → 入力群 → root の revision の順に読み、
 * 前後が一致したときだけ整合スナップショットとして採用する（キャッシュは使わない）。
 */
export interface RoomSnapshot {
  people: Person[];
  placements: Placement[];
  constraints: Constraint[];
  hopes: string[];
  unknowns: string[];
  careWindows: CareWindow[];
  copayRate: CopayRate;
  revision: number;
}

/**
 * commitRoomChange に渡す変更分。
 * 家族・配置・制約・careWindows・負担割合の書き込みは、必ずこの形で共通関数を経由する。
 */
export interface RoomChange {
  people?: Person[];
  placements?: Placement[];
  constraints?: Constraint[];
  hopes?: string[];
  unknowns?: string[];
  careWindows?: CareWindow[];
  copayRate?: CopayRate;
}

/**
 * 全入力変更と revision の +1 を同一 transaction で保存する共通関数（シグネチャのみ）。
 * transaction では root の revision を expectedRevision と比較し、不一致なら保存しない。
 * 実装・Firestore ルール・テストは Issue 2 が担当する。
 *
 * @returns 保存後に新しくなった revision
 */
export declare function commitRoomChange(
  roomId: string,
  expectedRevision: number,
  change: RoomChange,
): Promise<number>;

// ---------------------------------------------------------------------------
// 検証結果（ValidationResult）
// ---------------------------------------------------------------------------

export type HardViolationType =
  | "unavailableOverlap" // 対応不可時間（unavailable）に家族配置が重なった
  | "overlap" // 同じ人の付き添いが時間で重なった
  | "unknownId" // 存在しない ID への配置・参照
  | "ineligibleCareProvider" // 実在するが canProvideCare=false の人への家族配置
  | "invalidRange" // 時刻の範囲が規則外
  | "duplicateShortstay"; // 同日にショートステイが2件以上

/** 「置いてはいけない場所に置いた」違反。いずれも空白を埋める有効な支援には数えない */
export interface HardViolation {
  type: HardViolationType;
  detail: string;
  placementId?: string;
}

/**
 * validationErrors の code。正は下記の4種とし、追加が必要な場合は
 * この型を更新して行う（エンジン側で勝手な文字列を作らない）。
 */
export type ValidationErrorCode =
  | "unsupportedBand" // 単位数マスターのどの band にも合わない時間
  | "missingCareWindows" // careWindows が未設定・空配列
  | "incompleteConstraint" // 必須時刻が不足するなど不完全な制約
  | "invalidMaster" // 単位数マスター自体が不正
  | (string & {}); // 拡張用（上記4種が正）

/** 「計算・判定ができなかった」もの */
export interface ValidationError {
  code: ValidationErrorCode;
  reason: string;
  serviceId?: string;
  placementId?: string;
  personId?: string;
}

/** 空白時間（careWindows の中で配置も付き添いもない時間） */
export interface Gap {
  day: DayIndex;
  startHour: number;
  endHour: number;
}

/** 家族ごとの付き添い時間（週次）。canProvideCare=true の家族全員分（配置がない人も0時間で返す） */
export interface MemberHours {
  personId: string;
  hours: number;
}

/** 負担が過多な家族（週次） */
export interface Overload {
  personId: string;
  hours: number;
}

/** 自己負担の内訳（円） */
export interface SelfPayBreakdown {
  /** 枠内分の自己負担 */
  withinYen: number;
  /** 枠を超えた分の全額自己負担 */
  overYen: number;
}

/**
 * 検証エンジン（Issue 6）の出力。
 * 単位を一部でも算出できない場合、weeklyUnits・monthlyUnits・overUnits・
 * selfPayYen・selfPayBreakdown は null にする（未計算を0に置き換えない）。
 * 算出不可の検査項目は UI で「未判定」と表示し、「空白なし」「0円」と誤表示しない。
 * ok は「hardViolations が空、validationErrors が空、overUnits=0、gaps が空、
 * overloads が空」のときだけ true。
 */
export interface ValidationResult {
  ok: boolean;
  /** 週の合計単位（週次） */
  weeklyUnits: number | null;
  /** 月換算単位 = 週の合計単位 × 30 ÷ 7（四捨五入。月次） */
  monthlyUnits: number | null;
  /** 区分支給限度額（単位／月。要介護3 = 27,048） */
  limitUnits: number;
  /** 限度額を超えた単位（月次） */
  overUnits: number | null;
  /** 月次の自己負担の総額（円） */
  selfPayYen: number | null;
  selfPayBreakdown: SelfPayBreakdown | null;
  gaps: Gap[];
  memberHours: MemberHours[];
  overloads: Overload[];
  hardViolations: HardViolation[];
  validationErrors: ValidationError[];
}

/**
 * 検証結果と、それを計算した入力の revision の組（Issue 3 の useRoomValidation 用）。
 * 別版の結果を現在の合格表示に流用しないため、必ず revision とセットで扱う。
 */
export interface RevisionedValidation {
  revision: number;
  result: ValidationResult;
}

// ---------------------------------------------------------------------------
// 代替案（Proposal）と変更の適用
// ---------------------------------------------------------------------------

export type ProposalAction = "move" | "resize" | "add" | "remove";

/**
 * Gemini の生出力の変更1件（信頼しない。サーバーで正規化する前の形）。
 * action 別の許可項目は、正規化（Issue 8）が検証する。
 */
export interface RawProposalChange {
  placementId?: string;
  action: ProposalAction;
  day?: number;
  startHour?: number;
  endHour?: number;
  kind?: PlacementKind;
  serviceId?: string;
  personId?: string;
}

/** Gemini の生出力の代替案1件 */
export interface RawProposal {
  summary: string;
  changes: RawProposalChange[];
}

/** 対象の配置を削除する（placementId のみ） */
export interface RemoveChange {
  action: "remove";
  placementId: string;
}

/** 対象の配置を移動する。終了時刻は元の長さから算出する */
export interface MoveChange {
  action: "move";
  placementId: string;
  day: DayIndex;
  startHour: number;
}

/** 対象の配置の時刻を変える */
export interface ResizeChange {
  action: "resize";
  placementId: string;
  startHour: number;
  endHour: number;
}

/**
 * 配置を新規追加する。placementId はサーバーがパース直後に
 * crypto.randomUUID() で一度だけ採番したもの（Gemini には採番させない）。
 * kind の変更は remove＋add で表す。
 */
export interface AddChange {
  action: "add";
  placementId: string;
  day: DayIndex;
  startHour: number;
  endHour: number;
  kind: PlacementKind;
  serviceId?: string;
  personId?: string;
  note?: string;
}

/** 正規化済みの変更1件（判別共用体） */
export type ProposalChange = RemoveChange | MoveChange | ResizeChange | AddChange;

/**
 * 正規化済みの代替案1件。
 * baseRevision は AI が返した値を捨て、リクエストに使った整合スナップショットの
 * revision をサーバーが付けたもの。採用時は現在の revision と一致しなければ破棄する。
 */
export interface Proposal {
  summary: string;
  changes: ProposalChange[];
  baseRevision: number;
  /**
   * サーバーが試し適用後に計算した、比較表示用の検証結果。
   * 過去の代替案との互換性のため省略可。採用時はこの値を信頼せず再検証する。
   */
  validation?: ValidationResult;
}

/**
 * 変更を配置の一覧へ適用する純粋関数（シグネチャのみ）。保存はしない。
 * 契約はここ（Issue 0）、実装は Issue 6 が担当する。
 * Issue 8（試し適用）と Issue 14（本適用）は必ず同じ関数を使う。
 */
export declare function applyChanges(
  placements: Placement[],
  changes: ProposalChange[],
): Placement[];

// ---------------------------------------------------------------------------
// 確定（ConfirmedSnapshot）とコメント
// ---------------------------------------------------------------------------

/**
 * 確定時点のスナップショット（summary に保存する形）。
 * 「確定済み」と言えるのは confirmedRevision ＝ 現在の room.revision のときだけ。
 * 編集で revision が進んだら自動的に「未確定」扱いにする。確定のみでは revision を増やさない。
 */
export interface ConfirmedSnapshot {
  snapshot: RoomSnapshot;
  validation: ValidationResult;
  confirmedRevision: number;
  confirmedAt: Timestamp;
}

/** rooms/{roomId}/summary/main のドキュメント形状 */
export type SummaryDoc = ConfirmedSnapshot;

/**
 * ケアマネのコメント1件（rooms/{roomId}/comments/{commentId}）。
 * 作成は careManager のみ。本文は1〜1,000字。更新・削除・返信・通知は MVP 外。
 * コメントの作成は計算入力の revision を増やさない。
 */
export interface RoomComment {
  id: string;
  /** 認証 UID */
  authorUid: string;
  body: string;
  /** サーバー時刻 */
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// 共通部品の props 型（Issue 14。外観は Issue 13 側、ロジックは Issue 14）
// ---------------------------------------------------------------------------

/** プランの確定・代替案の適用を担う操作部品の props */
export interface PlanActionsProps {
  snapshot: RoomSnapshot;
  validation: ValidationResult;
  proposals: Proposal[];
  /** summary.confirmedRevision ＝ snapshot.revision のときだけ true */
  confirmed: boolean;
  /** 入力の更新と確定ができるのは family のみ */
  canEdit: boolean;
  onApplyProposal: (proposal: Proposal) => void | Promise<void>;
  onConfirm: () => void | Promise<void>;
  /** ルームID（まとめシート画面への導線などで使用） */
  roomId?: string;
  /** 成功通知（緑バナー）の表示を抑制するかどうか（親コンポーネント側で通知を管理する場合に使用） */
  suppressSuccessNotice?: boolean;
}

/** ケアマネコメントの表示・投稿部品の props */
export interface CommentPanelProps {
  comments: RoomComment[];
  /** コメントを作成できるのは careManager のみ */
  canComment: boolean;
  onSubmitComment: (body: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// コンテンツ（data/columns.json）と場面 ID（Issue 9・13）
// ---------------------------------------------------------------------------

/**
 * 場面 ID（5種に固定）。ValidationResult から判定する。
 * null の検査項目は未判定として扱い、対応するコラムは出さない。
 */
export type SceneId =
  | "overLimit" // overUnits > 0
  | "careGap" // gaps が非空
  | "caregiverOverload" // overloads が非空
  | "hardViolation" // hardViolations が非空
  | "validationUnavailable"; // validationErrors が非空

/** 決めることリストの項目 */
export interface DecisionContent {
  type: "decision";
  id: string;
  title: string;
  body: string;
}

/** 場面連動コラム */
export interface SceneColumnContent {
  type: "column";
  id: string;
  title: string;
  body: string;
  sceneId: SceneId;
}

/** サービスの説明（サービスパレットと配置の詳細から読めるようにする） */
export interface ServiceContent {
  type: "service";
  id: string;
  title: string;
  body: string;
  kind: PlacementKind;
  serviceId?: string;
}

/** data/columns.json の項目（union） */
export type ColumnContent = DecisionContent | SceneColumnContent | ServiceContent;

// ---------------------------------------------------------------------------
// Firestore のコレクションパスとドキュメント形状（Issue 2 が実装に使う）
// ---------------------------------------------------------------------------

/**
 * コレクション構成は rooms/{roomId} 配下のサブコレクションに統一する。
 * constraints と summary は1ルーム1件のため固定ドキュメントID `main` を使う。
 * invites と rateLimits はサーバー専用（Client からの read/write はルールで全面禁止）。
 */
export const firestorePaths = {
  room: (roomId: string) => `rooms/${roomId}`,
  people: (roomId: string) => `rooms/${roomId}/people`,
  person: (roomId: string, personId: string) => `rooms/${roomId}/people/${personId}`,
  members: (roomId: string) => `rooms/${roomId}/members`,
  member: (roomId: string, uid: string) => `rooms/${roomId}/members/${uid}`,
  placements: (roomId: string) => `rooms/${roomId}/placements`,
  placement: (roomId: string, placementId: string) =>
    `rooms/${roomId}/placements/${placementId}`,
  constraints: (roomId: string) => `rooms/${roomId}/constraints/main`,
  comments: (roomId: string) => `rooms/${roomId}/comments`,
  comment: (roomId: string, commentId: string) => `rooms/${roomId}/comments/${commentId}`,
  summary: (roomId: string) => `rooms/${roomId}/summary/main`,
  invites: (roomId: string) => `rooms/${roomId}/invites`,
  rateLimits: (roomId: string) => `rooms/${roomId}/rateLimits`,
} as const;

/** rooms/{roomId} 本体のドキュメント形状 */
export interface RoomDoc {
  /** ルーム作成者の認証 UID。変更不可 */
  creatorUid: string;
  /** デモ用ルームかどうか。一般 Client による変更不可 */
  isDemo: boolean;
  /** 入力の版番号。単調増加（リセットでも0に戻さない） */
  revision: number;
  careWindows: CareWindow[];
  careLevel: 3;
  copayRate: CopayRate;
  createdAt: Timestamp;
}

/** rooms/{roomId}/people/{personId} のドキュメント形状（Person そのもの） */
export type PersonDoc = Person;

/** rooms/{roomId}/members/{uid} のドキュメント形状。作れるのはサーバーだけ */
export interface MemberDoc {
  role: MemberRole;
  createdAt: Timestamp;
}

/** rooms/{roomId}/placements/{placementId} のドキュメント形状（Placement そのもの） */
export type PlacementDoc = Placement;

/** rooms/{roomId}/constraints/main のドキュメント形状（RoomConstraints そのもの） */
export type ConstraintsDoc = RoomConstraints;

/** rooms/{roomId}/comments/{commentId} のドキュメント形状（RoomComment そのもの） */
export type CommentDoc = RoomComment;

/**
 * 招待トークンの保存値（サーバー専用。ドキュメントIDはトークンのハッシュ）。
 * 参加時はこの保存値だけを検証・採用し、リクエストで送られた role は採用しない。
 * トークンは128bit以上のランダム値・有効24時間・1回のみ使用。
 */
export interface InviteDoc {
  role: MemberRole;
  expiresAt: Timestamp;
  /** 使用済みの時刻。未使用なら null */
  usedAt: Timestamp | null;
  createdAt: Timestamp;
}

/**
 * Gemini 呼び出し回数枠のカウンター（サーバー専用。ドキュメントIDは時間枠）。
 * 呼び出し前に transaction で予約し、処理失敗も1回に数える。Client の更新は禁止。
 */
export interface RateLimitDoc {
  count: number;
  windowStart: Timestamp;
}
