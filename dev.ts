import { initFunCParserOnce } from "./src/parse-func-source";
import { convertFunCToTolk } from "./src/convert-to-tolk";

async function runConvertAndPrint(funCSource: string) {
  await initFunCParserOnce('node_modules/web-tree-sitter/tree-sitter.wasm', 'tree-sitter-func/tree-sitter-func.wasm')

  let result = convertFunCToTolk(funCSource)
  console.log(result.tolkSource)
  for (let warning of result.warnings) {
    warning.lineNo >= 0
      ? console.warn(warning.text + ` at ${warning.lineNo}:${warning.colNo}`)
      : console.warn(warning.text)
  }
}

const funCSource = `
{- this is 
          FunC source -}
#include "another.fc";

(int, cell) main() impure method_id(123) { int x = 10; return x; }
`
runConvertAndPrint(funCSource).catch(console.error)

