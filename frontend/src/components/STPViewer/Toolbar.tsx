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

  const getPlane = (axis: string) => clipPlanes.find((p) => p.axis === axis);

  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center gap-2 rounded-b-lg border border-t-0 border-gray-200 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      {/* Section planes */}
      {(['x', 'y', 'z'] as const).map((axis) => {
        const plane = getPlane(axis);
        return (
          <label key={axis} className="flex items-center gap-1 text-xs font-medium uppercase text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!plane}
              onChange={(e) => e.target.checked ? setClipPlane(axis, 0) : removeClipPlane(axis)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            {axis}
          </label>
        );
      })}

      <div className="w-px h-4 bg-gray-300" />

      {/* Measure mode */}
      <button
        onClick={() => setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
        className={`text-xs px-2 py-1 rounded ${measureMode === 'distance' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
      >
        测量
      </button>

      <div className="w-px h-4 bg-gray-300" />

      {/* Explode distance */}
      <label className="flex items-center gap-1 text-xs text-gray-600">
        爆炸
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={explodeDistance}
          onChange={(e) => setExplodeDistance(Number(e.target.value))}
          className="w-16 h-1 accent-blue-500"
        />
      </label>

      <div className="w-px h-4 bg-gray-300" />

      {/* Wireframe */}
      <button
        onClick={toggleWireframe}
        className={`text-xs px-2 py-1 rounded ${wireframe ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
      >
        线框
      </button>
    </div>
  );
}
