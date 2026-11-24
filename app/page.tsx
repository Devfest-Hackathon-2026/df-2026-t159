import Link from "next/link";
import { scopeCopy } from "@/lib/scope-copy";
import Image from "next/image";
import DemoCreateButton from "@/components/DemoCreateButton";
import "./home.css";
import PlacementIcon from "@/components/PlacementIcon";
import HomeSplash from "@/components/HomeSplash";
import { openHomeSplash } from "@/lib/home-splash";
import { Users, CalendarDays, Bus, TriangleAlert } from "lucide-react";
import RecentRoomsList from "@/components/RecentRoomsList";
import Logo from "@/components/Logo";
import { demoFixture } from "@/lib/demo-fixture";
import { computePlacementColumns, DAYS, HOURS, KIND_LABELS } from "@/lib/board";
import type { Placement, PlacementKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const ROW_HEIGHT = 24;

const PREVIEW_COLORS: Record<PlacementKind, string> = {
  visit: "border-sky-300 bg-sky-100 text-sky-950",
  daycare: "border-emerald-300 bg-emerald-100 text-emerald-950",
  dayrehab: "border-fuchsia-400 bg-fuchsia-200 text-fuchsia-950",
  shortstay: "border-violet-300 bg-violet-100 text-violet-950",
  family: "border-amber-300 bg-amber-100 text-amber-950",
};

const PREVIEW_LEGEND_KINDS: readonly PlacementKind[] = [
  "visit",
  "daycare",
  "dayrehab",
  "family",
];

// トップページの静的な週間ボード見本（納得プラン＝acceptedPlan に合わせる）
const PREVIEW_PLACEMENTS: readonly Placement[] =
  demoFixture.acceptedPlan.placements;
const PREVIEW_VALIDATION = demoFixture.acceptedPlan.expectedValidationResult;
const PREVIEW_MEMBER_HOURS = PREVIEW_VALIDATION.memberHours.map((item) => {
  const person = demoFixture.people.find((p) => p.id === item.personId);
  return {
    personId: item.personId,
    name: person?.name ?? item.personId,
    hours: item.hours,
  };
});
const PREVIEW_TOTAL_CARE_HOURS = PREVIEW_MEMBER_HOURS.reduce(
  (sum, item) => sum + item.hours,
  0,
);

function previewLabelFor(placement: Placement): string {
  if (placement.kind === "family") {
    const person = demoFixture.people.find((p) => p.id === placement.personId);
    return `${person?.name ?? placement.personId}の付き添い`;
  }
  return KIND_LABELS[placement.kind];
}

function WeeklyBoardPreview() {
  const dayLayouts = DAYS.map((_, dayIndex) => {
    const placements = PREVIEW_PLACEMENTS.filter(
      (placement) => placement.day === dayIndex,
    );
    return {
      placements,
      columns: computePlacementColumns(placements),
    };
  });

  const monthlyUnitsText =
    PREVIEW_VALIDATION.monthlyUnits !== null
      ? `${PREVIEW_VALIDATION.monthlyUnits.toLocaleString()}単位`
      : "未判定";
  const selfPayYenText =
    PREVIEW_VALIDATION.selfPayYen !== null
      ? `${PREVIEW_VALIDATION.selfPayYen.toLocaleString()}円`
      : "未判定";

  return (
    <figure className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-lg shadow-indigo-950/5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5 sm:px-5">
        <div>
          <p className="text-xs font-bold tracking-wider text-violet-600">
            できあがるプランのイメージ
          </p>
          <h2
            id="preview-title"
            className="text-base font-bold text-neutral-900 sm:text-lg"
          >
            家族の予定を、ひと目で。
          </h2>
        </div>
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
          納得プランの見本（{demoFixture.familyProfile.familyName}・要介護3）
        </span>
      </figcaption>

      <div
        aria-label="納得プランの目安"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-emerald-100 bg-emerald-50/80 px-4 py-2 text-xs text-emerald-950 sm:px-5"
      >
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
            {PREVIEW_VALIDATION.overUnits === 0 ? "枠内" : "上限超過"}
          </span>
          <span>
            {monthlyUnitsText}（上限{" "}
            {PREVIEW_VALIDATION.limitUnits.toLocaleString()}単位以内）
          </span>
        </span>
        <span className="font-semibold">自己負担：{selfPayYenText}</span>
        <span className="font-semibold">
          家族の負担：
          {PREVIEW_MEMBER_HOURS.map((m) => `${m.name} ${m.hours}時間`).join(
            "・",
          )}
          （合計 {PREVIEW_TOTAL_CARE_HOURS}時間／週）
        </span>
      </div>

      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
        <ul
          aria-label="予定の種類"
          className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600"
        >
          {PREVIEW_LEGEND_KINDS.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-sm border ${PREVIEW_COLORS[kind]}`}
              />
              {KIND_LABELS[kind]}
            </li>
          ))}
        </ul>
        <p className="mb-2 text-xs text-neutral-500 sm:hidden">
          横にスクロールして、全曜日を確認できます。
        </p>

        <div
          role="region"
          aria-label="週間ボードの見本。横にスクロールして全曜日を確認できます"
          tabIndex={0}
          className="overflow-x-auto overscroll-x-contain rounded-lg border border-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600"
        >
          {/* 本物の週間ボード（WeeklyBoard）と同じ列分割アルゴリズムで配置する。 */}
          <div className="min-w-[660px] text-xs">
            <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-neutral-200 bg-neutral-50 text-center font-semibold text-neutral-700">
              <div className="py-1.5 text-[11px] text-neutral-500">時刻</div>
              {DAYS.map((day) => (
                <div
                  key={day}
                  className="border-l border-neutral-200 py-1.5 text-[11px]"
                >
                  {day}曜日
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))]">
              <div
                aria-hidden="true"
                className="bg-neutral-50/70 font-numeric tabular-nums text-[10px] text-neutral-500"
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: ROW_HEIGHT }}
                    className="border-b border-neutral-100 pr-1.5 pt-0.5 text-right leading-none last:border-b-0"
                  >
                    {hour}:00
                  </div>
                ))}
              </div>
              {DAYS.map((day, dayIndex) => {
                const { placements: dayPlacements, columns: columnLayouts } =
                  dayLayouts[dayIndex];
                return (
                  <div
                    key={day}
                    role="group"
                    aria-label={`${day}曜日の予定`}
                    className="relative border-l border-neutral-200"
                    style={{ height: HOURS.length * ROW_HEIGHT }}
                  >
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        aria-hidden="true"
                        style={{ height: ROW_HEIGHT }}
                        className="border-b border-neutral-100 last:border-b-0"
                      />
                    ))}
                    <div
                      className="pointer-events-none absolute inset-0 grid grid-cols-[minmax(0,1fr)]"
                      style={{
                        gridTemplateRows: `repeat(${HOURS.length}, ${ROW_HEIGHT}px)`,
                      }}
                    >
                      {dayPlacements.map((placement) => {
                        const layout = columnLayouts.get(placement.id) ?? {
                          column: 0,
                          totalColumns: 1,
                        };
                        const isOverlapping = layout.totalColumns > 1;
                        const widthPct = 100 / layout.totalColumns;
                        const leftPct = layout.column * widthPct;
                        const durationHours =
                          placement.endHour - placement.startHour;
                        const label = previewLabelFor(placement);
                        const displayLabel =
                          isOverlapping && placement.kind === "family"
                            ? label.replace(/の付き添い$/, "")
                            : label;
                        const timeRange = `${placement.startHour}:00〜${placement.endHour}:00`;
                        const displayTime = isOverlapping
                          ? `${placement.startHour}〜${placement.endHour}`
                          : timeRange;

                        return (
                          <div
                            key={placement.id}
                            className="relative grid grid-cols-[minmax(0,1fr)] min-w-0"
                            style={{
                              gridRow: `${placement.startHour - 5} / ${placement.endHour - 5}`,
                              gridColumn: "1",
                              width: `${widthPct}%`,
                              marginLeft: `${leftPct}%`,
                            }}
                          >
                            <div
                              className={`absolute inset-0.5 flex flex-col justify-center overflow-hidden rounded border px-1 shadow-2xs ${PREVIEW_COLORS[placement.kind]}`}
                              title={`${label} (${timeRange})`}
                            >
                              <span className="flex items-center gap-1 text-[11px] font-bold leading-tight">
                                {!isOverlapping && (
                                  <PlacementIcon
                                    kind={placement.kind}
                                    people={demoFixture.people}
                                    personId={placement.personId}
                                  />
                                )}
                                <span className="truncate">{displayLabel}</span>
                              </span>
                              {durationHours >= 2 && (
                                <span
                                  className={`mt-0.5 truncate font-numeric tabular-nums text-[10px] leading-none opacity-90 ${
                                    isOverlapping ? "-mx-0.5 text-center" : ""
                                  }`}
                                >
                                  {displayTime}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              aria-hidden="true"
              className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-t border-neutral-100 bg-neutral-50/70 font-numeric tabular-nums text-[10px] text-neutral-500"
            >
              <div className="py-0.5 pr-1.5 text-right leading-none">24:00</div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          {scopeCopy.estimate}
        </p>
      </div>
    </figure>
  );
}

function HomeActions() {
  return (
    <div className="actions">
      <DemoCreateButton className="button primary" />
      <Link className="button" href="/rooms/new">
        新しくルームを作成
      </Link>
    </div>
  );
}

export default function HomePage() {
  return (
    <main id="top" className="carepact-home">
      <HomeSplash />
      {/* トップ本文を解析する前に判定する。アプリ内遷移時はダイアログのrefで同じ処理を行う。 */}
      <script dangerouslySetInnerHTML={{
        __html: `(${openHomeSplash.toString()})(document.currentScript.previousElementSibling)`,
      }} />
      <div className="screenbar">
        <header>
          <a
            className="official-logo inline-flex items-center gap-2 text-3xl font-black text-indigo-950"
            href="#top"
          >
            <Logo />
            CarePact
          </a>
          <nav aria-label="ホームページ内の移動">
            <a href="#vision-title">CarePactについて</a>
            <a href="#features">できること</a>
            <a href="#rooms">あなたのルーム</a>
          </nav>
        </header>
      </div>
      <section className="hero">
        <Image
          className="photo"
          alt=""
          src="/carepact-family-chatgpt.png"
          fill
          sizes="100vw"
          priority
        />
        <div className="veil"></div>
        <div className="inside">
          <div className="intro">
            <p className="eyebrow">予定も費用も、付き添いの分担も。</p>
            <h1>
              家族で決める、
              <br />
              介護のかたち。
            </h1>
            <p>{scopeCopy.purpose}</p>
            <HomeActions />
            <RecentRoomsList />
          </div>
          <div className="official-board">
            <WeeklyBoardPreview />
          </div>
        </div>
      </section>
      <section className="vision" aria-labelledby="vision-title">
        <div className="vision-inner">
          <h2 id="vision-title">
            <span>家で暮らしたい。</span>
            <br />
            <span>支える家族にも、暮らしがある。</span>
          </h2>
          <p>
            「家で過ごしたい」という本人の願いも、「この時間ならそばにいられる」という家族の事情も、同じように大切です。
            <br />
            CarePactは、それぞれの思いを持ち寄って、家族が続けていける介護の形を一緒に考えられるようにしたいと思っています。
          </p>
        </div>
      </section>
      <section id="features" className="features">
        <h2>CarePactでできること</h2>
        <div className="cards">
          <article>
            <div className="sample">
              <div className="sheet">
                <strong>家族の事情</strong>
                <div className="line">
                  <b>対応不可　長女</b>
                  <br />
                  月〜金　9:00〜18:00
                  <br />
                  平日は仕事のため日中は対応できない
                </div>
              </div>
            </div>
            <h3>家族の事情を整理する</h3>
            <p>
              本人の希望や、家族が付き添えない時間を、予定を組む前に持ち寄れます。
            </p>
          </article>
          <article>
            <div className="sample">
              <div className="sheet">
                <strong>
                  <Users className="ui-icon" aria-hidden="true" />{" "}
                  家族の負担　合計 42 時間
                </strong>
                <div className="preview-row">
                  母<b>12時間／週</b>
                </div>
                <div className="preview-row">
                  長女<b>18時間／週</b>
                </div>
                <div className="preview-row">
                  長男<b>12時間／週</b>
                </div>
              </div>
            </div>
            <h3>予定・費用・分担を見比べる</h3>
            <p>
              予定を組み替えながら、月の費用と、一人ひとりの付き添い時間を確かめられます。
            </p>
          </article>
          <article>
            <div className="sample">
              <div className="sheet">
                <strong>
                  <CalendarDays className="ui-icon" aria-hidden="true" /> 2.
                  家族で考えた1週間の予定
                </strong>
                <div className="week-fragment">
                  <b>時刻</b>
                  <b>月曜</b>
                  <span>7:00</span>
                  <span className="visit-slot">
                    訪問介護（身体介護）
                    <br />
                    7:00〜9:00
                  </span>
                </div>
              </div>
            </div>
            <h3>ケアマネへの相談に持ち出す</h3>
            <p>
              週間予定と家族の分担を一枚にまとめて、面談で相談したいことを伝えられます。
            </p>
          </article>
        </div>
      </section>
      <div className="stories">
        <section className="story">
          <div>
            <h2>
              家族のメモから、
              <br />
              希望と条件を整理する。
            </h2>
            <p>
              仕事がある時間、本人が大切にしたいこと。家族のメモをAIが整理し、読み取った内容を家族が確かめてから予定づくりに進めます。
            </p>
          </div>
          <div className="example">
            <div className="piece">
              <strong>長女のメモ</strong>
              <blockquote className="excerpt">
                「私は平日9時から18時まで仕事があり、日中は父のそばにいられません。」
              </blockquote>
            </div>
            <div className="piece">
              <strong>Geminiの整理</strong>
              <dl>
                <dt>対応不可</dt>
                <dd>長女 · 月〜金 9:00〜18:00</dd>
              </dl>
            </div>
          </div>
        </section>
        <section className="story">
          <div>
            <h2>
              付き添いが足りない時間を、
              <br />
              週間ボードで見つける。
            </h2>
            <p>
              設定した「支援が必要な時間帯」と予定を照らし合わせ、手が足りない時間を見つけます。佐藤家の例では、通所介護が終わる正午からの2時間が、次の相談のきっかけになります。
            </p>
          </div>
          <div className="example warm">
            <div className="piece">
              <strong>水曜日</strong>
              <div className="day-fragment">
                <div>
                  <Bus className="ui-icon" aria-hidden="true" /> 通所介護
                  <br />
                  9:00〜12:00
                </div>
                <div>
                  <TriangleAlert className="ui-icon" aria-hidden="true" />{" "}
                  介護が必要
                  <br />
                  12:00〜14:00
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="story">
          <div>
            <h2>
              代替案を選ぶ前に、
              <br />
              費用と分担を比べる。
            </h2>
            <p>
              佐藤家の代替案では、水曜の通所介護を延ばし、火曜・木曜の通所リハを短縮。土曜の午前は長男が付き添います。家族は採用する前に、変更後の見込みを比べられます。
            </p>
          </div>
          <div className="example">
            <div className="piece">
              <strong>変更の要約</strong>
              <div>今のプラン → この代替案</div>
              <div className="preview-row">
                <span>月換算単位</span>
                <span>
                  28,131単位 → <b>24,094単位</b>
                </span>
              </div>
              <div className="preview-row">
                <span>月次自己負担（概算）</span>
                <span>
                  37,878円 → <b>24,094円</b>
                </span>
              </div>
              <div className="preview-row">
                <span>長女の付き添い</span>
                <span>
                  27時間/週 → <b>18時間/週</b>
                </span>
              </div>
            </div>
            <small>
              要介護3・自己負担1割の例。{scopeCopy.estimate}
            </small>
          </div>
        </section>
      </div>
      <section className="closing-cta" aria-labelledby="closing-title">
        <h2 id="closing-title">
          <span className="closing-brand">
            <Logo />
            CarePact
          </span>
        </h2>
        <p className="closing-message">介護の予定を、家族で組んでみよう。</p>
        <HomeActions />
      </section>
    </main>
  );
}
