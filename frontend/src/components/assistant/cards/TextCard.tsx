interface Props { text: string; streaming?: boolean; }
export default function TextCard({ text, streaming }: Props) {
  return (
    <div className="text-sm whitespace-pre-wrap leading-relaxed">
      {text}{streaming && <span className="animate-pulse">▋</span>}
    </div>
  );
}
