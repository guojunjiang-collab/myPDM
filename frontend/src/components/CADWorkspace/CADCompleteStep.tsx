interface Props {
  count: number;
  onClose: () => void;
}

export function CADCompleteStep({ count, onClose }: Props) {
  return (
    <div className="flex flex-col items-center py-12">
      <div className="text-4xl mb-4">&#10004;</div>
      <h3 className="text-lg font-bold text-gray-800 mb-2">操作完成</h3>
      <p className="text-sm text-gray-500 mb-6">
        本次共处理 {count} 个零部件，可在零部件列表中查看结果
      </p>
      <button
        onClick={onClose}
        className="px-8 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
      >
        关闭
      </button>
    </div>
  );
}
