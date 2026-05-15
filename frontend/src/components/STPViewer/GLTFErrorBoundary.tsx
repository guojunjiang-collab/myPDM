import { Component, type ReactNode } from 'react';
import { useViewerStore } from '../../stores/viewerStore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches GLTF loading/parsing errors and sets the viewer store to error state.
 * Without this, Suspense would show the fallback indefinitely with no error feedback.
 */
class GLTFErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('GLTF loading error:', error);
    // Set loadingState to 'error' via the store
    const store = useViewerStore.getState();
    store.setLoadingState('error', error.message || '模型加载失败');
  }

  render() {
    if (this.state.hasError) {
      return null; // Overlay in parent will show error
    }
    return this.props.children;
  }
}

export function GLTFErrorBoundary({ children }: Props) {
  return <GLTFErrorBoundaryClass>{children}</GLTFErrorBoundaryClass>;
}
