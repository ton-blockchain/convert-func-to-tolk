import { initFunCParserOnce } from "../src/parse-func-source";
import fs from "fs";
import { convertFunCToTolk } from "../src/convert-to-tolk";

beforeAll(async () => {
  await initFunCParserOnce(__dirname + '/../node_modules/web-tree-sitter/tree-sitter.wasm', __dirname + '/../tree-sitter-func/tree-sitter-func.wasm');
})

describe('should convert all files in a folder', () => {
  const FOLDER_INOUT = __dirname + '/inout/'
  const files = fs.readdirSync(FOLDER_INOUT)
  const funCFiles = files.filter(f => f.endsWith('.fc'))

  for (let fcFile of funCFiles) {
    let tolkFile = files.find(f => f === fcFile + '.tolk')
    if (!tolkFile)
      throw `${fcFile}.tolk not found in a folder`

    it(fcFile, () => {
      let funCSource = fs.readFileSync(FOLDER_INOUT + fcFile, 'utf-8')
      let tolkSource = fs.readFileSync(FOLDER_INOUT + tolkFile, 'utf-8')
      let result = convertFunCToTolk(funCSource)
      expect(result.tolkSource).toEqual(tolkSource)
    })
  }
})
