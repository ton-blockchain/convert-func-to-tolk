// It's a main grammar description, `tree-sitter generate` works based on this file.
// This grammar describes the latest version of the FunC language for TON Blockchain.
// Originally taken from this repo: https://github.com/akifoq/tree-sitter-func
// and slightly modified to cover all FunC grammar.

function commaSep(rule) { return optional(commaSep1(rule)) }
function commaSep1(rule) { return seq(rule, repeat(seq(',', rule))) }
function commaSep2(rule) { return seq(rule, repeat1(seq(',', rule))) }

const FUNC_GRAMMAR = {
  translation_unit: $ => repeat($._top_level_item),

  // ----------------------------------------------------------
  // top-level declarations

  _top_level_item: $ => choice(
    $.function_definition,
    $.global_var_declarations,
    $.compiler_directive,
    $.constant_declarations,
    $.empty_statement,
  ),

  compiler_directive: $ => seq(choice($.include_directive, $.pragma_directive), ';'),
  include_directive: $ => seq('#include', repeat1(' '), field('path', $.string_literal)),

  version_identifier: $ => /(>=|<=|=|>|<|\^)?([0-9]+)(.[0-9]+)?(.[0-9]+)?/,
  pragma_directive: $ => seq(
    '#pragma',
    repeat1(' '),
    choice(
      seq(
        field('key', choice('version', 'not-version')),
        repeat1(' '),
        field('value', $.version_identifier)
      ),
      field('key', choice('allow-post-modification', 'compute-asm-ltr')),
    ),
  ),

  global_var_declarations: $ => seq(
    'global',
    commaSep1($.global_var_declaration),
    ';'
  ),
  global_var_declaration: $ => seq(
    field('type', optional($._type)),
    field('name', $.identifier),
  ),

  constant_declarations: $ => seq(
    'const',
    commaSep1($.constant_declaration),
    ';'
  ),
  constant_declaration: $ => seq(
    field('type', optional($.constant_type)),
    field('name', $.identifier),
    '=',
    field('value', choice($.expression))
  ),

  // ----------------------------------------------------------
  // functions and their body

  function_definition: $ => seq(
    field("type_variables", optional($.type_variables_list)),
    field("return_type", $._type),
    field("name", $.function_name),
    choice(
      seq(
        field("arguments", $.parameter_list),
        field("specifiers", optional($.specifiers_list)),
        choice(
          field("body", $.block_statement),
          field("asm_body", $.asm_function_body)
        )
      ),
      seq(
        field("arguments", $.parameter_list_relaxed),
        field("specifiers", optional($.specifiers_list)),
        ';',
      )
    )
  ),

  function_name: $ => /(`.*`)|((\.|~)?(([$%a-zA-Z0-9_](\w|['?:$%!])+)|([a-zA-Z%$])))/,

  impure: $ => "impure",
  inline: $ => choice("inline", "inline_ref"),
  method_id: $ => seq("method_id", optional(
    seq('(', choice($.number_literal, $.string_literal), ')')
  )),

  specifiers_list: $ => choice(
    seq($.impure, optional($.inline), optional($.method_id)),
    seq($.inline, optional($.method_id)),
    $.method_id
  ),

  type_variables_list: $ => seq(
    "forall",
    commaSep(seq(optional("type"), $.type_identifier)),
    "->"
  ),

  parameter_list: $ => seq(
    '(',
    commaSep($.parameter_declaration),
    ')'
  ),

  parameter_list_relaxed: $ => seq(
    '(',
    commaSep(
      choice(
        $.parameter_declaration,
        field('name', $.identifier),
        $.underscore
      )
    ),
    ')'
  ),

  parameter_declaration: $ => seq(
    field('type', $._type),
    optional(
      choice(
        field('name', $.identifier),
        $.underscore
      )
    )
  ),

  asm_function_body: $ => seq(
    $.asm_specifier,
    repeat1($.asm_instruction),
    ';'
  ),

  asm_specifier: $ => seq(
    'asm',
    optional(seq(
      '(',
      repeat($.identifier),
      optional(seq(
        '->',
        repeat($.number_literal)
      )),
      ')'
    ))
  ),
  asm_instruction: $ => alias($.string_literal, $.asm_instruction),

  // ----------------------------------------------------------
  // statements

  statement: $ => choice(
    $.return_statement,
    $.block_statement,
    $.expression_statement,
    $.empty_statement,
    $.repeat_statement,
    $.if_statement,
    $.do_statement,
    $.while_statement,
    $.try_catch_statement,
  ),

  return_statement: $ => seq('return', $.expression, ';'),
  block_statement: $ => seq('{', repeat($.statement), '}'),
  expression_statement: $ => seq($.expression, ';'),
  empty_statement: $ => ';',
  repeat_statement: $ => seq('repeat', field("count", $.expression), field("body", $.block_statement)),

  if_statement: $ => seq(
    choice('if', 'ifnot'),
    $._if_statement_contents
  ),
  _if_statement_contents: $ => seq(
    field("condition", $.expression),
    field("consequent", $.block_statement),
    field("alternative",
      optional(choice(
        seq("else", $.block_statement),
        seq(choice("elseif", "elseifnot"), $._if_statement_contents)
      )))
  ),

  do_statement: $ => seq(
    "do",
    field("body", $.block_statement),
    "until",
    field("postcondition", $.expression)
  ),
  while_statement: $ => seq(
    "while",
    field("precondition", $.expression),
    field("body", $.block_statement)
  ),
  try_catch_statement: $ => seq(
    "try",
    field("body", $.block_statement),
    "catch",
    field("catch_expr", optional($.expression)),
    field("catch_body", $.block_statement),
  ),

  // ----------------------------------------------------------
  // expressions

  expression: $ => $._expr10,

  _expr10: $ => prec(10, seq(
    $._expr13,
    optional(seq(
      choice('=', '+=', '-=', '*=', '/=', '~/=', '^/=', '%=', '~%=', '^%=',
        '<<=', '>>=', '~>>=', '^>>=', '&=', '|=', '^='),
      $._expr10
    )),
  )),

  _expr13: $ => prec(13, seq(
    $._expr15,
    optional(seq(
      '?',
      $.expression,
      ':',
      $._expr13
    ))
  )),

  _expr15: $ => prec(15, seq(
    $._expr17,
    optional(seq(
      choice('==', '<', '>', '<=', '>=', '!=', '<=>'),
      $._expr17
    ))
  )),

  _expr17: $ => prec.left(17, seq(
    $._expr20,
    repeat(seq(
      choice('<<', '>>', '~>>', '^>>'),
      $._expr20
    ))
  )),

  _expr20: $ => prec.left(20, seq(
    optional('-'),
    $._expr30,
    repeat(seq(
      choice('-', '+', '|', '^'),
      $._expr30
    ))
  )),

  _expr30: $ => prec.left(30, seq(
    $._expr75,
    repeat(seq(
      choice('*', '/', '%', '~/', '^/', '~%', '^%', '/%', '&'),
      $._expr75
    ))
  )),

  _expr75: $ => prec(75, seq(
    optional('~'),
    $._expr80
  )),

  _expr80: $ => prec.left(80, seq(
    $._expr90,
    repeat($.method_call)
  )),
  method_call: $ => prec.left(80, seq(
    choice('.', '~'),
    field("method_name", $.identifier),
    field("arguments", $._expr100)
  )),

  _expr90: $ => prec.left(90, choice(
    $._expr100,
    $.variable_declaration,
    $.function_application
  )),
  function_application: $ => prec.left(90, seq(
    field("function", $._nontype_expr100),
    field("agruments", repeat1(choice(
      $.identifier,
      $.parenthesized_expression,
      $.tensor_expression,
      $.unit_literal
    )))
  )),
  variable_declaration: $ => prec.left(90, seq(
    field("type", $.type_expression),
    field("variable", choice(
      $.identifier,
      $.tuple_expression,
      $.tensor_expression,
      $.parenthesized_expression
    ))
  )),

  type_expression: $ => prec(101, choice(
    $.primitive_type,
    $.var_type,
    $.parenthesized_type_expression,
    $.tensor_type_expression,
    $.tuple_type_expression
  )),
  parenthesized_type_expression: $ => prec(101, seq('(', $.type_expression, ')')),
  tensor_type_expression: $ => prec(101, seq('(', commaSep2($.type_expression), ')')),
  tuple_type_expression: $ => prec(101, seq('[', commaSep1($.type_expression), ']')),

  _nontype_expr100 : $ => prec(100, choice(
    $.parenthesized_expression,
    $.tensor_expression,
    $.tuple_expression,
    $.unit_literal,
    $.primitive_type,
    $.identifier,
    $.number_literal,
    $.string_literal,
    $.slice_string_literal,
    $.underscore
  )),

  _expr100: $ => prec(100, choice(
    $.type_expression,
    $._nontype_expr100
  )),

  unit_literal: $ => '()',

  parenthesized_expression: $ => seq('(', $.expression, ')'),
  tensor_expression: $ => seq('(', commaSep2($.expression), ')'),
  tuple_expression: $ => seq('[', commaSep($.expression), ']'),

  // ----------------------------------------------------------
  // type system

  _type: $ => choice(
    $._atomic_type,
    $.function_type,
  ),

  function_type: $ => prec.right(100, seq(
    $._atomic_type,
    '->',
    $._type
  )),

  _atomic_type: $ => choice(
    $.primitive_type,
    $.var_type,
    $.hole_type,
    $.type_identifier,
    $.tensor_type,
    $.unit_type,
    $.tuple_type,
    $._parenthesized_type
  ),

  _parenthesized_type: $ => seq('(', $._type, ')'),

  primitive_type: $ => choice(
    'int',
    'cell',
    'slice',
    'builder',
    'cont',
    'tuple',
  ),

  constant_type: $ => choice(
    'int',
    'slice',
  ),

  tensor_type: $ => seq('(', commaSep2($._type), ')'),

  tuple_type: $ => seq('[', commaSep($._type), ']'),

  var_type: $ => 'var',
  hole_type: $ => alias($.underscore, $.hole_type),
  unit_type: $ => '()',

  type_identifier: $ => alias($.identifier, $.type_identifier),
  
  // ----------------------------------------------------------
  // common constructions

  number_literal: $ => choice(
    token(seq(
      optional('-'),
      choice(
        seq('0x', /[0-9a-fA-F]+/),
        /[0-9]+/
      )
    )),
    $.number_string_literal
  ),

  string_literal: $ => /"[^"]*"/,
  number_string_literal: $ => /"[^"]*"[Hhcu]/,
  slice_string_literal: $ => /"[^"]*"[sa]/,

  // actually FunC identifiers are much more flexible
  identifier: $ => /`[^`]+`|[a-zA-Z0-9_\$%][^\s\+\-\*\/%,\.;\(\)\{\}\[\]=<>\|\^\~]*/,
  underscore: $ => '_',

  // multiline_comment: $ => seq('{-', repeat(choice(/./, $.multiline_comment)), '-}'),
  // unfortunately getting panic while generating parser with support for nested comments
  comment: $ => token(choice(
    seq(';;', /[^\r\n]*/),
    seq('//', /[^\r\n]*/),
    seq('{-', /[^-]*\-+([^-}][^-]*\-+)*/, '}'),
    seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
  )),
}

module.exports = grammar({
  name: 'func',

  extras: $ => [
    /\s/,
    $.comment,
  ],

  word: $ => $.identifier,

  rules: FUNC_GRAMMAR,

  conflicts: $ => [
    [$.parameter_list_relaxed, $.type_identifier],
    [$.parameter_list_relaxed, $.hole_type],
    [$.parameter_list_relaxed, $.parameter_list]
  ]
});
