import parser from '@babel/parser';

const parse = parser.parse ?? parser.default?.parse ?? parser;

export function parseCode(code) {
  return parse(code, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: false,
  });
}
