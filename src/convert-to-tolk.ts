import { Point, SyntaxNode } from "web-tree-sitter";
import { parseFunCSource } from "./parse-func-source";
import * as RENAMING from "./renaming-mapping";

export interface ConvertFunCToTolkOptions {
  shouldInsertWarningsAsComments: boolean
  transformFunctionNamesToCamelCase: boolean
  transformLocalVarNamesToCamelCase: boolean
}

const defaultOptions: ConvertFunCToTolkOptions = {
  shouldInsertWarningsAsComments: false,
  transformFunctionNamesToCamelCase: true,
  transformLocalVarNamesToCamelCase: true,
}


function transformSnakeCaseToCamelCase(name: string): string {
  if (name.startsWith('`')) {
    return name
  }

  let newName = ''
  for (let i = 0; i < name.length; ++i) {
    if (name[i] === '_' && i < name.length - 1 && name[i + 1] >= 'a' && name[i + 1] <= 'z') {
      newName += name[i + 1].toUpperCase()
      i++
    } else {
      newName += name[i]
    }
  }
  return newName
}

function replaceIdentifier(name: string, out: FunCToTolkState, isFunctionCall: boolean): string {
  if (name.startsWith('`')) {
    return name
  }
  if (!isFunctionCall && out.isInsideModifyingMethod() && name === out.getSelfVarNameInModifyingMethod()) {
    return 'self'
  }
  if (isFunctionCall && name in RENAMING.STDLIB_RENAMING) {
    name = RENAMING.STDLIB_RENAMING[name]
  }
  if (!isFunctionCall && name in RENAMING.KEYWORDS_RENAMING) {
    name = RENAMING.KEYWORDS_RENAMING[name]
  }
  if (name.endsWith('?')) {
    name = (name.startsWith('is_') ? '' : 'is_') + name.substring(0, name.length - 1)
  }
  if (name.startsWith("op::")) {
    name = "OP_" + name.substring(4).toUpperCase();
  }
  if (name.startsWith("err::")) {
    name = "ERR_" + name.substring(5).toUpperCase();
  }
  if (name.startsWith("error::")) {
    name = "ERROR_" + name.substring(7).toUpperCase();
  }
  if (!/^[a-zA-Z_$][a-zA-Z_$0-9.]*$/.test(name)) {
    name = '`' + name + '`'
  }

  if (isFunctionCall && name in RENAMING.STDLIB_AUTO_IMPORTS) {
    // console.log(`import ${STDLIB_AUTO_IMPORTS[name]} because of ${name}`)
    out.autoImportStdlib(RENAMING.STDLIB_AUTO_IMPORTS[name])
  }
  return name
}

class FunCToTolkState {
  private readonly funCSource: string
  private readonly options: ConvertFunCToTolkOptions

  private tolkSource: string = ''
  private warnings: { text: string, lineNo: number, colNo: number }[] = []
  private lastEndIndex = 0
  private forkedFromNode: SyntaxNode | null = null
  private importStdlib = new Set<string>()
  private selfVarNameInModifyingMethod: string | null = null
  private localVarNames: string[] | null = null
  private knownGetMethods: string[] = []
  private needInsertTolkPreamble = false

  constructor(funCSource: string, options: ConvertFunCToTolkOptions) {
    this.funCSource = funCSource
    this.options = options
  }

  getOptions() {
    return this.options
  }

  createEmptyFork(offsetNode: SyntaxNode): FunCToTolkState {
    let fork = new FunCToTolkState(this.funCSource, this.options)
    fork.forkedFromNode = offsetNode
    fork.lastEndIndex = offsetNode.endIndex
    fork.selfVarNameInModifyingMethod = this.selfVarNameInModifyingMethod
    fork.localVarNames = this.localVarNames
    return fork
  }

  mergeWithFork(...forksAndDelimiters: (FunCToTolkState | null)[]) {
    let minNodeStartIndex = 1e9
    let maxNodeEndIndex = 0
    for (let fork of forksAndDelimiters) {
      if (fork) {
        minNodeStartIndex = Math.min(minNodeStartIndex, fork.forkedFromNode!.startIndex)
        maxNodeEndIndex = Math.max(maxNodeEndIndex, fork.forkedFromNode!.endIndex)
      }
    }
    if (minNodeStartIndex > this.lastEndIndex) {
      this.tolkSource += this.funCSource.substring(this.lastEndIndex, minNodeStartIndex)
    }
    for (let fork of forksAndDelimiters) {
      if (fork) {
        this.tolkSource += fork.tolkSource
        this.warnings.push(...fork.warnings)
      }
    }
    this.lastEndIndex = maxNodeEndIndex
  }

  autoImportStdlib(stdlibFilename: string) {
    this.importStdlib.add(stdlibFilename)
  }

  addTextUnchanged(node: SyntaxNode) {
    if (node.startIndex > this.lastEndIndex) {
      this.tolkSource += this.funCSource.substring(this.lastEndIndex, node.startIndex)
    }
    this.tolkSource += node.text
    this.lastEndIndex = node.endIndex
  }

  addTextModified(node: SyntaxNode, text: string) {
    if (node.startIndex > this.lastEndIndex) {
      this.tolkSource += this.funCSource.substring(this.lastEndIndex, node.startIndex)
    }
    this.tolkSource += text
    this.lastEndIndex = node.endIndex
  }

  justSkipNode(node: SyntaxNode, withTrailingNl = true) {
    if (node.startIndex > this.lastEndIndex) {
      this.tolkSource += this.funCSource.substring(this.lastEndIndex, node.startIndex)
    }
    this.lastEndIndex = node.endIndex
    if (withTrailingNl && this.funCSource[this.lastEndIndex] === '\n')
      this.lastEndIndex++
  }

  skipSpaces() {
    if (this.funCSource[this.lastEndIndex] === ' ' || this.funCSource[this.lastEndIndex] === '\n')
      this.lastEndIndex++
  }

  moveCursorToNode(n: SyntaxNode) {
    while (this.lastEndIndex < n.startIndex) {
      this.tolkSource += this.funCSource[this.lastEndIndex]
      this.lastEndIndex++
    }
  }

  addTextCustom(text: string) {
    this.tolkSource += text
  }

