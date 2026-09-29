// eslint-disable-next-line @typescript-eslint/no-require-imports -- Webpack loads CommonJS loaders.
const ts = require('typescript');

module.exports = function(source) {
  if (this.resourcePath.endsWith('.css')) return '';
  return ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: this.resourcePath,
  }).outputText;
};
