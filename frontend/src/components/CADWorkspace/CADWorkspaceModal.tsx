import { useState } from 'react';
import { Modal } from '../Modal';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow } from './CADBOMMatchTable';
import { CADCompleteStep } from './CADCompleteStep';
import { useCADBridge } from '../../hooks/useCADBridge';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'connect' | 'match' | 'complete';

export function CADWorkspaceModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [bomRows, setBomRows] = useState<BOMRow[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const bridge = useCADBridge();

  const handleClose = () => {
    setStep('connect');
    setBomRows([]);
    onClose();
  };

  const handleAssemblyLoaded = (rows: BOMRow[]) => {
    setBomRows(rows);
    setStep('match');
  };

  const handleMatchComplete = (count: number) => {
    setCompletedCount(count);
    setStep('complete');
  };

  const stepLabels: Record<Step, string> = {
    connect: '连接CATIA',
    match: 'BOM匹配',
    complete: '完成',
  };

  return (
    <Modal open={open} onClose={handleClose} title="CAD 入口 · 工作台" width="3xl" height="75vh">
      {/* 步骤标签 */}
      <div className="flex border-b border-gray-200 mb-4">
        {(['connect', 'match', 'complete'] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`px-5 py-2.5 text-sm font-semibold ${
              step === s
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-400'
            }`}
          >
            {i === 0 ? '①' : i === 1 ? '②' : '③'} {stepLabels[s]}
          </div>
        ))}
      </div>

      {/* 步骤内容 */}
      {step === 'connect' && (
        <CADConnectStep
          bridge={bridge}
          onAssemblyLoaded={handleAssemblyLoaded}
          onClose={handleClose}
        />
      )}
      {step === 'match' && (
        <CADBOMMatchTable
          bridge={bridge}
          rows={bomRows}
          onComplete={handleMatchComplete}
        />
      )}
      {step === 'complete' && (
        <CADCompleteStep
          count={completedCount}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
