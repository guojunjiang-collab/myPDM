import { useState, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { useViewerStore } from '../../stores/viewerStore';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

export function BOMPanel() {
  const {
    modelUrl,
    loadingState,
    selectedPartId,
    visibleParts,
    selectPart,
    highlightPart,
    togglePartVisibility,
  } = useViewerStore();

  const [meshNames, setMeshNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);

  /** Extract mesh names from the GLB model */
  useEffect(() => {
    if (!modelUrl || loadingState !== 'ready') {
      setMeshNames([]);
      setLoadingNames(false);
      return;
    }

    let cancelled = false;
    setLoadingNames(true);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return;
        const names: string[] = [];
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.name) {
            names.push(child.name);
          }
        });
        setMeshNames(names);
        setLoadingNames(false);
      },
      undefined,
      () => {
        if (!cancelled) {
          setMeshNames([]);
          setLoadingNames(false);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [modelUrl, loadingState]);

  /** Count visible parts — when visibleParts is empty, all are visible */
  const visibleCount = useMemo(() => {
    if (visibleParts.size === 0) return meshNames.length;
    return meshNames.filter((n) => visibleParts.has(n)).length;
  }, [meshNames, visibleParts]);

  /** Whether a given part is currently visible */
  const isVisible = useCallback(
    (name: string) => {
      if (visibleParts.size === 0) return true;
      return visibleParts.has(name);
    },
    [visibleParts]
  );

  /** Toggle a single part, handling the "all visible → selective" transition */
  const handleToggle = useCallback(
    (name: string) => {
      if (visibleParts.size === 0) {
        // All parts are currently visible. To hide just this one,
        // we must populate visibleParts with every other part first.
        meshNames.forEach((n) => {
          if (n !== name) togglePartVisibility(n);
        });
      } else {
        togglePartVisibility(name);
      }
    },
    [visibleParts, meshNames, togglePartVisibility]
  );

  /** Toggle all parts: if any hidden → show all; if all visible → hide all */
  const handleToggleAll = useCallback(() => {
    if (visibleCount === meshNames.length) {
      // Hide all: populate visibleParts with no entries means all hidden.
      // Since visibleParts is an allowlist, we remove every entry.
      meshNames.forEach((n) => {
        if (visibleParts.has(n)) togglePartVisibility(n);
      });
    } else {
      // Show all: add any missing parts to visibleParts.
      meshNames.forEach((n) => {
        if (!visibleParts.has(n)) togglePartVisibility(n);
      });
      // If visibleParts was empty, we need to first add all parts,
      // then the second pass above handles it.
      if (visibleParts.size === 0) {
        meshNames.forEach((n) => togglePartVisibility(n));
      }
    }
  }, [visibleCount, meshNames, visibleParts, togglePartVisibility]);

  /** Click part name → select + highlight */
  const handleSelect = useCallback(
    (name: string) => {
      selectPart(name);
      highlightPart(name);
    },
    [selectPart, highlightPart]
  );

  // ── Render ──────────────────────────────────────────────────────────

  if (!modelUrl || loadingState !== 'ready') return null;

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 w-64 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          零件列表
        </span>
        <span className="text-[11px] text-gray-400 tabular-nums">
          {loadingNames ? '...' : `${visibleCount}/${meshNames.length}`}
        </span>
      </div>

      {/* Toolbar */}
      {meshNames.length > 0 && (
        <div className="px-3 py-1.5 border-b border-gray-100">
          <button
            onClick={handleToggleAll}
            className="text-[11px] text-gray-500 hover:text-primary-600 transition-colors cursor-pointer select-none"
          >
            {visibleCount === meshNames.length ? '全部隐藏' : '全部显示'}
          </button>
        </div>
      )}

      {/* Part List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loadingNames && meshNames.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-4 w-4 border border-primary-400 border-t-transparent" />
          </div>
        ) : meshNames.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6 px-3">
            模型中未找到零件
          </p>
        ) : (
          <ul className="py-0.5">
            {meshNames.map((name) => {
              const checked = isVisible(name);
              const isSelected = selectedPartId === name;

              return (
                <li key={name}>
                  <label
                    className={`
                      flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none
                      transition-colors duration-100
                      ${isSelected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'}
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggle(name)}
                      className="
                        w-3.5 h-3.5 rounded border-gray-300 text-primary-500
                        focus:ring-1 focus:ring-primary-400 focus:ring-offset-0
                        cursor-pointer shrink-0
                      "
                    />
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        handleSelect(name);
                      }}
                      className="text-xs leading-tight truncate flex-1"
                      title={name}
                    >
                      {name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
