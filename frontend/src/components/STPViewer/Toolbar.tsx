import { useViewerStore } from '../../stores/viewerStore';

export function Toolbar() {
  const clipPlanes = useViewerStore((s) => s.clipPlanes);
  const measureMode = useViewerStore((s) => s.measureMode);
  const explodeDistance = useViewerStore((s) => s.explodeDistance);
  const setClipPlane = useViewerStore((s) => s.setClipPlane);
  const removeClipPlane = useViewerStore((s) => s.removeClipPlane);
  const setMeasureMode = useViewerStore((s) => s.setMeasureMode);
  const setExplodeDistance = useViewerStore((s) => s.setExplodeDistance);
  const toggleWireframe = useViewerStore((s) => s.toggleWireframe);
  const wireframe = useViewerStore((s) => s.wireframe);
  const autoColor = useViewerStore((s) => s.autoColor);
  const toggleAutoColor = useViewerStore((s) => s.toggleAutoColor);
  const cameraMode = useViewerStore((s) => s.cameraMode);
  const toggleCameraMode = useViewerStore((s) => s.toggleCameraMode);
  const triggerResetView = useViewerStore((s) => s.triggerResetView);

  const getPlane = (axis: string) => clipPlanes.find((p) => p.axis === axis);
  const toggleClipFlip = useViewerStore((s) => s.toggleClipFlip);
  const activeAxes = (['x', 'y', 'z'] as const).filter((a) => getPlane(a));

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

      {/* Measure mode */}
      <button
        onClick={() => setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${measureMode === 'distance'
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        测量
      </button>

      {/* Explode distance */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="font-medium">爆炸</span>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={explodeDistance}
          onChange={(e) => setExplodeDistance(Number(e.target.value))}
          className="w-14 h-1 accent-blue-500"
        />
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Reset view */}
      <button
        onClick={triggerResetView}
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
        onClick={toggleWireframe}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${wireframe
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        线框
      </button>

      {/* Auto color */}
      <button
        onClick={toggleAutoColor}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${autoColor
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        上色
      </button>

      {/* Section plane sliders (右侧，3倍长) */}
      {activeAxes.length > 0 && (
        <div className="flex items-center gap-3 ml-auto">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const plane = getPlane(axis);
            return plane ? (
              <label key={axis} className="flex items-center gap-1.5 text-sm font-semibold uppercase text-gray-400">
                {axis}
                <button
                  onClick={() => toggleClipFlip(axis)}
                  className={`text-sm px-1 rounded transition-colors ${plane.flip ? 'text-blue-500 bg-blue-50' : 'text-gray-400 hover:text-gray-600'}`}
                  title="切换剖面方向"
                >
                  {plane.flip ? '>' : '<'}
                </button>
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  value={plane.position}
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
