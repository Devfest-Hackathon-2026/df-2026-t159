export default function TutorialMessage({ id, title, message }: {
  id: string;
  title: string;
  message: string;
}) {
  // キャプチャした **操作文** の中身が奇数番目に入り、結合すると読み上げ用の本文になる。
  const parts = message.split(/\*\*([^*]+)\*\*/);

  return (
    <>
      <p id={id} className="text-xs leading-relaxed text-[#403346]">
        {parts.map((part, index) =>
          index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
        )}
      </p>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {title}。{parts.join("")}
      </div>
    </>
  );
}
