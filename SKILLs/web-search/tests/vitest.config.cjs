// Run from the repository root after the nested skill's existing install/build workflow.
module.exports = {
  test: {
    include: ['SKILLs/web-search/tests/*.test.ts', 'tests/webSearchDependencySecurity.test.ts'],
    environment: 'node',
  },
};
