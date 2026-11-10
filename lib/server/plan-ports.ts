/**
 * Issue 14 の Route Handler が使う PlanPorts の組み立て（サーバー専用）。
 *
 * - auth／membership: Issue 7 本接続（lib/server/ports.ts）の実装をそのまま使う
 *   （Firebase Admin SDK の verifyIdToken／members の保存値の role）
 * - store: lib/server/plan-store.ts の Admin SDK 実装
 *   （適用・確定は transaction 方式、コメントはサーバー時刻で保存）
 */

import type { PlanPorts } from "../plan/ports";
import { createAdminPlanStore } from "./plan-store";
import { createServerPorts } from "./ports";

export function createPlanPorts(): PlanPorts {
  const server = createServerPorts();
  return {
    auth: server.auth,
    membership: server.membership,
    store: createAdminPlanStore(),
  };
}
