/**
 * 家族（people）と区分（careRole）に関する共通ロジック（Issue #71, #72）。
 */

import type { CareRole, Constraint, Person, Placement } from "./types";

/** 3区分の表示用ラベル */
export const CARE_ROLE_LABELS: Record<CareRole, string> = {
  recipient: "介護を受ける人",
  caregiver: "付き添いができる家族",
  family: "付き添いはできない家族",
};

/** 3区分の短縮ラベル（セレクトボックスやバッジ用） */
export const CARE_ROLE_SHORT_LABELS: Record<CareRole, string> = {
  recipient: "介護を受ける人",
  caregiver: "付き添いができる",
  family: "付き添いはできない",
};

/** 家族の登録・編集で選べる絵文字アイコン候補（肌色や特徴で互いに判別しやすい12個程度） */
export const PERSON_ICON_OPTIONS = [
  "👴🏻", // おじいさん（明るい肌色）
  "👵🏼", // おばあさん（中間肌色）
  "👨🏽", // 成人男性（健康的な肌色）
  "👩🏻", // 成人女性（明るい肌色）
  "🧔🏻", // ひげの男性
  "👩‍🦱", // カールヘアの女性
  "👨‍🦳", // 白髪の男性
  "👩‍🦳", // 白髪の女性
  "👦🏼", // 男の子
  "👧🏽", // 女の子
  "🧑🏾", // 落ち着いた肌色
  "👶🏻", // 赤ちゃん
] as const;

/**
 * 家族のアバター表示文字列を返す。
 * アイコンが設定されていればそのアイコン、未設定なら名前の先頭1文字。
 */
export function getPersonAvatarText(person: Pick<Person, "name" | "icon">): string {
  const icon = person.icon?.trim();
  if (icon) return icon;
  return person.name.trim().slice(0, 1);
}

/**
 * 既存データ互換の区分導出規則（Issue #72）。
 * 区分フィールド（careRole）が無い既存の人について以下のようにみなす：
 * - 既に careRole がある場合はそれを採用
 * - canProvideCare === true -> "caregiver"
 * - canProvideCare === false ->
 *   - 全体の中で canProvideCare === false かつ careRole !== "caregiver" の人が1人だけなら "recipient"
 *   - 複数いる場合は、その中で先頭（最初の1人）なら "recipient"、残りは "family"
 */
export function deriveCareRole(person: Person, allPeople?: Person[]): CareRole {
  if (person.careRole) {
    return person.careRole;
  }
  if (person.canProvideCare) {
    return "caregiver";
  }
  // canProvideCare === false の場合
  if (!allPeople || allPeople.length === 0) {
    return "recipient";
  }

  const nonCaregivers = allPeople.filter((p) => {
    if (p.careRole) return p.careRole !== "caregiver";
    return !p.canProvideCare;
  });

  if (nonCaregivers.length <= 1) {
    return "recipient";
  }

  return person.id === nonCaregivers[0].id ? "recipient" : "family";
}

/**
 * 人のリストを受け取り、未指定の careRole を補完し、canProvideCare を careRole から導出した配列を返す。
 * canProvideCare は caregiver のみ true。
 */
export function normalizePeople(people: Person[]): Person[] {
  return people.map((p) => {
    const role = deriveCareRole(p, people);
    const trimmedIcon = p.icon?.trim();
    const next: Person = {
      ...p,
      careRole: role,
      canProvideCare: role === "caregiver",
    };
    if (trimmedIcon) {
      next.icon = trimmedIcon;
    } else {
      delete next.icon;
    }
    return next;
  });
}

/**
 * 人の区分制約を検証する（Issue #72）。
 * - 被介護者（recipient）はちょうど1人必須
 * - 付き添いができる家族（caregiver）は1人以上必須
 * - 各人の名前は空文字（空白のみ含む）不可
 */
export function validatePeopleCareRoles(people: Person[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const normalized = normalizePeople(people);

  let recipientCount = 0;
  let caregiverCount = 0;

  for (const p of normalized) {
    if (!p.name || p.name.trim().length === 0) {
      errors.push("名前が入力されていない家族がいます。");
      break;
    }
  }

  for (const p of normalized) {
    if (p.careRole === "recipient") {
      recipientCount++;
    } else if (p.careRole === "caregiver") {
      caregiverCount++;
    }
  }

  if (recipientCount === 0) {
    errors.push("介護を受ける人を1人指定してください。");
  } else if (recipientCount > 1) {
    errors.push("介護を受ける人は1人だけにしてください。");
  }

  if (caregiverCount === 0) {
    errors.push("付き添いができる家族を1人以上指定してください。");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 家族を削除可能かどうかを判定する削除ガード（Issue #71）。
 * その人への配置・条件が1件も無い場合だけ削除を許可する。
 */
export function canDeletePerson(
  personId: string,
  placements: Placement[],
  constraints: Constraint[],
): { canDelete: boolean; reason?: string } {
  const placementCount = placements.filter((p) => p.personId === personId).length;
  const constraintCount = constraints.filter((c) => c.personId === personId).length;

  if (placementCount > 0 && constraintCount > 0) {
    return {
      canDelete: false,
      reason: `週間ボードに${placementCount}件の配置、および${constraintCount}件の条件があるため削除できません。先に週間ボードの配置や条件を削除してください。`,
    };
  }
  if (placementCount > 0) {
    return {
      canDelete: false,
      reason: `週間ボードに${placementCount}件の配置があるため削除できません。先に週間ボードの配置を削除してください。`,
    };
  }
  if (constraintCount > 0) {
    return {
      canDelete: false,
      reason: `${constraintCount}件の条件が設定されているため削除できません。先に家族の条件を削除してください。`,
    };
  }

  return { canDelete: true };
}

/**
 * 人の表示用ラベル（3区分）を取得する。
 */
export function getPersonRoleLabel(person: Person, short = false): string {
  const role = deriveCareRole(person);
  return short ? CARE_ROLE_SHORT_LABELS[role] : CARE_ROLE_LABELS[role];
}
