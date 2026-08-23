import { useViewerStore } from '../../stores/viewerStore';

export function Toolbar() {
  const vs = useViewerStore((s) => s);

  const clipPlanes = vs.clipPlanes;
  const wireframe = vs.wireframe;
  const autoColor = vs.autoColor;
  const explodeValue = vs.explodeDistance;

  const setClipPlane = vs.setClipPlane;
  const removeClipPlane = vs.removeClipPlane;
  const toggleClipFlip = vs.toggleClipFlip;
  const setExplode = vs.setExplodeDistance;
  const resetAction = vs.triggerResetView;

  const measureMode = vs.measureMode;
  const setMeasureMode = vs.setMeasureMode;
  const cameraMode = vs.cameraMode;
  const toggleCameraMode = vs.toggleCameraMode;

  const getPlane = (axis: string) => clipPlanes.find((p: any) => p.axis === axis);
  const activeAxes = (['x', 'y', 'z'] as const).filter((a) => getPlane(a));
  const onWireframe = () => vs.toggleWireframe();
  const onAutoColor = () => vs.toggleAutoColor();

  const compare = vs.compare;
  const setDisplayMode = vs.setDisplayMode;
  const setOnlyDiff = vs.setOnlyDiff;
  const setGhostOpacity = vs.setGhostOpacity;
  const DISPLAY_MODES = [
    { value: 'both' as const, label: '叠加' },
    { value: 'left' as const, label: '只看左' },
    { value: 'right' as const, label: '只看右' },
  ];

  return (
    <div className="relative border-b border-gray-100 bg-[var(--ui-bg-surface)] shadow-sm">
      <div className="flex items-center gap-3 px-4 py-2">
      {compare && (
        <>
          <div className="flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-subtle)] overflow-hidden shrink-0">
            {DISPLAY_MODES.map((m, i) => (
              <button
                key={m.value}
                onClick={() => setDisplayMode(m.value)}
                className={`px-2.5 py-1.5 text-sm font-medium transition-colors
                  ${compare.displayMode === m.value ? 'bg-primary-50 text-primary-600' : 'text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-hover)]'}
                  ${i > 0 ? 'border-l border-[var(--ui-border)]' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-sm text-[var(--ui-text-secondary)] cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={compare.onlyDiff}
              onChange={(e) => setOnlyDiff(e.target.checked)}
              className="accent-primary-500"
            />
            仅显示差异
          </label>

          <div className="flex items-center gap-2 text-sm text-[var(--ui-text-secondary)] shrink-0">
            <span className="font-medium">幽灵</span>
            <input
              type="range"
              min={0.02}
              max={0.5}
              step={0.01}
              value={compare.ghostOpacity}
              onChange={(e) => setGhostOpacity(Number(e.target.value))}
              className="w-16 h-1 accent-primary-500"
              title="淡出零件的不透明度"
            />
            <span className="tabular-nums text-[var(--ui-text-tertiary)] w-8">{compare.ghostOpacity.toFixed(2)}</span>
          </div>

          <div className="w-px h-5 bg-gray-200 shrink-0" />
        </>
      )}

      {/* Section planes toggles */}
      <div className="flex items-center rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-subtle)] overflow-hidden shrink-0">
        {(['x', 'y', 'z'] as const).map((axis, i) => {
          const plane = getPlane(axis);
          return (
            <label
              key={axis}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-sm font-medium uppercase cursor-pointer select-none transition-colors
                ${plane ? 'bg-blue-50 text-blue-600' : 'text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-hover)]'}
                ${i > 0 ? 'border-l border-[var(--ui-border)]' : ''}`}
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
            : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-hover)] border border-transparent'}`}
      >
        测量
      </button>

      {/* Explode */}
      <div className="flex items-center gap-2 text-sm text-[var(--ui-text-secondary)]">
        <span className="font-medium">爆炸</span>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={explodeValue}
          onChange={(e) => setExplode(Number(e.target.value))}
          className="w-14 h-1 accent-blue-500"
        />
      </div>

      <div className="w-px h-5 bg-gray-200 shrink-0" />

      {/* Reset */}
      <button onClick={resetAction}
        className="text-sm px-3 py-1.5 rounded-md font-medium text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-hover)] border border-transparent transition-colors"
      >
        重置
      </button>

      {/* Camera mode */}
      <button
        onClick={toggleCameraMode}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${cameraMode === 'orthographic'
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-hover)] border border-transparent'}`}
      >
        {cameraMode === 'orthographic' ? '平行' : '透视'}
      </button>

      {/* Wireframe */}
      <button
        onClick={onWireframe}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${wireframe
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-hover)] border border-transparent'}`}
      >
        线框
      </button>

      {/* Auto color */}
      <button
        onClick={onAutoColor}
        disabled={!!compare}
        title={compare ? '对比模式下按变更类型着色' : undefined}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${compare
            ? 'text-gray-300 cursor-not-allowed border border-transparent'
            : autoColor
              ? 'bg-blue-50 text-blue-600 border border-blue-200'
              : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-bg-hover)] border border-transparent'}`}
      >
        上色
      </button>
      </div>

      {/* Section plane slider popup */}
      {activeAxes.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full z-20 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-lg px-4 py-3">
          {(['x', 'y', 'z'] as const).map((axis) => {
            const plane = getPlane(axis);
            return plane ? (
              <div key={axis} className="flex items-center gap-2 text-sm py-0.5">
                <span className="font-semibold uppercase text-[var(--ui-text-tertiary)] w-4">{axis}</span>
                <button
                  onClick={() => toggleClipFlip(axis)}
                  className={`text-xs px-1.5 py-0.5 rounded transition-colors ${(plane as any).flip ? 'text-blue-500 bg-blue-50' : 'text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)]'}`}
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
                  className="w-48 h-1 accent-blue-500"
                />
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
