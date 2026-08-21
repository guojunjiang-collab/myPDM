export default function DesktopOnlyCard({ feature }: { feature: string }) {
  return (
    <div className="mx-4 mt-4 bg-white rounded-lg px-4 py-8 shadow-sm flex flex-col items-center gap-3">
      <div className="text-base font-medium text-gray-800">{feature}</div>
      <div className="text-sm text-gray-500">该功能暂不支持手机，请使用电脑浏览器打开</div>
    </div>
  );
}
