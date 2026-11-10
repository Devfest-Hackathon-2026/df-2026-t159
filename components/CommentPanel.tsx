"use client";

/**
 * ケアマネコメントの表示・投稿部品（Issue 14）。
 *
 * props の契約は lib/types.ts の CommentPanelProps（Issue 0 で固定）。
 * 作成できるのは careManager のみ（呼び出し側が canComment で渡す）。
 * 本文は1〜1,000字。更新・削除・返信は MVP 外のため出さない。
 * 保存と認可の担保はサーバー（Route Handler）側で行う。
 */

import { useState } from "react";
import { COMMENT_BODY_MAX_LENGTH } from "@/lib/plan/ports";
import type { CommentPanelProps } from "@/lib/types";

function formatCreatedAt(comment: CommentPanelProps["comments"][number]): string {
  // createdAt は Firestore の Timestamp。時系列表示用に日時に整形する
  const date =
    typeof comment.createdAt?.toDate === "function"
      ? comment.createdAt.toDate()
      : null;
  return date ? date.toLocaleString("ja-JP") : "";
}

export default function CommentPanel({
  comments,
  canComment,
  onSubmitComment,
}: CommentPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const length = Array.from(draft).length;
  const canSubmit = canComment && !busy && length >= 1 && length <= COMMENT_BODY_MAX_LENGTH;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmitComment(draft);
      setDraft("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "コメントを送信できませんでした。もう一度お試しください",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="ケアマネからのコメント" className="space-y-3">
      <h2 className="text-lg font-semibold">ケアマネからのコメント</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-neutral-600">コメントはまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li
              key={comment.id}
              className="rounded border border-neutral-200 px-3 py-2"
            >
              <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {formatCreatedAt(comment)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="space-y-2">
          <label className="block">
            <span className="sr-only">コメント本文</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              maxLength={COMMENT_BODY_MAX_LENGTH}
              placeholder="プランへのコメントを入力してください"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
            >
              コメントする
            </button>
            <span className="text-xs text-neutral-500">
              {length}／{COMMENT_BODY_MAX_LENGTH}字
            </span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
