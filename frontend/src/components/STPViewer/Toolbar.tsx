import { useViewerStore } from '../../stores/viewerStore';
import { useAssemblyStore } from '../AssemblyViewer/assemblyViewerStore';

interface Props { isAssembly?: boolean; }

export function Toolbar({ isAssembly }: Props) {
  // 同时订阅两个 store，按 isAssembly 选用
  const vs = useViewerStore((s) => s);
  const asm = useAssemblyStore((s) => s);

  const clipPlanes = isAssembly ? asm.clipPlanes : vs.clipPlanes;
  const wireframe = isAssembly ? asm.wireframe : vs.wireframe;
  const autoColor = isAssembly ? asm.autoColor : vs.autoColor;
  const explodeValue = isAssembly ? asm.explodeFactor : vs.explodeDistance;

  const setClipPlane = isAssembly ? asm.setClipPlane : vs.setClipPlane;
  const removeClipPlane = isAssembly ? asm.removeClipPlane : vs.removeClipPlane;
  const toggleClipFlip = isAssembly ? asm.toggleClipFlip : vs.toggleClipFlip;
  const setExplode = isAssembly ? asm.setExplodeFactor : vs.setExplodeDistance;
  const resetAction = isAssembly ? asm.reset : vs.triggerResetView;

  const measureMode = isAssembly ? 'off' : vs.measureMode;
  const setMeasureMode = vs.setMeasureMode;
  const cameraMode = isAssembly ? asm.cameraMode : vs.cameraMode;
  const toggleCameraMode = isAssembly ? asm.toggleCameraMode : vs.toggleCameraMode;

  const getPlane = (axis: string) => clipPlanes.find((p: any) => p.axis === axis);
  const activeAxes = (['x', 'y', 'z'] as const).filter((a) => getPlane(a));
  const onWireframe = () => isAssembly ? asm.setWireframe(!wireframe) : vs.toggleWireframe();
  const onAutoColor = () => isAssembly ? asm.setAutoColor(!autoColor) : vs.toggleAutoColor();

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white shadow-sm">
      {/* Section planes toggles */}
      <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
        {(['x', 'y', 'z'] as const).map((axis, i) => {
          const plane = getPlane(axis);
          return (
            <label
              key={axis}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium uppercase cursor-pointer select-none transition-colors
                ${plane ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}
                ${i > 0 ? 'border-l border-gray-200' : ''}`}
            >
              <input
                type="checkbox"
                checked={!!plane}
                onChange={(e) => e.target.checked ? setClipPlane(axis, 0) : removeClipPlane(axis)}
                className="sr-only"
              />
              {axis}
            </label>
          );
        })}
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Measure mode — 仅单件模式 */}
      {!isAssembly && (
        <button
          onClick={() => setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
          className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
            ${measureMode === 'distance'
              ? 'bg-blue-50 text-blue-600 border border-blue-200'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
        >
          测量
        </button>
      )}

      {/* Explode */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="font-medium">爆炸</span>
        <input
          type="range"
          min={0}
          max={isAssembly ? 1 : 5}
          step={isAssembly ? 0.01 : 0.1}
          value={explodeValue}
          onChange={(e) => setExplode(Number(e.target.value))}
          className="w-14 h-1 accent-blue-500"
        />
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Reset */}
      <button onClick={resetAction}
        className="text-sm px-3 py-1.5 rounded-md font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent transition-colors"
      >
        重置
      </button>

      {/* Camera mode */}
      <button
        onClick={toggleCameraMode}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${cameraMode === 'orthographic'
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        {cameraMode === 'orthographic' ? '平行' : '透视'}
      </button>

      {/* Wireframe */}
      <button
        onClick={onWireframe}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${wireframe
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        线框
      </button>

      {/* Auto color */}
      <button
        onClick={onAutoColor}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${autoColor
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        上色
      </button>

      {/* Section plane sliders */}
      {activeAxes.length > 0 && (
        <div className="flex items-center gap-3 ml-auto">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const plane = getPlane(axis);
            return plane ? (
              <label key={axis} className="flex items-center gap-1.5 text-sm font-semibold uppercase text-gray-400">
                {axis}
                <button
                  onClick={() => toggleClipFlip(axis)}
                  className={`text-sm px-1 rounded transition-colors ${(plane as any).flip ? 'text-blue-500 bg-blue-50' : 'text-gray-400 hover:text-gray-600'}`}
                  title="切换剖面方向"
                >
                  {(plane as any).flip ? '>' : '<'}
                </button>
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  value={(plane as any).position}
                  onChange={(e) => setClipPlane(axis, Number(e.target.value))}
                  className="w-[13.5rem] h-1 accent-blue-500"
                />
              </label>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
