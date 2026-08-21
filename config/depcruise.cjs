/** Read-only architecture analysis config used by `deep`.
 *
 * Lives here rather than in the analysed repository: `deep` measures and never
 * writes. The tsconfig it should read comes in through DS_TSCONFIG, because path
 * aliases are the whole reason a hand-written traversal under-reports.
 */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: process.env.DS_EXCLUDE || '(^|/)\\.[^/]' },
    tsConfig: process.env.DS_TSCONFIG ? { fileName: process.env.DS_TSCONFIG } : undefined,
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
