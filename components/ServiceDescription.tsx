"use client";

/**
 * サービス説明の表示部品（Issue 13）。
 *
 * 入力：data/columns.json の service 項目（4サービス＋家族の付き添い）。
 * 仕様（carepact_issues.md Issue 13）：
 * - サービスパレットと配置の詳細から読める形にする
 * - 4サービス＋家族の付き添いの各役割と特徴を解説する
 */

import { useState } from "react";
import {
  columnsData,
  findServiceContent,
  getServiceContents,
  REQUIRED_SERVICE_KINDS,
  SERVICE_KIND_LABELS,
  SERVICE_KIND_STYLES,
} from "@/lib/columns";
import type { ColumnContent, PlacementKind, ServiceContent } from "@/lib/types";

export interface ServiceDescriptionProps {
  /** 対象サービス種別（指定時はそのサービスのみ、未指定時は全サービス） */
  kind?: PlacementKind;
  /** 対象 serviceId（指定時は完全一致を優先検索） */
  serviceId?: string;
  /** 表示モード：'card'（単体カード）, 'compact'（配置詳細やパレット用インライン）, 'list'（一覧） */
  variant?: "card" | "compact" | "list";
  services?: ServiceContent[];
  columns?: ColumnContent[];
  className?: string;
}

export default function ServiceDescription({
  kind,
  serviceId,
  variant = "list",
  services,
  columns = columnsData,
  className = "",
}: ServiceDescriptionProps) {
  const allServices = services ?? getServiceContents(columns);
  const [activeFilterKind, setActiveFilterKind] = useState<string>("all");

  // 単体指定（kind または serviceId）がある場合
  if (kind || serviceId) {
    const service = kind ? findServiceContent(allServices, kind, serviceId)
      : allServices.find(s => s.serviceId === serviceId);

    if (!service) {
      return (
        <div className={`text-xs text-neutral-400 ${className}`}>
          サービス説明が見つかりません。
        </div>
      );
    }

    const badgeStyle = SERVICE_KIND_STYLES[service.kind] ?? "bg-neutral-100 text-neutral-800";
    const kindLabel = SERVICE_KIND_LABELS[service.kind] ?? service.kind;

    if (variant === "compact") {
      return (
        <div
          role="note"
          aria-label={`サービス説明：${service.title}`}
          className={`rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 text-xs ${className}`}
        >
          <div className="flex items-center gap-2 font-semibold text-neutral-900">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${badgeStyle}`}
            >
              {kindLabel}
            </span>
            <span>{service.title}</span>
          </div>
          <p className="mt-1.5 leading-relaxed text-neutral-600 whitespace-pre-line">
            {service.body}
          </p>
        </div>
      );
    }

    // variant === 'card'
    return (
      <article
        aria-labelledby={`svc-${service.id}`}
        className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-xs ${className}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-bold ${badgeStyle}`}
          >
            {kindLabel}
          </span>
          {service.serviceId && (
            <span className="font-mono text-[11px] text-neutral-400">
              ID: {service.serviceId}
            </span>
          )}
        </div>
        <h3
          id={`svc-${service.id}`}
          className="mt-2 text-base font-bold text-neutral-900"
        >
          {service.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700 whitespace-pre-line">
          {service.body}
        </p>
      </article>
    );
  }

  // variant === 'list'（全サービス一覧モード）
  const displayedServices =
    activeFilterKind === "all"
      ? allServices
      : allServices.filter((s) => s.kind === activeFilterKind);

  return (
    <div className={`space-y-5 ${className}`} role="region" aria-label="サービス説明一覧">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">
            サービス説明（{allServices.length}件）
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            介護保険の基本4サービス（訪問介護・通所介護・通所リハビリ・ショートステイ）と家族の付き添いの特徴を解説します。
          </p>
        </div>

        {/* フィルター切り替えタブ */}
        <div className="flex flex-wrap gap-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveFilterKind("all")}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              activeFilterKind === "all"
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            すべて（{allServices.length}）
          </button>
          {REQUIRED_SERVICE_KINDS.map((k) => {
            const isCurrent = activeFilterKind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setActiveFilterKind(k)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  isCurrent
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {SERVICE_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {displayedServices.map((service) => {
          const badgeStyle =
            SERVICE_KIND_STYLES[service.kind] ?? "bg-neutral-100 text-neutral-800";
          const kindLabel = SERVICE_KIND_LABELS[service.kind] ?? service.kind;

          return (
            <article
              key={service.id}
              aria-labelledby={`svc-card-${service.id}`}
              className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-bold ${badgeStyle}`}
                  >
                    {kindLabel}
                  </span>
                  {service.serviceId && (
                    <span className="font-mono text-[10px] text-neutral-400">
                      {service.serviceId}
                    </span>
                  )}
                </div>
                <h3
                  id={`svc-card-${service.id}`}
                  className="mt-3 text-base font-bold text-neutral-900"
                >
                  {service.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600 whitespace-pre-line">
                  {service.body}
                </p>
              </div>

              <div className="mt-4 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
                {service.kind === "family"
                  ? "※ 公的介護保険の枠外（時間のみ集計）"
                  : "※ 介護保険給付対象（要介護3の基本単位）"}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
