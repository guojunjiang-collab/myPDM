import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow, type NamingPrefixes } from './CADBOMMatchTable';
import { useCADBridge, type CADType } from '../../hooks/useCADBridge';
import { settingsApi } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'connect' | 'match';

export function CADWorkspaceModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [cadType, setCadType] = useState<CADType>('catia');
  const [bomRows, setBomRows] = useState<BOMRow[]>([]);
  const [namingPrefixes, setNamingPrefixes] = useState<NamingPrefixes>({
    pdfPartPrefix: '',
    pdfAssemblyPrefix: '',
    stpPrefix: '',
  });
  const bridge = useCADBridge(cadType);

  useEffect(() => {
    if (open) {
      settingsApi.cadNaming().then(setNamingPrefixes).catch(() => {});
    }
  }, [open]);

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
    toast.success(`已同步 ${count} 个零部件`);
  };

  const stepLabels: Record<Step, string> = {
    connect: '连接CAD',
    match: 'BOM匹配',
  };

  return (
    <Modal open={open} onClose={handleClose} title="CAD工作台" width="max" height="85vh">
      <div className="flex flex-col h-full">
        {/* 步骤标签 */}
        <div className="flex border-b border-[var(--ui-border)] mb-4 shrink-0">
          {(['connect', 'match'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`px-5 py-2.5 text-sm font-semibold ${
                step === s
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-[var(--ui-text-tertiary)]'
              }`}
            >
              {i === 0 ? '①' : '②'} {stepLabels[s]}
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          {step === 'connect' && (
            <CADConnectStep
              bridge={bridge}
              cadType={cadType}
              onCadTypeChange={setCadType}
              onAssemblyLoaded={handleAssemblyLoaded}
              onClose={handleClose}
            />
          )}
          {step === 'match' && (
            <CADBOMMatchTable
              bridge={bridge}
              rows={bomRows}
              onComplete={handleMatchComplete}
              namingPrefixes={namingPrefixes}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
