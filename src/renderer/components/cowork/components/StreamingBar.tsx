import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import React from 'react';

export const ArtifactPanelIcon: React.FC<React.SVGProps<SVGSVGElement> & { open?: boolean }> = ({
  open,
  ...props
}) => {
  const Icon = open ? PanelRightClose : PanelRightOpen;
  return <Icon {...props} />;
};
