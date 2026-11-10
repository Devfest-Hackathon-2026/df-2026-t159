/**
 * Gemini 連携 API（Issue 7 構造化／Issue 8 代替案）のハンドラ本体。
 *
 * Route Handler（app/api/**）は HTTP の読み取りだけを行い、処理はここに寄せる。
 * ここは ports（ports.ts）経由でだけ外部を呼ぶため、フェイクを差して単体テストできる。
 *
 * 処理の順序とエラー（共通前提）：
 * - ID トークン検証 → 401、family 照合 → 403
 * - 入力検査（構造化）→ 400／413
 * - 回数枠は Firestore カウンターで「呼び出し前に予約」するのが実物の契約。
 *   ここでは RateLimitPort.reserve() を Gemini 呼び出しの直前に呼ぶ（超過 → 429）。
 *   実物は lib/server/ports.ts 経由で接続済み（Firestore カウンターの transaction 予約）
 * - Gemini 呼び出しは30秒でタイムアウト → 504。出力の形式不正 → 502
 * - ログにはリクエストの中身（画像・メモ・制約）を出さない。requestId と結果だけを返す
 */

import { applyChanges } from "../apply-changes";
import { RevisionConflictError, RoomNotFoundError } from "../room-change";
import {
  AiApiError,
  NotWiredError,
  aiUpstreamError,
  forbidden,
  gatewayTimeout,
  invalidAiOutput,
  rateLimited,
  revisionMismatch,
  roomNotFound,
  unauthorized,
} from "./errors";
import { GEMINI_TIMEOUT_MS, validateStructureInput, type StructureImageInput } from "./inputValidation";
import type { Proposal } from "../types";
import { NormalizeError } from "./normalizeUtil";
import type { ServerPorts } from "./ports";
import { normalizeProposals } from "./proposalNormalize";
import { buildProposalPrompt } from "./proposalPrompt";
import { proposalResponseSchema } from "./proposalSchema";
import { normalizeStructureOutput, type StructureDraftResult } from "./structureNormalize";
import { buildStructurePrompt } from "./structurePrompt";
import { structureResponseSchema } from "./structureSchema";
import { bindStructureDrafts } from "./structureSave";

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface HandlerOptions {
  /** テスト用に短くできるよう差し替え可能にする（既定は共通前提の30秒） */
  timeoutMs?: number;
}

interface ErrorBody {
  error: string;
  message: string;
  requestId: string;
}

function errorResult(status: number, code: string, message: string, requestId: string): HandlerResult {
  const body: ErrorBody = { error: code, message, requestId };
  return { status, body };
}

