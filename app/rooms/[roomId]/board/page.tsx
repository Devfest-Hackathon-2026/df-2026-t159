import BoardClient from "./BoardClient";
import type { BoardService } from "@/lib/board";
import { demoFixture } from "@/lib/demo-fixture";
import { unitsMaster } from "@/lib/units";

/**
 * ボード画面への接続（サーバー側で組み立てて BoardClient へ渡す）：
 * - services：単位数マスター（data/units.json／lib/units.ts）の全サービスを
 *   パレット・追加フォーム用に変換する。家族の付き添いはサービスではないため除く
 * - demoPlacements：デモ fixture の「揉めるプラン」の配置。BoardClient は
 *   デモルーム（isDemo）のときだけ読み込みボタンを表示するため、常時渡してよい
 */
const boardServices: BoardService[] = unitsMaster.flatMap((service) =>
  service.kind === "family"
    ? []
    : [
        {
          serviceId: service.serviceId,
          title: service.name,
          kind: service.kind,
        },
      ],
);

export default async function BoardPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <BoardClient
      key={roomId}
      roomId={roomId}
      services={boardServices}
      demoPlacements={demoFixture.troubledPlan.placements}
    />
  );
}
