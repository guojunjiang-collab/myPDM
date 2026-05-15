import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { ModelLoader } from './ModelLoader';
import { GLTFErrorBoundary } from './GLTFErrorBoundary';
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
        <GLTFErrorBoundary>
          <ModelLoader url={url} />
        </GLTFErrorBoundary>
      </Suspense>
      <SectionPlanes />
      <MeasureTool />
      <ExplodeView />
      <OrbitControls makeDefault enableDamping={false} zoomSpeed={1}
        minPolarAngle={0.01} maxPolarAngle={Math.PI - 0.01} />
      <Environment preset="warehouse" />
    </Canvas>
  );
}
