import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow, type NamingPrefixes } from './CADBOMMatchTable';
import { CADCompleteStep } from './CADCompleteStep';
import { useCADBridge, type CADType } from '../../hooks/useCADBridge';
import { settingsApi } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'connect' | 'match' | 'complete';

export function CADWorkspaceModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [cadType, setCadType] = useState<CADType>('catia');
  const [bomRows, setBomRows] = useState<BOMRow[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
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
    setCompletedCount(count);
    setStep('complete');
  };

  const stepLabels: Record<Step, string> = {
    connect: '连接CAD',
    match: 'BOM匹配',
    complete: '完成',
  };

  const cadLabel = cadType === 'catia' ? 'CATIA V5' : 'SolidWorks';

  return (
    <Modal open={open} onClose={handleClose} title="CAD 入口 · 工作台" width="max" height="85vh">
      <div className="flex flex-col h-full">
        {/* CAD 类型选择 + 步骤标签 */}
        <div className="flex border-b border-gray-200 mb-4 shrink-0 items-end justify-between">
          <div className="flex">
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
          {step === 'connect' && (
            <div className="flex items-center gap-2 pr-4 pb-2">
              <span className="text-xs text-gray-500">选择CAD软件:</span>
              <select
                value={cadType}
                onChange={(e) => setCadType(e.target.value as CADType)}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="catia">CATIA V5</option>
                <option value="solidworks">SolidWorks</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0">
          {step === 'connect' && (
            <CADConnectStep
              bridge={bridge}
              cadType={cadType}
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
          {step === 'complete' && (
            <CADCompleteStep
              count={completedCount}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
