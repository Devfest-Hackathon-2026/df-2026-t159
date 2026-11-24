"use client";

/**
 * 入力画面（統一UI・時間帯まとめ表示・色案F改）：
 * - 上部にステップ表示（1. 事情を入れる → 2. ボードで組む → 3. 確定・印刷）
 * - 見出し「まず、ご家族の事情を教えてください」
 * - 左カラム（PC表示／モバイル表示では家族カードの下）：
 *   - 退院書類の写真アップロードカード
 *   - 家族の事情メモの入力欄（AIで条件・希望の下書きを作る）
 *   - 介護が必要な時間帯（同じ時間帯の曜日をまとめ表示＋一括追加）と自己負担割合
 * - 右カラム：
 *   - 登録されている家族カード（コンパクト表示／モバイル縦積みでは先頭に維持）
 *   - 「Geminiの整理」統一UIパネル（簡易／詳細切替なし、その場編集）
 *   - 条件カード／家族の希望（自由記述・1行1件）／分からないことの行UI
 *   - 入力画面の保存を1つに統合（時間帯・負担割合・Geminiの整理をまとめて保存）
 */

import { Camera, FileText, PenLine, Settings, Sparkles, TriangleAlert, Upload, Users } from "lucide-react";
import { scopeCopy } from "@/lib/scope-copy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { doc, getDocFromServer } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRoomNavigationGuard } from "@/components/RoomShell";
import CareWindowsSection, { type EditingWindowGroup } from "./CareWindowsSection";
import { createDemoDischargeImage } from "@/lib/demo-discharge-image";
import DemoInputTutorial from "./DemoInputTutorial";
import GeminiReviewPanel from "./GeminiReviewPanel";
import { getIdToken, useAnonymousAuth } from "@/lib/auth";
import { AiApiError } from "@/lib/ai/errors";
import { validateStructureImageSelection } from "@/lib/ai/inputValidation";
import { bindStructureDrafts } from "@/lib/ai/structureSave";
import { replaceCareWindowsForDays } from "@/lib/care-windows-group";
import { demoFixture } from "@/lib/demo-fixture";
import {
  hasWeekendDaysSelected,
  hasSeenDemoInputTutorial,
  markDemoInputTutorialDone,
  markDemoInputTutorialStarted,
  type DemoInputTutorialStepNumber,
} from "@/lib/demo-input-tutorial";
import { fetchDemoStructureClient } from "@/lib/demo/client";
import { db } from "@/lib/firebase";
import {
  canDeletePerson,
  CARE_ROLE_LABELS,
  deriveCareRole,
  normalizePeople,
  validatePeopleCareRoles,
} from "@/lib/people";
import MemberAvatar from "@/components/MemberAvatar";
import {
  commitRoomChange,
  readOwnMembership,
  readRoomSnapshot,
} from "@/lib/rooms";
import {
  DraftBaseRevisionMissingError,
  RevisionConflictError,
  canSubmitStructure,
  careWindowDraftsFromWindows,
  clearInputScreenDraft,
  emptyReviewDraft,
  getInputScreenDraft,
  inferConstraintTypeFromDetail,
  linesToList,
  listToLines,
  resolveInputDraftSaveRevision,
  resolveNextDraftBaseRevision,
  resolveUniquePersonId,
  reviewDraftsFromSnapshot,
  reviewDraftsFromStructureResult,
  saveInputScreenDraft,
  separateDatelessHopes,
  toCareWindows,
  toStructureSaveConstraints,
  unboundDraftCount,
  validateCareWindowDrafts,
  validateInputSaveLimits,
  type CareWindowDraft,
  type ReviewDraft,
} from "@/lib/structure-review";
import type { StructureDraftResult } from "@/lib/ai/structureNormalize";
import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  firestorePaths,
  type CareRole,
  type CopayRate,
  type DayIndex,
  type MemberDoc,
  type Person,
  type RoomDoc,
  type RoomSnapshot,
} from "@/lib/types";

const ROLE_DOT_COLORS: Record<CareRole, string> = {
  recipient: "bg-[#65519A]",
  caregiver: "bg-emerald-700",
  family: "bg-gray-500",
};

