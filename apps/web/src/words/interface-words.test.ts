import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint/interface-words.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('the interface-words rule (the UI plan, UI-F)', () => {
  tester.run('interface-words', rule, {
    valid: [
      "const a = <p>{words('home.welcome')}</p>;",
      'const b = <button aria-label={words(\'shell.search\')} className="chip" />;',
      'const c = <p>{count} · {name}</p>;',
      'const d = <a href="#/components" data-state="open" />;',
    ],
    invalid: [
      { code: 'const a = <p>Needs your attention</p>;', errors: [{ messageId: 'words' }] },
      { code: 'const b = <button aria-label="Close menu" />;', errors: [{ messageId: 'words' }] },
      {
        code: "const c = <p>{open ? 'Hide it' : 'Show it'}</p>;",
        errors: [{ messageId: 'words' }, { messageId: 'words' }],
      },
      { code: 'const d = <p>{`Welcome back, ${name}`}</p>;', errors: [{ messageId: 'words' }] },
    ],
  });
});
