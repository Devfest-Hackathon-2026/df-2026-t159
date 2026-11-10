/**
 * Gemini 代替案（Issue 8）のプロンプト構築（純粋関数）。
 *
 * 入力は整合スナップショットと検証結果（NG理由）。
 * 単位数の計算・判定は AI にさせない（再計算と判定は検証エンジン＝Issue 6 が担う）。
 */

import type { RoomSnapshot, ValidationResult } from "../types";

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** 検証結果から「何がNGか」の箇条書きを作る（プロンプトと表示で共有する） */
export function describeValidationProblems(
  validation: ValidationResult,
): string[] {
  const problems: string[] = [];
  if (validation.overUnits !== null && validation.overUnits > 0) {
    problems.push(
      `介護保険の支給限度額を月換算で ${validation.overUnits} 単位 超えています（月換算 ${validation.monthlyUnits} 単位／限度 ${validation.limitUnits} 単位）`,
    );
  }
  for (const gap of validation.gaps) {
    problems.push(
      `介護が必要な時間に誰もいない空白があります：${DAY_LABELS[gap.day]}曜日 ${gap.startHour}時〜${gap.endHour}時`,
    );
  }
  for (const overload of validation.overloads) {
    problems.push(
      `付き添いの負担が集中しています：personId=${overload.personId} が週 ${overload.hours} 時間`,
    );
  }
  for (const violation of validation.hardViolations) {
    problems.push(
      `置き方の違反があります（${violation.type}）：${violation.detail}`,
    );
  }
  for (const error of validation.validationErrors) {
    problems.push(`計算・判定できなかった項目があります（${error.code}）：${error.reason}`);
  }
  if (validation.weeklyUnits === null && problems.length === 0) {
    problems.push("単位数を計算できていません");
  }
  return problems;
}

export function buildProposalPrompt(
  snapshot: RoomSnapshot,
  validation: ValidationResult,
): string {
  const people = snapshot.people
    .map(
      (p) =>
        `- id=${p.id} 名前=${p.name} 付き添い可否=${p.canProvideCare ? "可" : "不可（配置の対象にしない）"}`,
    )
    .join("\n");
  const placements = snapshot.placements
    .map((p) => {
      const target =
        p.kind === "family" ? `personId=${p.personId}` : `serviceId=${p.serviceId}`;
      return `- id=${p.id} ${DAY_LABELS[p.day]}曜日 ${p.startHour}時〜${p.endHour}時 kind=${p.kind} ${target}`;
    })
    .join("\n");
  const constraints = snapshot.constraints
    .map((c) => {
      const days = c.days.map((d) => DAY_LABELS[d]).join("・");
      const hours =
        c.startHour !== undefined && c.endHour !== undefined
          ? ` ${c.startHour}時〜${c.endHour}時`
          : "";
      return `- personId=${c.personId} type=${c.type} 曜日=${days || "指定なし"}${hours} 内容=${c.detail}`;
    })
    .join("\n");
  const problems = describeValidationProblems(validation)
    .map((p) => `- ${p}`)
    .join("\n");

  return [
    "あなたは、親の介護体制を決める家族の週間プランの「直し方を提案する係」です。",
    "現在のプランは検証で次の問題が見つかっています。問題を解く代替案を最大3案、指定された JSON 形式で返してください。",
    "",
    "## 守ること",
    "- 単位数の計算や金額の判定はしないこと（正しさの判定はシステム側の検証が担う）",
    "- 制約（仕事・対応不可の時間）に反する配置を作らないこと。対応不可の時間にはその家族を置かないこと",
    "- canProvideCare=false の家族を付き添い（kind=family）に使わないこと",
    "- 配置の時間は6時〜24時、1時間単位、半開区間 [startHour, endHour) で表すこと",
    "- ショートステイ（shortstay）は1日を通しての利用として扱い、時刻を細かく動かす提案はしないこと",
    "",
    "## 変更（changes）の書き方",
    "- remove: placementId だけを指定する",
    "- move: placementId と day・startHour を指定する（長さは変わらない。endHour は書かない）",
    "- resize: placementId と startHour・endHour を指定する（曜日は変わらない）",
    "- add: day・startHour・endHour・kind を指定する。kind が family のときは personId を、それ以外のときは serviceId を指定する。placementId は書かない（IDはサーバーが付ける）",
    "- kind を変えたいときは remove と add の組み合わせで表すこと",
    "- 同じ配置に対して1案の中で複数の変更を書かないこと。実在しない配置IDを使わないこと",
    "- 出力は指定スキーマの JSON のみ。前置きや説明文は付けないこと",
    "",
    "## 家族（people）",
    people || "（なし）",
    "",
    "## 現在の配置（placements）",
    placements || "（なし）",
    "",
    "## 制約（constraints）",
    constraints || "（なし）",
    "",
    `## 家族の希望`,
    snapshot.hopes.length > 0 ? snapshot.hopes.map((h) => `- ${h}`).join("\n") : "（なし）",
    "",
    "## 検証で見つかった問題",
    problems || "（なし）",
  ].join("\n");
}
