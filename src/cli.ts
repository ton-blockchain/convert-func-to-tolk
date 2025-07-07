#!/usr/bin/env node
import arg from 'arg'
import fs from 'fs'
import path from 'path'
import { convertFunCToTolk, ConvertFunCToTolkOptions } from './convert-to-tolk'
import { initFunCParserOnce } from './parse-func-source'

function findAllFcFilesInFolder(folderName: string): string[] {
  const entries = fs.readdirSync(folderName, { withFileTypes: true });
  return entries
      .filter(e => e.isFile() && (e.name.endsWith('.fc') || e.name.endsWith('.func')))
      .map(e => path.join(folderName, e.name))
}

function convertOneFcFile(fcFileName: string, outTolkFileName: string, options: ConvertFunCToTolkOptions) {
  const funCSource = fs.readFileSync(fcFileName, 'utf-8')

  let convertionResult = convertFunCToTolk(funCSource, options)
  for (let warning of convertionResult.warnings) {
    warning.lineNo >= 0
        ? console.warn(warning.text + ` at ${warning.lineNo}:${warning.colNo}`)
        : console.warn(warning.text)
  }

  fs.writeFileSync(outTolkFileName, convertionResult.tolkSource, 'utf-8')
  console.log(`written ${outTolkFileName}`)
}

async function convertFunCToTolkCli() {
  const args = arg({
    '--help': Boolean,
    '--output': String,
    '--warnings-as-comments': Boolean,
    '--no-camel-case': Boolean,

    '-h': '--help',
  })
  let options: ConvertFunCToTolkOptions = {
    shouldInsertWarningsAsComments: false,
    transformFunctionNamesToCamelCase: true,
    transformLocalVarNamesToCamelCase: true,
  }

  if (args['--help']) {
    console.log(`Usage: convert-func-to-tolk [OPTIONS] folderName OR file.fc
Options:
-h, --help — print this help and exit
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
  const fcFolderOrFile = args._[0];
  if (!fs.existsSync(fcFolderOrFile)) {
    throw `${fcFolderOrFile} doesn't exist`
  }

  const foundFiles = fs.statSync(fcFolderOrFile).isFile()
      ? [fcFolderOrFile]
      : findAllFcFilesInFolder(fcFolderOrFile)
  if (foundFiles.length === 0) {
    throw `folder ${fcFolderOrFile} is empty (note: search is not recursive)`
  }

  await initFunCParserOnce(__dirname + '/tree-sitter.wasm', __dirname + '/tree-sitter-func.wasm')

  for (let fcFileName of foundFiles) {
    let tolkFileName = fcFileName.replace(/\.(fc|func)/, '.tolk')
    if (tolkFileName === fcFileName) {
      tolkFileName = fcFileName + '.tolk'
    }

    convertOneFcFile(fcFileName, tolkFileName, options)
  }
}

convertFunCToTolkCli().catch(ex => {
  console.error(ex)
  process.exit(1)
})
