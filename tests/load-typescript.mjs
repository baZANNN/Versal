import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

export function loadTypeScript(relativePath, mocks = {}, globals = {}) {
  const url = new URL(relativePath, import.meta.url);
  const nativeRequire = createRequire(url);
  const source = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith(".")) {
      const target = [".ts", ".tsx"].map((extension) => new URL(`${name}${extension}`, url)).find(existsSync);
      if (!target) throw new Error(`Cannot resolve ${name} from ${url}`);
      return loadTypeScript(target.href, mocks, globals);
    }
    return nativeRequire(name);
  };
  new Function("require", "module", "exports", ...Object.keys(globals), source)(require, module, module.exports, ...Object.values(globals));
  return module.exports;
}
