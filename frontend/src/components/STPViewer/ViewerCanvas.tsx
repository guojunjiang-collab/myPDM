import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { ModelLoader } from './ModelLoader';
import { SectionPlanes } from './SectionPlanes';
import { MeasureTool } from './MeasureTool';
import { useViewerStore } from '../../stores/viewerStore';

interface ViewerCanvasProps {
  url: string;
}

export function ViewerCanvas({ url }: ViewerCanvasProps) {
  return (
    <Canvas
      camera={{ position: [5, 3, 5], fov: 45 }}
      style={{ width: '100%', height: '100%', background: '#f0f0f0' }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Suspense fallback={null}>
        <ModelLoader url={url} />
      </Suspense>
      <SectionPlanes />
      <MeasureTool />
      <OrbitControls makeDefault />
      <Environment preset="warehouse" />
    </Canvas>
  );
}
