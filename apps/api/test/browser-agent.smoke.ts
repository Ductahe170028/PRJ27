import { CodeValidator } from '../src/agent/code-validator.js';
import { PlaywrightGameTester } from '../src/agent/game-tester.js';
import { shooterPlan, shooterSource } from './agent-fixtures.js';
const result = new CodeValidator().validate(shooterSource);
if (!result.javascript) throw new Error(result.errors.join('\n'));
const tested = await new PlaywrightGameTester().test(result.javascript, shooterPlan, new AbortController().signal);
console.log(JSON.stringify(tested));
if (tested.errors.length) process.exitCode = 1;