function FamilyRoleDot({ role }: { role: CareRole }) {
  return <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${ROLE_DOT_COLORS[role]}`} />;
}

const DEMO_TUTORIAL_HIDDEN_WEEKEND_EVENING_SLOTS: ReadonlyArray<{
  day: DayIndex;
  startHour: number;
  endHour: number;
}> = [
  { day: 5, startHour: 17, endHour: 21 },
  { day: 6, startHour: 17, endHour: 21 },
];

export default function InputClient({ roomId }: { roomId: string }) {
  const router = useRouter();
  const {
    user,
    error: authError,
    retry: retryAuth,
  } = useAnonymousAuth();

  const [membership, setMembership] = useState<MemberDoc | null | undefined>(
    undefined,
  );
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  // 構造化の入力（既存の下書きがあれば初期復元）
  const initialSavedDraft = getInputScreenDraft(roomId);
  const [hasLocalDraft, setHasLocalDraft] = useState(
    Boolean(initialSavedDraft?.dirty),
  );
  const [memo, setMemo] = useState(initialSavedDraft?.memo ?? "");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
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

  // その場編集の状態
  const [editingDraft, setEditingDraft] = useState<{
    index: number;
    backup: ReviewDraft | null;
  } | null>(null);
  const [editingHope, setEditingHope] = useState<{
    index: number;
    value: string;
  } | null>(null);
  const [editingUnknown, setEditingUnknown] = useState<{
    index: number;
    value: string;
  } | null>(null);

  // 介護が必要な時間帯・自己負担割合の状態
  const [careWindowDrafts, setCareWindowDrafts] = useState<CareWindowDraft[]>(
    initialSavedDraft?.dirty ? initialSavedDraft.careWindowDrafts : [],
  );
  const [editingWindowGroup, setEditingWindowGroup] =
    useState<EditingWindowGroup | null>(null);
  const [copayRate, setCopayRate] = useState<CopayRate>(
    initialSavedDraft?.dirty ? initialSavedDraft.copayRate : 1,
  );
  const [showCopayDetail, setShowCopayDetail] = useState(false);

  // 統合保存の状態
  const [savingAll, setSavingAll] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{
    href: string;
    placement: "header" | "footer";
  } | null>(null);

  // 家族の追加・編集
  const [isEditingPeople, setIsEditingPeople] = useState(false);
  const [draftPeople, setDraftPeople] = useState<Person[]>([]);
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleDeleteWarnings, setPeopleDeleteWarnings] = useState<
    Record<string, string>
  >({});

  // デモルーム専用チュートリアル（表示レイヤーのみ）
  const [tutorialStep, setTutorialStep] =
    useState<DemoInputTutorialStepNumber | null>(null);
  const [tutorialSavedVisual, setTutorialSavedVisual] = useState(false);
  const demoImageInitialized = useRef(false);
  const memoGuideSlot = useRef<HTMLDivElement>(null);

  const canEdit = membership?.role === "family";
  useEffect(() => {
    if (!isDemo || !snapshot || demoImageInitialized.current) return;
    demoImageInitialized.current = true;
    try {
      setImageFiles([createDemoDischargeImage(demoFixture.documents.dischargeSummary)]);
    } catch {
      setImageError("見本の写真を用意できませんでした。写真を選択できます。");
    }
  }, [isDemo, snapshot]);

  const startDemoTutorial = useCallback(() => {
    markDemoInputTutorialStarted(roomId);
    setTutorialSavedVisual(false);
    setTutorialStep(1);
  }, [roomId]);

  useEffect(() => {
    if (isDemo && canEdit && snapshot && !hasSeenDemoInputTutorial(roomId)) {
      startDemoTutorial();
    }
  }, [isDemo, canEdit, snapshot, roomId, startDemoTutorial]);

  const isTutorialActive = isDemo && canEdit && tutorialStep !== null;

  const finishDemoTutorial = useCallback(() => {
    markDemoInputTutorialDone(roomId);
    setTutorialStep(null);
    setTutorialSavedVisual(false);
  }, [roomId]);

  const handleStartEditingPeople = () => {
    if (!snapshot || isTutorialActive) return;
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
        draftPeople.map((p, index) => ({
          id: p.id,
          name: p.name.trim(),
          canProvideCare: p.careRole === "caregiver",
          careRole: p.careRole,
          icon: p.icon,
          order: index,
        })),
      );
      const expectedRevision = snapshot.revision;
      const nextRevision = await commitRoomChange(roomId, expectedRevision, {
        people: normalized,
      });
      const existingDraft = getInputScreenDraft(roomId);
      if (
        existingDraft?.dirty &&
        existingDraft.baseRevision === expectedRevision
      ) {
        saveInputScreenDraft(roomId, {
          ...existingDraft,
          baseRevision: nextRevision,
        });
      }
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
      const nextDirty = next.dirty ?? existing?.dirty ?? true;
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
        dirty: nextDirty,
        baseRevision: resolveNextDraftBaseRevision(existing, snapshot?.revision),
      });
      setHasLocalDraft(nextDirty);
    },
    [
      roomId,
      memo,
      drafts,
      hopesText,
      unknownsText,
      careWindowDrafts,
      copayRate,
      snapshot?.revision,
    ],
  );

  const applySnapshot = useCallback(
    (snap: RoomSnapshot, forceOverwrite = false, roomIsDemo: boolean = false) => {
      setSnapshot(snap);
      setEditingDraft(null);
      setEditingHope(null);
      setEditingUnknown(null);
      setEditingWindowGroup(null);
      const saved = getInputScreenDraft(roomId);
      if (saved && saved.memo !== "") {
        setMemo(saved.memo);
      } else if (roomIsDemo && (!saved || !saved.dirty || forceOverwrite)) {
        setMemo(demoFixture.documents.familyMemo);
      }
      if (!forceOverwrite && saved?.dirty) {
        // 未保存の下書きがある場合は画面遷移後も失われないよう復元する
        // ただし対象が未選択または現在の家族一覧にない場合は、一意に名前が一致する人だけ補完する
        const peopleIds = new Set(snap.people.map((p) => p.id));
        const reboundDrafts = saved.drafts.map((d) => {
          const isMissingOrInvalid =
            d.personId === "" || !peopleIds.has(d.personId);
          if (isMissingOrInvalid && (!d.manualPersonId || d.personId !== "")) {
            return { ...d, personId: resolveUniquePersonId(d, snap.people) };
          }
          return d;
        });
        setDrafts(reboundDrafts);
        setHopesText(saved.hopesText);
        setUnknownsText(saved.unknownsText);
        setCareWindowDrafts(saved.careWindowDrafts);
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
      setCopayRate(snap.copayRate);
    },
    [roomId],
  );

  const refresh = useCallback(async () => {
    if (!user) return;
    setMembershipError(null);
    setLoadError(null);
    let member: MemberDoc | null;
    try {
      member = await readOwnMembership(roomId, user.uid);
    } catch {
      setMembershipError(scopeCopy.membershipLoadFailed);
      return;
    }
    setMembership(member);
    if (member) {
      // デモルーム判定は rooms/{roomId} の isDemo（RoomSnapshot には含まれない）
      let roomIsDemo = false;
      try {
        const roomSnap = await getDocFromServer(
          doc(db, firestorePaths.room(roomId)),
        );
        roomIsDemo = roomSnap.exists()
          ? ((roomSnap.data() as RoomDoc).isDemo ?? false)
          : false;
      } catch {
        roomIsDemo = false;
      }
      try {
        const snap = await readRoomSnapshot(roomId);
        if (snap) {
          setIsDemo(roomIsDemo);
          applySnapshot(snap, false, roomIsDemo);
        } else {
          setIsDemo(roomIsDemo);
          setTutorialStep(null);
          setLoadError(
            "ルームの読み込みに失敗しました。もう一度お試しください。",
          );
        }
      } catch {
        setIsDemo(roomIsDemo);
        setTutorialStep(null);
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
    const selectedFiles = imageFiles.slice(0, 2);
    const { errors: imageValidationErrors } = validateStructureImageSelection(
      0,
      selectedFiles,
    );
    if (imageValidationErrors.length > 0) {
      setStructureError(imageValidationErrors.join(" / "));
      return null;
    }
    const form = new FormData();
    form.set("roomId", roomId);
    form.set("memo", memo);
    for (const file of selectedFiles) {
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
    if (isTutorialActive) {
      if (tutorialStep === 3) {
        setTutorialStep(4);
      }
      return;
    }
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
      setEditingDraft(null);
      setEditingHope(null);
      setEditingUnknown(null);
      setSavedRevision(null);
      persistDraftState({
        drafts: separated.drafts,
        hopesText: nextHopesText,
        unknownsText: nextUnknownsText,
        dirty: true,
      });

      const remainingUnbound = unboundDraftCount(
        separated.drafts,
        snapshot?.people,
      );
      setStructureNotice(
        remainingUnbound > 0
          ? `下書きを作成しました。右側の「Geminiの整理」で未選択の対象（${remainingUnbound}件）を選び、内容を確認して保存してください。`
          : separated.drafts.length === 0
            ? "下書きを作成しました。「分からないこと・書かれていないこと」を確認し、必要に応じて条件を追加して保存してください。"
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
        if (
          "startHour" in patch ||
          "endHour" in patch ||
          patch.provisional === false
        ) {
          delete updated.provisional;
        }
        if (patch.detail !== undefined) {
          if (!updated.manualPersonId) {
            updated.personId = resolveUniquePersonId(
              { memberName: updated.memberName, detail: patch.detail },
              snapshot?.people,
            );
          }
          if (!updated.manualType) {
            updated.type = inferConstraintTypeFromDetail(patch.detail, "hope");
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
    setEditingDraft((prev) => {
      if (!prev) return null;
      if (prev.index === index) return null;
      if (prev.index > index) return { ...prev, index: prev.index - 1 };
      return prev;
    });
    setSavedRevision(null);
  };

  const addDraft = () => {
    const nextIndex = drafts.length;
    const next = [...drafts, emptyReviewDraft()];
    setDrafts(next);
    persistDraftState({ drafts: next, dirty: true });
    setEditingDraft({ index: nextIndex, backup: null });
    setSavedRevision(null);
  };

  const startEditDraft = (index: number) => {
    const target = drafts[index];
    if (!target) return;
    setEditingDraft({
      index,
      backup: { ...target, days: [...target.days] },
    });
  };

  const finishEditDraft = () => {
    setEditingDraft(null);
  };

  const cancelEditDraft = () => {
    if (!editingDraft) return;
    if (editingDraft.backup === null) {
      const next = drafts.filter((_, i) => i !== editingDraft.index);
      setDrafts(next);
      persistDraftState({ drafts: next, dirty: true });
    } else {
      const restored = editingDraft.backup;
      const next = drafts.map((d, i) =>
        i === editingDraft.index ? restored : d,
      );
      setDrafts(next);
      persistDraftState({ drafts: next, dirty: true });
    }
    setEditingDraft(null);
    setSavedRevision(null);
  };

  const handleMemoChange = (value: string) => {
    if (isTutorialActive) return;
    setMemo(value);
    const existing = getInputScreenDraft(roomId);
    const nextDirty = existing?.dirty ?? true;
    saveInputScreenDraft(roomId, {
      memo: value,
      drafts: existing?.drafts ?? drafts,
      hopesText: existing?.hopesText ?? hopesText,
      unknownsText: existing?.unknownsText ?? unknownsText,
      careWindowDrafts: existing?.careWindowDrafts ?? careWindowDrafts,
      copayRate: existing?.copayRate ?? copayRate,
      dirty: nextDirty,
      baseRevision: resolveNextDraftBaseRevision(existing, snapshot?.revision),
    });
    setHasLocalDraft(nextDirty);
  };

  const handleDiscardDraft = () => {
    clearInputScreenDraft(roomId);
    setHasLocalDraft(false);
    setPendingNavigation(null);
    setEditingDraft(null);
    setEditingHope(null);
    setEditingUnknown(null);
    setEditingWindowGroup(null);
    setMemo(isDemo ? demoFixture.documents.familyMemo : "");
    setStructureNotice(null);
    setStructureError(null);
    setSaveError(null);
    setSavedRevision(null);
    if (snapshot) {
      applySnapshot(snapshot, true, isDemo);
    } else {
      setDrafts([]);
      setHopesText("");
      setUnknownsText("");
      setCareWindowDrafts([]);
      setCopayRate(1);
    }
  };

  const hopesList = linesToList(hopesText);
  const unknownsList = linesToList(unknownsText);

  const handleAddHope = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nextText = listToLines([...linesToList(hopesText), trimmed]);
    setHopesText(nextText);
    persistDraftState({ hopesText: nextText, dirty: true });
    setSavedRevision(null);
  };

  const handleStartEditHope = (index: number) => {
    const list = linesToList(hopesText);
    if (index < 0 || index >= list.length) return;
    setEditingHope({ index, value: list[index] });
  };

  const handleSaveEditHope = (): boolean => {
    if (!editingHope) return false;
    const trimmed = editingHope.value.trim();
    if (!trimmed) return false;
    const nextList = linesToList(hopesText).map((item, i) =>
      i === editingHope.index ? trimmed : item,
    );
    const nextText = listToLines(nextList);
    setHopesText(nextText);
    persistDraftState({ hopesText: nextText, dirty: true });
    setEditingHope(null);
    setSavedRevision(null);
    return true;
  };

  const handleRemoveHope = (index: number) => {
    const nextList = linesToList(hopesText).filter((_, i) => i !== index);
    const nextText = listToLines(nextList);
    setHopesText(nextText);
    persistDraftState({ hopesText: nextText, dirty: true });
    setEditingHope((prev) => {
      if (!prev) return null;
      if (prev.index === index) return null;
      if (prev.index > index) return { ...prev, index: prev.index - 1 };
      return prev;
    });
    setSavedRevision(null);
  };

  const handleAddUnknown = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const nextText = listToLines([...linesToList(unknownsText), trimmed]);
    setUnknownsText(nextText);
    persistDraftState({ unknownsText: nextText, dirty: true });
    setSavedRevision(null);
  };

  const handleStartEditUnknown = (index: number) => {
    const list = linesToList(unknownsText);
    if (index < 0 || index >= list.length) return;
    setEditingUnknown({ index, value: list[index] });
  };

  const handleSaveEditUnknown = (): boolean => {
    if (!editingUnknown) return false;
    const trimmed = editingUnknown.value.trim();
    if (!trimmed) return false;
    const nextList = linesToList(unknownsText).map((item, i) =>
      i === editingUnknown.index ? trimmed : item,
    );
    const nextText = listToLines(nextList);
    setUnknownsText(nextText);
    persistDraftState({ unknownsText: nextText, dirty: true });
    setEditingUnknown(null);
    setSavedRevision(null);
    return true;
  };

  const handleRemoveUnknown = (index: number) => {
    const nextList = linesToList(unknownsText).filter((_, i) => i !== index);
    const nextText = listToLines(nextList);
    setUnknownsText(nextText);
    persistDraftState({ unknownsText: nextText, dirty: true });
    setEditingUnknown((prev) => {
      if (!prev) return null;
      if (prev.index === index) return null;
      if (prev.index > index) return { ...prev, index: prev.index - 1 };
      return prev;
    });
    setSavedRevision(null);
  };

  const handleCopayRateChange = (rate: CopayRate) => {
    if (isTutorialActive) return;
    setCopayRate(rate);
    setSavedRevision(null);
    persistDraftState({ copayRate: rate, dirty: true });
  };

  const handleChangeCareWindowDrafts = (next: CareWindowDraft[]) => {
    if (isTutorialActive) return;
    setCareWindowDrafts(next);
    persistDraftState({ careWindowDrafts: next, dirty: true });
    setSavedRevision(null);
  };

  const handleTutorialCareWindowsBulkAdd = (params: {
    days: DayIndex[];
    startHour: number;
    endHour: number;
    nextDrafts: CareWindowDraft[];
  }): string | null => {
    if (!hasWeekendDaysSelected(params.days)) {
      return "「土日」ボタン、または「土」「日」の曜日を選んでから「＋ まとめて追加」を押してください。";
    }
    if (params.startHour !== 17 || params.endHour !== 21) {
      return "時間帯を「17:00〜21:00」にしてから「＋ まとめて追加」を押してください。";
    }
    setTutorialStep(7);
    return null;
  };

  const effectiveHopesList =
    editingHope && editingHope.value.trim() !== ""
      ? hopesList.map((item, i) =>
          i === editingHope.index ? editingHope.value.trim() : item,
        )
      : hopesList;
  const effectiveUnknownsList =
    editingUnknown && editingUnknown.value.trim() !== ""
      ? unknownsList.map((item, i) =>
          i === editingUnknown.index ? editingUnknown.value.trim() : item,
        )
      : unknownsList;
  const editingWindowInvalid = editingWindowGroup
    ? editingWindowGroup.slots.some(
        (s) =>
          !(
            s.startHour >= BOARD_START_HOUR &&
            s.startHour < s.endHour &&
            s.endHour <= BOARD_END_HOUR
          ),
      )
    : false;
  const effectiveWindowDrafts =
    editingWindowGroup && !editingWindowInvalid
      ? replaceCareWindowsForDays(
          careWindowDrafts,
          editingWindowGroup.days,
          editingWindowGroup.slots.map((s) => ({
            startHour: s.startHour,
            endHour: s.endHour,
          })),
        )
      : careWindowDrafts;

  const careWindowErrors = validateCareWindowDrafts(effectiveWindowDrafts);
  const separatedForValidation = separateDatelessHopes(
    drafts,
    effectiveHopesList,
  );
  const saveLimitErrors = validateInputSaveLimits({
    drafts: separatedForValidation.drafts,
    hopes: separatedForValidation.hopes,
    unknowns: effectiveUnknownsList,
    careWindows: toCareWindows(effectiveWindowDrafts),
  });

  // 入力画面の保存を1つに統合（介護が必要な時間帯・自己負担割合・Geminiの整理をまとめて保存）
  const handleSaveAll = async (): Promise<boolean> => {
    if (isTutorialActive) {
      if (tutorialStep === 7) {
        setTutorialSavedVisual(true);
        setTutorialStep(8);
        return true;
      }
      return false;
    }
    if (!snapshot || !canEdit) return false;
    setSaveError(null);
    if (editingWindowInvalid) {
      setSaveError(
        "介護が必要な時間帯の開始時刻と終了時刻を確認してください。",
      );
      return false;
    }
    if (
      !canSubmitStructure(drafts, snapshot.people) ||
      careWindowErrors.length > 0
    ) {
      return false;
    }
    setSavingAll(true);
    try {
      // 曜日・時刻がない希望があれば保存時にも「家族の希望」へ集約する
      const separated = separateDatelessHopes(drafts, effectiveHopesList);
      const finalDrafts = separated.drafts;
      const finalHopes = separated.hopes;
      const finalUnknowns = effectiveUnknownsList;
      const finalCareWindows = toCareWindows(effectiveWindowDrafts);

      const limitErrors = validateInputSaveLimits({
        drafts: finalDrafts,
        hopes: finalHopes,
        unknowns: finalUnknowns,
        careWindows: finalCareWindows,
      });
      if (limitErrors.length > 0) {
        setSaveError(limitErrors[0]);
        return false;
      }

      const baseRevision = resolveInputDraftSaveRevision(
        getInputScreenDraft(roomId),
        snapshot.revision,
      );
      const token = await getIdToken();
      const peopleNames = new Map(snapshot.people.map((p) => [p.id, p.name]));
      const savePayload = {
        roomId,
        baseRevision,
        constraints: toStructureSaveConstraints(finalDrafts, peopleNames),
        hopes: finalHopes,
        unknowns: finalUnknowns,
        careWindows: finalCareWindows,
        copayRate,
      };
      // 保存APIと同じ形式を用意し、成功したときだけ下書き破棄の復元元にする。
      const savedInput = bindStructureDrafts(savePayload, snapshot.people);

      const res = await fetch("/api/structure/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(savePayload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        revision?: number;
      };
      if (!res.ok) {
        setSaveError(
          res.status === 409
            ? "他の人が先に内容を更新しました。再読み込みして、最新の内容で確認し直してください。"
            : (data.message ?? "保存に失敗しました。内容を確認してください。"),
        );
        return false;
      }

      const nextRevision = data.revision ?? snapshot.revision + 1;
      const nextHopesText = listToLines(savedInput.hopes);
      const nextUnknownsText = listToLines(savedInput.unknowns);
      const nextWindowDrafts = careWindowDraftsFromWindows(
        savedInput.careWindows ?? finalCareWindows,
      );

      // 保存で Gemini の整理が消えないよう、画面上の整理状態を維持したまま版と保存済み状態を更新する
      setDrafts(finalDrafts);
      setHopesText(nextHopesText);
      setUnknownsText(nextUnknownsText);
      setCareWindowDrafts(nextWindowDrafts);
      setEditingDraft(null);
      setEditingHope(null);
      setEditingUnknown(null);
      setEditingWindowGroup(null);
      setSavedRevision(nextRevision);
      setSnapshot((prev) =>
        prev ? { ...prev, ...savedInput, revision: nextRevision } : prev,
      );
      saveInputScreenDraft(roomId, {
        memo,
        drafts: finalDrafts,
        hopesText: nextHopesText,
        unknownsText: nextUnknownsText,
        careWindowDrafts: nextWindowDrafts,
        copayRate,
        dirty: false,
        baseRevision: nextRevision,
      });
      setHasLocalDraft(false);
      setPendingNavigation(null);
      return true;
    } catch (err) {
      if (err instanceof RevisionConflictError) {
        setSaveError(
          "他の人が先に内容を更新しました。再読み込みして、最新の内容で確認し直してください。",
        );
      } else if (
        err instanceof DraftBaseRevisionMissingError ||
        err instanceof AiApiError
      ) {
        setSaveError(err.message);
      } else {
        setSaveError("通信に失敗しました。もう一度お試しください。");
      }
      return false;
    } finally {
      setSavingAll(false);
    }
  };

  const handleNavigateWithGuard = (
    e: MouseEvent<HTMLElement>,
    href: string,
    placement: "header" | "footer" = "header",
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    if (!canEdit || !hasLocalDraft) {
      return;
    }
    e.preventDefault();
    setPendingNavigation({ href, placement });
  };

  const handleSaveAndProceed = async () => {
    if (!pendingNavigation) return;
    const targetHref = pendingNavigation.href;
    const saved = await handleSaveAll();
    if (saved) {
      router.push(targetHref);
    }
  };

  const handleProceedWithoutSaving = () => {
    if (!pendingNavigation) return;
    const targetHref = pendingNavigation.href;
    setPendingNavigation(null);
    router.push(targetHref);
  };

  const handleStayOnInput = () => {
    setPendingNavigation(null);
  };

  const handleHeaderNavigate = (e: MouseEvent<HTMLElement>, href: string) => {
    if (isTutorialActive && tutorialStep === 8 && href.endsWith("/board")) {
      finishDemoTutorial();
    }
    handleNavigateWithGuard(e, href);
  };
  const warningHost = useRoomNavigationGuard(handleHeaderNavigate);

  const renderUnsavedNavigationWarning = (placement: "header" | "footer") => {
    if (!pendingNavigation || pendingNavigation.placement !== placement) {
      return null;
    }
    const headingId = `unsaved-navigation-warning-${placement}`;
    return (
      <div
        role="region"
        aria-labelledby={headingId}
        className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 shadow-xs"
      >
        <div>
          <p id={headingId} className="font-bold flex items-center gap-1.5">
            <span aria-hidden="true"><TriangleAlert className="ui-icon" aria-hidden="true" /></span>
            <span>{scopeCopy.unsavedLeaveTitle}</span>
          </p>
          <p className="mt-0.5 text-amber-900">{scopeCopy.unsavedLeaveBody}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={savingAll || !snapshot}
            onClick={() => void handleSaveAndProceed()}
            className="rounded-lg bg-[#65519A] px-3.5 py-1.5 font-bold text-white hover:bg-[#564385] disabled:opacity-40 transition-colors"
          >
            {savingAll ? "保存中…" : scopeCopy.unsavedLeaveSaveAndProceed}
          </button>
          <button
            type="button"
            disabled={savingAll}
            onClick={handleProceedWithoutSaving}
            className="rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-40 transition-colors"
          >
            {scopeCopy.unsavedLeaveProceedWithoutSaving}
          </button>
          <button
            type="button"
            disabled={savingAll}
            onClick={handleStayOnInput}
            className="rounded-lg border border-[#E6DFD2] bg-white px-3.5 py-1.5 font-bold text-[#574468] hover:bg-[#F8F4EC] disabled:opacity-40 transition-colors"
          >
            {scopeCopy.unsavedLeaveStay}
          </button>
        </div>
      </div>
    );
  };

  const removeFile = (fileIndex: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== fileIndex));
    setImageError(null);
  };

  if (authError) {
    return (
      <div className="min-h-screen bg-[#F8F4EC] text-[#403346]">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold">入力</h1>
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-3"
          >
            <p>{authError}</p>
            <button
              type="button"
              onClick={retryAuth}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100 transition-colors"
            >
              再試行
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (membershipError) {
    return (
      <div className="min-h-screen bg-[#F8F4EC] text-[#403346]">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold">入力</h1>
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-3"
          >
            <p>{membershipError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100 transition-colors"
            >
              再試行
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (user === null || membership === undefined) {
    return (
      <div className="min-h-screen bg-[#F8F4EC] text-[#403346]">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold">入力</h1>
          <p className="mt-4 text-[#574468]">読み込み中…</p>
        </main>
      </div>
    );
  }

  if (membership === null) {
    return (
      <div className="min-h-screen bg-[#F8F4EC] text-[#403346]">
        <main className="mx-auto max-w-4xl px-6 py-12">
          <h1 className="text-2xl font-bold">入力</h1>
          <p className="mt-4 text-[#403346]">
            このルームにはまだ参加していません。先にルームの入口から招待リンクで参加してください。
          </p>
          <p className="mt-4 text-sm">
            <Link
              className="underline font-bold text-[#65519A]"
              href={`/rooms/${roomId}`}
            >
              ルームの入口へ
            </Link>
          </p>
        </main>
      </div>
    );
  }

  const unbound = unboundDraftCount(drafts, snapshot?.people);
  const maskRightPanel = isTutorialActive && tutorialStep <= 3;
  const submittable =
    canSubmitStructure(drafts, snapshot?.people) &&
    careWindowErrors.length === 0 &&
    saveLimitErrors.length === 0;

  return (
    <div
      data-testid="input-page-root"
      className="min-h-screen bg-[#F8F4EC] text-[#403346] pb-16"
    >
      {warningHost && createPortal(renderUnsavedNavigationWarning("header"), warningHost)}

      <div className="border-b border-[#E6DFD2] bg-white shadow-2xs">
        <div className="room-header-row flex flex-col justify-center py-2">
          <h1 className="text-2xl font-extrabold text-[#403346] sm:text-3xl">
            まず、ご家族の事情を教えてください
          </h1>
          {isDemo && canEdit && snapshot && tutorialStep === null && (
            <button
              type="button"
              onClick={startDemoTutorial}
              disabled={savingAll || structuring || peopleSaving}
              className="mt-1 self-start rounded py-2 text-sm font-semibold text-[#65519A] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              チュートリアルをもう一度見る
            </button>
          )}

          {!canEdit && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
              ※ あなたの役割はケアマネ（閲覧のみ）のため、この画面での入力・保存はできません。入力の更新は家族だけが行えます。
            </p>
          )}
          {loadError && (
            <div
              role="alert"
              className="mt-3 flex flex-wrap items-center gap-3 text-xs text-red-700"
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded border border-red-300 bg-white px-2.5 py-1 font-bold text-red-700 hover:bg-red-50"
              >
                再試行
              </button>
            </div>
          )}
        </div>
      </div>

      {/* メイン 2カラムレイアウト */}
      <main className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-8">
        {canEdit && hasLocalDraft && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950"
          >
            <div>
              <p className="font-bold">未保存の下書きがあります</p>
              <p className="mt-0.5 text-amber-900">
                {scopeCopy.localDraftNotice}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-900 hover:bg-amber-100 transition-colors"
            >
              下書きを破棄する
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-[auto_1fr] gap-x-8 gap-y-6 lg:gap-y-4 items-start">
          {/* ===================== 右カラム先頭（モバイルでは先頭表示）：登録されている家族カード ===================== */}
          {snapshot && (
            <section
              aria-label="登録されている家族"
              className="lg:col-start-2 lg:row-start-1 rounded-2xl border border-[#E6DFD2] bg-white px-4 py-3 shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-[#E6DFD2] pb-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#403346] flex items-center gap-1.5">
                    <span><Users className="ui-icon text-[#574468]" aria-hidden="true" /></span>
                    <span>登録されている家族</span>
                  </h2>
                  <span className="text-xs text-[#574468]">
                    {snapshot.people.length}名
                  </span>
                </div>
                {canEdit && !isEditingPeople && (
                  <button
                    type="button"
                    className="rounded-lg border border-[#E6DFD2] bg-white px-2.5 py-0.5 text-xs font-semibold text-[#65519A] hover:bg-[#EFEAF6] transition-colors"
                    onClick={handleStartEditingPeople}
                  >
                    家族を追加・編集
                  </button>
                )}
              </div>

              {!isEditingPeople ? (
                <>
                  <ul aria-label="家族一覧" className="mt-1.5 flex flex-wrap gap-1.5">
                    {snapshot.people.map((person, index) => {
                      const role = deriveCareRole(person, snapshot.people);
                      return (
                        <li
                          key={person.id}
                          title={CARE_ROLE_LABELS[role]}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-[#E6DFD2] bg-white py-0.5 pl-1 pr-2 text-xs"
                        >
                          <MemberAvatar name={person.name} index={index} className="h-6 w-6 text-[10px]" />
                          <span className="min-w-0 wrap-anywhere font-semibold text-[#403346]">
                            {person.name}
                          </span>
                          <FamilyRoleDot role={role} />
                          <span className="sr-only">{CARE_ROLE_LABELS[role]}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <ul aria-label="役割の凡例" className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-[#574468]">
                    {(["recipient", "caregiver", "family"] as const).map((role) => (
                      <li key={role} className="inline-flex items-center gap-1">
                        <FamilyRoleDot role={role} />
                        {CARE_ROLE_LABELS[role]}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="mt-3 space-y-2.5">
                  <p className="text-xs text-[#574468]">
                    介護を受ける人をちょうど1人、付き添いができる家族を1人以上指定してください。
                  </p>
                  <div className="space-y-2">
                    {draftPeople.map((person, index) => (
                      <div
                        key={person.id}
                        className="rounded-lg border border-[#E6DFD2] bg-[#FAF7F1] p-2 space-y-1"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <MemberAvatar name={person.name} index={index} />
                          <input
                            className="w-36 sm:w-44 rounded border border-[#E6DFD2] bg-white px-2.5 py-1.5 text-sm text-[#403346] focus:border-[#65519A] focus:outline-hidden"
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
                            className="rounded border border-[#E6DFD2] bg-white px-2.5 py-1.5 text-sm text-[#403346] focus:border-[#65519A] focus:outline-hidden"
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
                            className="text-xs text-[#991b1b] hover:underline font-medium ml-auto px-2 py-1"
                            onClick={() => handleDeletePerson(person.id)}
                          >
                            削除
                          </button>
                        </div>
                        {peopleDeleteWarnings[person.id] && (
                          <p className="text-xs text-red-600 font-medium">
                            <TriangleAlert className="ui-icon" aria-hidden="true" /> {peopleDeleteWarnings[person.id]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="rounded border border-dashed border-[#E6DFD2] bg-white px-3 py-1.5 text-xs font-bold text-[#65519A] hover:bg-[#EFEAF6]"
                    onClick={handleAddPerson}
                  >
                    ＋ 家族を追加
                  </button>

                  {peopleError && (
                    <p className="text-xs text-red-700 font-semibold">
                      {peopleError}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6DFD2]">
                    <button
                      type="button"
                      className="rounded-lg border border-[#E6DFD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#574468] hover:bg-[#F8F4EC] disabled:opacity-50"
                      disabled={peopleSaving}
                      onClick={handleCancelEditingPeople}
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#65519A] px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#564385] disabled:opacity-50"
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

          {/* ===================== 左カラム ===================== */}
          <div className="space-y-6 lg:col-start-1 lg:row-start-1 lg:row-span-2">

            {/* 1. 退院書類の写真アップロードカード */}
            <section
              aria-label="書類の写真アップロード"
              data-tutorial-target="documents-section"
              className="rounded-2xl border border-[#E6DFD2] bg-white p-6 shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-[#E6DFD2] pb-3">
                <h2 className="text-base font-bold text-[#403346] flex items-center gap-2">
                  <span><Camera className="ui-icon text-[#574468]" aria-hidden="true" /></span> 退院書類の写真
                </h2>
                <span className="text-xs text-[#574468] font-medium">
                  最大2枚（各5MBまで）
                </span>
              </div>

              <p className="mt-2 text-xs text-[#574468] leading-relaxed">
                写真は保存されません。{isDemo && scopeCopy.beforeInput}
              </p>

              <div className="mt-4">
                <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#E6DFD2] bg-[#FAF7F1] p-6 text-center hover:bg-[#EFEAF6]/40 cursor-pointer transition-colors">
                  <span className="text-3xl text-[#574468]"><Upload className="ui-icon" aria-hidden="true" /></span>
                  <span className="mt-2 text-xs font-bold text-[#65519A]">
                    写真を選択またはドロップ
                  </span>
                  <span className="mt-0.5 text-[11px] text-[#574468]">
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
                      e.target.value = "";
                      if (!user || !canEdit || files.length === 0) return;
                      const { acceptedIndices, errors } =
                        validateStructureImageSelection(
                          imageFiles.length,
                          files,
                        );
                      if (acceptedIndices.length > 0) {
                        const acceptedFiles = acceptedIndices.map(
                          (idx) => files[idx],
                        );
                        setImageFiles((prev) => [...prev, ...acceptedFiles]);
                      }
                      setImageError(
                        errors.length > 0 ? errors.join(" / ") : null,
                      );
                    }}
                  />
                </label>
              </div>

              {imageError && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700"
                >
                  {imageError}
                </p>
              )}

              {/* 選択したファイル名・状態・サムネイルプレビュー */}
              {imageFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-xs font-bold text-[#403346]">
                    選択中のファイル（{imageFiles.length} / 2枚）
                  </h3>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {imageFiles.map((file, i) => (
                      <li
                        key={`${file.name}-${i}`}
                        className="flex items-center gap-3 rounded-lg bg-[#FAF7F1] p-2.5 text-xs border border-[#E6DFD2]"
                      >
                        {imagePreviewUrls[i] && (
                          <img
                            src={imagePreviewUrls[i]}
                            alt={`${file.name}のプレビュー`}
                            data-testid="image-preview-thumbnail"
                            className="h-16 w-16 shrink-0 rounded-md border border-[#E6DFD2] bg-white object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm shrink-0 text-[#574468]"><FileText className="ui-icon" aria-hidden="true" /></span>
                            <span className="font-medium text-[#403346] truncate">
                              {file.name}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] text-[#574468] shrink-0">
                              ({(file.size / 1024).toFixed(0)} KB)
                            </span>
                            <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800 shrink-0">
                              準備完了
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => removeFile(i)}
                                className="text-xs text-[#991b1b] hover:underline font-bold shrink-0 ml-auto"
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
              className="rounded-2xl border border-[#E6DFD2] bg-white p-6 shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-[#E6DFD2] pb-3">
                <h2 className="text-base font-bold text-[#403346] flex items-center gap-2">
                  <span><PenLine className="ui-icon text-[#574468]" aria-hidden="true" /></span> 家族の事情メモ
                </h2>
                <span className="text-xs text-[#574468] font-mono">
                  {memo.length} / 4,000字
                </span>
              </div>

              {isDemo && (
                <p className="mt-2 text-xs text-[#574468] leading-relaxed">
                  {scopeCopy.beforeInput}
                </p>
              )}

              <textarea
                className="mt-3 w-full rounded-xl border border-[#E6DFD2] bg-white p-3 text-xs leading-relaxed text-[#403346] disabled:opacity-50 focus:border-[#65519A] focus:ring-1 focus:ring-[#65519A] focus:outline-hidden"
                rows={6}
                maxLength={4000}
                disabled={!canEdit}
                data-tutorial-target="memo-section"
                readOnly={isTutorialActive}
                value={memo}
                onChange={(e) => handleMemoChange(e.target.value)}
                placeholder="例：父は来週退院予定で要介護3。長女は平日フルタイム勤務のため日中は対応不可。母は同居だが腰痛のため重い介助は困難。平日は通所介護や訪問介護を利用したい…"
              />
              <div ref={memoGuideSlot} />

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  data-tutorial-target="ai-structure-btn"
                  className="rounded-xl bg-[#65519A] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#564385] disabled:opacity-50 transition-colors flex items-center gap-2"
                  disabled={!canEdit || structuring}
                  onClick={handleStructure}
                >
                  <span><Sparkles className="ui-icon" aria-hidden="true" /></span>
                  <span>
                    {structuring
                      ? "事情メモから整理中…"
                      : "家族の事情メモから条件・希望の下書きを作る（AI）"}
                  </span>
                </button>
                {structuring && (
                  <span className="text-xs text-[#65519A] animate-pulse font-medium">
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
                <p className="mt-3 rounded-lg border border-[#DDD4EC] bg-[#EFEAF6] p-3 text-xs font-medium text-[#403346]">
                  {structureNotice}
                </p>
              )}
            </section>

            {/* 3. 介護が必要な時間帯と自己負担割合の設定 */}
            <section
              aria-label="介護が必要な時間帯と自己負担割合の設定"
              className="rounded-2xl border border-[#E6DFD2] bg-white p-6 shadow-xs"
            >
              <div className="flex items-center justify-between border-b border-[#E6DFD2] pb-3">
                <h2 className="text-base font-bold text-[#403346] flex items-center gap-2">
                  <span><Settings className="ui-icon text-[#574468]" aria-hidden="true" /></span> 介護が必要な時間帯と自己負担割合
                </h2>
              </div>

              <p className="mt-2 text-xs text-[#574468] leading-relaxed">
                {scopeCopy.scheduleHours} {scopeCopy.gapScope}
              </p>

              {/* 自己負担割合 */}
              <div
                data-tutorial-target="copay-rate"
                className="mt-4 rounded-xl bg-[#FAF7F1] p-4 border border-[#E6DFD2]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#403346]">
                    自己負担割合
                  </span>
                  <button
                    type="button"
                    aria-expanded={showCopayDetail}
                    onClick={() => setShowCopayDetail((prev) => !prev)}
                    className="text-xs font-semibold text-[#65519A] hover:underline"
                  >
                    {showCopayDetail ? "詳細を隠す ▲" : "所得による目安（詳細表示） ▼"}
                  </button>
                </div>
                <div
                  role="radiogroup"
                  aria-label="自己負担割合"
                  className="mt-2 inline-flex overflow-hidden rounded-lg border border-[#E6DFD2] bg-white text-xs font-bold"
                >
                  {([1, 2, 3] as CopayRate[]).map((rate, idx) => {
                    const checked = copayRate === rate;
                    return (
                      <label
                        key={rate}
                        className={`cursor-pointer px-3.5 py-1.5 transition-colors focus-within:outline-2 focus-within:outline-[#65519A] focus-within:-outline-offset-2 ${
                          idx > 0 ? "border-l border-[#E6DFD2]" : ""
                        } ${
                          checked
                            ? "bg-[#65519A] text-white"
                            : "bg-white text-[#574468] hover:bg-[#F8F4EC]"
                        } ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <input
                          type="radio"
                          name="copayRate"
                          disabled={!canEdit}
                          checked={checked}
                          onClick={(e) => {
                            if (isTutorialActive) e.preventDefault();
                          }}
                          onChange={() => handleCopayRateChange(rate)}
                          className="sr-only"
                        />
                        <span>{rate}割</span>
                      </label>
                    );
                  })}
                </div>
                {showCopayDetail && (
                  <p className="mt-2.5 rounded-lg bg-white p-2.5 text-[11px] text-[#574468] border border-[#E6DFD2] leading-relaxed">
                    所得による目安：一般的な所得の方は1割、一定以上の所得がある方は2割・3割です（介護保険負担割合証で確認できます）。
                  </p>
                )}
              </div>

              {/* careWindows（介護が必要な時間帯） */}
              <CareWindowsSection
                careWindowDrafts={careWindowDrafts}
                canEdit={canEdit && (!isTutorialActive || tutorialStep === 6)}
                editingGroup={isTutorialActive ? null : editingWindowGroup}
                onChangeEditingGroup={setEditingWindowGroup}
                onChangeCareWindowDrafts={handleChangeCareWindowDrafts}
                careWindowErrors={careWindowErrors}
                hiddenDays={
                  isTutorialActive && tutorialStep <= 5 ? [5, 6] : undefined
                }
                hiddenSlots={
                  isTutorialActive && tutorialStep === 6
                    ? DEMO_TUTORIAL_HIDDEN_WEEKEND_EVENING_SLOTS
                    : undefined
                }
                tutorialMode={isTutorialActive && tutorialStep === 6}
                onTutorialBulkAdd={
                  isTutorialActive && tutorialStep === 6
                    ? handleTutorialCareWindowsBulkAdd
                    : undefined
                }
              />
            </section>
          </div>

          {/* ===================== 右カラム（Geminiの整理パネル） ===================== */}
          <div className={`space-y-6 lg:col-start-2 ${snapshot ? "lg:row-start-2" : "lg:row-start-1"}`}>
            <GeminiReviewPanel
              drafts={maskRightPanel ? [] : drafts}
              hopes={maskRightPanel ? [] : hopesList}
              unknowns={maskRightPanel ? [] : unknownsList}
              people={snapshot?.people ?? []}
              canEdit={canEdit && !isTutorialActive}
              editingDraftIndex={editingDraft?.index ?? null}
              onStartEditDraft={startEditDraft}
              onFinishEditDraft={finishEditDraft}
              onCancelEditDraft={cancelEditDraft}
              onAddDraft={addDraft}
              onUpdateDraft={updateDraft}
              onToggleDraftDay={toggleDraftDay}
              onRemoveDraft={removeDraft}
              editingHope={editingHope}
              onStartEditHope={handleStartEditHope}
              onChangeEditingHope={(value) =>
                setEditingHope((prev) => (prev ? { ...prev, value } : prev))
              }
              onSaveEditHope={handleSaveEditHope}
              onCancelEditHope={() => setEditingHope(null)}
              onAddHope={handleAddHope}
              onRemoveHope={handleRemoveHope}
              editingUnknown={editingUnknown}
              onStartEditUnknown={handleStartEditUnknown}
              onChangeEditingUnknown={(value) =>
                setEditingUnknown((prev) => (prev ? { ...prev, value } : prev))
              }
              onSaveEditUnknown={handleSaveEditUnknown}
              onCancelEditUnknown={() => setEditingUnknown(null)}
              onAddUnknown={handleAddUnknown}
              onRemoveUnknown={handleRemoveUnknown}
            >
              {/* 保存エラー・完了・統合アクションボタン */}
              {!maskRightPanel && unbound > 0 && (
                <p className="mt-4 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800 border border-amber-200">
                  <TriangleAlert className="ui-icon" aria-hidden="true" /> 対象の家族が未選択の条件が {unbound} 件あります。すべて選択するまで保存できません。
                </p>
              )}
              {careWindowErrors.length > 0 && (
                <p className="mt-4 rounded bg-amber-50 p-2 text-xs font-bold text-amber-800 border border-amber-200">
                  <TriangleAlert className="ui-icon" aria-hidden="true" /> 介護が必要な時間帯に未入力または不正な行があります。確認してから保存してください。
                </p>
              )}
              {saveLimitErrors.length > 0 && (
                <div
                  role="alert"
                  className="mt-4 rounded bg-red-50 p-3 text-xs font-bold text-red-700 border border-red-200 space-y-1"
                >
                  <p><TriangleAlert className="ui-icon" aria-hidden="true" /> 保存上限を超えている項目があります。内容を減らしてから保存してください。</p>
                  <ul className="list-disc pl-5 font-medium space-y-0.5">
                    {saveLimitErrors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {saveError && (
                <p className="mt-4 rounded bg-red-50 p-2 text-xs font-bold text-red-700 border border-red-200">
                  {saveError}
                </p>
              )}
              {(savedRevision !== null ||
                (isTutorialActive && tutorialSavedVisual)) && (
                <p className="mt-4 rounded bg-emerald-50 p-2.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                  ✓ 条件・時間帯・負担割合をまとめて保存しました。
                </p>
              )}

              {renderUnsavedNavigationWarning("footer")}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E6DFD2] pt-4">
                <button
                  type="button"
                  data-tutorial-target="save-btn"
                  className="rounded-xl border border-[#65519A] bg-white px-6 py-2.5 text-xs font-bold text-[#65519A] hover:bg-[#EFEAF6] disabled:opacity-40 transition-colors"
                  disabled={!canEdit || (!isTutorialActive && !submittable) || savingAll || !snapshot}
                  onClick={() => void handleSaveAll()}
                >
                  {savingAll
                    ? "保存中…"
                    : "条件・時間帯・負担割合をまとめて保存する"}
                </button>
                <Link
                  href={`/rooms/${roomId}/board`}
                  data-tutorial-target="board-link"
                  onClick={(e) => {
                    if (isTutorialActive && tutorialStep === 8) {
                      finishDemoTutorial();
                    }
                    handleNavigateWithGuard(
                      e,
                      `/rooms/${roomId}/board`,
                      "footer",
                    );
                  }}
                  className="rounded-xl bg-[#65519A] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#574468] flex items-center gap-1 shadow-xs transition-colors"
                >
                  <span>次へ（週間ボードへ進む）</span>
                  <span>→</span>
                </Link>
              </div>
            </GeminiReviewPanel>
          </div>
        </div>
      </main>

      {isTutorialActive && tutorialStep !== null && (
        <DemoInputTutorial
          step={tutorialStep}
          memoGuideSlot={memoGuideSlot.current}
          onNext={() => {
            if (tutorialStep === 1) {
              setTutorialStep(2);
            } else if (tutorialStep === 2) {
              setTutorialStep(3);
            } else if (tutorialStep === 4) {
              setTutorialStep(5);
            } else if (tutorialStep === 5) {
              setTutorialStep(6);
            }
          }}
          onClose={finishDemoTutorial}
        />
      )}
    </div>
  );
}
