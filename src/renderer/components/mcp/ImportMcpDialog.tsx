import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldLabel } from '@shared/components/ui/field';
import { Textarea } from '@shared/components/ui/textarea';
import { FileUp, Sparkles } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { setMcpServers } from '../../store/slices/mcpSlice';

interface ImportMcpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const SAMPLE_MCP_JSON = `{
  "mcpServers": {
    "local-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/folder"],
      "env": {}
    },
    "remote-server": {
      "url": "https://api.example.com/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}`;

const ImportMcpDialog: React.FC<ImportMcpDialogProps> = ({ open, onOpenChange, onSuccess }) => {
  const dispatch = useDispatch();
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setJsonText('');
      setError('');
    }
  }, [open]);

  const handleChooseFile = async () => {
    setError('');
    try {
      const result = await mcpService.importConfig();
      if (!result.success) {
        setError(result.error || i18nService.t('mcpImportFailed'));
        return;
      }
      if (result.servers) {
        dispatch(setMcpServers(result.servers));
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('mcpImportFailed'));
    }
  };

  const handleImportText = async () => {
    const trimmed = jsonText.trim();
    if (!trimmed) {
      setError(i18nService.t('importMcpJsonPlaceholder'));
      return;
    }

    try {
      JSON.parse(trimmed);
    } catch {
      setError(i18nService.t('importMcpConfigInvalid'));
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const result = await mcpService.importConfigContent(trimmed);
      if (!result.success) {
        setError(result.error || i18nService.t('mcpImportFailed'));
        return;
      }

      if (result.servers) {
        dispatch(setMcpServers(result.servers));
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('mcpImportFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-6 gap-5">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {i18nService.t('importMcpJsonTitle')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{i18nService.t('importMcpJsonTip')}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">方式一：从本地文件导入</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleChooseFile()}
              className="gap-1.5 h-8 text-xs"
            >
              <FileUp className="size-3.5" />
              选择配置文件 (.json)
            </Button>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-border" />
            <span className="flex-shrink mx-3 text-xs text-muted-foreground uppercase">或者</span>
            <div className="flex-grow border-t border-border" />
          </div>

          <Field className="flex-1 flex flex-col min-h-56">
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel className="text-xs font-medium">方式二：直接粘贴 JSON 配置</FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setJsonText(SAMPLE_MCP_JSON)}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <Sparkles className="size-3.5" />
                填充示例模板
              </Button>
            </div>
            <Textarea
              value={jsonText}
              onChange={e => setJsonText(e.target.value)}
              placeholder={i18nService.t('importMcpJsonPlaceholder')}
              className="flex-1 min-h-[180px] font-mono text-xs leading-relaxed resize-y bg-muted/20"
              spellCheck={false}
            />
          </Field>
        </div>

        <DialogFooter className="flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void handleImportText()}
            disabled={isSubmitting || !jsonText.trim()}
          >
            {isSubmitting ? i18nService.t('importingSkill') : i18nService.t('import') || '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ImportMcpDialog;
