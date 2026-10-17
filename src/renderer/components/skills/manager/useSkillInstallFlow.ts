import React, { useState } from 'react';
import { useDispatch } from 'react-redux';

import type { SkillSecurityReport as SkillSecurityReportData } from '../../../../main/libs/skillSecurity/skillSecurityTypes';
import { i18nService } from '../../../services/i18n';
import { skillService } from '../../../services/skill';
import { setSkills } from '../../../store/slices/skillSlice';
import { MarketplaceSkill, Skill } from '../../../types/skill';
import {
  findInstalledSkillForMarketplace,
  isMarketplaceSkillAlreadyInstalled,
} from './skillMatching';
import type { DirectImportSource } from './types';

export type SecurityReportAction = 'install' | 'installDisabled' | 'cancel';

interface UseSkillInstallFlowOptions {
  installedSkills: Skill[];
  setSkillActionError: (message: string) => void;
  showToast: (message: string) => void;
  setSelectedSkill: React.Dispatch<React.SetStateAction<Skill | null>>;
  setSelectedMarketplaceSkill: React.Dispatch<React.SetStateAction<MarketplaceSkill | null>>;
  /** Called after a confirmed install clears the security review. */
  onInstallConfirmed: () => void;
}

/**
 * Skill install flow state: the marketplace install button (in-flight id,
 * fake progress, security review gate) and the security-report confirmation
 * shared by marketplace installs and direct zip/folder/remote imports.
 */
export function useSkillInstallFlow({
  installedSkills,
  setSkillActionError,
  showToast,
  setSelectedSkill,
  setSelectedMarketplaceSkill,
  onInstallConfirmed,
}: UseSkillInstallFlowOptions) {
  const dispatch = useDispatch();
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [securityReport, setSecurityReport] = useState<SkillSecurityReportData | null>(null);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const [pendingMarketplaceSkillId, setPendingMarketplaceSkillId] = useState<string | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<DirectImportSource | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);

  /** A direct import (zip/folder/remote) returned a security report. */
  const openDirectImportSecurityReview = (
    report: SkillSecurityReportData,
    reviewPendingInstallId: string,
    importSource: DirectImportSource,
  ) => {
    setSecurityReport(report);
    setPendingInstallId(reviewPendingInstallId);
    setPendingImportSource(importSource);
  };

  /** A marketplace install returned a security report. */
  const openMarketplaceSecurityReview = (
    report: SkillSecurityReportData,
    reviewPendingInstallId: string,
    marketplaceSkillId: string,
  ) => {
    setSecurityReport(report);
    setPendingInstallId(reviewPendingInstallId);
    setPendingMarketplaceSkillId(marketplaceSkillId);
    setPendingImportSource(null);
  };

  const handleInstallMarketplaceSkill = async (skill: MarketplaceSkill) => {
    const installSource = skill.installSource;
    if (installingSkillId || !installSource) return;
    if (isMarketplaceSkillAlreadyInstalled(installedSkills, skill)) {
      setSkillActionError(i18nService.t('skillAlreadyInstalled'));
      return;
    }
    setInstallingSkillId(skill.id);
    setInstallProgress(12);
    let awaitingSecurityConfirmation = false;
    const progressTimer = window.setInterval(() => {
      setInstallProgress(current => Math.min(88, current + 4));
    }, 700);
    setSkillActionError('');
    try {
      const result = await skillService.downloadSkill(installSource, {
        iconUrl: skill.iconUrl,
        displayName: skill.name,
      });
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillInstallFailed'));
        return;
      }
      // Security audit returned — show report modal
      if (result.auditReport && result.pendingInstallId) {
        awaitingSecurityConfirmation = true;
        openMarketplaceSecurityReview(result.auditReport, result.pendingInstallId, skill.id);
        return;
      }
      if (result.skills) {
        dispatch(setSkills(result.skills));
        const installedSkill = findInstalledSkillForMarketplace(result.skills, skill);
        if (installedSkill) {
          setSelectedMarketplaceSkill(null);
          setSelectedSkill(installedSkill);
        }
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      window.clearInterval(progressTimer);
      setInstallProgress(100);
      window.setTimeout(
        () => {
          setInstallingSkillId(current => (current === skill.id ? null : current));
        },
        awaitingSecurityConfirmation ? 0 : 300,
      );
    }
  };

  const handleSecurityReportAction = async (action: SecurityReportAction) => {
    if (action === 'cancel') {
      setSecurityReport(null);
      setPendingInstallId(null);
      setPendingMarketplaceSkillId(null);
      setPendingImportSource(null);
      setSkillActionError('');
      return;
    }
    if (!pendingInstallId) return;
    setIsConfirmingInstall(true);
    let shouldCloseSecurityReport = false;
    try {
      const result = await skillService.confirmInstall(pendingInstallId, action);
      if (result.success && result.skills) {
        dispatch(setSkills(result.skills));
        const installedSkill = pendingMarketplaceSkillId
          ? result.skills.find(skill => skill.id === pendingMarketplaceSkillId)
          : undefined;
        if (installedSkill) {
          setSelectedMarketplaceSkill(null);
          setSelectedSkill(installedSkill);
        }
        if (pendingImportSource) {
          showToast(i18nService.t('skillImportSuccess'));
        }
        shouldCloseSecurityReport = true;
      }
      if (!result.success && result.error) {
        setSkillActionError(result.error);
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      if (shouldCloseSecurityReport) {
        setSecurityReport(null);
        setPendingInstallId(null);
        setPendingMarketplaceSkillId(null);
        setPendingImportSource(null);
      }
      setIsConfirmingInstall(false);
      setInstallingSkillId(null);
      if (shouldCloseSecurityReport) {
        onInstallConfirmed();
      }
    }
  };

  return {
    installingSkillId,
    installProgress,
    securityReport,
    isConfirmingInstall,
    openDirectImportSecurityReview,
    handleInstallMarketplaceSkill,
    handleSecurityReportAction,
  };
}
