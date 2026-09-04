import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useMemo } from 'react';

import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskDetail,
} from '../../../../../shared/workbenchTask';
import { i18nService } from '../../../../services/i18n';
import { TIMELINE_EASE } from '../constants';
import { TimelineChapter } from './TimelineChapter';
import { buildTimelineChapters } from './timelineModel';

const chapterListVariants: Variants = {
  show: { transition: { staggerChildren: 0.06 } },
};

const chapterItemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: TIMELINE_EASE } },
};

interface WorkbenchTimelineProps {
  detail: WorkbenchTaskDetail;
  busy: boolean;
  onRespondToApproval: (input: WorkbenchApprovalResponseInput) => void;
}

export function WorkbenchTimeline({
  detail,
  busy,
  onRespondToApproval,
}: WorkbenchTimelineProps) {
  const reducedMotion = useReducedMotion();
  const chapters = useMemo(() => buildTimelineChapters(detail), [detail]);
  const defaultOpenRunId = useMemo(() => {
    if (detail.task.activeRunId && chapters.some(chapter => chapter.run.id === detail.task.activeRunId)) {
      return detail.task.activeRunId;
    }
    return chapters[chapters.length - 1]?.run.id ?? null;
  }, [chapters, detail.task.activeRunId]);

  if (chapters.length === 0) {
    return <p className="pb-10 text-sm text-muted-foreground">{i18nService.t('workbenchTaskNoRuns')}</p>;
  }

  return (
    <div className="relative pb-10">
      <motion.ol
        className="relative flex flex-col gap-4"
        variants={reducedMotion ? undefined : chapterListVariants}
        initial={reducedMotion ? false : 'hidden'}
        animate={reducedMotion ? undefined : 'show'}
      >
        {chapters.map((chapter, index) => {
          const hasNextChapter = index < chapters.length - 1;
          return (
            <motion.li
              key={chapter.run.id}
              className="relative isolate"
              variants={reducedMotion ? undefined : chapterItemVariants}
            >
              {hasNextChapter && (
                <>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-3.5 left-3.5 z-0 h-[calc(100%+1rem)] w-px -translate-x-1/2 bg-border"
                  />
                  {!reducedMotion && (
                    <motion.span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-3.5 left-3.5 z-0 h-[calc(100%+1rem)] w-px origin-top bg-primary/40"
                      style={{ x: '-50%' }}
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.8, ease: TIMELINE_EASE }}
                    />
                  )}
                </>
              )}
              <TimelineChapter
                chapter={chapter}
                runs={detail.runs}
                defaultOpen={chapter.run.id === defaultOpenRunId}
                busy={busy}
                onRespondToApproval={onRespondToApproval}
              />
            </motion.li>
          );
        })}
      </motion.ol>
    </div>
  );
}
