"use client";

/**
 * 入力画面（Issue 7 改修 ＋ 最終チェック9項目対応）：
 * - 上部にステップ表示（1. 事情を入れる → 2. ボードで組む → 3. 確定・印刷）
 * - 見出し「まず、ご家族の事情を教えてください」
 * - 左カラム：
 *   - 退院書類の写真アップロードカード（選択したファイル名と状態が分かる表示）
 *   - 家族の事情メモの入力欄（事情メモから条件・希望の下書きを作るAIボタン＋説明）
 *   - 介護が必要な時間帯（careWindows）と自己負担割合の設定（未入力行は先頭表示、日時選択で曜日・時刻順ソート）
 * - 右カラム：
 *   - 「Geminiの整理」パネル（簡易／詳細の切り替えで隠す・表示できる）
 *   - 整理結果（制約）のカード一覧（重複バッジ解消、対象・分類の自動反映、AI読み取りメモ名非表示、時刻行横にゴミ箱アイコン削除）
 *   - 曜日・時刻がない希望は下の「家族の希望（自由記述）」へ自動集約（入力欄を縦に広く表示）
 *   - 「分からないこと」の破線枠ボックス
 *   - 入力画面の保存を1つに統合（時間帯・負担割合・Geminiの整理をまとめて保存、保存後も整理表示を維持）
 *   - 画面遷移しても未保存の下書きが消えないよう保持
 */

import Link from "next/link";
import { doc, getDocFromServer } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import RoomHeader from "@/components/RoomHeader";
import { getIdToken, useAnonymousUser } from "@/lib/auth";
import { fetchDemoStructureClient } from "@/lib/demo/client";
import { db } from "@/lib/firebase";
import {
  canDeletePerson,
  getPersonAvatarText,
  getPersonRoleLabel,
  normalizePeople,
  validatePeopleCareRoles,
} from "@/lib/people";
import PersonIconPicker from "@/components/PersonIconPicker";
import {
  commitRoomChange,
  readOwnMembership,
  readRoomSnapshot,
} from "@/lib/rooms";
import {
  DAY_LABELS,
  canSubmitStructure,
  careWindowDraftsFromWindows,
  createEmptyCareWindowDraft,
  emptyReviewDraft,
  getInputScreenDraft,
  inferConstraintTypeFromDetail,
  linesToList,
  listToLines,
  resolveUniquePersonId,
  reviewDraftsFromSnapshot,
  reviewDraftsFromStructureResult,
  saveInputScreenDraft,
  separateDatelessHopes,
  sortCareWindowDrafts,
  toCareWindows,
  toStructureSaveConstraints,
  unboundDraftCount,
  validateCareWindowDrafts,
  validateReviewDraft,
  type CareWindowDraft,
  type ReviewDraft,
} from "@/lib/structure-review";
import type { StructureDraftResult } from "@/lib/ai/structureNormalize";
import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  firestorePaths,
  type CareRole,
  type ConstraintType,
  type CopayRate,
  type DayIndex,
  type MemberDoc,
  type Person,
  type RoomDoc,
  type RoomSnapshot,
} from "@/lib/types";

const TYPE_CONFIG: Record<
  ConstraintType,
  { label: string; border: string; badge: string; dot: string }
> = {
  unavailable: {
    label: "対応不可",
    border: "border-l-red-500",
    badge: "bg-red-100 text-red-800 border border-red-300",
    dot: "bg-red-500",
  },
  hope: {
    label: "希望",
    border: "border-l-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    dot: "bg-emerald-500",
  },
  other: {
    label: "その他",
    border: "border-l-sky-500",
    badge: "bg-sky-100 text-sky-800 border border-sky-300",
    dot: "bg-sky-500",
  },
};

const CONSTRAINT_START_HOURS = Array.from({ length: 24 }, (_, i) => i);
const CONSTRAINT_END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1);
const WINDOW_START_HOURS = Array.from(
  { length: BOARD_END_HOUR - BOARD_START_HOUR },
  (_, i) => BOARD_START_HOUR + i,
);
const WINDOW_END_HOURS = Array.from(
  { length: BOARD_END_HOUR - BOARD_START_HOUR },
  (_, i) => BOARD_START_HOUR + 1 + i,
);
const ALL_DAYS: DayIndex[] = [0, 1, 2, 3, 4, 5, 6];

function computeInitialOpenDays(
  windowDrafts: readonly CareWindowDraft[],
): Record<DayIndex, boolean> {
  const open: Record<DayIndex, boolean> = {
    0: false,
    1: false,
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
  };
  for (const w of windowDrafts) {
    const day: DayIndex = w.day === "" ? 0 : w.day;
    open[day] = true;
  }
  return open;
}

