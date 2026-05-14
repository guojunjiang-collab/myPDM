import { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useViewerStore } from '../../stores/viewerStore';

/**
 * Fixed toolbar overlay — rendered inside the R3F Canvas via drei's Html.
 * Provides controls for section planes, measurement, explode, wireframe,
 * and camera reset.
 */
export function Toolbar() {
  const { camera, controls } = useThree();

  const clipPlanes = useViewerStore((s) => s.clipPlanes);
  const measureMode = useViewerStore((s) => s.measureMode);
  const explodeDistance = useViewerStore((s) => s.explodeDistance);
  const wireframe = useViewerStore((s) => s.wireframe);

  const setClipPlane = useViewerStore((s) => s.setClipPlane);
  const removeClipPlane = useViewerStore((s) => s.removeClipPlane);
  const setMeasureMode = useViewerStore((s) => s.setMeasureMode);
  const setExplodeDistance = useViewerStore((s) => s.setExplodeDistance);
  const toggleWireframe = useViewerStore((s) => s.toggleWireframe);

  const getPlane = (axis: 'x' | 'y' | 'z') =>
    clipPlanes.find((p) => p.axis === axis);

  const resetCamera = useCallback(() => {
    camera.position.set(5, 3, 5);
    camera.lookAt(0, 0, 0);
    // R3F types controls as EventDispatcher; OrbitControls exposes target & update
    const ctrl = controls as unknown as {
      target: { set: (x: number, y: number, z: number) => void };
      update: () => void;
    } | null;
    if (ctrl) {
      ctrl.target.set(0, 0, 0);
      ctrl.update();
    }
  }, [camera, controls]);

  return (
    <Html fullscreen style={{ pointerEvents: 'none' }}>
      <div className="pointer-events-auto absolute top-2 left-1/2 -translate-x-1/2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-lg backdrop-blur-sm">
        {/* --- Section plane controls --- */}
        {(['x', 'y', 'z'] as const).map((axis) => {
          const plane = getPlane(axis);
          const active = !!plane;
          return (
            <div key={axis} className="flex items-center gap-1">
              <label className="flex cursor-pointer items-center gap-1 text-xs font-medium uppercase text-gray-600 select-none">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setClipPlane(axis, 0);
                    } else {
                      removeClipPlane(axis);
                    }
                  }}
                  className="h-3.5 w-3.5 accent-primary-500"
                />
                {axis}
              </label>
              {active && (
                <input
                  type="range"
                  min={-10}
                  max={10}
                  step={0.1}
                  value={plane.position}
                  onChange={(e) => setClipPlane(axis, parseFloat(e.target.value))}
                  className="h-1.5 w-16 cursor-pointer accent-primary-500"
                />
              )}
            </div>
          );
        })}

        <div className="mx-1 h-6 w-px bg-gray-300" />

        {/* --- Measure mode toggle --- */}
        <button
          type="button"
          onClick={() =>
            setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')
          }
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            measureMode === 'distance'
              ? 'bg-primary-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          📏 测量
        </button>

        {/* --- Wireframe toggle --- */}
        <button
          type="button"
          onClick={toggleWireframe}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
            wireframe
              ? 'bg-primary-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          🔲 线框
        </button>

        <div className="mx-1 h-6 w-px bg-gray-300" />

        {/* --- Explode slider --- */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-600 whitespace-nowrap">
            💥 分解
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={explodeDistance}
            onChange={(e) => setExplodeDistance(parseFloat(e.target.value))}
            className="h-1.5 w-20 cursor-pointer accent-primary-500"
          />
          <span className="w-6 text-right text-xs text-gray-500">
            {explodeDistance.toFixed(1)}
          </span>
        </div>

        <div className="mx-1 h-6 w-px bg-gray-300" />

        {/* --- Reset camera --- */}
        <button
          type="button"
          onClick={resetCamera}
          className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
        >
          🔄 重置
        </button>
      </div>
    </Html>
  );
}