function toErrorResult(error: unknown, requestId: string): HandlerResult {
  if (error instanceof AiApiError) {
    return errorResult(error.status, error.code, error.message, requestId);
  }
  if (error instanceof RevisionConflictError) {
    // 保存時点までに版が進んでいた（古い下書きからの保存は拒否。共通前提）
    const wrapped = revisionMismatch();
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  if (error instanceof RoomNotFoundError) {
    const wrapped = roomNotFound();
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  if (error instanceof NormalizeError) {
    const wrapped = invalidAiOutput("AI の出力形式が不正だったため、結果を表示できません");
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  if (error instanceof NotWiredError) {
    return errorResult(
      500,
      "server_not_configured",
      "サーバー側の接続がまだ完了していません",
      requestId,
    );
  }
  return errorResult(500, "internal_error", "サーバーでエラーが発生しました", requestId);
}

/** 認証（401）と family 照合（403）を行い、uid を返す */
async function requireFamilyUid(
  ports: ServerPorts,
  idToken: string | null,
  roomId: string,
): Promise<string> {
  if (!idToken) throw unauthorized();
  const verified = await ports.auth.verifyIdToken(idToken);
  if (!verified) throw unauthorized();
  const role = await ports.membership.getRole(roomId, verified.uid);
  if (role !== "family") throw forbidden();
  return verified.uid;
}

/** タイムアウト付きで実行する。時間切れは 504、abort 由来の失敗も 504 に寄せる */
async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(gatewayTimeout());
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } catch (error) {
    if (controller.signal.aborted) throw gatewayTimeout();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Gemini 呼び出し区間の失敗を 502 に寄せる（形式不正・上流エラー） */
async function callGemini<T>(
  ports: ServerPorts,
  timeoutMs: number,
  args: Parameters<ServerPorts["gemini"]["generateJson"]>[0],
): Promise<T> {
  try {
    return (await withTimeout(timeoutMs, (signal) =>
      ports.gemini.generateJson({ ...args, signal }),
    )) as T;
  } catch (error) {
    if (error instanceof AiApiError) throw error; // 504 など
    // 原因切り分けのため、上流エラーの内容をサーバーログに残す（キー等の秘密情報は含めない）
    console.error(
      "[ai] gemini call failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
    // JSON パース失敗も含め、Gemini 側の失敗は 502 として返す
    throw aiUpstreamError();
  }
}

// ---------------------------------------------------------------------------
// Issue 7：構造化（書類画像＋事情メモ → 制約JSONの下書き）
// ---------------------------------------------------------------------------

export interface StructureHandlerInput {
  idToken: string | null;
  roomId: string;
  memo: string;
  images: StructureImageInput[];
}

export async function handleStructureRequest(
  ports: ServerPorts,
  input: StructureHandlerInput,
  options: HandlerOptions = {},
): Promise<HandlerResult> {
  const requestId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);

    // 入力検査（413／400）。回数枠は不正な入力では消費しない
    validateStructureInput({ memo: input.memo, images: input.images });

    // 回数枠の事前予約（実物は Firestore transaction。フェイクはメモリ実装）
    if (!(await ports.rateLimit.reserve(input.roomId))) {
      throw rateLimited();
    }

    const snapshot = await ports.rooms.getSnapshot(input.roomId);
    if (!snapshot) throw roomNotFound();

    let prompt = buildStructurePrompt({
      peopleNames: snapshot.people.map((p) => p.name),
      memo: input.memo,
      hasImages: input.images.length > 0,
    });
    // 上流の一時的な失敗（503 等）と出力形式の不正は、同じ入力でもう1回だけ試す。
    // 出力形式の不正（NormalizeError）の場合は、失敗理由をプロンプトに添えて1回だけ再実行する。
    // 回数枠はこのリクエストで予約した1回分のみ消費する。タイムアウトは再試行しない。
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw: unknown;
      try {
        raw = await callGemini<unknown>(ports, timeoutMs, {
          prompt,
          images: input.images.map((img) => ({
            mimeType: img.mimeType,
            dataBase64: img.dataBase64,
          })),
          responseSchema: structureResponseSchema,
        });
      } catch (error) {
        lastError = error;
        if (
          error instanceof AiApiError &&
          error.code === "ai_upstream_error"
        ) {
          continue;
        }
        throw error;
      }

      try {
        // attempt === 1（リトライ時）は、全部失敗で502にするより一部でも正しく救えるよう allowPartial: true で試みる
        const drafts: StructureDraftResult = normalizeStructureOutput(raw, {
          allowPartial: attempt > 0,
        });

        // 空成功の禁止：入力文が空でないのに、正規化の結果が条件・希望・支援時間帯すべて0件なら、
        // 成功として返さずエラーとして返す（UIに「取り出せませんでした」系の表示になる既存のエラー形を使う）
        const totalExtracted =
          drafts.constraints.length +
          drafts.hopes.length +
          ((drafts as { careWindows?: unknown[] }).careWindows?.length ?? 0);
        if (totalExtracted === 0) {
          throw invalidAiOutput("入力から条件を取り出せませんでした");
        }

        return { status: 200, body: drafts };
      } catch (error) {
        if (error instanceof NormalizeError) {
          lastError = invalidAiOutput(
            "AI の出力形式が不正だったため、結果を表示できません",
          );
          // 失敗理由（どのルールで落ちたか）をプロンプトに添えて1回だけ再実行する
          prompt = buildStructurePrompt({
            peopleNames: snapshot.people.map((p) => p.name),
            memo: input.memo,
            hasImages: input.images.length > 0,
            retryReason: error.reason,
          });
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// Issue 7：構造化結果の保存（確認画面で personId に結びつけた下書きを保存する）
// ---------------------------------------------------------------------------

export interface StructureSaveHandlerInput {
  idToken: string | null;
  roomId: string;
  /** 確認画面が基にしたスナップショットの revision。サーバー側の現在値と照合する */
  baseRevision: number;
  /** 確定した下書き一式。各制約には利用者が選んだ personId を含む */
  constraints: unknown;
  hopes: unknown;
  unknowns: unknown;
  /** まとめて保存する場合の介護が必要な時間帯（任意） */
  careWindows?: unknown;
  /** まとめて保存する場合の自己負担割合（任意） */
  copayRate?: unknown;
}

/**
 * 構造化結果の保存（および設定の一括保存）。
 * - 認可は構造化と同じ（401／family 以外は 403）。Gemini は呼ばないため回数枠は消費しない
 * - personId への結びつけは利用者が明示した値だけを採用する（名前からの自動一致はしない）
 * - baseRevision が現在の revision と違う場合は 409（古い下書きからの保存は拒否）
 * - 保存は commitRoomChange と同じ意味論の RoomWritePort 経由（revision の +1 と同一 transaction）
 */
export async function handleStructureSaveRequest(
  ports: ServerPorts,
  input: StructureSaveHandlerInput,
): Promise<HandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);

    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return errorResult(400, "invalid_base_revision", "baseRevision が不正です", requestId);
    }

    const snapshot = await ports.rooms.getSnapshot(input.roomId);
    if (!snapshot) throw roomNotFound();
    if (snapshot.revision !== input.baseRevision) throw revisionMismatch();

    // 人物への結びつけと保存形式への変換（400：結びつけ不備・形の不正）
    const bound = bindStructureDrafts(
      {
        constraints: input.constraints,
        hopes: input.hopes,
        unknowns: input.unknowns,
        careWindows: input.careWindows,
        copayRate: input.copayRate,
      },
      snapshot.people,
    );

    const revision = await ports.roomWrite.commitChange(
      input.roomId,
      input.baseRevision,
      bound,
    );
    return { status: 200, body: { revision } };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// Issue 8：代替案（検証NGのときに変更リストを受け取る）
// ---------------------------------------------------------------------------

export interface ProposalsHandlerInput {
  idToken: string | null;
  roomId: string;
  /** クライアントが見ていたスナップショットの revision。サーバー側の現在値と照合する */
  baseRevision: number;
}

export async function handleProposalsRequest(
  ports: ServerPorts,
  input: ProposalsHandlerInput,
  options: HandlerOptions = {},
): Promise<HandlerResult> {
  const requestId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? GEMINI_TIMEOUT_MS;
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);

    if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
      return errorResult(400, "invalid_base_revision", "baseRevision が不正です", requestId);
    }

    const snapshot = await ports.rooms.getSnapshot(input.roomId);
    if (!snapshot) throw roomNotFound();
    // 古い版への代替案は作らない（返す時点で付け替えることもしない。v5確定事項）
    if (snapshot.revision !== input.baseRevision) throw revisionMismatch();

    const validation = ports.validation.validate(snapshot);
    if (validation.ok) {
      // 直すところがないので Gemini は呼ばず、回数枠も消費しない
      return { status: 200, body: { proposals: [], baseRevision: snapshot.revision } };
    }

    if (!(await ports.rateLimit.reserve(input.roomId))) {
      throw rateLimited();
    }

    const prompt = buildProposalPrompt(snapshot, validation);
    // 構造化と同じく、上流の一時的な失敗（503 等）と出力形式の不正は、同じ入力でもう1回だけ試す。
    // 回数枠はこのリクエストで予約した1回分のみ消費する。タイムアウトは再試行しない。
    let lastError: unknown;
    let proposals: Proposal[] | null = null;
    for (let attempt = 0; attempt < 2 && proposals === null; attempt++) {
      let raw: unknown;
      try {
        raw = await callGemini<unknown>(ports, timeoutMs, {
          prompt,
          responseSchema: proposalResponseSchema,
        });
      } catch (error) {
        lastError = error;
        if (
          error instanceof AiApiError &&
          error.code === "ai_upstream_error"
        ) {
          continue;
        }
        throw error;
      }

      try {
        proposals = normalizeProposals(raw, {
          placements: snapshot.placements,
          people: snapshot.people,
          baseRevision: snapshot.revision,
        });
      } catch (error) {
        if (error instanceof NormalizeError) {
          lastError = invalidAiOutput(
            "AI の出力形式が不正だったため、代替案を表示できません",
          );
          continue;
        }
        throw error;
      }
    }
    if (proposals === null) throw lastError;

    // 試し適用＋再検証（Issue 8 本接続）：変更リストを applyChanges で試し適用し、
    // 検証エンジンで再計算して ok=true になった案だけを「検証済み」として返す。
    // 再計算で OK にならない案は提示しない（仕様 Issue 8 の「やらないこと」）。
    // 保存はしない（ボードへの反映は Issue 14）。
    const verified = proposals.flatMap((proposal) => {
      const trialSnapshot = {
        ...snapshot,
        placements: applyChanges(snapshot.placements, proposal.changes),
      };
      const trialValidation = ports.validation.validate(trialSnapshot);
      // 候補の比較表示にも、この再検証で得た結果をそのまま使う。
      return trialValidation.ok
        ? [{ ...proposal, validation: trialValidation }]
        : [];
    });
    return { status: 200, body: { proposals: verified, baseRevision: snapshot.revision } };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}
