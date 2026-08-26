import fs from 'node:fs';
import path from 'node:path';

import {
  ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION,
  type ZhiyuanEnterpriseManagedSkillRegistration,
  type ZhiyuanEnterpriseSkillHostCapability,
} from './contract';
import { skillRootRegistry } from '../skillRootRegistry';

const ENTERPRISE_DIRECTORY = 'zhiyuan-enterprise';
const MANAGED_SKILL_DIRECTORY = 'managed-skills';

type RegisterSkillRoot = (root: string) => () => void;

export interface ZhiyuanEnterpriseSkillBridgeOptions {
  readonly userDataPath: string;
  readonly refreshSkills: () => void;
  readonly registerSkillRoot?: RegisterSkillRoot;
}

export class ZhiyuanEnterpriseSkillBridge implements ZhiyuanEnterpriseSkillHostCapability {
  readonly apiVersion = ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION;
  readonly #managedDirectory: string;
  readonly #refreshSkills: () => void;
  readonly #registerSkillRoot: RegisterSkillRoot;
  #registered = false;

  constructor(options: ZhiyuanEnterpriseSkillBridgeOptions) {
    if (!path.isAbsolute(options.userDataPath)) {
      throw new Error('Zhiyuan enterprise user data path must be absolute.');
    }
    this.#managedDirectory = path.join(
      path.resolve(options.userDataPath),
      ENTERPRISE_DIRECTORY,
      MANAGED_SKILL_DIRECTORY,
    );
    this.#refreshSkills = options.refreshSkills;
    this.#registerSkillRoot =
      options.registerSkillRoot ?? (root => skillRootRegistry.register(root));
  }

  registerManagedRoot(): ZhiyuanEnterpriseManagedSkillRegistration {
    if (this.#registered) {
      throw new Error('A Zhiyuan enterprise managed Skill root is already registered.');
    }
    fs.mkdirSync(this.#managedDirectory, { recursive: true });
    const unregisterRoot = this.#registerSkillRoot(this.#managedDirectory);
    this.#registered = true;
    let active = true;
    return Object.freeze({
      directory: this.#managedDirectory,
      notifyChanged: () => {
        if (active) this.#refreshSkills();
      },
      unregister: () => {
        if (!active) return;
        active = false;
        unregisterRoot();
        this.#registered = false;
      },
    });
  }
}