  addWarningAt(text: string, position: Point) {
    if (this.options.shouldInsertWarningsAsComments) {
      this.tolkSource += `/* _WARNING_ ${text} */`
    }
    this.warnings.push({ text, lineNo: position.row + 1, colNo: position.column + 1 })
  }

  addWarningGlobal(text: string) {
    this.warnings.push({ text, lineNo: -1, colNo: -1 })
  }

  insertTolkPreambleInsteadOfPragmaVersion() {
    this.needInsertTolkPreamble = true
  }

  onEnterModifyingMethod(selfVarName: string) {
    this.selfVarNameInModifyingMethod = selfVarName
  }

  onLeaveModifyingMethod() {
    this.selfVarNameInModifyingMethod = null
  }

  onEnterFunction(localVarNames: string[]) {
    this.localVarNames = localVarNames
  }

  onLeaveFunction() {
    this.localVarNames = null
  }

  registerKnownGetMethod(functionName: string) {
    this.knownGetMethods.push(functionName)
  }

  isInsideModifyingMethod() {
    return this.selfVarNameInModifyingMethod !== null
  }

  getSelfVarNameInModifyingMethod(): string {
    return this.selfVarNameInModifyingMethod!
  }

  isLocalVariableOrParameter(n: string): boolean {
    return this.localVarNames?.includes(n) ?? false
  }

  isKnownGetMethod(functionName: string) {
    return this.knownGetMethods.includes(functionName)
  }

  isEmpty() {
    return this.tolkSource.length === 0
  }

  getResultingWarnings() {
    return this.warnings
  }

