import type { ReactNode } from 'react';

import type { EnterpriseRendererLanguage } from '../../../renderer-contract.js';
import logoDarkUrl from '../../assets/zhiyuan-logo-dark.svg';
import logoLightUrl from '../../assets/zhiyuan-logo-light.svg';
import { translate } from '../../i18n.js';

interface SessionLayoutProps {
  readonly language: EnterpriseRendererLanguage;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

export function SessionLayout({ language, title, description, children }: SessionLayoutProps) {
  return (
    <main className="flex min-h-full items-center justify-center bg-background p-4 sm:p-6">
      <section className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-surface p-5 shadow-lg sm:p-6">
        <header className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <img
              src={logoLightUrl}
              alt={translate(language, 'brand')}
              className="h-6 w-auto select-none dark:hidden"
            />
            <img
              src={logoDarkUrl}
              alt=""
              aria-hidden="true"
              className="hidden h-6 w-auto select-none dark:block"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold leading-snug">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
