"use client";

/**
 * ルーム作成画面（Issue 2）。
 *
 * 家族（people）の初期登録と、ルーム設定（自己負担割合・careWindows）を受け付け、
 * 作成はサーバー側の Route Handler（POST /api/rooms）に集約する。
 * people は初期登録後、変更できない。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getIdToken, useAnonymousUser } from "@/lib/auth";
import {
  getPersonAvatarText,
  normalizePeople,
  validatePeopleCareRoles,
} from "@/lib/people";
import PersonIconPicker from "@/components/PersonIconPicker";
import { saveRecentRoom } from "@/lib/recent-rooms";
import type { CareRole, CareWindow, CopayRate, DayIndex } from "@/lib/types";

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

interface PersonRow {
  name: string;
  careRole: CareRole;
  icon?: string;
}

interface CareWindowRow {
  day: DayIndex;
  startHour: number;
  endHour: number;
}

export default function NewRoomClient() {
  const router = useRouter();
  const user = useAnonymousUser();
  const [people, setPeople] = useState<PersonRow[]>([
    { name: "", careRole: "recipient" },
    { name: "", careRole: "caregiver" },
  ]);
  const [copayRate, setCopayRate] = useState<CopayRate>(1);
  const [careWindows, setCareWindows] = useState<CareWindowRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePerson = (index: number, patch: Partial<PersonRow>) => {
    setPeople((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const updateCareWindow = (index: number, patch: Partial<CareWindowRow>) => {
    setCareWindows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleSubmit = async () => {
    setError(null);
    const candidate = normalizePeople(
      people.map((row, i) => ({
        id: `p-${i}`,
        name: row.name.trim(),
        canProvideCare: row.careRole === "caregiver",
        careRole: row.careRole,
        icon: row.icon,
      })),
    );
    const validation = validatePeopleCareRoles(candidate);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }

    setSubmitting(true);
    try {
      const token = await getIdToken();
      const payloadPeople = candidate.map((row) => ({
        ...row,
        id: crypto.randomUUID(),
      }));
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          people: payloadPeople,
          careWindows: careWindows satisfies CareWindow[],
          copayRate,
        }),
      });
      if (!res.ok) {
        setError("ルームを作成できませんでした。入力を確認してください。");
        return;
      }
      const data = (await res.json()) as { roomId: string };
      const recipient = candidate.find((p) => p.careRole === "recipient");
      const roomName = recipient?.name
        ? `${recipient.name}のルーム`
        : candidate[0]?.name
        ? `${candidate[0].name}のルーム`
        : "ルーム";
      saveRecentRoom({ roomId: data.roomId, roomName });
      router.push(`/rooms/${data.roomId}`);
    } catch {
      setError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
      >
        <span>←</span>
        <span>トップページへ戻る</span>
      </Link>

      <h1 className="text-2xl font-bold">ルーム作成</h1>
      <p className="mt-2 text-neutral-600">
        家族（ボードに載る人）を登録してルームを作ります。ログインする人とは別物で、
        ログインしない家族も含めて全員を登録してください。
        介護を受ける人をちょうど1人、付き添いができる家族を1人以上指定してください（作成後もルームトップから追加・編集できます）。
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">家族の登録</h2>
        <div className="mt-3 space-y-2">
          {people.map((row, index) => (
            <div
              key={index}
              className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 space-y-2.5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-neutral-200 font-bold text-lg text-neutral-700 shadow-2xs"
                >
                  {getPersonAvatarText({ name: row.name, icon: row.icon }) || "？"}
                </span>
                <input
                  className="w-44 rounded border bg-white px-3 py-1.5 text-sm"
                  placeholder="名前（例：父、長女）"
                  value={row.name}
                  onChange={(e) => updatePerson(index, { name: e.target.value })}
                />
                <select
                  aria-label="家族の区分"
                  className="rounded border px-2.5 py-1.5 text-sm bg-white"
                  value={row.careRole}
                  onChange={(e) =>
                    updatePerson(index, { careRole: e.target.value as CareRole })
                  }
                >
                  <option value="recipient">介護を受ける人</option>
                  <option value="caregiver">付き添いができる家族</option>
                  <option value="family">付き添いはできない家族</option>
                </select>
                <button
                  type="button"
                  className="text-sm text-neutral-500 underline hover:text-neutral-700 ml-auto"
                  onClick={() =>
                    setPeople((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  削除
                </button>
              </div>
              <div className="pt-1">
                <span className="text-[11px] font-semibold text-neutral-500 mb-1 block">
                  アイコンを選択：
                </span>
                <PersonIconPicker
                  value={row.icon}
                  onChange={(icon) => updatePerson(index, { icon })}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 rounded border px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
          onClick={() =>
            setPeople((prev) => [...prev, { name: "", careRole: "caregiver" }])
          }
        >
          家族を追加
        </button>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">自己負担割合</h2>
        <div className="mt-3 flex gap-4 text-sm">
          {([1, 2, 3] as CopayRate[]).map((rate) => (
            <label key={rate} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="copayRate"
                checked={copayRate === rate}
                onChange={() => setCopayRate(rate)}
              />
              {rate}割
            </label>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">
          介護が必要な時間帯
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          任意です。あとからボードの入力でも設定できます。「空白」の判定はこの時間帯の中だけで行います。
        </p>
        <div className="mt-3 space-y-2">
          {careWindows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <select
                className="rounded border px-2 py-1.5"
                value={row.day}
                onChange={(e) =>
                  updateCareWindow(index, {
                    day: Number(e.target.value) as DayIndex,
                  })
                }
              >
                {DAY_LABELS.map((label, day) => (
                  <option key={label} value={day}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="w-20 rounded border px-2 py-1.5"
                min={6}
                max={24}
                value={row.startHour}
                onChange={(e) =>
                  updateCareWindow(index, { startHour: Number(e.target.value) })
                }
              />
              <span>時〜</span>
              <input
                type="number"
                className="w-20 rounded border px-2 py-1.5"
                min={6}
                max={24}
                value={row.endHour}
                onChange={(e) =>
                  updateCareWindow(index, { endHour: Number(e.target.value) })
                }
              />
              <span>時</span>
              <button
                type="button"
                className="text-neutral-500 underline"
                onClick={() =>
                  setCareWindows((prev) => prev.filter((_, i) => i !== index))
                }
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 rounded border px-3 py-1.5 text-sm"
          onClick={() =>
            setCareWindows((prev) => [
              ...prev,
              { day: 0, startHour: 9, endHour: 17 },
            ])
          }
        >
          時間帯を追加
        </button>
      </section>

      {error && <p className="mt-6 text-sm text-red-700">{error}</p>}

      <button
        type="button"
        className="mt-8 rounded bg-neutral-900 px-5 py-2 text-white disabled:opacity-50"
        disabled={submitting || user === null}
        onClick={handleSubmit}
      >
        {user === null ? "ログイン中…" : submitting ? "作成中…" : "ルームを作成"}
      </button>
    </main>
  );
}
