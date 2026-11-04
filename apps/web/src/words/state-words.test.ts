import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint/state-words.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('the state-words rule (ADR-0081)', () => {
  tester.run('state-words', rule, {
    valid: [
      'const a = <Lozenge kind="archived" />;',
      'const b = <span data-kind="section" />;',
      'const c = <StateLozenge state={item.state} />;',
      "const d = <span>{stateWord('archived')}</span>;",
      'const e = <p>{person.name}</p>;',
      "const f = words('document.archived-on');",
    ],
    invalid: [
      { code: "const a = words('states.archived');", errors: [{ messageId: 'key' }] },
      { code: 'const b = <span data-kind="approved" />;', errors: [{ messageId: 'kind' }] },
      { code: 'const c = <p>{item.state.name}</p>;', errors: [{ messageId: 'name' }] },
      { code: 'const d = <p>{state.name}</p>;', errors: [{ messageId: 'name' }] },
      { code: "const e = <Chip>{stateWord('archived')}</Chip>;", errors: [{ messageId: 'chip' }] },
    ],
  });
});
