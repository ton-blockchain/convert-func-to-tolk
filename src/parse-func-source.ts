import Parser, { SyntaxNode } from "web-tree-sitter";

let funCParser: Parser

export async function initFunCParserOnce(treeSitterUri: string, langUri: string) {
  if (funCParser) {
    return;
  }
  await Parser.init({
    locateFile() {
      return treeSitterUri
    }
  })

  funCParser = new Parser();
  funCParser.setLanguage(await Parser.Language.load(langUri));
  funCParser.setTimeoutMicros(1000 * 1000);
}

function ensureFunCParserCreated() {
  if (!funCParser) {
    throw new Error(`initFunCParserOnce() hasn't been called`)
  }
}

export function parseFunCSource(funcSource: string): SyntaxNode {
  ensureFunCParserCreated()
  return funCParser.parse(funcSource).rootNode
}