  getResultingTolkSource() {
    let out = ''

    let posFirstDirective = Math.max(0, this.funCSource.search(/#include|#pragma/))
    out += this.tolkSource.substring(0, posFirstDirective)

    if (this.needInsertTolkPreamble) {
      out += 'tolk 1.0\n\n'
    }
    for (let filename of this.importStdlib) {
      out += `import "${filename}"\n`
    }

    out += this.tolkSource.substring(posFirstDirective)
    out = out.replace(/var (\w+) redef =/g, '$1 =')
    return out
  }
}

export interface FunCToTolkConvertionResult {
  tolkSource: string
  warnings: { text: string, lineNo: number, colNo: number }[]
}

function debugStrNode(n: SyntaxNode, state: { indent: string, str: string }) {
  let childCount = n.childCount
  state.str += n.type === ' ' ? '_' : n.type
  if (!childCount) {
    if (n.type === 'string_literal' || n.type === 'number_literal') {
      state.str += ' ' + n.text
    } else if (n.type === 'function_name' || n.type === 'identifier') {
      state.str += ' "' + n.text + '"'
    }
  } else {
    state.str += ' (' + childCount + ')'
    state.indent += '  '
    for (let idx = 0; idx < childCount; ++idx) {
      let child = n.child(idx)!
      state.str += '\n' + state.indent
      state.str += (n.fieldNameForChild(idx) || idx) + ' = '
      debugStrNode(child, state)
    }
    state.indent = state.indent.substring(0, state.indent.length - 2)
  }
}

function debugPrintNode(n: SyntaxNode) {
  let state = { indent: '', str: '' }
  debugStrNode(n, state)
  console.log(state.str)
}

function doesVariableSeemLikeAddress(variableName: string) {
  return variableName.includes('addr') || variableName.includes('Addr')
      || variableName.startsWith('sender')
}

function convertComment(n: SyntaxNode, out: FunCToTolkState) {
  const text = n.text
  if (text[0] === '{' && text[1] === '-') {
    const len = text.length
    if (text[len - 2] !== '-' || text[len - 1] !== '}')
      out.addWarningAt('unexpected comment end', n.endPosition)
    out.addTextModified(n, '/*' + text.substring(2, len - 2) + '*/')
  } else if (text[0] === ';' && text[1] === ';') {
    let slashes = '/'.repeat(/^;+/.exec(text)![0].length)
    out.addTextModified(n, slashes + text.substring(slashes.length))
  } else {
    out.addTextUnchanged(n)
  }
}

function convertIncludeToImport(n: SyntaxNode, out: FunCToTolkState) {
  let text = n.childForFieldName('path')?.text || ''
  if (!text) {
    out.addWarningAt('Empty #include', n.startPosition)
  }
  if (text.endsWith('stdlib.fc"') || text.endsWith('stdlib.func"')) {
    out.justSkipNode(n)
    out.skipSpaces()
    return
  }
  text = text.replace(/\.(fc|func)"$/, '"')
  out.addTextModified(n, `import ${text}`)
}

function convertCompilerDirective(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    switch (child.type) {
      case 'include_directive':
        convertIncludeToImport(child, out)
        break
      case 'pragma_directive':
        if (child.text.includes('version')) {
          out.insertTolkPreambleInsteadOfPragmaVersion()
        }
        out.justSkipNode(n)
        return
      case ';':
        out.justSkipNode(child, false)
        break
      default:    // a comment, for example
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertConstantDeclarations(n: SyntaxNode, out: FunCToTolkState) {
  let declarations = n.descendantsOfType('constant_declaration')
  if (declarations.length === 1) {
    let n_name = declarations[0].childForFieldName('name')
    let n_init = declarations[0].childForFieldName('value')
    if (n_name && n_init && RENAMING.STDLIB_INTRODUCED_CONSTANTS[n_name.text] === n_init.text) {
      out.justSkipNode(n)
      return
    }
  }

  for (let child of n.children) {
    if (child.type === 'constant_declaration') {
      let n_type = child.childForFieldName('type')
      let n_name = child.childForFieldName('name')
      let n_init = child.childForFieldName('value')
      if (!n_name || !n_init) {
        out.addWarningAt('unrecognized const decl, skipping', child.startPosition)
        continue
      }
      let s_name = n_name.text
      let s_const = out.createEmptyFork(child)
      s_const.addTextCustom(`${replaceIdentifier(s_name, out, false)} = `)
      convertAnyInFunctionBody(n_init, s_const)
      out.mergeWithFork(s_const)
    } else if (child.type === 'comment') {
      convertComment(child, out)
    } else if (child.type === ',') {
      out.addTextModified(child, ";\nconst")
    } else {
      out.addTextUnchanged(child)
    }
  }
}

function convertGlobalsDeclarations(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    if (child.type === 'global_var_declaration') {
      let n_type = child.childForFieldName('type')
      let n_name = child.childForFieldName('name')
      if (!n_name) {
        out.addWarningAt('unrecognized global decl, skipping', child.startPosition)
        continue
      }
      let s_name = n_name.text
      let s_global = out.createEmptyFork(child)
      // global int a
      s_global.addTextCustom(replaceIdentifier(s_name, out, false))
      if (n_type) {
        s_global.addTextCustom(': ')
        convertType([n_type], s_global)
      }
      out.mergeWithFork(s_global)
    } else if (child.type === 'comment') {
      convertComment(child, out)
    } else if (child.type === ',') {
      out.addTextModified(child, ";\nglobal")
    } else {
      out.addTextUnchanged(child)
    }
  }
}

function convertType(typeNodes: SyntaxNode[], out: FunCToTolkState, replaceSliceWithAddress = false) {
  for (let i = 0; i < typeNodes.length; ++i) {
    let n = typeNodes[i]
    if (n.type === 'comment') {
      convertComment(n, out)
    } else if (n.type === '(' && i < typeNodes.length - 2 && typeNodes[i + 1].type === 'primitive_type' && typeNodes[i + 2].type === ')') {
      out.justSkipNode(n)
      convertType([typeNodes[i + 1]], out)
      out.justSkipNode(typeNodes[i + 2])
      i += 2
    } else if (n.type === 'primitive_type') {
      let txt = n.text
      if (txt === 'cont')
        out.addTextModified(n, 'continuation')
      else if (txt === 'slice' && replaceSliceWithAddress)
        out.addTextModified(n, 'address')
      else
        out.addTextUnchanged(n)
    } else if (n.type === 'hole_type' || n.type === 'var_type') {
      out.addTextModified(n, 'todo')    // to fire compilation error in Tolk, absence of type
    } else if (n.childCount) {
      convertType(n.children, out)
    } else {
      out.addTextUnchanged(n)
    }
  }
}

function extractActualTypeFromModifyingMethod(typeNodes: SyntaxNode[]): SyntaxNode[] {
  let result: SyntaxNode[] = []
  let skipped_first = false
  for (let n of typeNodes) {
    if (n.type !== ',' && !skipped_first) {
      continue
    }
    if (n.type === ',' && !skipped_first) {
      skipped_first = true
      continue
    }
    if (n.type === ')' && skipped_first && n.id === typeNodes[typeNodes.length - 1].id) {
      continue
    }
    result.push(n)
  }
  return result
}

function extractLocalVarNamesAndParametersFromFunction(nDeclaration: SyntaxNode, out: FunCToTolkState): string[] {
  let varNames: string[] = []

  for (let n_arg_declaration of nDeclaration.descendantsOfType('parameter_declaration')) {
    let n_type = n_arg_declaration.childrenForFieldName('type')
    let n_name = n_arg_declaration.childForFieldName('name')
    if (n_type.length && n_name) {
      varNames.push(replaceIdentifier(n_name.text, out, false))
    } else {  // "param_name" or "param_type" (unnamed)
      let nt = n_arg_declaration.text
      let is_type = nt === 'int' || nt === 'slice' || nt === 'builder' || nt === 'tuple'
      if (!is_type) {
        varNames.push(replaceIdentifier(n_arg_declaration.text, out, false))
      }
    }
  }

  for (let n_var_declaration of nDeclaration.descendantsOfType('variable_declaration')) {
    for (let n_var of n_var_declaration.descendantsOfType('identifier')) {
      varNames.push(replaceIdentifier(n_var.text, out, false))
    }
  }

  return varNames
}

function convertFunctionParameter(n: SyntaxNode, out: FunCToTolkState, forceName: string | null) {
  let n_type = n.childrenForFieldName('type')
  let n_name = n.childForFieldName('name')
  let s_name = forceName ? forceName : n_name ? replaceIdentifier(n_name.text, out, false) : n.children[n.childCount - 1].type === 'underscore' ? '_' : ''
  if (out.getOptions().transformLocalVarNamesToCamelCase) {
    s_name = transformSnakeCaseToCamelCase(s_name)
  }

  if (n_type.length && s_name) {
    let s_type = out.createEmptyFork(n)
    s_type.addTextCustom(s_name + ": ")
    convertType(n_type, s_type, doesVariableSeemLikeAddress(s_name))
    if (forceName !== 'self') {
      out.mergeWithFork(s_type)
    } else {
      n_type.forEach(d => out.justSkipNode(d))
      out.justSkipNode(n_name!)
      out.addTextCustom('self')
    }
  } else {  // "param_name" or "param_type" (unnamed)
    let nt = n.text
    let is_type = nt === 'int' || nt === 'slice' || nt === 'builder' || nt === 'tuple'
    if (is_type) {
      out.addTextModified(n, "_: " + nt)
    } else {
      nt = replaceIdentifier(nt, out, false)
      if (out.getOptions().transformLocalVarNamesToCamelCase) {
        nt = transformSnakeCaseToCamelCase(nt)
      }
      out.addTextModified(n, nt + ": todo")   // there is no `auto` in Tolk, add compilation error
    }
  }
}

function convertFunctionDefinition(n: SyntaxNode, out: FunCToTolkState) {
  let n_forall = n.childForFieldName('type_variables')
  let n_return_type = n.childrenForFieldName('return_type')
  let n_name = n.childForFieldName('name')
  let n_arguments = n.childForFieldName('arguments')
  let n_specifiers = n.childForFieldName('specifiers')
  let n_code_body = n.childForFieldName('body')
  let n_asm_body = n.childForFieldName('asm_body')
  let is_builtin = n.childForFieldName('is_builtin')

  let is_impure = n_specifiers?.children.find(n => n.type === 'impure' && n.text === 'impure')
  let is_pure = n_asm_body && !is_impure
  let is_inline = n_specifiers?.children.find(n => n.type === 'inline' && !n.text.includes('inline_ref'))
  let is_inline_ref = n_specifiers?.children.find(n => n.type === 'inline' && n.text.includes('inline_ref'))
  let is_method_id_n = n_specifiers?.children.find(n => n.type === 'method_id' && !n.text.includes('('))
  let n_method_id = n_specifiers?.children.find(n => n.type === 'method_id' && n.text.includes('('))

  let f_name = n_name!.text
  let arr_annotations = []
  let is_get_method = !!is_method_id_n
  let s_preceding_comment = null
  let s_fun_keyword = out.createEmptyFork(n.firstChild!)
  let s_name = out.createEmptyFork(n_name!)
  let s_receiver_name = null
  let s_genericsT = n_forall ? out.createEmptyFork(n_forall) : null
  let s_parameters = n_arguments ? out.createEmptyFork(n_arguments) : null
  let s_return_type = n_return_type.length ? out.createEmptyFork(n_return_type[0]) : null
  let s_specifiers = n_specifiers ? out.createEmptyFork(n_specifiers) : null
  let first_param_name = ''

  if (is_get_method || n_method_id) {
    out.registerKnownGetMethod(f_name)
  }

  if (!n_code_body && !n_asm_body && !is_builtin) {
    out.justSkipNode(n)   // skip forward declarations
    return
  }

  let is_modifying_method = f_name[0] === '~'
  if (f_name.startsWith('load_') || f_name.startsWith('skip_') || f_name.startsWith('store_') || f_name.startsWith('set_')) {
    let ret_type = n_return_type[0]   // search for (slice, int)
    if (ret_type && n_arguments && ret_type.type === 'tensor_type' && ret_type.childCount === 5 && n_arguments.childCount > 2) {
      is_modifying_method = true
    }
  }

  let localVarNames = extractLocalVarNamesAndParametersFromFunction(n, out)
  out.onEnterFunction(localVarNames)

  if (n_forall) {
    let s_joinedT = n_forall.children.filter(n => n.type === 'type_identifier').map(n => n.text).join(', ')
    s_genericsT!.addTextCustom("<" + s_joinedT + ">")
  }
  if (n_return_type.length || n_asm_body || is_builtin) {
    if (is_modifying_method) {
      n_return_type = extractActualTypeFromModifyingMethod(n_return_type.length === 1 ? n_return_type[0].children : n_return_type)
    }
    let orig_s_return_type = n_return_type.map(n => n.text).join()
    if (orig_s_return_type === '()' && (is_modifying_method || n_asm_body)) {
      s_return_type?.addTextCustom('void')
    } else if ((orig_s_return_type === '_' || orig_s_return_type === '()') && !is_builtin) {
      // skip
    } else {
      convertType(n_return_type, s_return_type!, doesVariableSeemLikeAddress(f_name))
    }
  }
  if (n_name) {
    let oldName = n_name.text[0] === '~' ? n_name.text.substring(1) : n_name.text
    let newName = replaceIdentifier(oldName, out, false)
    if (is_get_method || n_method_id) {
      newName = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(oldName) ? oldName : '`' + oldName + '`'
    } else if (newName in RENAMING.ENTRYPOINT_RENAMING) {
      newName = RENAMING.ENTRYPOINT_RENAMING[newName]
      if (newName === 'onInternalMessage') {
        s_preceding_comment = out.createEmptyFork(n.firstChild!)
        s_preceding_comment.addTextCustom('// in the future, use: fun onInternalMessage(in: InMessage) {\n')
      }
    } else if (out.getOptions().transformFunctionNamesToCamelCase) {
      newName = transformSnakeCaseToCamelCase(newName)
    }
    s_name!.addTextModified(n_name, newName)
  }
  if (n_arguments) {
    let is_mutate_added = false
    for (let child of n_arguments.children) {
      if (child.type === 'parameter_declaration') {
        if (first_param_name === '' && is_modifying_method) {
          convertFunctionParameter(child, s_parameters!, 'self')
          s_receiver_name = out.createEmptyFork(child.childForFieldName('type')!)
          convertType(child.childrenForFieldName('type'), s_receiver_name)
          s_receiver_name.addTextCustom('.')      // output will be `fun slice.method(mutate self)`
        } else {
          convertFunctionParameter(child, s_parameters!, null)
        }
        if (first_param_name === '') {
          first_param_name = child.childForFieldName('name')?.text ?? ''
        }
      } else if (child.type === 'comment') {
        convertComment(child, s_parameters!)
      } else {
        s_parameters!.addTextUnchanged(child)
        if (is_modifying_method && !is_mutate_added && child.type === '(') {
          s_parameters!.addTextCustom('mutate')
          is_mutate_added = true
        }
      }
    }
  }
  if (is_inline) {
    arr_annotations.push('@inline')
  }
  if (is_inline_ref) {
    arr_annotations.push('@inline_ref')
  }
  if (is_pure) {
    arr_annotations.push('@pure')
  }
  if (n_method_id) {
    arr_annotations.push("@method_id(" + n_method_id.text.match(/\(\s*([\dxXa-fA-F]+)/)![1] + ")")
  }

  // add text delimiters
  if (arr_annotations.length)
    s_fun_keyword.addTextCustom(arr_annotations.join("\n") + "\n")
  s_fun_keyword.addTextCustom(is_get_method ? "get fun " : "fun ")
  if (s_return_type && !s_return_type.isEmpty())
    s_parameters!.addTextCustom(': ')

  out.mergeWithFork(s_preceding_comment, s_fun_keyword, s_receiver_name, s_name, s_genericsT, s_parameters, s_return_type, s_specifiers)

  if (is_modifying_method) {
    out.onEnterModifyingMethod(first_param_name)
  }
  for (let next = (n_specifiers || n_arguments!).nextSibling; next; next = next.nextSibling) {
    if (next.type === 'comment') {
      convertComment(next, out)
    } else if (next.type === 'asm_function_body') {
      out.addTextCustom("\n    ")
      out.skipSpaces()
      convertAnyInFunctionBody(next, out)
    } else {
      convertAnyInFunctionBody(next, out)
    }
  }
  if (is_modifying_method) {
    out.onLeaveModifyingMethod()
  }
  out.onLeaveFunction()
}

function convertVariableDeclarationExpression(n: SyntaxNode, s_type: string, varsDeclaredEarlier: string[], out: FunCToTolkState) {
  switch (n.type) {
    case 'comment':
      convertComment(n, out)
      break
    case 'identifier':
      let varName = replaceIdentifier(n.text, out, false)
      if (out.getOptions().transformLocalVarNamesToCamelCase) {
        varName = transformSnakeCaseToCamelCase(varName)
      }
      if (s_type === 'slice' && doesVariableSeemLikeAddress(varName)) {
        s_type = 'address'
      }
      if (s_type === '(expression)' || varsDeclaredEarlier.includes(varName)) {
        out.addTextModified(n, varName + " redef")
      } else if (s_type) {
        out.addTextModified(n, varName + ": " + s_type)
      } else {
        out.addTextModified(n, varName)
      }
      break
    case 'variable_declaration':
      let n_type = n.childForFieldName('type')!
      let fork_type = out.createEmptyFork(n_type)
      convertType([n_type], fork_type)
      out.justSkipNode(n_type)
      out.skipSpaces()
      convertVariableDeclarationExpression(n_type.nextSibling!, fork_type.getResultingTolkSource(), varsDeclaredEarlier, out)
      break
    default:
      if (!n.childCount) {
        out.addTextUnchanged(n)
      } else {
        for (let child of n.children) {
          convertVariableDeclarationExpression(child, s_type, varsDeclaredEarlier, out)
        }
      }
  }
}

function extractVariablesDeclaredEarlierInSameScope(n: SyntaxNode, out: FunCToTolkState): string[] {
  let n_block: SyntaxNode | null = n
  while (n_block && n_block.type !== 'block_statement') {
    n_block = n_block.parent
  }
  if (!n_block) {
    return []
  }

  let children = n_block.descendantsOfType('variable_declaration', undefined, n.startPosition)
  let inSameScope = children.filter(c => {
    let p = c.parent
    while (p && p?.type !== 'block_statement') {
      p = p.parent
    }
    return p && p.id === n_block.id
  })

  let declared: string[] = []
  for (let n_var_decl of inSameScope) {
    for (let v_ident of n_var_decl.descendantsOfType('identifier')) {
      let varName = replaceIdentifier(v_ident.text, out, false)
      if (out.getOptions().transformLocalVarNamesToCamelCase) {
        varName = transformSnakeCaseToCamelCase(varName)
      }
      declared.push(varName)
    }
  }
  return declared
}

function convertVariableDeclarationStatement(n: SyntaxNode, out: FunCToTolkState) {
  let varsDeclaredEarlier = extractVariablesDeclaredEarlierInSameScope(n, out)
  let n_type = n.childForFieldName('type')
  let n_variable = n.childForFieldName('variable')

  if (!n_type || !n_variable) {
    out.addWarningAt("unrecognized variable declaration", n.startPosition)
    out.addTextUnchanged(n)
    return
  }

  let s_type = ''
  if (n_type.text !== 'var') {
    let fork_type = out.createEmptyFork(n_type)
    convertType([n_type], fork_type)
    s_type = fork_type.getResultingTolkSource()
  }

  out.addTextModified(n_type, 'var')
  convertVariableDeclarationExpression(n_variable, s_type, varsDeclaredEarlier, out)
}

function convertIfElseWhileRepeatCondition(n: SyntaxNode, addLogicalNot: boolean, out: FunCToTolkState) {
  let is_parenthesized = n.childCount == 1 && n.firstChild!.type === 'parenthesized_expression'

  if (is_parenthesized && !addLogicalNot) {
    for (let child of n.children) {
      convertAnyInFunctionBody(child, out)
    }
    return
  }

  let cond: SyntaxNode[] = is_parenthesized ? n.firstChild!.children.slice(1, -1) : n.children

  out.skipSpaces()
  if (is_parenthesized) {
    out.justSkipNode(n.firstChild!.firstChild!)
  }

  if (addLogicalNot) {
    let expr = cond.length === 1 && cond[0].type === 'expression' ? cond[0].children : []
    let no_parenthesis = expr.length === 1 && expr[0].type === 'identifier'
      || expr.length === 1 && expr[0].type === 'number_literal'
      || expr.length === 1 && expr[0].type === 'parenthesized_expression'
      || expr.length === 1 && expr[0].type === 'function_application'
      || expr.length === 2 && expr[0].type === 'identifier' && expr[1].type === 'method_call'
    out.addTextCustom(' (!')
    if (!no_parenthesis) {
      out.addTextCustom('(')
    }
    for (let child of cond) {
      convertAnyInFunctionBody(child, out)
    }
    out.addTextCustom(')')
    if (!no_parenthesis) {
      out.addTextCustom(')')
    }
  } else {
    out.addTextCustom(' (')
    for (let child of cond) {
      convertAnyInFunctionBody(child, out)
    }
    out.addTextCustom(')')
  }

  if (is_parenthesized)
    out.justSkipNode(n.firstChild!.lastChild!)
}

function convertIfStatement(n: SyntaxNode, out: FunCToTolkState) {
  let was_ifnot = false
  for (let i = 0; i < n.childCount; ++i) {
    let child = n.child(i)!
    switch (child.type) {
      case 'if':
      case 'else':
        was_ifnot = false
        out.addTextUnchanged(child)
        break
      case 'ifnot':
        was_ifnot = true
        out.addTextModified(child, 'if')
        break
      case 'elseif':
        was_ifnot = false
        out.addTextModified(child, 'else if')
        break
      case 'elseifnot':
        was_ifnot = true
        out.addTextModified(child, 'else if')
        break
      case 'expression':
        convertIfElseWhileRepeatCondition(child, was_ifnot, out)
        break
      default:
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertWhileStatement(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    switch (child.type) {
      case 'while':
        out.addTextUnchanged(child)
        break
      case 'expression':
        convertIfElseWhileRepeatCondition(child, false, out)
        break
      default:
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertRepeatStatement(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    switch (child.type) {
      case 'repeat':
        out.addTextUnchanged(child)
        break
      case 'expression':
        convertIfElseWhileRepeatCondition(child, false, out)
        break
      default:
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertDoUntilStatement(n: SyntaxNode, out: FunCToTolkState) {
  let was_until = false
  for (let child of n.children) {
    switch (child.type) {
      case 'do':
      case 'while':
        was_until = false
        out.addTextUnchanged(child)
        break
      case 'until':
        was_until = true
        out.addTextModified(child, 'while')
        break
      case 'expression':
        convertIfElseWhileRepeatCondition(child, was_until, out)
        break
      default:
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertTensorCustomCallback(n: SyntaxNode, out: FunCToTolkState, callback: (forks: FunCToTolkState[]) => FunCToTolkState[]) {
  let forks = [] as FunCToTolkState[]
  let expr_num_to_idx = {} as { [idx: number]: number }
  let count = n.childCount
  let n_expressions = 0
  for (let i = 0; i < count; ++i) {
    let child = n.child(i)!
    let fork = out.createEmptyFork(child)
    if (child.type !== 'comment') { // comments can't be merged, the result is single-line
      convertAnyInFunctionBody(child, fork)
    }
    forks.push(fork)
    if (child.type === 'expression') {
      expr_num_to_idx[n_expressions] = i
      n_expressions++
    }
  }

  let reordered = callback(forks)
  for (let i = 0; i < reordered.length; ++i) {
    if (reordered[i].getResultingTolkSource() === ',') {
      reordered[i].addTextCustom(' ')
    }
  }
  out.mergeWithFork(...reordered)
}

function convertThrow(n: SyntaxNode, out: FunCToTolkState) {
  let n_function = n.childForFieldName('function')!
  let n_arguments = n.childForFieldName('agruments')!
  let f_name = n_function.text

  out.justSkipNode(n_function)
  if (f_name === 'throw') {   // throw (n) -> throw n
    out.addTextCustom('throw ')
    out.skipSpaces()
    if (n_arguments.type === 'parenthesized_expression') {
      out.moveCursorToNode(n_arguments)
      out.justSkipNode(n_arguments.firstChild!)
      convertAnyInFunctionBody(n_arguments.firstNamedChild!, out)
      out.justSkipNode(n_arguments.lastChild!)
    } else {
      convertAnyInFunctionBody(n_arguments, out)
    }
    return
  }
  if (f_name === 'throw_arg') {   // throw_if (arg, n) -> throw (n, arg)
    if (n_arguments.type !== 'tensor_expression') {
      out.addWarningAt("unrecognized throw_arg call", n.startPosition)
    } else {
      out.addTextCustom('throw ')
      convertTensorCustomCallback(n_arguments, out, (forks) => {
        let idx1 = n_arguments.children.findIndex(c => c.type === 'expression')
        let idx2 = n_arguments.children.findIndex((c, i) => c.type === 'expression' && i > idx1)
        if (idx1 !== -1 && idx2 !== -1) {
          let tmp = forks[idx1]
          forks[idx1] = forks[idx2]
          forks[idx2] = tmp
        }
        return forks
      })
    }
    return
  }
  if (f_name === 'throw_if' || f_name === 'throw_unless') { // throw_unless(code, cond) -> assert(cond, code)
    if (n_arguments.type !== 'tensor_expression') {
      out.addWarningAt("unrecognized throw_arg call", n.startPosition)
    } else {
      out.addTextCustom('assert')
      convertTensorCustomCallback(n_arguments, out, (forks) => {
        let idx1 = n_arguments.children.findIndex(c => c.type === 'expression')
        if (idx1 !== -1) {    // throw_unless(n, cond) -> assert(cond) throw n
          let f1 = forks[idx1]
          forks.splice(idx1, 2)
          let kw_throw = out.createEmptyFork(n_arguments)
          kw_throw.addTextCustom(' throw ')
          forks.push(kw_throw, f1)
        }
        if (f_name === 'throw_if') {    // assert(cond) -> assert(!(cond))
          let open_not = out.createEmptyFork(n_arguments)
          open_not.addTextCustom('!(')
          forks.splice(idx1, 0, open_not)
          let close_par = out.createEmptyFork(n_arguments)
          close_par.addTextCustom(')')
          forks.splice(idx1 + 2, 0, close_par)
        }
        return forks
      })
    }
    return
  }

  for (let child of n.children) {
    convertAnyInFunctionBody(child, out)
  }
}

function convertTryCatchStatement(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    switch (child.type) {
      case 'try':
      case 'catch':
        out.addTextUnchanged(child)
        break
      case 'expression':
        let n_catch_expr = child.firstChild!
        convertTensorCustomCallback(n_catch_expr, out, (forks) => {
          let idx1 = n_catch_expr.children.findIndex(c => c.type === 'expression')
          let idx2 = n_catch_expr.children.findIndex((c, i) => c.type === 'expression' && i > idx1)
          if (idx1 !== -1 && idx2 !== -1) {
            let tmp = forks[idx1]
            forks[idx1] = forks[idx2]
            forks[idx2] = tmp
            if (forks[idx2].getResultingTolkSource() === '_') {
              forks.splice(idx2 - 1, 2)
            }
          }
          if (forks.length === 3 && forks[1].getResultingTolkSource() === '_') {
            forks = [out.createEmptyFork(n_catch_expr)]
            out.skipSpaces()
          }
          return forks
        })
        break
      default:
        convertAnyInFunctionBody(child, out)
    }
  }
}

function convertReturnStatement(n: SyntaxNode, out: FunCToTolkState) {
  for (let child of n.children) {
    if (child.type === 'expression' && child.child(0)!.type === 'unit_literal') {
      out.skipSpaces()
      out.justSkipNode(child)
    } else {
      convertAnyInFunctionBody(child, out)
    }
  }
}

function convertReturnStatementUnwrappingReturns(n: SyntaxNode, out: FunCToTolkState) {
  let fork = out.createEmptyFork(n)
  let assign_fork = out.createEmptyFork(n)
  for (let child of n.children) {
    if (child.type === 'expression' && child.child(0)!.type === 'tensor_expression') {
      fork.skipSpaces()
      let skipped_first = false
      let assign_done = false
      for (let nested of child.child(0)!.children) {
        if (nested.type === 'expression' && !assign_done && !skipped_first) {
          assign_fork.addTextCustom(`self = `)
          convertAnyInFunctionBody(nested, assign_fork)
          if (assign_fork.getResultingTolkSource() === `self = self`) {
            assign_fork = out.createEmptyFork(n)
          } else {
            assign_fork.addTextCustom(`; `)
          }
          assign_done = true
        }
        if (nested.type !== ',' && !skipped_first) {
          fork.justSkipNode(nested)
          continue
        }
        if (nested.type === ',' && !skipped_first) {
          skipped_first = true
          fork.justSkipNode(nested)
          continue
        }
        if (nested.type === ')' && skipped_first) {
          fork.justSkipNode(nested)
          continue
        }
        convertAnyInFunctionBody(nested, fork)
      }
    } else {
      convertAnyInFunctionBody(child, fork)
    }
  }
  if (/^\s*return\s*\(\s*\);?\s*$/.test(fork.getResultingTolkSource())) {
    fork = out.createEmptyFork(n)
    fork.addTextCustom('return;')
  }
  out.mergeWithFork(assign_fork, fork)
}

function convertFunctionCall(n: SyntaxNode, out: FunCToTolkState) {
  let n_ident = n.childForFieldName('function')
  let n_arguments = n.childForFieldName('agruments')
  if (n_ident?.type === 'identifier') {
    let f_name = n_ident.text
    if (f_name === 'null') {
      if (n_arguments?.type === 'unit_literal') {
        out.addTextModified(n, 'null')
        return
      }
    }
    if (f_name === 'null?' || f_name === 'cell_null?' || f_name === 'builder_null?') {
      out.justSkipNode(n_ident)
      out.addTextCustom('(')
      if (n_arguments?.type === 'parenthesized_expression' && n_arguments!.child(1)?.childCount === 1) {
        out.justSkipNode(n_arguments!.firstChild!)
        convertAnyInFunctionBody(n_arguments!.child(1)!, out)
        out.justSkipNode(n_arguments!.lastChild!)
      } else {
        convertAnyInFunctionBody(n_arguments!, out)
      }
      out.addTextCustom(' == null)')
      return
    }
    if (f_name === 'throw' || f_name === 'throw_if' || f_name === 'throw_unless' ||
      f_name === 'throw_arg' || f_name === 'throw_arg_if' || f_name === 'throw_arg_unless') {
      convertThrow(n, out)
      return
    }
    if (f_name === 'get_balance' && n.nextSibling?.text === '.pair_first()') {
      out.addTextModified(n, 'contract.getOriginalBalance()')
      return
    }
    if (f_name === 'pair_first' && n.text === 'pair_first(get_balance())') {
      out.addTextModified(n, 'contract.getOriginalBalance()')
      return
    }
    // replace `cell_hash(c)` with `c.hash()`
    if (f_name in RENAMING.STDLIB_NOT_FUNCTIONS_BUT_METHODS && n_arguments && n_arguments.childCount > 2) {
      let n_children = n_arguments.childCount
      out.justSkipNode(n_ident)
      out.justSkipNode(n_arguments.child(0)!)   // '('
      convertAnyInFunctionBody(n_arguments.child(1)!, out)
      if (n_arguments.child(2)!.type === ',') {
        out.justSkipNode(n_arguments.child(2)!)
        out.skipSpaces()
      }
      out.addTextCustom(`.${RENAMING.STDLIB_RENAMING[f_name]}(`)
      for (let i = 3; i < n_children; ++i) {
        convertAnyInFunctionBody(n_arguments.child(i)!, out)
      }
      return
    }
  }

  for (let child of n.children) {
    convertAnyInFunctionBody(child, out)
  }
}

function convertMethodCall(n: SyntaxNode, out: FunCToTolkState) {
  let n_ident = n.childForFieldName('method_name')
  let n_arguments = n.childForFieldName('arguments')
  let force_name = ''
  if (n_ident?.type === 'identifier') {
    let f_name = n_ident.text
    if (f_name === 'null?' || f_name === 'cell_null?' || f_name === 'builder_null?') {
      if (n_arguments?.type === 'unit_literal') {
        out.addTextModified(n, ' == null')
        return
      }
    }
    if (f_name === 'pair_first' && n?.previousSibling?.text === 'get_balance()') {
      out.justSkipNode(n)
      return
    }
    if (f_name === 'store_slice' && n_arguments && doesVariableSeemLikeAddress(n_arguments.text)) {
      force_name = 'storeAddress'
    }
  }

  for (let child of n.children) {
    if (child.id === n_ident?.id && force_name) {
      out.addTextModified(child, force_name)
    } else {
      convertAnyInFunctionBody(child, out)
    }
  }
}

function convertExpression(n: SyntaxNode, out: FunCToTolkState) {
  let wrap_parenthesis_start = new Set<SyntaxNode['id']>()
  let wrap_parenthesis_end = new Set<SyntaxNode['id']>()

  for (let child of n.children) {
    if (child.type === 'method_call') {
      let n_ident = child.childForFieldName('method_name')
      if (n_ident?.type === 'identifier') {
        let f_name = n_ident.text
        if (f_name === 'null?' || f_name === 'cell_null?' || f_name === 'builder_null?') {
          let chain_start = child
          let prev = child.previousSibling
          while (prev?.type === 'function_application' || prev?.type === 'method_call' || prev?.type === 'identifier') {
            chain_start = prev
            prev = prev.previousSibling
          }
          wrap_parenthesis_start.add(chain_start.id)
          wrap_parenthesis_end.add(child.id)
        }
      }
    }
  }

  for (let i = 0; i < n.childCount; ++i) {
    let child = n.child(i)!

    if (wrap_parenthesis_start.has(child.id)) {
      out.moveCursorToNode(child)
      out.addTextCustom('(')
    }

    if (child.type in RENAMING.REMOVED_BINARY_OPERATORS) {
      out.addWarningAt(`operator ${child.type} has been removed; please, rewrite this piece of code`, child.startPosition)
    }

    let next = child.nextSibling
    if (next?.type === '/%') {
      out.moveCursorToNode(child)
      out.addTextCustom('divMod(')
      convertAnyInFunctionBody(child, out)
      out.skipSpaces()
      out.justSkipNode(next)
      out.addTextCustom(',')
      convertAnyInFunctionBody(next.nextSibling!, out)
      out.addTextCustom(')')
      i += 2
    } else {
      convertAnyInFunctionBody(child, out)
    }

    if (wrap_parenthesis_end.has(child.id))
      out.addTextCustom(')')
  }
}

function convertStringLiteralWithPostfix(n: SyntaxNode, out: FunCToTolkState) {
  let postfix = n.text[n.text.length - 1]
  if (postfix in RENAMING.STRING_POSTFIXES_TO_FUNCTIONS) {
    let f_name = RENAMING.STRING_POSTFIXES_TO_FUNCTIONS[postfix]
    out.addTextCustom(`${f_name}(${n.text.substring(0, n.text.length - 1)})`)
    out.justSkipNode(n)
  } else {
    out.addTextUnchanged(n)
  }
}

function convertTildeCallToDotCall(n: SyntaxNode, out: FunCToTolkState) {
  let identifier_name = n.nextSibling?.text
  let key = '~' + identifier_name
  if (n.parent!.type === 'method_call') {
    out.addTextModified(n, '.')
  } else {
    out.addTextUnchanged(n)   // keep ~
  }
}

function convertDotCallToProbableWarning(n: SyntaxNode, out: FunCToTolkState) {
  let identifier_name = n.nextSibling?.text || ''
  if (identifier_name in RENAMING.FUNCTIONS_WHERE_DOT_CALL_BECAME_MUTATING) {
    let return_type = RENAMING.FUNCTIONS_WHERE_DOT_CALL_BECAME_MUTATING[identifier_name]
    out.addWarningAt(`method .${replaceIdentifier(identifier_name, out, true)}() now mutates the object and returns ${return_type === 'self' ? 'self' : 'just ' + return_type}`, n.startPosition)
  }
}

function convertAnyInFunctionBody(n: SyntaxNode, out: FunCToTolkState) {
  switch (n.type) {
    case 'comment':
      convertComment(n, out)
      break
    case 'identifier':
      let is_call = n.parent!.type === 'function_application' || n.parent!.type === 'method_call'
      let old_name = n.text
      if (is_call && old_name in RENAMING.STDLIB_DELETED_FUNCTIONS) {
        out.moveCursorToNode(n)
        out.addWarningAt(`function \`${old_name}\` has been removed`, n.startPosition)
      }
      let new_name = replaceIdentifier(old_name, out, is_call)
      if (is_call && out.getOptions().transformFunctionNamesToCamelCase && !(new_name in RENAMING.STDLIB_RENAMING) && !(new_name in RENAMING.STDLIB_DELETED_FUNCTIONS) && !out.isKnownGetMethod(new_name)) {
        new_name = transformSnakeCaseToCamelCase(new_name)
      } else if (!is_call && out.getOptions().transformLocalVarNamesToCamelCase && out.isLocalVariableOrParameter(new_name)) {
        new_name = transformSnakeCaseToCamelCase(new_name)
      }
      out.addTextModified(n, new_name)
      break
    case 'variable_declaration':
      convertVariableDeclarationStatement(n, out)
      break
    case 'if_statement':
      convertIfStatement(n, out)
      break
    case 'while_statement':
      convertWhileStatement(n, out)
      break
    case 'repeat_statement':
      convertRepeatStatement(n, out)
      break
    case 'do_statement':
      convertDoUntilStatement(n, out)
      break
    case 'try_catch_statement':
      convertTryCatchStatement(n, out)
      break
    case 'return_statement':
      if (out.isInsideModifyingMethod()) {
        convertReturnStatementUnwrappingReturns(n, out)
      } else {
        convertReturnStatement(n, out)
      }
      break
    case 'function_application':
      convertFunctionCall(n, out)
      break
    case 'method_call':
      convertMethodCall(n, out)
      break
    case 'expression':
      convertExpression(n, out)
      break
    case 'number_string_literal':
    case 'slice_string_literal':
      convertStringLiteralWithPostfix(n, out)
      break
    case '~':
      convertTildeCallToDotCall(n, out)
      break
    case '.':
      convertDotCallToProbableWarning(n, out)
      break
    default:
      if (!n.childCount) {
        out.addTextUnchanged(n)
      } else if (n.children[0].type === '(' || n.children[0].type === '[') {
        let has_variable_declarations = n.children.find(c => c.type === 'expression' && c.firstChild?.type === 'variable_declaration')
        if (has_variable_declarations) {
          let varsDeclaredEarlier = extractVariablesDeclaredEarlierInSameScope(n, out)
          out.addTextModified(n.firstChild!, 'var ')
          convertVariableDeclarationExpression(n, '(expression)', varsDeclaredEarlier, out)
        } else {
          for (let child of n.children) {
            convertAnyInFunctionBody(child, out)
          }
        }
      } else {
        for (let child of n.children) {
          convertAnyInFunctionBody(child, out)
        }
      }
  }
}

function convertTopmostNode(n: SyntaxNode, out: FunCToTolkState) {
  switch (n.type) {
    case 'comment':
      convertComment(n, out)
      break
    case 'compiler_directive':
      convertCompilerDirective(n, out)
      break
    case 'constant_declarations':
      convertConstantDeclarations(n, out)
      break
    case 'global_var_declarations':
      convertGlobalsDeclarations(n, out)
      break
    case 'function_definition':
      convertFunctionDefinition(n, out)
      break
    case 'empty_statement':
      out.addTextUnchanged(n)
      break
    default:
      out.addWarningGlobal('unhandled type in convertTopmostNode(): ' + n.type)
      out.addTextUnchanged(n)
  }
}

function appendUnparsedNodesAsWarnings(root: SyntaxNode, out: FunCToTolkState) {
  if (root.isError) {
    out.addWarningAt('Parse error: ' + root.text, root.startPosition)
  }

  for (let child of root.children) {
    if (child.hasError) {
      appendUnparsedNodesAsWarnings(child, out)
    }
  }
}

export function convertFunCToTolk(funCSource: string, options?: Partial<ConvertFunCToTolkOptions>): FunCToTolkConvertionResult {
  let fullOptions = Object.assign({}, defaultOptions, options)
  let state = new FunCToTolkState(funCSource, fullOptions)
  let rootNode = parseFunCSource(funCSource)

  if (rootNode.hasError) {
    appendUnparsedNodesAsWarnings(rootNode, state)
  }
  for (let child of rootNode.children) {
    convertTopmostNode(child, state)
  }
  state.addTextCustom("\n")

  return {
    tolkSource: state.getResultingTolkSource(),
    warnings: state.getResultingWarnings(),
  }
}
