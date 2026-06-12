import { useViewerStore } from '../../stores/viewerStore';

const FACES: { key: string; label: string; css: string }[] = [
  { key: 'front',  label: '前', css: 'translateZ(23px)' },
  { key: 'back',   label: '后', css: 'rotateY(180deg) translateZ(23px)' },
  { key: 'right',  label: '右', css: 'rotateY(90deg) translateZ(23px)' },
  { key: 'left',   label: '左', css: 'rotateY(-90deg) translateZ(23px)' },
  { key: 'top',    label: '上', css: 'rotateX(90deg) translateZ(23px)' },
  { key: 'bottom', label: '下', css: 'rotateX(-90deg) translateZ(23px)' },
];

function closestFace(dir: [number, number, number]): string {
  const [px, py, pz] = dir; // 相机位置方向（从原点指向相机）
  // 用户视线方向 = -相机位置方向
  const vx = -px, vy = -py, vz = -pz;
  const ax = Math.abs(vx), ay = Math.abs(vy), az = Math.abs(vz);
  if (ax >= ay && ax >= az) return vx > 0 ? 'right' : 'left';
  if (ay >= ax && ay >= az) return vy > 0 ? 'top' : 'bottom';
  return vz > 0 ? 'front' : 'back';
}

export function ViewCube() {
  const cameraDir = useViewerStore((s) => s.cameraDir);
  const setViewTarget = useViewerStore((s) => s.setViewTarget);
  const active = closestFace(cameraDir);

  const [px, py, pz] = cameraDir;
  // 用 rotate3d 避免 rotateX/rotateY 顺序耦合（万向节锁）
  const axisX = -py;
  const axisY = px;
  const axisLen = Math.sqrt(axisX * axisX + axisY * axisY);
  const a = axisLen > 0.001 ? axisX / axisLen : 0;
  const b = axisLen > 0.001 ? axisY / axisLen : 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, pz))) * (180 / Math.PI);

  return (
    <div
      className="absolute top-3 left-3 z-20 select-none"
      style={{ width: 64, height: 64, perspective: 200 }}
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotate3d(${a}, ${b}, 0, ${angle}deg)`,
        }}
      >
        {FACES.map((f) => (
          <div
            key={f.key}
            onClick={() => setViewTarget(f.key)}
            className={`absolute inset-0 flex items-center justify-center cursor-pointer border border-gray-300 text-xs font-medium
              ${f.key === active ? 'bg-blue-500 text-white border-blue-600' : 'bg-white/90 text-gray-600 hover:bg-gray-100'}`}
            style={{ transform: f.css, backfaceVisibility: 'hidden' }}
          >
            {f.label}
          </div>
        ))}
      </div>
    </div>
  );
}
