"use client";

/**
 * 場面連動コラムの表示部品（Issue 13）。
 *
 * 入力：ValidationResult と SceneId（または columns.json）。
 * 仕様（carepact_issues.md Issue 13）：
 * - 枠オーバーのとき overLimit
 * - 空白があるとき careGap
 * - 過労のとき caregiverOverload
 * - hardViolations があるとき hardViolation
 * - validationErrors があるとき validationUnavailable
 * - 枠オーバー警告の横、空白検出の横などに置ける Notice 部品と、一覧表示部品を提供する
 */

import {
  columnsData,
  determineActiveScenes,
  findSceneColumn,
  getActiveSceneColumns,
  getSceneColumns,
  isSceneActive,
  SCENE_LABELS,
  SCENE_STYLES,
} from "@/lib/columns";
import type {
  ColumnContent,
  SceneColumnContent,
  SceneId,
  ValidationResult,
} from "@/lib/types";

/** 単一コラムカードの Props */
export interface SceneColumnCardProps {
  column: SceneColumnContent;
  isActive?: boolean | null;
  className?: string;
}

/** 単一コラムのカード表示部品 */
export function SceneColumnCard({
  column,
  isActive = true,
  className = "",
}: SceneColumnCardProps) {
  const style = SCENE_STYLES[column.sceneId];
  const sceneLabel = SCENE_LABELS[column.sceneId];

  return (
    <article
      aria-labelledby={`col-title-${column.id}`}
      className={`rounded-xl border ${style.border} ${style.bg} p-5 shadow-xs transition-all ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">
            {style.icon}
          </span>
          <span className="rounded-md bg-white/80 px-2 py-0.5 text-xs font-bold text-neutral-800 shadow-2xs">
            {style.badge}
          </span>
          <span className="text-xs text-neutral-500">（{sceneLabel}）</span>
        </div>
        {isActive ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            現在該当
          </span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
            {isActive === null ? "未判定" : "未検出"}
          </span>
        )}
      </div>

      <h3
        id={`col-title-${column.id}`}
        className={`mt-3 font-bold text-base ${style.text}`}
      >
        {column.title}
      </h3>

      <div className="mt-2.5 rounded-lg bg-white/80 p-3.5 text-sm leading-relaxed text-neutral-800 shadow-2xs">
        <p className="whitespace-pre-line">{column.body}</p>
      </div>
    </article>
  );
}

/** 警告やボードの各セクション横に添えて置く小Notice部品の Props */
export interface SceneColumnNoticeProps {
  sceneId: SceneId;
  validation?: ValidationResult;
  column?: SceneColumnContent;
  columns?: ColumnContent[];
  className?: string;
  forceShow?: boolean;
}

/** 警告やボードの各セクション横に添えて置く小Notice部品 */
export function SceneColumnNotice({
  sceneId,
  validation,
  column,
  columns = columnsData,
  className = "",
  forceShow = false,
}: SceneColumnNoticeProps) {
  // validation が渡されている場合、該当場面が非アクティブなら非表示（forceShow を除く）
  if (!forceShow && (!validation || !isSceneActive(validation, sceneId))) {
    return null;
  }

  const col = column ?? findSceneColumn(columns, sceneId);
  if (!col) return null;

  const style = SCENE_STYLES[sceneId];

  return (
    <aside
      role="note"
      aria-label={`コラム：${col.title}`}
      className={`rounded-lg border ${style.border} ${style.bg} p-4 text-xs ${className}`}
    >
      <div className="flex items-center gap-1.5 font-bold text-neutral-900">
        <span aria-hidden="true">{style.icon}</span>
        <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-neutral-700">
          解消のヒント
        </span>
        <span className="truncate">{col.title}</span>
      </div>
      <p className="mt-2 leading-relaxed text-neutral-700 whitespace-pre-line">
        {col.body}
      </p>
    </aside>
  );
}

/** 場面連動コラム一覧部品の Props */
export interface SceneColumnListProps {
  validation: ValidationResult | null;
  columns?: ColumnContent[];
  /** true のときは未検出のコラムも一覧に含める */
  showAll?: boolean;
  className?: string;
}

/**
 * ValidationResult に応じて現在アクティブな場面のコラムを表示する一覧部品。
 */
export default function SceneColumnList({
  validation,
  columns = columnsData,
  showAll = false,
  className = "",
}: SceneColumnListProps) {
  const activeScenes = new Set(validation ? determineActiveScenes(validation) : []);
  const allSceneColumns = getSceneColumns(columns);
  const activeColumns = validation ? getActiveSceneColumns(columns, validation) : [];

  const displayColumns = showAll ? allSceneColumns : activeColumns;

  return (
    <div className={`space-y-4 ${className}`} role="region" aria-label="場面連動コラム">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">場面連動コラム</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            枠の超過・介護の空白・負担の集中などに応じて、見直しのヒントを表示します。
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          該当場面:{" "}
          <span className="font-bold text-neutral-800">
            {validation ? `${activeScenes.size} / 5` : "未判定"}
          </span>
        </div>
      </div>

      {displayColumns.length === 0 ? (
        <div
          role="status"
          className={`rounded-xl border p-6 text-center ${validation?.ok ? "border-emerald-200 bg-emerald-50/70 text-emerald-900" : "border-neutral-200 bg-neutral-50 text-neutral-700"}`}
        >
          <div className="text-2xl" aria-hidden="true">
            {validation?.ok ? "✓" : "?"}
          </div>
          <h3 className="mt-2 font-bold text-base">
            {validation?.ok ? "現在、警告はありません" : "現在は未判定です"}
          </h3>
          <p className="mt-1 text-xs text-emerald-700">
            {validation?.ok ? "対応ルール内で検証済みです。" : "結果を取得するまで、コラムは表示しません。"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {displayColumns.map((col) => (
            <SceneColumnCard
              key={col.id}
              column={col}
              isActive={validation ? activeScenes.has(col.sceneId) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
