import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { ModelLoader } from './ModelLoader';
import { SectionPlanes } from './SectionPlanes';
import { MeasureTool } from './MeasureTool';
import { ExplodeView } from './ExplodeView';

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
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Suspense fallback={null}>
        <ModelLoader url={url} />
      </Suspense>
      <SectionPlanes />
      <MeasureTool />
      <ExplodeView />
      <OrbitControls makeDefault enableDamping={false} zoomSpeed={1.5} />
      <Environment preset="warehouse" />
    </Canvas>
  );
}
