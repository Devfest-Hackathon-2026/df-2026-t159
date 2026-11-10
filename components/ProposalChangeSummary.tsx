import type { Person, ValidationResult } from "@/lib/types";

interface ProposalChangeSummaryProps {
  people: Person[];
  current: ValidationResult;
  proposed?: ValidationResult;
}

function formatValue(value: number | null | undefined, unit: string) {
  return value == null ? "未判定" : `${value.toLocaleString("ja-JP")} ${unit}`;
}

function ComparisonRow({
  label,
  before,
  after,
  unit,
}: {
  label: string;
  before: number | null | undefined;
  after: number | null | undefined;
  unit: string;
}) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <dt className="text-neutral-600">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span>{formatValue(before, unit)}</span>
        <span aria-label="から" className="text-neutral-400">→</span>
        <span className="font-bold text-neutral-900">{formatValue(after, unit)}</span>
      </dd>
    </div>
  );
}

/** 既存の検証結果を表示するだけ。配置からの再計算は行わない。 */
export default function ProposalChangeSummary({
  people,
  current,
  proposed,
}: ProposalChangeSummaryProps) {
  if (!proposed) {
    return (
      <div className="mt-4 rounded-lg bg-neutral-50 p-4 text-sm">
        <h4 className="font-bold text-neutral-900">変更の要約</h4>
        <p className="mt-2 text-neutral-600">
          検証結果がないため未判定です。代替案を再取得してください。
        </p>
      </div>
    );
  }

  const changedPeople = people
    .filter((person) => person.canProvideCare)
    .map((person) => ({
      person,
      before: current.memberHours.find((member) => member.personId === person.id)?.hours,
      after: proposed.memberHours.find((member) => member.personId === person.id)?.hours,
    }))
    .filter(({ before, after }) => before == null || after == null || before !== after);

  return (
    <div className="mt-4 rounded-lg border border-neutral-100 bg-neutral-50 p-4 text-sm">
      <h4 className="font-bold text-neutral-900">変更の要約</h4>
      <p className="mt-1 text-xs text-neutral-500">今のプラン → この代替案</p>
      <dl className="mt-2 divide-y divide-neutral-200">
        <ComparisonRow
          label="月換算単位"
          before={current.monthlyUnits}
          after={proposed.monthlyUnits}
          unit="単位"
        />
        <ComparisonRow
          label="月次自己負担（概算）"
          before={current.selfPayYen}
          after={proposed.selfPayYen}
          unit="円"
        />
        {changedPeople.map(({ person, before, after }) => (
          <ComparisonRow
            key={person.id}
            label={`${person.name}の付き添い`}
            before={before}
            after={after}
            unit="時間/週"
          />
        ))}
      </dl>
      {changedPeople.length === 0 && (
        <p className="mt-2 text-xs text-neutral-600">家族の付き添い時間に変更はありません。</p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        月換算単位・自己負担は概算であり実際の請求額ではありません。食費・居住費・各種加算は含みません。
      </p>
    </div>
  );
}
