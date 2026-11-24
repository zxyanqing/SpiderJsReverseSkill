import generator from '@babel/generator';

const generate = generator.default ?? generator;

export function generateCode(ast, originalCode) {
  return generate(
    ast,
    {
      compact: false,
      comments: true,
      jsescOption: {
        minimal: true,
      },
    },
    originalCode
  );
}
