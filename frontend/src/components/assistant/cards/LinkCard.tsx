interface Props { payload: { label?: string; href: string }; }
export default function LinkCard({ payload }: Props) {
  return (
    <a href={payload.href} className="my-2 inline-block text-blue-600 underline text-sm">
      {payload.label || '查看详情'}
    </a>
  );
}
