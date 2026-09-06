import { CheckIcon, XIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="top-center"
      duration={2200}
      className="toaster group"
      icons={{
        success: <CheckIcon className="theme-toast-icon" />,
        info: <InfoIcon className="theme-toast-icon" />,
        warning: <TriangleAlertIcon className="theme-toast-icon" />,
        error: <XIcon className="theme-toast-icon" />,
        loading: <Loader2Icon className="theme-spinner" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
