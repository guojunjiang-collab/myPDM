import { Outlet } from 'react-router-dom';

export default function MobileLayout() {
  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="flex-1 overflow-y-auto"><Outlet /></div>
    </div>
  );
}
