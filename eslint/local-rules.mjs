/**
 * Project-local ESLint rules. These encode architecture invariants from CLAUDE.md and
 * docs/IMPLEMENTATION_PLAN.md so they are enforced by tooling, not by review.
 */

/** 'use client' files may not import server-only modules. */
const noServerEnvInClient = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid importing server-only modules from a "use client" file.' },
    schema: [],
    messages: {
      forbidden:
        "'{{source}}' is server-only and cannot be imported from a 'use client' module. " +
        'Read env through @/config/env (client) or pass values down as props.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const program = sourceCode.ast;
    const isClient = (program.body ?? []).some(
      (node) => node.type === 'ExpressionStatement' && node.directive === 'use client',
    );
    if (!isClient) return {};
    const forbidden = [
      /^@\/config\/env\.server$/,
      /(^|\/)env\.server$/,
      /^server-only$/,
      /^@\/db\/admin(\/|$)/,
      /^@\/ai(\/|$)/,
      /^@\/jobs(\/|$)/,
      /^@\/flags$/,
      /^@\/flags\/index$/,
    ];
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source === 'string' && forbidden.some((re) => re.test(source))) {
          context.report({ node, messageId: 'forbidden', data: { source } });
        }
      },
    };
  },
};

const TAILWIND_PALETTE =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)';
const COLOR_UTILITIES =
  '(?:bg|text|border|ring|ring-offset|fill|stroke|from|to|via|outline|decoration|accent|caret|divide|placeholder|shadow)';
const paletteClass = new RegExp(
  `(?:^|\\s|:)(?:${COLOR_UTILITIES})-${TAILWIND_PALETTE}(?:-\\d{2,3})?(?:/\\d+)?(?=\\s|$|")`,
);
const arbitraryColor = new RegExp(`(?:${COLOR_UTILITIES})-\\[(?:#|rgb|hsl|oklch)`);
const rawColor =
  /(?:^|[^\w-])#(?:[0-9a-fA-F]{3}){1,2}(?:[0-9a-fA-F]{2})?\b|\b(?:rgba?|hsla?|oklch)\(/;

/** Components may not hard-code colours; every colour comes from src/ui/tokens.css. */
const noHardcodedColors = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid hard-coded colours in components; use design tokens.' },
    schema: [],
    messages: {
      hardcoded:
        'Hard-coded colour "{{text}}". Use a token utility (bg-surface, text-fg, border-hairline, ' +
        'text-accent …) defined in src/ui/tokens.css / app/globals.css.',
    },
  },
  create(context) {
    function check(node, text) {
      if (typeof text !== 'string' || text.length === 0) return;
      const hit = paletteClass.exec(text) ?? arbitraryColor.exec(text) ?? rawColor.exec(text);
      if (hit) context.report({ node, messageId: 'hardcoded', data: { text: hit[0].trim() } });
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
};

const plugin = {
  meta: { name: 'local', version: '1.0.0' },
  rules: {
    'no-server-env-in-client': noServerEnvInClient,
    'no-hardcoded-colors': noHardcodedColors,
  },
};

export default plugin;
