import { initialState, advance, execute } from './domain.ts';
import type { Command, State } from './domain.ts';

export function replay(commands: readonly Command[], cursor: number): State {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid replay cursor.');
  let state = initialState();
  for (const command of commands) {
    if (command.tick > cursor) break;
    state = advance(state, command.tick);
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Invalid internal replay: ${result.message}`);
    state = result.state;
  }
  return advance(state, cursor);
}
