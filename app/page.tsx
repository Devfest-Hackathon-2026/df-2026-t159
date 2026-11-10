import Link from "next/link";
import Image from "next/image";
import DemoCreateButton from "@/components/DemoCreateButton";
import HomeReveal from "@/components/HomeReveal";
import RecentRoomsList from "@/components/RecentRoomsList";
import Logo from "@/components/Logo";
import { demoFixture } from "@/lib/demo-fixture";

export const dynamic = "force-dynamic";

const DAYS = ["月", "火", "水", "木", "金", "土", "日"];
const HOURS = Array.from({ length: 18 }, (_, index) => index + 6);
const ROW_HEIGHT = 18;

const PREVIEW_STYLES = {
  visit: { label: "訪問介護", color: "border-sky-200 bg-sky-100 text-sky-950" },
  daycare: { label: "通所介護", color: "border-emerald-200 bg-emerald-100 text-emerald-950" },
  dayrehab: { label: "通所リハビリ", color: "border-violet-200 bg-violet-100 text-violet-950" },
  family: { label: "家族の付き添い", color: "border-amber-200 bg-amber-100 text-amber-950" },
};

const FAMILY_LABELS: Record<string, string> = {
  "person-mother": "母の付き添い",
  "person-daughter": "長女の付き添い",
  "person-son": "長男の付き添い",
};

const FAMILY_ICONS: Record<string, string> = {
  "person-mother": "👵",
  "person-daughter": "👩",
  "person-son": "👨",
};

const SERVICE_LABELS: Record<string, string> = {
  visit: "訪問介護",
  daycare: "通所介護",
  dayrehab: "通所リハビリ",
  shortstay: "ショートステイ",
};

// トップページの静的な週間ボード見本（実際のデモ初期データ＝troubledPlan のシードに合わせる）
const PREVIEW_PLACEMENTS: {
  day: number;
  startHour: number;
  endHour: number;
  kind: keyof typeof PREVIEW_STYLES;
  label: string;
  icon?: string;
}[] = demoFixture.troubledPlan.placements.map((p) => ({
  day: p.day,
  startHour: p.startHour,
  endHour: p.endHour,
  kind: p.kind as keyof typeof PREVIEW_STYLES,
  label: (p.personId ? FAMILY_LABELS[p.personId] : undefined) ?? SERVICE_LABELS[p.kind] ?? "予定",
  icon: p.personId ? FAMILY_ICONS[p.personId] : undefined,
}));

