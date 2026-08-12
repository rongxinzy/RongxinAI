import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@shared/components/ai-elements/code-block';
import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { formatJson } from './utils';

interface AuditJsonDisclosureProps {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}

export function AuditJsonDisclosure({
  label,
  value,
  defaultOpen = false,
}: AuditJsonDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const code = formatJson(value);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" size="sm" className="w-full justify-start" />}
      >
        <ChevronRight
          data-icon="inline-start"
          className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <CodeBlock code={code} language="json">
          <CodeBlockHeader>
            <CodeBlockTitle>{label}</CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockCopyButton aria-label={i18nService.t('copyToClipboard')} size="icon-sm" />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      </CollapsibleContent>
    </Collapsible>
  );
}
