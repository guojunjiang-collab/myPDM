export default function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="text-sm text-[var(--ui-text-tertiary)] text-center">{text}</div>
    </div>
  );
}
