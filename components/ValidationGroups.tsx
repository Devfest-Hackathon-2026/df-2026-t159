import type { ReactNode } from "react";

const GROUPS = [
  { key: "overLimit", title: "介護保険の上限" },
  { key: "careGap", title: "空白（介護が必要な時間の空き）" },
  { key: "caregiverOverload", title: "付き添いの負担" },
  { key: "hardViolation", title: "ルール違反" },
  // 判定不能は違反と混ぜず、4分類の後に別枠で残す。
  { key: "validationUnavailable", title: "未判定・不備" },
] as const;

export type ValidationGroup = (typeof GROUPS)[number]["key"];

/** 検証済みの注意点を表示上の種類で並べる。判定・文言は呼び出し側のまま。 */
export default function ValidationGroups<T extends { group: ValidationGroup }>({
  issues,
  renderIssues,
  headingLevel = 3,
}: {
  issues: T[];
  renderIssues: (issues: T[]) => ReactNode;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="space-y-4">
      {GROUPS.map(({ key, title }) => {
        const items = issues.filter(issue => issue.group === key);
        if (items.length === 0) return null;
        return (
          <section key={key} aria-label={title} className="space-y-2">
            <Heading className="text-xs font-bold text-neutral-800">{title}</Heading>
            {renderIssues(items)}
          </section>
        );
      })}
    </div>
  );
}
