/**
 * サービス説明の正本は data/columns.json（Issue 9 の文面）。
 * このモジュールは、そのうち type="service" の項目だけを取り出し、
 * 配置の種別（PlacementKind）やサービスIDから引けるようにする。
 * 対応付けのルールは lib/types.ts の ServiceContent 型に従う：
 * serviceId が設定されている項目は serviceId を優先し、無ければ kind で引く。
 */
import columnsData from "@/data/columns.json";
import type { ColumnContent, PlacementKind, ServiceContent } from "./types";

const contents = columnsData as unknown as ColumnContent[];

/** columns.json の service 項目すべて（パレットと配置フォームの説明用） */
export const SERVICE_CONTENTS: ServiceContent[] = contents.filter(
  (content): content is ServiceContent => content.type === "service",
);

/** 種別（と任意でサービスID）に対応するサービス説明を返す。無ければ undefined。 */
export function serviceContentFor(kind: PlacementKind, serviceId?: string): ServiceContent | undefined {
  if (serviceId) {
    const byServiceId = SERVICE_CONTENTS.find(content => content.serviceId === serviceId);
    if (byServiceId) return byServiceId;
  }
  return SERVICE_CONTENTS.find(content => content.kind === kind);
}

/** パレット用の短い説明（本文の1行目）。 */
export function serviceShortDescription(kind: PlacementKind): string | undefined {
  return serviceContentFor(kind)?.body.split("\n")[0];
}
