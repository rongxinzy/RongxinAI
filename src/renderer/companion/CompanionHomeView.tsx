import { CompanionView } from './CompanionView';
import { CompanionSurface } from '../../shared/companion/constants';

interface Props {
  isSidebarCollapsed: boolean;
  onToggleSidebar(): void;
}
export default function CompanionHomeView(props: Props) {
  return (
    <CompanionView {...props} api={window.electron.companion} surface={CompanionSurface.Home} />
  );
}
