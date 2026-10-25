import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { FieldError, FieldGroup } from '@shared/components/ui/field';
import { LoaderCircle } from 'lucide-react';
import { useRef } from 'react';
import { i18nService } from '../../../services/i18n';
import { ProviderConnectionFields } from './providerEditor/ProviderConnectionFields';
import { ProviderDiscovery } from './providerEditor/ProviderDiscovery';
import { ProviderModelsEditor } from './providerEditor/ProviderModelsEditor';
import { useProviderEditor, type ProviderEditorProps } from './providerEditor/useProviderEditor';

export function ProviderEditDialog(props: ProviderEditorProps) {
  const editor = useProviderEditor(props);
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={editor.changeOpen}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl"
        initialFocus={nameRef}
        aria-describedby={undefined}
        closeLabel={i18nService.t('close')}
        showCloseButton={!editor.isSaving}
      >
        <DialogHeader>
          <DialogTitle>
            {i18nService.t(editor.isEditing ? 'magpieEditProvider' : 'magpieAddProvider')}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={event => {
            event.preventDefault();
            void editor.save();
          }}
          className="flex min-h-0 flex-col gap-4"
          aria-busy={editor.isSaving}
        >
          <div className="min-h-0 overflow-y-auto">
            <FieldGroup className="gap-4">
              <ProviderConnectionFields editor={editor} nameRef={nameRef} />
              <ProviderDiscovery editor={editor} canTest={Boolean(props.onTest)} />
              <ProviderModelsEditor key={editor.generation} editor={editor} />
            </FieldGroup>
          </div>
          {editor.saveFailed && (
            <FieldError>{i18nService.t('magpieProviderSaveFailed')}</FieldError>
          )}
          <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              disabled={editor.isSaving}
              onClick={() => editor.changeOpen(false)}
            >
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                editor.isSaving || !editor.draft.name.trim() || !editor.draft.baseUrl.trim()
              }
            >
              {editor.isSaving && (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              )}
              {i18nService.t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
