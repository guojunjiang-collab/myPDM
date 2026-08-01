import { useViewerStore } from '../../stores/viewerStore';

const FACES: { key: string; label: string; css: string }[] = [
  { key: 'front',  label: '前', css: 'translateZ(32px)' },
  { key: 'back',   label: '后', css: 'rotateY(180deg) translateZ(32px)' },
  { key: 'right',  label: '右', css: 'rotateY(90deg) translateZ(32px)' },
  { key: 'left',   label: '左', css: 'rotateY(-90deg) translateZ(32px)' },
  { key: 'top',    label: '上', css: 'rotateX(90deg) translateZ(32px)' },
  { key: 'bottom', label: '下', css: 'rotateX(-90deg) translateZ(32px)' },
];

function quatToMatrix3d(x: number, y: number, z: number, w: number): string {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const xw = x * w, yw = y * w, zw = z * w;

  const m11 = 1 - 2 * (yy + zz);
  const m21 = 2 * (xy - zw);
  const m31 = 2 * (xz + yw);

  const m12 = 2 * (xy + zw);
  const m22 = 1 - 2 * (xx + zz);
  const m32 = 2 * (yz - xw);

  const m13 = 2 * (xz - yw);
  const m23 = 2 * (yz + xw);
  const m33 = 1 - 2 * (xx + yy);

  return `matrix3d(${m11},${m21},${m31},0, ${m12},${m22},${m32},0, ${m13},${m23},${m33},0, 0,0,0,1)`;
}

export function ViewCube() {
  const quat = useViewerStore((s) => s.cameraQuat);
  const modelZUp = useViewerStore((s) => s.modelZUp);
  const setViewTarget = useViewerStore((s) => s.setViewTarget);

  const [qx, qy, qz, qw] = quat;

  const cssTransform = quatToMatrix3d(-qx, qy, -qz, qw);

  // 活跃面检测必须与 cssTransform 使用同一套四元数（取反后），否则立方体视觉旋转
  // 与高亮面之间存在由 X/Z 分量符号差引入的角度偏差
  const nqx = -qx, nqz = -qz;
  const fwdX = 2 * (nqx * nqz + qw * qy);
  const fwdY = 2 * (qy * nqz - qw * nqx);
  const fwdZ = 1 - 2 * (nqx * nqx + qy * qy);
  const vx = -fwdX, vy = -fwdY, vz = -fwdZ;
  const ax = Math.abs(vx), ay = Math.abs(vy), az = Math.abs(vz);
  let active: string;
  if (ax >= ay && ax >= az) active = vx > 0 ? 'right' : 'left';
  else if (ay >= ax && ay >= az) active = vy > 0 ? 'top' : 'bottom';
  // Z-up 模式下模型 front(Y+)→世界-Z，故 Z 轴前后反转
  else if (modelZUp) active = vz > 0 ? 'back' : 'front';
  else active = vz > 0 ? 'front' : 'back';

  return (
    <div
      className="absolute top-10 left-10 z-20 select-none"
      style={{ width: 64, height: 64, perspective: 200 }}
    >
      <div
        className="relative w-full h-full"
        style={{
          transformStyle: 'preserve-3d',
          transform: cssTransform,
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
