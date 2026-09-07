import { useViewerStore } from '../../stores/viewerStore';
import Button from '../ui/Button';

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
    <div className="relative border-b border-[var(--ui-border)] bg-[var(--ui-bg-subtle)] shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
      {compare && (
        <>
          <div className="flex items-center gap-2 shrink-0">
            {DISPLAY_MODES.map((m) => (
              <Button key={m.value} size="md" active={compare.displayMode === m.value} onClick={() => setDisplayMode(m.value)}>
                {m.label}
              </Button>
            ))}
          </div>

          <Button size="md" active={compare.onlyDiff} onClick={() => setOnlyDiff(!compare.onlyDiff)}>
            仅显示差异
          </Button>

          <div className="w-px h-5 bg-[var(--ui-border)] shrink-0 hidden sm:block" />
        </>
      )}

      {/* Section planes toggles */}
      <div className="flex items-center gap-2 shrink-0">
        {(['x', 'y', 'z'] as const).map((axis) => {
          const plane = getPlane(axis);
          return (
            <Button
              key={axis}
              size="md"
              active={!!plane}
              onClick={() => (plane ? removeClipPlane(axis) : setClipPlane(axis, 0))}
            >
              {axis.toUpperCase()}
            </Button>
          );
        })}
      </div>

      <div className="w-px h-5 bg-[var(--ui-border)] shrink-0 hidden sm:block" />

      {/* Measure mode */}
      <Button
        size="md"
        active={measureMode === 'distance'}
        onClick={() => setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
      >
        测量
      </Button>

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
          className="w-14 h-1 accent-primary-500"
        />
      </div>

      {/* Ghost opacity（对比淡出非匹配 / 装配预览全局淡出） */}
      <div className="flex items-center gap-2 text-sm text-[var(--ui-text-secondary)] shrink-0">
        <span className="font-medium">幽灵</span>
        <input
          type="range"
          min={0.05}
          max={0.3}
          step={0.01}
          value={vs.ghostOpacity}
          onChange={(e) => setGhostOpacity(Number(e.target.value))}
          className="w-16 h-1 accent-primary-500"
          title="淡出零件的不透明度"
        />
        <span className="tabular-nums text-[var(--ui-text-tertiary)] w-8">{vs.ghostOpacity.toFixed(2)}</span>
      </div>

      <div className="w-px h-5 bg-[var(--ui-border)] shrink-0 hidden sm:block" />

      {/* Reset */}
      <Button size="md" variant="secondary" onClick={resetAction}>
        重置
      </Button>

      {/* Camera mode */}
      <Button
        size="md"
        active={cameraMode === 'orthographic'}
        onClick={toggleCameraMode}
      >
        {cameraMode === 'orthographic' ? '平行' : '透视'}
      </Button>

      {/* Wireframe */}
      <Button size="md" active={wireframe} onClick={onWireframe}>
        线框
      </Button>

      {/* Auto color */}
      <Button
        size="md"
        active={autoColor}
        onClick={onAutoColor}
        disabled={!!compare}
        title={compare ? '对比模式下按变更类型着色' : undefined}
      >
        上色
      </Button>
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
                  className="w-48 h-1 accent-primary-500"
                />
              </div>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
