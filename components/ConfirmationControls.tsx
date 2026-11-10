"use client";

import { confirmBlockReasons } from "@/lib/plan/logic";
import type { RoomSnapshot, ValidationResult } from "@/lib/types";

interface ConfirmationInput {
  snapshot: RoomSnapshot;
  validation: ValidationResult | null;
  canEdit: boolean;
}

export function ConfirmPlanButton({ snapshot, validation, canEdit, busy, unavailable = false, onConfirm, describedBy }: ConfirmationInput & {
  busy: boolean; unavailable?: boolean; onConfirm: () => void; describedBy?: string;
}) {
  const blocked = !canEdit || !validation || confirmBlockReasons(snapshot, validation).length > 0;
  return (
    <button type="button" disabled={blocked || busy || unavailable} aria-busy={busy}
      aria-describedby={blocked ? describedBy : undefined} onClick={onConfirm}
      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-neutral-300 transition-colors">
      このプランで確定する
    </button>
  );
}

export function ConfirmationBlockers({ snapshot, validation, canEdit, id }: ConfirmationInput & { roomId?: string; id?: string }) {
  const reasons = validation ? confirmBlockReasons(snapshot, validation) : [];
  if (canEdit && validation && reasons.length === 0) return null;
  return (
    <div id={id} className="space-y-2 rounded-lg border border-amber-200/80 bg-amber-50 p-3 text-xs text-amber-900">
      {!validation && <p>検証中です。最新の検証結果を確認してから確定できます。</p>}
      {reasons.includes("validation_not_ok") && <p>⚠️ 問題があるため確定できません（枠・空白・負担・違反を確認してください）。</p>}
      {reasons.includes("validation_errors") && <p>計算・判定できない項目が残っています。入力内容や設定を確認してください。</p>}
      {snapshot.unknowns.length > 0 && <div>
        <p className="font-bold">未確認事項が残っているため、まだ確定できません。</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">{snapshot.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}</ul>
      </div>}
      {!canEdit && <p>※ プランを確定できるのは家族だけです（ケアマネは閲覧・コメントのみ）。</p>}
    </div>
  );
}