export default function InputClient({ roomId }: { roomId: string }) {
  const user = useAnonymousUser();

  const [membership, setMembership] = useState<MemberDoc | null | undefined>(
    undefined,
  );
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  // 構造化の入力（既存の下書きがあれば初期復元）
  const initialSavedDraft = getInputScreenDraft(roomId);
  const [memo, setMemo] = useState(initialSavedDraft?.memo ?? "");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureNotice, setStructureNotice] = useState<string | null>(null);

  useEffect(() => {
    const urls = imageFiles.map((file) =>
      typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : `blob:preview-${file.name}`,
    );
    setImagePreviewUrls(urls);
    return () => {
      for (const url of urls) {
        if (
          typeof URL !== "undefined" &&
          typeof URL.revokeObjectURL === "function"
        ) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }
      }
    };
  }, [imageFiles]);

  // 確認・修正の状態
  const [drafts, setDrafts] = useState<ReviewDraft[]>(
    initialSavedDraft?.dirty ? initialSavedDraft.drafts : [],
  );
  const [hopesText, setHopesText] = useState(
    initialSavedDraft?.dirty ? initialSavedDraft.hopesText : "",
  );
  const [unknownsText, setUnknownsText] = useState(
    initialSavedDraft?.dirty ? initialSavedDraft.unknownsText : "",
  );

  // Geminiの整理：簡易／詳細の表示切り替え
  const [viewMode, setViewMode] = useState<"detailed" | "simple">("detailed");

  // 介護が必要な時間帯・自己負担割合の状態
  const [careWindowDrafts, setCareWindowDrafts] = useState<CareWindowDraft[]>(
    initialSavedDraft?.dirty ? initialSavedDraft.careWindowDrafts : [],
  );
  const [openDays, setOpenDays] = useState<Record<DayIndex, boolean>>(() =>
    computeInitialOpenDays(
      initialSavedDraft?.dirty ? initialSavedDraft.careWindowDrafts : [],
    ),
  );
  const [copayRate, setCopayRate] = useState<CopayRate>(
    initialSavedDraft?.dirty ? initialSavedDraft.copayRate : 1,
  );
  const [showCopayDetail, setShowCopayDetail] = useState(false);

  // 統合保存の状態
  const [savingAll, setSavingAll] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);

  // 家族の追加・編集
  const [isEditingPeople, setIsEditingPeople] = useState(false);
  const [draftPeople, setDraftPeople] = useState<Person[]>([]);
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleDeleteWarnings, setPeopleDeleteWarnings] = useState<
    Record<string, string>
  >({});

  const canEdit = membership?.role === "family";

  const handleStartEditingPeople = () => {
    if (!snapshot) return;
    setDraftPeople(snapshot.people.map((p) => ({ ...p })));
    setPeopleError(null);
    setPeopleDeleteWarnings({});
    setIsEditingPeople(true);
  };

  const handleCancelEditingPeople = () => {
    setIsEditingPeople(false);
    setPeopleError(null);
    setPeopleDeleteWarnings({});
  };

  const handleAddPerson = () => {
    setDraftPeople((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "",
        canProvideCare: true,
        careRole: "caregiver",
      },
    ]);
  };

  const handleUpdatePerson = (personId: string, patch: Partial<Person>) => {
    setDraftPeople((prev) =>
      prev.map((p) => {
        if (p.id !== personId) return p;
        const next = { ...p, ...patch };
        if (patch.careRole !== undefined) {
          next.canProvideCare = patch.careRole === "caregiver";
        }
        return next;
      }),
    );
  };

  const handleDeletePerson = (personId: string) => {
    if (!snapshot) return;
    const check = canDeletePerson(
      personId,
      snapshot.placements,
      snapshot.constraints,
    );
    if (!check.canDelete) {
      setPeopleDeleteWarnings((prev) => ({
        ...prev,
        [personId]: check.reason || "この家族は削除できません。",
      }));
      return;
    }
    setDraftPeople((prev) => prev.filter((p) => p.id !== personId));
    setPeopleDeleteWarnings((prev) => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
  };

  const handleSavePeople = async () => {
    if (!snapshot) return;
    const validation = validatePeopleCareRoles(draftPeople);
    if (!validation.valid) {
      setPeopleError(validation.errors.join(" "));
      return;
    }

    setPeopleSaving(true);
    setPeopleError(null);
    try {
      const normalized = normalizePeople(
        draftPeople.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          canProvideCare: p.careRole === "caregiver",
          careRole: p.careRole,
          icon: p.icon,
        })),
      );
      const nextRevision = await commitRoomChange(roomId, snapshot.revision, {
        people: normalized,
      });
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              people: normalized,
              revision: nextRevision,
            }
          : prev,
      );
      setIsEditingPeople(false);
    } catch (err) {
      setPeopleError(
        err instanceof Error ? err.message : "家族の保存に失敗しました。",
      );
    } finally {
      setPeopleSaving(false);
    }
  };

  // 下書きを保存するヘルパー
  const persistDraftState = useCallback(
    (
      next: Partial<{
        memo: string;
        drafts: ReviewDraft[];
        hopesText: string;
        unknownsText: string;
        careWindowDrafts: CareWindowDraft[];
        copayRate: CopayRate;
        dirty: boolean;
      }>,
    ) => {
      const existing = getInputScreenDraft(roomId);
      saveInputScreenDraft(roomId, {
        memo: next.memo ?? existing?.memo ?? memo,
        drafts: next.drafts ?? existing?.drafts ?? drafts,
        hopesText: next.hopesText ?? existing?.hopesText ?? hopesText,
        unknownsText:
          next.unknownsText ?? existing?.unknownsText ?? unknownsText,
        careWindowDrafts:
          next.careWindowDrafts ??
          existing?.careWindowDrafts ??
          careWindowDrafts,
        copayRate: next.copayRate ?? existing?.copayRate ?? copayRate,
        dirty: next.dirty ?? existing?.dirty ?? true,
      });
    },
    [roomId, memo, drafts, hopesText, unknownsText, careWindowDrafts, copayRate],
  );

  const applySnapshot = useCallback(
    (snap: RoomSnapshot, forceOverwrite = false) => {
      setSnapshot(snap);
      const saved = getInputScreenDraft(roomId);
      if (saved && saved.memo !== "") {
        setMemo(saved.memo);
      }
      if (!forceOverwrite && saved?.dirty) {
        // 未保存の下書きがある場合は画面遷移後も失われないよう復元する
        // ただし対象が未選択で一意に名前が一致するものがあれば補完する
        const reboundDrafts = saved.drafts.map((d) => {
          if (d.personId === "" && !d.manualPersonId) {
            const autoId = resolveUniquePersonId(d, snap.people);
            if (autoId !== "") {
              return { ...d, personId: autoId };
            }
          }
          return d;
        });
        setDrafts(reboundDrafts);
        setHopesText(saved.hopesText);
        setUnknownsText(saved.unknownsText);
        setCareWindowDrafts(saved.careWindowDrafts);
        setOpenDays(computeInitialOpenDays(saved.careWindowDrafts));
        setCopayRate(saved.copayRate);
        return;
      }

      const rawDrafts = reviewDraftsFromSnapshot(snap).map((d) => {
        if (d.personId === "") {
          const autoId = resolveUniquePersonId(d, snap.people);
          if (autoId !== "") {
            return { ...d, personId: autoId };
          }
        }
        return d;
      });
      const separated = separateDatelessHopes(rawDrafts, snap.hopes);
      const nextHopesText = listToLines(separated.hopes);
      const nextUnknownsText = listToLines(snap.unknowns);
      const nextWindowDrafts = careWindowDraftsFromWindows(snap.careWindows);

      setDrafts(separated.drafts);
      setHopesText(nextHopesText);
      setUnknownsText(nextUnknownsText);
      setCareWindowDrafts(nextWindowDrafts);
      setOpenDays(computeInitialOpenDays(nextWindowDrafts));
      setCopayRate(snap.copayRate);
    },
    [roomId],
  );

  const refresh = useCallback(async () => {
    if (!user) return;
    const member = await readOwnMembership(roomId, user.uid);
    setMembership(member);
    if (member) {
      // デモルーム判定は rooms/{roomId} の isDemo（RoomSnapshot には含まれない）
      try {
        const roomSnap = await getDocFromServer(
          doc(db, firestorePaths.room(roomId)),
        );
        setIsDemo(
          roomSnap.exists()
            ? ((roomSnap.data() as RoomDoc).isDemo ?? false)
            : false,
        );
      } catch {
        setIsDemo(false);
      }
      try {
        const snap = await readRoomSnapshot(roomId);
        if (snap) {
          applySnapshot(snap);
        } else {
          setLoadError(
            "ルームの読み込みに失敗しました。もう一度お試しください。",
          );
        }
      } catch {
        setLoadError(
          "ルームの読み込みに失敗しました。もう一度お試しください。",
        );
      }
    }
  }, [roomId, user, applySnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 構造化（書類＋メモ → 下書き）
  const requestRealStructure = async (
    token: string,
  ): Promise<StructureDraftResult | null> => {
    const form = new FormData();
    form.set("roomId", roomId);
    form.set("memo", memo);
    for (const file of imageFiles.slice(0, 2)) {
      form.append("images", file);
    }
    const res = await fetch("/api/structure", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    } & Partial<StructureDraftResult>;
    if (!res.ok) {
      setStructureError(
        data.message ??
          "内容を整理できませんでした。入力を見直して、もう一度お試しください。",
      );
      return null;
    }
    return {
      constraints: data.constraints ?? [],
      hopes: data.hopes ?? [],
      unknowns: data.unknowns ?? [],
    };
  };

  const handleStructure = async () => {
    setStructuring(true);
    setStructureError(null);
    setStructureNotice(null);
    try {
      const token = await getIdToken();
      let result: StructureDraftResult | null;
      try {
        result = isDemo
          ? await fetchDemoStructureClient(token, roomId)
          : await requestRealStructure(token);
      } catch (error) {
        setStructureError(
          error instanceof Error
            ? error.message
            : "内容を整理できませんでした。入力を見直して、もう一度お試しください。",
        );
        return;
      }
      if (!result) return;

      // メモから読み取った対象（名前が一意に一致する場合のみ自動セット）と分類を反映し、
      // 曜日・時刻がない希望は下の「家族の希望（自由記述）」へ移す
      const initialDrafts = reviewDraftsFromStructureResult(
        result,
        snapshot?.people,
      );
      const separated = separateDatelessHopes(initialDrafts, result.hopes);
      const nextHopesText = listToLines(separated.hopes);
      const nextUnknownsText = listToLines(result.unknowns);

      setDrafts(separated.drafts);
      setHopesText(nextHopesText);
      setUnknownsText(nextUnknownsText);
      setSavedRevision(null);
      persistDraftState({
        drafts: separated.drafts,
        hopesText: nextHopesText,
        unknownsText: nextUnknownsText,
        dirty: true,
      });

      const remainingUnbound = unboundDraftCount(separated.drafts);
      setStructureNotice(
        remainingUnbound > 0
          ? `下書きを作成しました。右側の「Geminiの整理」で未選択の対象（${remainingUnbound}件）を選び、内容を確認して保存してください。`
          : "下書きを作成しました。対象の家族を選び、内容を確認して保存してください。",
      );
    } catch {
      setStructureError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setStructuring(false);
    }
  };

  const updateDraft = (index: number, patch: Partial<ReviewDraft>) => {
    setDrafts((prev) => {
      const next = prev.map((draft, i) => {
        if (i !== index) return draft;
        const updated: ReviewDraft = { ...draft, ...patch };
        if (patch.personId !== undefined) {
          updated.manualPersonId = true;
        }
        if (patch.type !== undefined) {
          updated.manualType = true;
        }
        if (patch.detail !== undefined) {
          if (!updated.manualPersonId) {
            updated.personId = resolveUniquePersonId(
              { memberName: updated.memberName, detail: patch.detail },
              snapshot?.people,
            );
          }
          if (!updated.manualType) {
            updated.type = inferConstraintTypeFromDetail(patch.detail, "other");
          }
        }
        return updated;
      });
      persistDraftState({ drafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const toggleDraftDay = (index: number, day: DayIndex) => {
    setDrafts((prev) => {
      const next = prev.map((draft, i) => {
        if (i !== index) return draft;
        const days = draft.days.includes(day)
          ? draft.days.filter((d) => d !== day)
          : [...draft.days, day].sort((a, b) => a - b);
        return { ...draft, days };
      });
      persistDraftState({ drafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      persistDraftState({ drafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const addDraft = () => {
    setDrafts((prev) => {
      const next = [...prev, emptyReviewDraft()];
      persistDraftState({ drafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const handleMemoChange = (value: string) => {
    setMemo(value);
    const existing = getInputScreenDraft(roomId);
    saveInputScreenDraft(roomId, {
      memo: value,
      drafts: existing?.drafts ?? drafts,
      hopesText: existing?.hopesText ?? hopesText,
      unknownsText: existing?.unknownsText ?? unknownsText,
      careWindowDrafts: existing?.careWindowDrafts ?? careWindowDrafts,
      copayRate: existing?.copayRate ?? copayRate,
      dirty: existing?.dirty ?? true,
    });
  };

  const handleHopesChange = (value: string) => {
    setHopesText(value);
    setSavedRevision(null);
    persistDraftState({ hopesText: value, dirty: true });
  };

  const handleUnknownsChange = (value: string) => {
    setUnknownsText(value);
    setSavedRevision(null);
    persistDraftState({ unknownsText: value, dirty: true });
  };

  const handleCopayRateChange = (rate: CopayRate) => {
    setCopayRate(rate);
    setSavedRevision(null);
    persistDraftState({ copayRate: rate, dirty: true });
  };

  const toggleDayOpen = (day: DayIndex) => {
    setOpenDays((prev) => ({ ...prev, [day]: !prev[day] }));
  };

  const handleAddCareWindowForDay = (day: DayIndex) => {
    setOpenDays((prev) => ({ ...prev, [day]: true }));
    setCareWindowDrafts((prev) => {
      const next = [{ ...createEmptyCareWindowDraft(), day }, ...prev];
      persistDraftState({ careWindowDrafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const updateCareWindowDraft = (
    id: string,
    patch: Partial<Omit<CareWindowDraft, "id">>,
  ) => {
    if (patch.day !== undefined && patch.day !== "") {
      const targetDay = patch.day;
      setOpenDays((prev) => ({ ...prev, [targetDay]: true }));
    }
    setCareWindowDrafts((prev) => {
      const updated = prev.map((w) => (w.id === id ? { ...w, ...patch } : w));
      // 未入力行は一番上に残し、日時がすべて選ばれたら曜日・時刻順に並び替える
      const sorted = sortCareWindowDrafts(updated);
      persistDraftState({ careWindowDrafts: sorted, dirty: true });
      return sorted;
    });
    setSavedRevision(null);
  };

  const removeCareWindowDraft = (id: string) => {
    setCareWindowDrafts((prev) => {
      const next = prev.filter((w) => w.id !== id);
      persistDraftState({ careWindowDrafts: next, dirty: true });
      return next;
    });
    setSavedRevision(null);
  };

  const careWindowErrors = validateCareWindowDrafts(careWindowDrafts);

  // 入力画面の保存を1つに統合（介護が必要な時間帯・自己負担割合・Geminiの整理をまとめて保存）
  const handleSaveAll = async () => {
    if (!snapshot) return;
    setSavingAll(true);
    setSaveError(null);
    try {
      const token = await getIdToken();
      const peopleNames = new Map(snapshot.people.map((p) => [p.id, p.name]));

      // 曜日・時刻がない希望があれば保存時にも「家族の希望」へ集約する
      const separated = separateDatelessHopes(drafts, linesToList(hopesText));
      const finalDrafts = separated.drafts;
      const finalHopes = separated.hopes;
      const finalUnknowns = linesToList(unknownsText);
      const finalCareWindows = toCareWindows(careWindowDrafts);

      const res = await fetch("/api/structure/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId,
          baseRevision: snapshot.revision,
          constraints: toStructureSaveConstraints(finalDrafts, peopleNames),
          hopes: finalHopes,
          unknowns: finalUnknowns,
          careWindows: finalCareWindows,
          copayRate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        revision?: number;
      };
      if (!res.ok) {
        setSaveError(
          res.status === 409
            ? "他の人が先に内容を更新しました（版が進んでいます）。再読み込みして、最新の内容で確認し直してください。"
            : (data.message ?? "保存に失敗しました。内容を確認してください。"),
        );
        return;
      }

      const nextRevision = data.revision ?? snapshot.revision + 1;
      const nextHopesText = listToLines(finalHopes);
      const nextWindowDrafts = careWindowDraftsFromWindows(finalCareWindows);

      // 保存で Gemini の整理が消えないよう、画面上の整理状態を維持したまま版と保存済み状態を更新する
      setDrafts(finalDrafts);
      setHopesText(nextHopesText);
      setCareWindowDrafts(nextWindowDrafts);
      setSavedRevision(nextRevision);
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              hopes: finalHopes,
              unknowns: finalUnknowns,
              careWindows: finalCareWindows,
              copayRate,
              revision: nextRevision,
            }
          : prev,
      );
      saveInputScreenDraft(roomId, {
        memo,
        drafts: finalDrafts,
        hopesText: nextHopesText,
        unknownsText,
        careWindowDrafts: nextWindowDrafts,
        copayRate,
        dirty: false,
      });
    } catch {
      setSaveError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setSavingAll(false);
    }
  };

  const removeFile = (fileIndex: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== fileIndex));
  };

  if (user === null || membership === undefined) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-bold">入力</h1>
        <p className="mt-4 text-neutral-600">読み込み中…</p>
      </main>
    );
  }

  if (membership === null) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-bold">入力</h1>
        <p className="mt-4 text-neutral-700">
          このルームにはまだ参加していません。先にルームの入口から招待リンクで参加してください。
        </p>
        <p className="mt-4 text-sm">
          <Link
            className="underline font-bold text-indigo-600"
            href={`/rooms/${roomId}`}
          >
            ルームの入口へ
          </Link>
        </p>
      </main>
    );
  }

  const unbound = unboundDraftCount(drafts);
  const submittable =
    canSubmitStructure(drafts) && careWindowErrors.length === 0;
  const hopesCount = linesToList(hopesText).length;
  const unknownsCount = linesToList(unknownsText).length;
  const personNameMap = new Map(
    (snapshot?.people ?? []).map((p) => [p.id, p.name]),
  );

  return (
    <div className="min-h-screen bg-neutral-100/60 pb-16">
      {/* 全画面共通ヘッダー */}
      <RoomHeader roomId={roomId} activeKey="input" />

      {/* 画面ヘッダーとステップ表示 */}
      <div className="border-b border-neutral-200 bg-white px-4 sm:px-8 py-5 shadow-xs">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900">
                まず、ご家族の事情を教えてください
              </h1>
            </div>

            {/* 目標仕様：上部ステップ表示（1. 事情を入れる → 2. ボードで組む → 3. 確定・印刷） */}
            <div className="flex flex-wrap items-center gap-3">
              <nav aria-label="手続きの進行状況">
                <ol className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                  <li className="flex items-center gap-1.5 rounded-full bg-indigo-600 px-3.5 py-1.5 text-white shadow-xs">
                    <span>1. 事情を入れる</span>
                  </li>
                  <span className="text-neutral-300">→</span>
                  <li className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-neutral-600">
                    <Link
                      href={`/rooms/${roomId}/board`}
                      className="hover:text-indigo-600"
                    >
                      2. ボードで組む
                    </Link>
                  </li>
                  <span className="text-neutral-300">→</span>
                  <li className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1.5 text-neutral-600">
                    <Link
                      href={`/rooms/${roomId}/summary`}
                      className="hover:text-indigo-600"
                    >
                      3. 確定・印刷
                    </Link>
                  </li>
                </ol>
              </nav>
              <Link
                href={`/rooms/${roomId}/board`}
                className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition-colors"
              >
                <span>次へ（週間ボードへ進む）</span>
                <span>→</span>
              </Link>
            </div>
          </div>

          {!canEdit && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
              ※ あなたの役割はケアマネ（閲覧のみ）のため、この画面での入力・保存はできません。入力の更新は家族だけが行えます。
            </p>
          )}
          {loadError && <p className="mt-3 text-xs text-red-700">{loadError}</p>}
        </div>
      </div>

      {/* メイン 2カラムレイアウト */}
      <main className="mx-auto max-w-7xl px-4 sm:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* ===================== 左カラム ===================== */}
          <div className="space-y-6">
            {/* 0. 登録されている家族カード */}
            {snapshot && (
              <section
                aria-label="登録されている家族"
                className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                      <span>👥</span>
                      <span>登録されている家族</span>
                    </h2>
                    <span className="text-xs text-neutral-500">
                      {snapshot.people.length}名
                    </span>
                  </div>
                  {canEdit && !isEditingPeople && (
                    <button
                      type="button"
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-2xs"
                      onClick={handleStartEditingPeople}
                    >
                      家族を追加・編集
                    </button>
                  )}
                </div>

                {!isEditingPeople ? (
                  <ul className="mt-4 divide-y divide-neutral-100">
                    {snapshot.people.map((person) => {
                      const role =
                        person.careRole ??
                        (person.canProvideCare ? "caregiver" : "recipient");
                      return (
                        <li
                          key={person.id}
                          className="max-sm:flex-wrap max-sm:gap-2 flex items-center justify-between py-2 text-xs sm:text-sm first:pt-0 last:pb-0"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-bold text-lg text-neutral-700 shadow-2xs">
                              {getPersonAvatarText(person)}
                            </span>
                            <span className="font-semibold text-neutral-800">
                              {person.name}
                            </span>
                          </div>
                          <span
                            className={`rounded-md px-2.5 py-0.5 text-xs font-medium border ${
                              role === "recipient"
                                ? "bg-purple-50 text-purple-800 border-purple-200/60"
                                : role === "caregiver"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200/60"
                                : "bg-neutral-100 text-neutral-600 border-neutral-200/60"
                            }`}
                          >
                            {getPersonRoleLabel(person)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-4 space-y-4">
                    <p className="text-xs text-neutral-600">
                      名前・アイコン・区分（3択）を編集できます。介護を受ける人をちょうど1人、付き添いができる家族を1人以上指定してください。
                    </p>
                    <div className="space-y-3">
                      {draftPeople.map((person) => (
                        <div
                          key={person.id}
                          className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-neutral-200 font-bold text-lg text-neutral-700 shadow-2xs"
                            >
                              {getPersonAvatarText(person) || "？"}
                            </span>
                            <input
                              className="w-36 sm:w-44 rounded border bg-white px-2.5 py-1.5 text-sm"
                              placeholder="名前（例：父、長女）"
                              value={person.name}
                              onChange={(e) =>
                                handleUpdatePerson(person.id, {
                                  name: e.target.value,
                                })
                              }
                            />
                            <select
                              aria-label="家族の区分"
                              className="rounded border bg-white px-2.5 py-1.5 text-sm"
                              value={
                                person.careRole ??
                                (person.canProvideCare
                                  ? "caregiver"
                                  : "recipient")
                              }
                              onChange={(e) =>
                                handleUpdatePerson(person.id, {
                                  careRole: e.target.value as CareRole,
                                })
                              }
                            >
                              <option value="recipient">介護を受ける人</option>
                              <option value="caregiver">
                                付き添いができる家族
                              </option>
                              <option value="family">
                                付き添いはできない家族
                              </option>
                            </select>
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:text-red-800 font-medium ml-auto px-2 py-1"
                              onClick={() => handleDeletePerson(person.id)}
                            >
                              削除
                            </button>
                          </div>
                          <div className="pt-1">
                            <span className="text-[11px] font-semibold text-neutral-500 mb-1 block">
                              アイコンを選択：
                            </span>
                            <PersonIconPicker
                              value={person.icon}
                              onChange={(icon) =>
                                handleUpdatePerson(person.id, { icon })
                              }
                            />
                          </div>
                          {peopleDeleteWarnings[person.id] && (
                            <p className="text-xs text-red-600 font-medium">
                              ⚠️ {peopleDeleteWarnings[person.id]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="rounded border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      onClick={handleAddPerson}
                    >
                      ＋ 家族を追加
                    </button>

                    {peopleError && (
                      <p className="text-xs text-red-700 font-semibold">
                        {peopleError}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
                      <button
                        type="button"
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        disabled={peopleSaving}
                        onClick={handleCancelEditingPeople}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
                        disabled={peopleSaving}
                        onClick={() => void handleSavePeople()}
                      >
                        {peopleSaving ? "保存中…" : "変更を保存"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* 1. 退院書類の写真アップロードカード */}
            <section
              aria-label="書類の写真アップロード"
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>📷</span> 退院書類の写真
                </h2>
                <span className="text-xs text-neutral-500 font-medium">
                  最大2枚（各5MBまで）
                </span>
              </div>

              <p className="mt-2 text-xs text-neutral-600 leading-relaxed">
                退院時サマリーなどを読み取ります（写真は保存されません）。
              </p>

              <div className="mt-4">
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50/70 p-6 text-center hover:bg-neutral-100/70 cursor-pointer transition-colors">
                  <span className="text-3xl">📤</span>
                  <span className="mt-2 text-xs font-bold text-indigo-700">
                    写真を選択またはドロップ
                  </span>
                  <span className="mt-0.5 text-[11px] text-neutral-500">
                    JPG, PNG, WebP対応
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={!canEdit}
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      setImageFiles((prev) => [...prev, ...files].slice(0, 2));
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {/* 選択したファイル名・状態・サムネイルプレビュー */}
              {imageFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-xs font-bold text-neutral-700">
                    選択中のファイル（{imageFiles.length} / 2枚）
                  </h3>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {imageFiles.map((file, i) => (
                      <li
                        key={`${file.name}-${i}`}
                        className="flex items-center gap-3 rounded-lg bg-neutral-50 p-2.5 text-xs border border-neutral-200"
                      >
                        {imagePreviewUrls[i] && (
                          <img
                            src={imagePreviewUrls[i]}
                            alt={`${file.name}のプレビュー`}
                            data-testid="image-preview-thumbnail"
                            className="h-16 w-16 shrink-0 rounded-md border border-neutral-200 bg-white object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm shrink-0">📄</span>
                            <span className="font-medium text-neutral-800 truncate">
                              {file.name}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-neutral-500 shrink-0">
                              ({(file.size / 1024).toFixed(0)} KB)
                            </span>
                            <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800 shrink-0">
                              準備完了
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => removeFile(i)}
                                className="text-xs text-red-600 hover:underline font-bold shrink-0 ml-auto"
                              >
                                削除
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* 2. 家族の事情メモの入力欄 */}
            <section
              aria-label="家族の事情メモ"
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>✍️</span> 家族の事情メモ
                </h2>
                <span className="text-xs text-neutral-500 font-mono">
                  {memo.length} / 4,000字
                </span>
              </div>

              <p className="mt-2 text-xs text-neutral-600 leading-relaxed">
                仕事の曜日・時間、付き添える時間帯、希望などを入力してください。
              </p>

              <textarea
                className="mt-3 w-full rounded-xl border border-neutral-300 p-3 text-xs leading-relaxed disabled:opacity-50 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                rows={6}
                maxLength={4000}
                disabled={!canEdit}
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                placeholder="例：父は来週退院予定で要介護3。長女は平日フルタイム勤務のため日中は対応不可。母は同居だが腰痛のため重い介助は困難。平日はデイサービスや訪問介護を利用したい…"
              />

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 transition-all flex items-center gap-2"
                  disabled={!canEdit || structuring}
                  onClick={handleStructure}
                >
                  <span>✨</span>
                  <span>
                    {structuring
                      ? "事情メモから整理中…"
                      : "家族の事情メモから条件・希望の下書きを作る（AI）"}
                  </span>
                </button>
                {structuring && (
                  <span className="text-xs text-indigo-600 animate-pulse font-medium">
                    文書とメモを読み取っています…
                  </span>
                )}
              </div>

              {structureError && (
                <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700 font-medium border border-red-200">
                  {structureError}
                </p>
              )}
              {structureNotice && (
                <p className="mt-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-900 font-medium border border-sky-200">
                  {structureNotice}
                </p>
              )}
            </section>

            {/* 3. 介護が必要な時間帯と自己負担割合の設定 */}
            <section
              aria-label="介護が必要な時間帯と自己負担割合の設定"
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>⚙️</span> 介護が必要な時間帯と自己負担割合
                </h2>
              </div>

              <p className="mt-2 text-xs text-neutral-600 leading-relaxed">
                介護が必要な時間帯に予定がない箇所を「空白」と表示します。
              </p>

              {/* 自己負担割合 */}
              <div className="mt-4 rounded-xl bg-neutral-50 p-4 border border-neutral-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-neutral-800">
                    自己負担割合
                  </span>
                  <button
                    type="button"
                    aria-expanded={showCopayDetail}
                    onClick={() => setShowCopayDetail((prev) => !prev)}
                    className="text-xs font-semibold text-indigo-600 hover:underline"
                  >
                    {showCopayDetail ? "詳細を隠す ▲" : "所得による目安（詳細表示） ▼"}
                  </button>
                </div>
                <div className="mt-2 flex gap-4 text-xs font-medium">
                  {([1, 2, 3] as CopayRate[]).map((rate) => (
                    <label
                      key={rate}
                      className="flex items-center gap-1.5 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="copayRate"
                        disabled={!canEdit}
                        checked={copayRate === rate}
                        onChange={() => handleCopayRateChange(rate)}
                        className="text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{rate}割</span>
                    </label>
                  ))}
                </div>
                {showCopayDetail && (
                  <p className="mt-2.5 rounded-lg bg-white p-2.5 text-[11px] text-neutral-600 border border-neutral-200 leading-relaxed">
                    所得による目安：一般的な所得の方は1割、一定以上の所得がある方は2割・3割です（介護保険負担割合証で確認できます）。
                  </p>
                )}
              </div>

              {/* careWindows（介護が必要な時間帯） */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-800">
                    介護が必要な時間帯
                  </span>
                </div>

                <div className="mt-2 space-y-2">
                  {ALL_DAYS.map((day) => {
                    const label = DAY_LABELS[day];
                    const dayDrafts = careWindowDrafts.filter(
                      (w) => (w.day === "" ? 0 : w.day) === day,
                    );
                    const isOpen = openDays[day];

                    return (
                      <div
                        key={day}
                        data-testid={`care-window-day-${day}`}
                        className="rounded-xl border border-neutral-200 bg-white overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-2 bg-neutral-50/80 px-3 py-2">
                          <h3 className="text-xs font-bold text-neutral-800">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => toggleDayOpen(day)}
                              className="flex items-center gap-2 text-left text-xs font-bold text-neutral-800 hover:text-indigo-600 transition-colors"
                            >
                              <span
                                aria-hidden="true"
                                className="text-[10px] text-neutral-500"
                              >
                                {isOpen ? "▼" : "▶"}
                              </span>
                              <span>{`${label}曜日（${dayDrafts.length}件）`}</span>
                            </button>
                          </h3>
                          {canEdit && dayDrafts.length === 0 && (
                            <button
                              type="button"
                              onClick={() => handleAddCareWindowForDay(day)}
                              className="text-xs font-bold text-indigo-600 hover:underline"
                            >
                              <span aria-hidden="true">＋ </span>
                              <span>時間帯を追加</span>
                            </button>
                          )}
                        </div>

                        {isOpen && (
                          <div className="border-t border-neutral-200">
                            {dayDrafts.length > 0 ? (
                              <div className="divide-y divide-neutral-100">
                                {dayDrafts.map((windowDraft) => {
                                  const isIncomplete =
                                    windowDraft.startHour === "" ||
                                    windowDraft.endHour === "";
                                  return (
                                    <div
                                      key={windowDraft.id}
                                      data-testid="care-window-row"
                                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                                        isIncomplete
                                          ? "bg-indigo-50/60"
                                          : "bg-white"
                                      }`}
                                    >
                                      {isIncomplete && (
                                        <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                          未入力
                                        </span>
                                      )}
                                      <select
                                        aria-label="介護が必要な開始時刻"
                                        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-hidden"
                                        disabled={!canEdit}
                                        value={windowDraft.startHour}
                                        onChange={(e) =>
                                          updateCareWindowDraft(windowDraft.id, {
                                            startHour:
                                              e.target.value === ""
                                                ? ""
                                                : Number(e.target.value),
                                          })
                                        }
                                      >
                                        <option value="">開始時刻</option>
                                        {WINDOW_START_HOURS.map((hour) => (
                                          <option key={hour} value={hour}>
                                            {hour}:00
                                          </option>
                                        ))}
                                      </select>
                                      <span className="text-neutral-400">〜</span>
                                      <select
                                        aria-label="介護が必要な終了時刻"
                                        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-hidden"
                                        disabled={!canEdit}
                                        value={windowDraft.endHour}
                                        onChange={(e) =>
                                          updateCareWindowDraft(windowDraft.id, {
                                            endHour:
                                              e.target.value === ""
                                                ? ""
                                                : Number(e.target.value),
                                          })
                                        }
                                      >
                                        <option value="">終了時刻</option>
                                        {WINDOW_END_HOURS.map((hour) => (
                                          <option key={hour} value={hour}>
                                            {hour}:00
                                          </option>
                                        ))}
                                      </select>
                                      {canEdit && (
                                        <button
                                          type="button"
                                          className="ml-auto shrink-0 text-xs text-red-600 hover:underline font-medium"
                                          onClick={() =>
                                            removeCareWindowDraft(windowDraft.id)
                                          }
                                        >
                                          削除
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-neutral-500 px-3 py-2">
                                この曜日の時間帯はまだありません。
                              </p>
                            )}
                            {canEdit && dayDrafts.length > 0 && (
                              <div className="border-t border-neutral-100 bg-neutral-50/40 px-3 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleAddCareWindowForDay(day)}
                                  className="text-xs font-bold text-indigo-600 hover:underline"
                                >
                                  <span aria-hidden="true">＋ </span>
                                  <span>時間帯を追加</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {careWindowDrafts.length === 0 && (
                    <p className="text-xs text-amber-700 font-medium p-2 bg-amber-50 rounded-lg">
                      介護が必要な時間帯が未設定です。未設定のままだと空白時間が未判定になります。
                    </p>
                  )}
                </div>
              </div>

              {careWindowErrors.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-xs text-red-700 space-y-0.5">
                  {careWindowErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ===================== 右カラム（Geminiの整理パネル） ===================== */}
          <div className="space-y-6">
            <section
              aria-label="Geminiの整理"
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600 text-white font-black text-xs">
                    ✦
                  </span>
                  <h2 className="text-base font-bold text-neutral-900">
                    Geminiの整理
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  {unbound > 0 ? (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
                      未選択: {unbound}件
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                      全条件結びつけ完了
                    </span>
                  )}

                  {/* 簡易／詳細の切り替え */}
                  <div
                    role="group"
                    aria-label="Geminiの整理の表示切り替え"
                    className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 text-xs font-bold"
                  >
                    <button
                      type="button"
                      aria-pressed={viewMode === "simple"}
                      onClick={() => setViewMode("simple")}
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        viewMode === "simple"
                          ? "bg-white text-indigo-700 shadow-2xs"
                          : "text-neutral-600 hover:text-neutral-900"
                      }`}
                    >
                      簡易
                    </button>
                    <button
                      type="button"
                      aria-pressed={viewMode === "detailed"}
                      onClick={() => setViewMode("detailed")}
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        viewMode === "detailed"
                          ? "bg-white text-indigo-700 shadow-2xs"
                          : "text-neutral-600 hover:text-neutral-900"
                      }`}
                    >
                      詳細
                    </button>
                  </div>
                </div>
              </div>

              <div
                role="note"
                className="mt-3 flex items-center gap-2.5 rounded-xl border-2 border-indigo-300 bg-indigo-50 px-3.5 py-2.5 text-xs font-bold text-indigo-950 shadow-2xs"
              >
                <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                  必須ステップ
                </span>
                <p>対象の家族を選び、内容を確認して保存してください。</p>
              </div>

              {viewMode === "simple" ? (
                /* ===================== 簡易表示モード（詳細を隠す） ===================== */
                <div
                  data-testid="gemini-simple-view"
                  className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-neutral-700">
                    <span className="rounded-lg bg-white px-3 py-1.5 border border-neutral-200">
                      条件カード：{drafts.length}件
                    </span>
                    <span className="rounded-lg bg-white px-3 py-1.5 border border-neutral-200">
                      家族の希望：{hopesCount}件
                    </span>
                    <span className="rounded-lg bg-white px-3 py-1.5 border border-neutral-200">
                      分からないこと：{unknownsCount}件
                    </span>
                  </div>

                  {drafts.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-neutral-800">
                      {drafts.map((draft, i) => {
                        const config =
                          TYPE_CONFIG[draft.type] ?? TYPE_CONFIG.other;
                        const personName =
                          personNameMap.get(draft.personId) ?? "（対象未選択）";
                        const dayText =
                          draft.days.length > 0
                            ? draft.days.map((d) => DAY_LABELS[d]).join("・")
                            : "";
                        const timeText =
                          draft.startHour !== undefined &&
                          draft.endHour !== undefined
                            ? `${draft.startHour}:00〜${draft.endHour}:00`
                            : "";
                        return (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 border border-neutral-200"
                          >
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-bold ${config.badge}`}
                            >
                              {config.label}
                            </span>
                            <span className="font-bold text-neutral-900">
                              {personName}
                            </span>
                            <span className="text-neutral-700">
                              {draft.detail || "（内容未入力）"}
                            </span>
                            {(dayText || timeText) && (
                              <span className="ml-auto text-[11px] text-neutral-500 font-mono">
                                {[dayText, timeText].filter(Boolean).join(" ")}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      登録されている条件カードはありません。
                    </p>
                  )}

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setViewMode("detailed")}
                      className="text-xs font-bold text-indigo-600 hover:underline"
                    >
                      詳細を表示して編集する →
                    </button>
                  </div>
                </div>
              ) : (
                /* ===================== 詳細表示モード ===================== */
                <div data-testid="gemini-detailed-view">
                  {/* 制約カード一覧 */}
                  <div className="mt-4 space-y-3">
                    {drafts.map((draft, index) => {
                      const errors = validateReviewDraft(draft);
                      const timed = draft.type === "unavailable";
                      const config =
                        TYPE_CONFIG[draft.type] ?? TYPE_CONFIG.other;

                      return (
                        <div
                          key={index}
                          data-testid="constraint-card"
                          className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-xs border-l-4 ${config.border} transition-all`}
                        >
                          {/* 上段：種別バッジ（重なり防止で単一表示）＋対象者ドロップダウン */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
                            <div className="flex items-center gap-2">
                              {canEdit ? (
                                <select
                                  aria-label="条件の種別"
                                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${config.badge}`}
                                  value={draft.type}
                                  onChange={(e) =>
                                    updateDraft(index, {
                                      type: e.target.value as ConstraintType,
                                    })
                                  }
                                >
                                  {(
                                    Object.keys(TYPE_CONFIG) as ConstraintType[]
                                  ).map((t) => (
                                    <option key={t} value={t}>
                                      {TYPE_CONFIG[t].label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className={`rounded-md px-2.5 py-1 text-xs font-bold ${config.badge}`}
                                >
                                  {config.label}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="text-xs font-bold text-neutral-700">
                                対象:
                              </label>
                              <select
                                aria-label="対象の家族"
                                className={`rounded border px-2 py-1 text-xs font-bold ${
                                  draft.personId === ""
                                    ? "border-red-400 bg-red-50 text-red-900"
                                    : "border-neutral-300 bg-white text-neutral-800"
                                }`}
                                disabled={!canEdit}
                                value={draft.personId}
                                onChange={(e) =>
                                  updateDraft(index, {
                                    personId: e.target.value,
                                  })
                                }
                              >
                                <option value="">家族を選択…</option>
                                {snapshot?.people.map((person) => (
                                  <option key={person.id} value={person.id}>
                                    {person.name} ({getPersonRoleLabel(person)})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* 本文（内容） */}
                          <div className="mt-2.5">
                            <label className="text-[11px] font-bold text-neutral-600">
                              内容
                            </label>
                            <input
                              type="text"
                              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-900 disabled:opacity-50"
                              disabled={!canEdit}
                              maxLength={500}
                              value={draft.detail}
                              onChange={(e) =>
                                updateDraft(index, { detail: e.target.value })
                              }
                              placeholder="事情・条件の詳しい内容"
                            />
                          </div>

                          {/* 曜日選択 */}
                          <div className="mt-2.5">
                            <span className="text-[11px] font-bold text-neutral-600">
                              該当曜日
                            </span>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {DAY_LABELS.map((label, day) => {
                                const checked = draft.days.includes(
                                  day as DayIndex,
                                );
                                return (
                                  <button
                                    key={day}
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() =>
                                      toggleDraftDay(index, day as DayIndex)
                                    }
                                    className={`rounded px-2 py-0.5 text-xs font-semibold transition-all ${
                                      checked
                                        ? "bg-indigo-600 text-white"
                                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* 時刻設定＋曜日・時刻必須ラベル＋右端にゴミ箱アイコン削除ボタン */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-[11px] font-bold text-neutral-600">
                              時刻:
                            </span>
                            <select
                              aria-label="条件の開始時刻"
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                              disabled={!canEdit}
                              value={draft.startHour ?? ""}
                              onChange={(e) =>
                                updateDraft(index, {
                                  startHour:
                                    e.target.value === ""
                                      ? undefined
                                      : Number(e.target.value),
                                })
                              }
                            >
                              <option value="">指定なし</option>
                              {CONSTRAINT_START_HOURS.map((hour) => (
                                <option key={hour} value={hour}>
                                  {hour}:00
                                </option>
                              ))}
                            </select>
                            <span className="text-neutral-400">〜</span>
                            <select
                              aria-label="条件の終了時刻"
                              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                              disabled={!canEdit}
                              value={draft.endHour ?? ""}
                              onChange={(e) =>
                                updateDraft(index, {
                                  endHour:
                                    e.target.value === ""
                                      ? undefined
                                      : Number(e.target.value),
                                })
                              }
                            >
                              <option value="">指定なし</option>
                              {CONSTRAINT_END_HOURS.map((hour) => (
                                <option key={hour} value={hour}>
                                  {hour}:00
                                </option>
                              ))}
                            </select>
                            {timed && (
                              <span className="text-[10px] text-amber-700 font-medium">
                                ※曜日と時刻が必須
                              </span>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                aria-label="この条件を削除"
                                title="この条件を削除"
                                className="ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                onClick={() => removeDraft(index)}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>

                          {errors.length > 0 && (
                            <ul className="mt-2 list-disc pl-4 text-[11px] text-red-600 space-y-0.5">
                              {errors.map((err) => (
                                <li key={err}>{err}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}

                    {drafts.length === 0 && (
                      <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-xs text-neutral-500">
                        条件はまだありません。左のAIボタンまたは下のボタンから追加してください。
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      className="mt-3 rounded-lg border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 shadow-xs"
                      onClick={addDraft}
                    >
                      ＋ 条件を追加する
                    </button>
                  )}

                  {/* 家族の希望（縦幅を広く） */}
                  <div className="mt-6 border-t border-neutral-100 pt-4">
                    <label
                      htmlFor="family-hopes-textarea"
                      className="text-xs font-bold text-neutral-800 block"
                    >
                      家族の希望（自由記述・1行に1件）
                    </label>
                    <textarea
                      id="family-hopes-textarea"
                      className="mt-1.5 w-full min-h-36 resize-y rounded-xl border border-neutral-300 p-3 text-xs leading-relaxed disabled:opacity-50"
                      rows={6}
                      disabled={!canEdit}
                      value={hopesText}
                      onChange={(e) => handleHopesChange(e.target.value)}
                      placeholder="例：週末はできるだけ家族で過ごしたい&#10;入浴はプロの手を借りたい"
                    />
                  </div>

                  {/* 「分からないこと」は破線枠のボックスに一覧表示 */}
                  <div className="mt-6 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-5">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">❓</span>
                      <h3 className="text-xs font-bold text-amber-950">
                        分からないこと・書かれていないこと
                      </h3>
                    </div>
                    <p className="mt-1 text-[11px] text-amber-900 leading-relaxed">
                      面談で確認したい項目を残します（1行に1件）。
                    </p>
                    <textarea
                      aria-label="分からないこと・書かれていないこと"
                      className="mt-2.5 w-full rounded-xl border border-amber-300 bg-white p-3 text-xs leading-relaxed text-amber-950 disabled:opacity-50"
                      rows={3}
                      disabled={!canEdit}
                      value={unknownsText}
                      onChange={(e) => handleUnknownsChange(e.target.value)}
                      placeholder="例：退院後の薬の管理方法は誰が確認するか未定&#10;デイサービスの送迎ルートに入れるか事業所に未確認"
                    />
                  </div>
                </div>
              )}

              {/* 保存エラー・完了・統合アクションボタン */}
              {unbound > 0 && (
                <p className="mt-4 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800 border border-amber-200">
                  ⚠️ 対象の家族が未選択の条件が {unbound} 件あります。すべて選択するまで保存できません。
                </p>
              )}
              {careWindowErrors.length > 0 && (
                <p className="mt-4 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800 border border-amber-200">
                  ⚠️ 介護が必要な時間帯に未入力または不正な行があります。確認してから保存してください。
                </p>
              )}
              {saveError && (
                <p className="mt-4 rounded bg-red-50 p-2 text-xs font-bold text-red-700 border border-red-200">
                  {saveError}
                </p>
              )}
              {savedRevision !== null && (
                <p className="mt-4 rounded bg-emerald-50 p-2.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                  ✓ 条件・時間帯・負担割合をまとめて保存しました（新しい版：{savedRevision}）。
                </p>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
                <button
                  type="button"
                  className="rounded-xl bg-neutral-900 px-6 py-2.5 text-xs font-bold text-white hover:bg-neutral-800 disabled:opacity-40 shadow-sm"
                  disabled={!canEdit || !submittable || savingAll || !snapshot}
                  onClick={handleSaveAll}
                >
                  {savingAll
                    ? "保存中…"
                    : "条件・時間帯・負担割合をまとめて保存する"}
                </button>
                <Link
                  href={`/rooms/${roomId}/board`}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 flex items-center gap-1"
                >
                  <span>次へ（週間ボードへ進む）</span>
                  <span>→</span>
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
