/**
 * デモ用 fixture（Issue 10 の下書き）。
 *
 * 正本データは data/demo-fixture.json。デモを一本の物語として流すための
 * サンプル家族・初期配置・期待値・固定の変更リスト・デモ用書類の一式。
 * すべて架空データ（佐藤家は実在しない家族設定）。文章と数値はこのファイルの
 * ために新規に作成したもので、実在の人物・医療機関の情報は含まない。
 *
 * 構成（仕様 Issue 10 の「fixture は一式で納品する」に対応）：
 * - people／constraints／hopes／unknowns／careWindows／copayRate：ルームの初期入力
 * - troubledPlan：デモで最初に読み込む「揉めるプラン」と、その期待する検証結果
 * - acceptedPlan：固定 changes を適用した後の「納得プラン」と、その期待する検証結果
 * - fixedProposal：揉めるプラン→納得プランへ変換する固定の変更リスト（正規化済み）
 * - documents：入力デモ用の退院サマリー風テキストと家族メモ
 * - masterVersion：期待値の算出に使った単位数マスター（data/units.json）の版
 *
 * 配置の ID はすべて固定の文字列（demo- プレフィックス）。デモモードの代替案
 * （Issue 15）と対応づけるため、crypto.randomUUID() は使わない。
 *
 * unknowns が空なのは、fixture が「入力画面で家族が構造化結果を確認・確定した直後」
 * の状態を表すため（確定の条件＝ unknowns が空、にそのまま進めるようにする）。
 * 実AIで構造化した直後の下書きでは unknowns が出ることがあるが、それは Issue 7 の
 * 確認画面で解消してから保存する前提。
 */

import fixtureData from "../data/demo-fixture.json";
import type {
  CareWindow,
  Constraint,
  CopayRate,
  Person,
  Placement,
  ProposalChange,
  ValidationResult,
} from "./types";

/** デモ用書類のサンプル文章（Gemini 構造化の入力サンプルとして使う） */
export interface DemoDocuments {
  /** 退院サマリー風の書類テキスト（架空） */
  dischargeSummary: string;
  /** 家族の事情メモ（架空） */
  familyMemo: string;
}

/** 家族設定の説明（fixture 専用のメタ情報。Person 型には含めない） */
export interface DemoFamilyProfile {
  familyName: string;
  note: string;
  members: { personId: string; profile: string }[];
}

/** 1プラン分（配置と、その期待する検証結果） */
export interface DemoPlan {
  placements: Placement[];
  expectedValidationResult: ValidationResult;
}

/**
 * デモ用 fixture 一式。
 * fixedProposal は Proposal から baseRevision を除いた形。baseRevision は
 * 実行時に取得したスナップショットの revision を Issue 15 側が付ける
 * （fixture 側で固定しない。共通前提の正規化契約どおり）。
 */
export interface DemoFixture {
  fixtureVersion: string;
  /** 期待値の算出に使った単位数マスターの版（data/units.json 側の版と対応させる） */
  masterVersion: string;
  familyProfile: DemoFamilyProfile;
  people: Person[];
  constraints: Constraint[];
  hopes: string[];
  unknowns: string[];
  careWindows: CareWindow[];
  copayRate: CopayRate;
  documents: DemoDocuments;
  /** 「揉めるプラン」：枠オーバー・水曜昼の空白・長女への負担集中を含む */
  troubledPlan: DemoPlan;
  /** 「納得プラン」：全判定が合格（ok=true）になる配置 */
  acceptedPlan: DemoPlan;
  /** 揉めるプラン→納得プランの固定の変更リスト（正規化済み） */
  fixedProposal: {
    summary: string;
    changes: ProposalChange[];
  };
}

/** デモ用 fixture 一式（data/demo-fixture.json の内容） */
export const demoFixture = fixtureData as unknown as DemoFixture;

/** fixture の版（Issue 15 の照合で使う fixtureVersion の参照用） */
export const DEMO_FIXTURE_VERSION = demoFixture.fixtureVersion;
