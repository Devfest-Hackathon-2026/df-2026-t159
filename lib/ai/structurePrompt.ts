/**
 * Gemini 構造化（Issue 7）のプロンプト構築（純粋関数）。
 *
 * 入力は退院書類の画像（別パートで渡す）と家族の事情メモ。
 * プロンプト本文にメモを含めるため、ログ出力時はこの戻り値をそのまま出さないこと
 * （共通前提：メモ本文・制約本文はログに出さない）。
 */

export interface StructurePromptInput {
  /** ルームに登録済みの家族の名前一覧。memberName はこの名前をそのまま使わせる */
  peopleNames: string[];
  /** 家族の事情メモ（自由文） */
  memo: string;
  /** 画像が添付されているか */
  hasImages: boolean;
  /** 再実行時の失敗理由（どのルールで落ちたか） */
  retryReason?: string;
}

export function buildStructurePrompt(input: StructurePromptInput): string {
  const { peopleNames, memo, hasImages, retryReason } = input;
  const peopleList =
    peopleNames.length > 0
      ? peopleNames.map((name) => `- ${name}`).join("\n")
      : "（登録済みの家族はいません）";
  const imageNote = hasImages
    ? "添付された退院書類の画像と、下の事情メモの両方を読んでください。"
    : "下の事情メモだけが入力です。";

  const lines = [
    "あなたは、親の介護体制を決める家族の「聞き取りメモを整理する係」です。",
    "退院書類と家族の事情メモから、介護の役割分担に影響する制約を抜き出し、指定された JSON 形式で返してください。",
    imageNote,
    "",
    "## 家族一覧（memberName はこの名前をそのまま使うこと）",
    peopleList,
    "",
    "## 守ること",
    "- 書かれていないことを推測で補完しないこと。分からないことは unknowns に具体的に書くこと",
    "- 医療的な判断や診断の推測はしないこと。書かれた事実だけを扱うこと",
    "- type の値は以下の3つ（英語小文字）のいずれかのみを使用してください:",
    "  - unavailable: 開始時刻と終了時刻が特定できる対応不可＝その時間は介護できない（仕事・勤務・通院・外出・用事など理由は問わない。例: 平日9時から17時まで勤務、水曜14時から16時まで通院）",
    "  - hope: 本人や家族の希望・要望（例: 土日なら付き添い可能）",
    "  - other: その他（「平日の昼間」「午後」「土日に限り」のように具体的な開始・終了時刻が特定できない仕事や用事・対応不可の条件は、推測で時刻を決めず必ず type を other にし、startHour と endHour を null にすること）",
    "- unavailable は、曜日（days）と時刻（startHour, endHour）の両方が必須です。開始・終了時刻が分からない制約には unavailable を使わず必ず other を使用してください",
    "- days は曜日番号（月=0、火=1、水=2、木=3、金=4、土=5、日=6）の整数配列（例: [0, 1, 2, 3, 4]）。「平日」は [0,1,2,3,4]、「土日」は [5,6]、「毎日」は全曜日",
    "- 除外の言い回し（「水曜以外は無理」「それ以外は大丈夫」など）は、無理・対応不可な曜日だけを制約（unavailable）として取り出し、「それ以外は可能」といった条件は作らないこと",
    "- 時刻は24時間制の整数で、範囲は半開区間 [startHour, endHour) とする（例：9時から17時 → startHour=9, endHour=17）",
    "- 「午前中」「夕方」のように時刻が特定できない表現は、推測で時刻を決めないこと。type を other とし、startHour／endHour を null にし、detail に原文の表現を残し、その旨を unknowns にも書くこと",
    "- detail は入力の表現に忠実に、短く書くこと",
    "- 対象者が家族一覧にいない場合は条件（constraints）を作らず、その事情を unknowns に残すこと",
    "- 出力は指定スキーマの JSON のみ。前置きや説明文、マークダウンのコードフェンス（```）は付けないこと",
    "",
    "## 出力JSONの具体例（この形式に従ってJSONのみ出力してください）",
    "```json",
    "{",
    '  "constraints": [',
    "    {",
    '      "memberName": "長女",',
    '      "type": "unavailable",',
    '      "detail": "平日9時〜18時は仕事で付き添い不可",',
    '      "days": [0, 1, 2, 3, 4],',
    '      "startHour": 9,',
    '      "endHour": 18',
    "    },",
    "    {",
    '      "memberName": "母",',
    '      "type": "other",',
    '      "detail": "水曜午後は母が通院に付き添う必要がある",',
    '      "days": [2],',
    '      "startHour": null,',
    '      "endHour": null',
    "    }",
    "  ],",
    '  "hopes": ["土日に限り付き添いができる"],',
    '  "unknowns": ["母の水曜午後の通院の具体的な時間帯（開始・終了時刻）"]',
    "}",
    "```",
    "",
    "## 家族の事情メモ",
    memo,
  ];

  if (retryReason) {
    lines.push(
      "",
      "## 前回の出力が形式不正となった理由（必ず修正してください）",
      `- 失敗理由: ${retryReason}`,
      "- 上記の守ることと指定スキーマを厳密に守って再度出力してください。",
    );
  }

  return lines.join("\n");
}
