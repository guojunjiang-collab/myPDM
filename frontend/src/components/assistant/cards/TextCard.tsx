import Markdown from '../Markdown';

interface Props { text: string; streaming?: boolean; }
export default function TextCard({ text, streaming }: Props) {
  return (
    <div className="text-sm leading-relaxed">
      <Markdown>{text}</Markdown>
      {streaming && <span className="animate-pulse">▋</span>}
    </div>
  );
}