function WeeklyBoardPreview() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-lg shadow-indigo-950/5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5 sm:px-5">
        <div>
          <p className="text-xs font-bold tracking-wider text-violet-600">できあがるプランのイメージ</p>
          <h2 id="preview-title" className="text-base font-bold text-neutral-900 sm:text-lg">家族の予定を、ひと目で。</h2>
        </div>
        <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">週間ボードの見本</span>
      </figcaption>

      <div className="px-3 py-2.5 sm:px-4 sm:py-3">
        <ul aria-label="予定の種類" className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
          {Object.entries(PREVIEW_STYLES).map(([kind, style]) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm border ${style.color}`} />
              {style.label}
            </li>
          ))}
        </ul>
        <p className="mb-2 text-xs text-neutral-500 sm:hidden">横にスクロールして、全曜日を確認できます。</p>

        <div
          role="region"
          aria-label="週間ボードの見本。横にスクロールして全曜日を確認できます"
          tabIndex={0}
          className="overflow-x-auto overscroll-x-contain rounded-lg border border-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600"
        >
          {/* SummarySheet と同じ、曜日列内に時刻と長さで予定を配置する方式。 */}
          <div className="min-w-[640px] text-xs">
            <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))] border-b border-neutral-200 bg-neutral-50 text-center font-semibold text-neutral-600">
              <div className="py-1 text-[11px]">時刻</div>
              {DAYS.map((day) => <div key={day} className="border-l border-neutral-200 py-1 text-[11px]">{day}曜</div>)}
            </div>
            <div className="grid grid-cols-[40px_repeat(7,minmax(0,1fr))]">
              <div aria-hidden="true" className="bg-neutral-50/70 font-mono text-[10px] text-neutral-500">
                {HOURS.map((hour) => (
                  <div key={hour} style={{ height: ROW_HEIGHT }} className="pr-1 text-right leading-none">
                    {hour % 3 === 0 ? `${hour}:00` : ""}
                  </div>
                ))}
              </div>
              {DAYS.map((day, dayIndex) => (
                <div key={day} role="group" aria-label={`${day}曜日の予定`} className="relative border-l border-neutral-200" style={{ height: HOURS.length * ROW_HEIGHT }}>
                  {HOURS.map((hour) => (
                    <div key={hour} aria-hidden="true" style={{ height: ROW_HEIGHT }} className="border-b border-neutral-100 last:border-b-0" />
                  ))}
                  {PREVIEW_PLACEMENTS.filter((placement) => placement.day === dayIndex).map((placement) => (
                    <div
                      key={`${day}-${placement.startHour}`}
                      className={`absolute inset-x-px overflow-hidden rounded-md border px-1 leading-tight ${PREVIEW_STYLES[placement.kind].color}`}
                      style={{ top: (placement.startHour - 6) * ROW_HEIGHT, height: (placement.endHour - placement.startHour) * ROW_HEIGHT }}
                      title={`${placement.label} ${placement.startHour}:00〜${placement.endHour}:00`}
                    >
                      <p className="truncate text-[10px] font-bold leading-tight">{placement.icon ? `${placement.icon} ` : ""}{placement.label}</p>
                      {(placement.endHour - placement.startHour) >= 2 && (
                        <p className="text-[9px] font-mono leading-none opacity-80 mt-0.5">{placement.startHour}:00–{placement.endHour}:00</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="border-t border-neutral-100 bg-neutral-50/70 py-0.5 pl-1 font-mono text-[10px] text-neutral-500">24:00</div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function HomePage() {
  return (
    <main className="mobile-page relative isolate min-h-screen bg-gradient-to-b from-violet-50 via-white to-indigo-50/60 px-4 py-4 sm:px-6 sm:py-6 lg:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[650px] overflow-hidden">
        <Image src="/carepact-family-chatgpt.png" alt="" fill priority sizes="100vw" className="object-cover object-top opacity-[0.32]" />
        <div className="absolute inset-0 bg-gradient-to-b from-violet-50/20 via-white/40 to-white" />
      </div>
      <HomeReveal />
      <div className="relative mx-auto max-w-[1440px]">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] xl:gap-8">
          <div className="xl:pt-1">
            <header className="home-intro">
              <div className="inline-flex items-center gap-2.5">
                <Logo className="h-9 w-auto shrink-0" />
                <span className="text-3xl font-extrabold tracking-tight text-indigo-950 sm:text-4xl">CarePact</span>
              </div>
              <p className="mt-3 text-xs font-bold tracking-wide text-violet-700 sm:text-sm">予定も費用も、付き添いの分担も。</p>
              <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-indigo-950 sm:text-4xl sm:leading-snug xl:text-[2.25rem]">
                家族で決める、<br />介護のかたち。
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-700 sm:text-base">
                誰が、いつ、どんなサービスを使うか。<br className="hidden sm:block" />
                費用と付き添いの負担を見ながら、<br className="hidden sm:block" />
                家族の希望をひとつのプランに。<br className="hidden sm:block" />
                ケアマネへの相談も、まとめシートで。
              </p>
            </header>

            <nav aria-label="はじめる" className="home-actions mt-5 grid max-w-xl gap-3 sm:grid-cols-2">
              <div className="[&>span]:flex [&>span]:flex-col [&>span]:items-stretch [&>span>button]:h-11 [&>span>button]:min-h-11 [&>span>button]:w-full [&>span>button]:rounded-xl [&>span>button]:border-0 [&>span>button]:bg-gradient-to-br [&>span>button]:from-violet-600 [&>span>button]:to-indigo-700 [&>span>button]:px-4 [&>span>button]:py-2.5 [&>span>button]:text-sm [&>span>button]:font-bold [&>span>button]:shadow-sm [&>span>button]:focus-visible:outline-2 [&>span>button]:focus-visible:outline-offset-4 [&>span>button]:focus-visible:outline-violet-600 [&>span>span]:block">
                <DemoCreateButton />
              </div>
              <div>
                <Link href="/rooms/new" className="flex h-11 min-h-11 items-center justify-center rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-950 shadow-sm hover:border-violet-400 hover:bg-violet-50/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-600">新しくルームを作成</Link>
              </div>
            </nav>

            <RecentRoomsList />
          </div>

          <section data-home-reveal aria-labelledby="preview-title" className="home-preview min-w-0">
            <WeeklyBoardPreview />
          </section>
        </div>

        <section data-home-reveal aria-labelledby="steps-title" className="mt-12 sm:mt-16">
          <h2 id="steps-title" className="text-center text-xl font-bold text-indigo-950 sm:text-2xl">家族の話し合いから、相談まで</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-6">
            {[
              { title: "家族の事情を入れる", detail: "予定や希望、できることを整理。" },
              { title: "週間ボードで組む", detail: "サービスと付き添いを組み合わせ。" },
              { title: "まとめシートでケアマネに相談", detail: "家族で考えたプランを共有。" },
            ].map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-violet-100 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-base font-bold text-violet-700">{index + 1}</span>
                  <h3 className="text-lg font-bold leading-relaxed text-neutral-800">{step.title}</h3>
                </div>
                <p className="mt-3 text-base leading-relaxed text-neutral-600">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
