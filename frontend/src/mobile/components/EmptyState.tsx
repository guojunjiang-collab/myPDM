export default function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="text-sm text-gray-400 text-center">{text}</div>
    </div>
  );
}
