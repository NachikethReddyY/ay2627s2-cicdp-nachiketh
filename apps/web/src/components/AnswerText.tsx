export default function AnswerText({ text }: { text: string }) {
  const lines = text.split(/\r\n?|\n/);

  return (
    <span className="min-w-0 whitespace-pre-wrap break-words">
      {lines.length === 1 ? text : (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{lines.join(" new line ")}</span>
        </>
      )}
    </span>
  );
}
