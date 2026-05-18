import { Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ArcballControls, Environment } from '@react-three/drei';
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
      <ControlsWrapper />
      <Environment preset="warehouse" />
    </Canvas>
  );
}