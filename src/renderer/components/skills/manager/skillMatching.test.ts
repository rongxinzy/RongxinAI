import { expect, test } from 'vitest';

import { MarketplaceSkill, Skill } from '../../../types/skill';
import { SkillCategory } from '../constants';
import {
  buildInstalledSkillNames,
  buildMarketplaceNameMap,
  filterInstalledSkills,
  findInstalledSkillForMarketplace,
  isMarketplaceSkillAlreadyInstalled,
  isMarketplaceSkillInstalled,
  normalizeSkillName,
} from './skillMatching';

const makeSkill = (overrides: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill => ({
  description: '',
  enabled: true,
  pinned: false,
  isOfficial: false,
  isBuiltIn: false,
  updatedAt: 0,
  prompt: '',
  skillPath: '',
  ...overrides,
});

const makeMarketplaceSkill = (
  overrides: Partial<MarketplaceSkill> & Pick<MarketplaceSkill, 'id' | 'name'>,
): MarketplaceSkill => ({
  description: '',
  url: '',
  version: '',
  source: { from: 'ModelScope', url: '' },
  ...overrides,
});

test('normalizeSkillName trims, lowercases and collapses separators', () => {
  expect(normalizeSkillName('  Foo_Bar  baz -- qux ')).toBe('foo-bar-baz-qux');
  expect(normalizeSkillName('A/B')).toBe('a/b');
});

test('buildInstalledSkillNames normalizes name and displayName and skips blanks', () => {
  const names = buildInstalledSkillNames([
    makeSkill({ id: 'a', name: 'My Skill', displayName: '  Display Name  ' }),
    makeSkill({ id: 'b', name: '   ' }),
    makeSkill({ id: 'c', name: 'plain' }),
  ]);
  expect([...names].sort()).toEqual(['display-name', 'my-skill', 'plain']);
});

test('buildMarketplaceNameMap maps marketplace id to listing name', () => {
  const map = buildMarketplaceNameMap([
    makeMarketplaceSkill({ id: 'org/a', name: 'A' }),
    makeMarketplaceSkill({ id: 'org/b', name: 'B' }),
  ]);
  expect(map.get('org/a')).toBe('A');
  expect(map.get('org/b')).toBe('B');
  expect(map.size).toBe(2);
});

test('findInstalledSkillForMarketplace matches by exact id', () => {
  const installed = [makeSkill({ id: 'org/pdf', name: 'Unrelated' })];
  const found = findInstalledSkillForMarketplace(
    installed,
    makeMarketplaceSkill({ id: 'org/pdf', name: 'Pdf Tools' }),
  );
  expect(found?.id).toBe('org/pdf');
});

test('findInstalledSkillForMarketplace matches by marketplace leaf id', () => {
  const installed = [makeSkill({ id: 'PDF-Tools', name: 'Anything' })];
  const found = findInstalledSkillForMarketplace(
    installed,
    makeMarketplaceSkill({ id: 'modelscope/pdf-tools', name: 'Other Name' }),
  );
  expect(found?.id).toBe('PDF-Tools');
});

test('findInstalledSkillForMarketplace matches by normalized name or displayName', () => {
  const byName = [makeSkill({ id: 'local-1', name: 'pdf_tools' })];
  expect(
    findInstalledSkillForMarketplace(
      byName,
      makeMarketplaceSkill({ id: 'org/x', name: 'PDF Tools' }),
    )?.id,
  ).toBe('local-1');

  const byDisplayName = [makeSkill({ id: 'local-2', name: 'internal', displayName: 'PDF Tools' })];
  expect(
    findInstalledSkillForMarketplace(
      byDisplayName,
      makeMarketplaceSkill({ id: 'org/x', name: 'pdf tools' }),
    )?.id,
  ).toBe('local-2');
});

test('findInstalledSkillForMarketplace returns undefined when nothing matches', () => {
  const installed = [makeSkill({ id: 'local', name: 'other' })];
  expect(
    findInstalledSkillForMarketplace(
      installed,
      makeMarketplaceSkill({ id: 'org/x', name: 'pdf tools' }),
    ),
  ).toBeUndefined();
});

test('isMarketplaceSkillInstalled counts id and normalized name but not displayName', () => {
  const installed = [makeSkill({ id: 'local', name: 'internal', displayName: 'PDF Tools' })];
  const listing = makeMarketplaceSkill({ id: 'org/x', name: 'pdf tools' });
  expect(isMarketplaceSkillInstalled(installed, listing)).toBe(false);

  const byId = [makeSkill({ id: 'org/x', name: 'other' })];
  expect(isMarketplaceSkillInstalled(byId, listing)).toBe(true);

  const byName = [makeSkill({ id: 'local', name: 'PDF_Tools' })];
  expect(isMarketplaceSkillInstalled(byName, listing)).toBe(true);
});

test('isMarketplaceSkillAlreadyInstalled counts id and normalized name but not displayName', () => {
  const listing = makeMarketplaceSkill({ id: 'org/x', name: 'pdf tools' });
  expect(
    isMarketplaceSkillAlreadyInstalled(
      [makeSkill({ id: 'local', name: 'internal', displayName: 'PDF Tools' })],
      listing,
    ),
  ).toBe(false);
  expect(
    isMarketplaceSkillAlreadyInstalled([makeSkill({ id: 'org/x', name: 'other' })], listing),
  ).toBe(true);
  expect(
    isMarketplaceSkillAlreadyInstalled([makeSkill({ id: 'local', name: 'PDF Tools' })], listing),
  ).toBe(true);
});

test('filterInstalledSkills keeps everything for All category without query', () => {
  const skills = [
    makeSkill({ id: 'docx', name: 'Docx' }),
    makeSkill({ id: 'web-search', name: 'Web Search' }),
  ];
  expect(filterInstalledSkills(skills, SkillCategory.All, '')).toEqual(skills);
  expect(filterInstalledSkills(skills, SkillCategory.All, '   ')).toEqual(skills);
});

test('filterInstalledSkills honors the category mapping', () => {
  const docx = makeSkill({ id: 'docx', name: 'Docx' });
  const webSearch = makeSkill({ id: 'web-search', name: 'Web Search' });
  // 'docx' is registered under the writing category, 'web-search' under search.
  expect(filterInstalledSkills([docx, webSearch], SkillCategory.Writing, '')).toEqual([docx]);
  expect(filterInstalledSkills([docx, webSearch], SkillCategory.Search, '')).toEqual([webSearch]);
});

test('filterInstalledSkills matches name, displayName, description and displayDescription', () => {
  const skills = [
    makeSkill({ id: 'a', name: 'Alpha', description: 'unrelated' }),
    makeSkill({ id: 'b', name: 'Beta', displayName: 'Gamma Marker' }),
    makeSkill({ id: 'c', name: 'Ceta', description: 'marker text' }),
    makeSkill({ id: 'd', name: 'Delta', displayDescription: 'has marker too' }),
  ];
  const results = filterInstalledSkills(skills, SkillCategory.All, 'marker');
  expect(results.map(skill => skill.id)).toEqual(['b', 'c', 'd']);
});

test('filterInstalledSkills collapses query whitespace and is case-insensitive', () => {
  const skills = [makeSkill({ id: 'a', name: 'Alpha', description: 'deep search text' })];
  expect(filterInstalledSkills(skills, SkillCategory.All, 'Deep  SEARCH')).toEqual(skills);
  // The haystack is not whitespace-collapsed, so a glued query must not match.
  expect(filterInstalledSkills(skills, SkillCategory.All, 'deepsearch')).toEqual([]);
});

test('filterInstalledSkills drops skills outside the category even when the query matches', () => {
  const docx = makeSkill({ id: 'docx', name: 'Marker Skill' });
  const webSearch = makeSkill({ id: 'web-search', name: 'Other Marker' });
  expect(filterInstalledSkills([docx, webSearch], SkillCategory.Search, 'marker')).toEqual([
    webSearch,
  ]);
});
