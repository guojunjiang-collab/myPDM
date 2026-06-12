import { Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ArcballControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ModelLoader } from './ModelLoader';
import { GLTFErrorBoundary } from './GLTFErrorBoundary';
import { SectionPlanes } from './SectionPlanes';
import { MeasureTool } from './MeasureTool';
import { ExplodeView } from './ExplodeView';
import { useEffect, useRef } from 'react';

function ControlsWrapper() {
  const controlsRef = useRef<any>(null);
  const { gl } = useThree();

  useEffect(() => {
    if (controlsRef.current) {
      // Increase rotation speed by 30%
      (controlsRef.current as any).rotateSpeed = 1.3;
    }
  }, []);

  return <ArcballControls ref={controlsRef} makeDefault />;
}

/**
 * 程序化室内环境光（three 内置 RoomEnvironment + PMREMGenerator）。
 * 为 MeshStandardMaterial 提供基于图像的环境光照(IBL)与反射，
 * 完全本地生成、无任何外部文件/CDN 依赖，替代原 <Environment preset>。
 */
function LocalEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;
    return () => {
      scene.environment = null;
      envMap.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

interface ViewerCanvasProps {
  url: string;
}

export function ViewerCanvas({ url }: ViewerCanvasProps) {
  return (
    <Canvas
      camera={{ position: [5, 5, 5], fov: 45 }}
      style={{ width: '100%', height: '100%', background: '#e8e8e8' }}
      gl={{ preserveDrawingBuffer: true }}
    >
      {/* 本地环境光(IBL) + 补充方向光，替代依赖 CDN 的 <Environment>，离线可用 */}
      <LocalEnvironment />
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <directionalLight position={[-8, 4, -6]} intensity={0.5} />
      <Suspense fallback={null}>
        <GLTFErrorBoundary>
          <ModelLoader url={url} />
        </GLTFErrorBoundary>
      </Suspense>
      <SectionPlanes />
      <MeasureTool />
      <ExplodeView />
      <ControlsWrapper />
    </Canvas>
  );
}