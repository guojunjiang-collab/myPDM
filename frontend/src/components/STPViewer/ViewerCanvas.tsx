import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ModelLoader } from './ModelLoader';
import { PartHighlighter } from './PartHighlighter';
import { GLTFErrorBoundary } from './GLTFErrorBoundary';
import { SectionPlanes } from './SectionPlanes';
import { MeasureTool } from './MeasureTool';
import { ExplodeView } from './ExplodeView';
import { CameraController } from './CameraController';
import { useViewerStore } from '../../stores/viewerStore';

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
    scene.environmentIntensity = 0.8;
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
  const selectNode = useViewerStore((s) => s.selectNode);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectNode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectNode]);

  return (
    <Canvas
      camera={{ position: [5, 5, 5] }}
      style={{ width: '100%', height: '100%', background: '#e8e8e8' }}
       gl={{
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
        antialias: false,
        stencil: false,
      }}
    >
      <LocalEnvironment />
      <ambientLight intensity={0.25} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <directionalLight position={[-8, 4, -6]} intensity={0.4} />
      <Suspense fallback={null}>
        <GLTFErrorBoundary>
          <ModelLoader url={url} />
          <PartHighlighter url={url} />
        </GLTFErrorBoundary>
      </Suspense>
      <SectionPlanes />
      <MeasureTool />
      <ExplodeView />
      <CameraController />
    </Canvas>
  );
}
