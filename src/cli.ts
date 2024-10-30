#!/usr/bin/env node
import arg from 'arg'
import fs from 'fs'
import { convertFunCToTolk, ConvertFunCToTolkOptions } from './convert-to-tolk'
import { initFunCParserOnce } from './parse-func-source'

async function convertFunCToTolkCli() {
  const args = arg({
    '--help': Boolean,
    '--output': String,
    '--warnings-as-comments': Boolean,
    '--no-camel-case': Boolean,

    '-h': '--help',
    '-o': '--output',
  })
  let options: ConvertFunCToTolkOptions = {
    shouldInsertWarningsAsComments: false,
    transformFunctionNamesToCamelCase: true,
    transformLocalVarNamesToCamelCase: true,
  }

  if (args['--help']) {
    console.log(`Usage: convert-func-to-tolk [OPTIONS] fileName.fc
Options:
-h, --help — print this help and exit
-o, --output {file.tolk} — instead of default fileName.tolk
--warnings-as-comments — insert /* _WARNING_ */ comments (not just print warnings to output)
--no-camel-case — don't transform snake_case to camelCase  
`)
    process.exit(0)
  }

  if (args['--warnings-as-comments']) {
    options.shouldInsertWarningsAsComments = true
  }
  if (args['--no-camel-case']) {
    options.transformLocalVarNamesToCamelCase = false
    options.transformFunctionNamesToCamelCase = false
  }

  if (args._.length !== 1) {
    throw `fileName.fc wasn't specified. Run with -h to see help.`
  }
  const funCFileName = args._[0];
  if (!fs.existsSync(funCFileName)) {
    throw `input file ${funCFileName} doesn't exist`
  }
  const funCSource = fs.readFileSync(funCFileName, 'utf-8')

  let tolkFileName = args['--output'] || funCFileName.replace(/\.(fc|func)/, '.tolk')
  if (tolkFileName === funCFileName) {
    tolkFileName = funCFileName + '.tolk'
  }

  await initFunCParserOnce(__dirname + '/tree-sitter.wasm', __dirname + '/tree-sitter-func.wasm')

  let convertionResult = convertFunCToTolk(funCSource, options)
  for (let warning of convertionResult.warnings) {
    warning.lineNo >= 0
      ? console.warn(warning.text + ` at ${warning.lineNo}:${warning.colNo}`)
      : console.warn(warning.text)
  }

  fs.writeFileSync(tolkFileName, convertionResult.tolkSource, 'utf-8')
  console.log(`written ${tolkFileName}`)
}

convertFunCToTolkCli().catch(ex => {
  console.error(ex)
  process.exit(1)
})
