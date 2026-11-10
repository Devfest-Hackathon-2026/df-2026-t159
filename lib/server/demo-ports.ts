/**
 * デモ機能の Route Handler が使う DemoPorts の組み立て（サーバー専用。Issue 15）。
 *
 * - auth／membership: Issue 7 本接続（lib/server/ports.ts）の実装を共有
 * - validation: Issue 6 の検証エンジン（validateRoom）を共有
 * - store: lib/server/demo-store.ts の Admin SDK 実装
 */

import type { DemoPorts } from "../demo/ports";
import { createAdminDemoStore } from "./demo-store";
import { createServerPorts } from "./ports";

export function createDemoPorts(): DemoPorts {
  const server = createServerPorts();
  return {
    auth: server.auth,
    membership: server.membership,
    store: createAdminDemoStore(),
    validation: server.validation,
  };
}
