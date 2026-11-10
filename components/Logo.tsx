/**
 * CarePact のロゴマーク（案X：週間ボードのマスで組んだ「CP」）。
 * CとPをボードのマス（タイル）で描き、Pの角の1マスだけ赤くして
 * 「合意の1マス」をアクセントにしている。
 */
export default function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 27 20" className={className} aria-hidden="true" focusable="false">
      <g fill="#312e81">
        {/* C */}
        <rect x="5.25" y="1" width="2.9" height="2.9" rx="0.8" />
        <rect x="9" y="1" width="2.9" height="2.9" rx="0.8" />
        <rect x="1.5" y="4.75" width="2.9" height="2.9" rx="0.8" />
        <rect x="1.5" y="8.5" width="2.9" height="2.9" rx="0.8" />
        <rect x="1.5" y="12.25" width="2.9" height="2.9" rx="0.8" />
        <rect x="5.25" y="16" width="2.9" height="2.9" rx="0.8" />
        <rect x="9" y="16" width="2.9" height="2.9" rx="0.8" />
        {/* P */}
        <rect x="15" y="1" width="2.9" height="2.9" rx="0.8" />
        <rect x="18.75" y="1" width="2.9" height="2.9" rx="0.8" />
        <rect x="15" y="4.75" width="2.9" height="2.9" rx="0.8" />
        <rect x="15" y="8.5" width="2.9" height="2.9" rx="0.8" />
        <rect x="18.75" y="8.5" width="2.9" height="2.9" rx="0.8" />
        <rect x="15" y="12.25" width="2.9" height="2.9" rx="0.8" />
        <rect x="15" y="16" width="2.9" height="2.9" rx="0.8" />
      </g>
      {/* 合意の1マス（Pの角） */}
      <rect x="22.5" y="4.75" width="2.9" height="2.9" rx="0.8" fill="#f43f5e" />
    </svg>
  );
}
