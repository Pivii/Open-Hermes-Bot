import type { HermesConnectionMode } from './hermes';

/**
 * What a key that could not be read means, in words.
 *
 * The shell reads `API_SERVER_KEY` from the Hermes home of the machine that
 * runs Hermes — over SSH, or right here. When that fails, the person used to
 * read what ssh printed: five lines about a security key, or a line about a
 * file they had never heard of. This is the sentence they read instead, what
 * to do about it, and the raw output kept aside for whoever wants it.
 */

/** What the shell answers when it was asked for the key. */
export type KeyReadResult = {
  ok: boolean;
  /**
   * Why it failed, when the shell says: the command did not run (`failed`),
   * or it ran and found no key (`missing`).
   */
  reason?: 'failed' | 'missing';
  /** A line the shell wrote itself. */
  error?: string;
  /** What the command printed, untouched. */
  details?: string;
};

export type KeyReadKind =
  | 'missing'
  | 'refused'
  | 'host-key'
  | 'unknown-host'
  | 'unreachable'
  | 'timeout'
  | 'other';

/** What the person reads when the key could not be read. */
export type KeyReadTrouble = {
  kind: KeyReadKind;
  /** The one line. */
  sentence: string;
  /** Why, when the sentence alone does not say what to do. */
  why?: string;
  /** The line before the commands: where to run them. */
  lead?: string;
  /** What to type, one command per line. */
  commands?: string[];
  /** The raw output, for the Details toggle. */
  details?: string;
};

/**
 * The two lines that turn Hermes' API server on, written as the commands that
 * add them: a `.env` file does not run `$(…)`, so pasting the second line as
 * it is would make the key the words themselves. Then the restart, because
 * the gateway reads its `.env` when it starts.
 */
export const API_SERVER_COMMANDS = [
  "echo 'API_SERVER_ENABLED=true' >> ~/.hermes/.env",
  'echo "API_SERVER_KEY=$(openssl rand -hex 32)" >> ~/.hermes/.env',
  'hermes gateway restart',
];

/** What ssh says, read as the reason it said it. */
export function sshTroubleKind(text: string): KeyReadKind {
  if (/Permission denied/i.test(text)) return 'refused';
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      text,
    )
  ) {
    return 'host-key';
  }
  if (
    /Could not resolve hostname|nodename nor servname|Name or service not known/i.test(
      text,
    )
  ) {
    return 'unknown-host';
  }
  if (
    /Connection refused|Connection timed out|Operation timed out|No route to host|Network is unreachable|Connection closed|Connection reset/i.test(
      text,
    )
  ) {
    return 'unreachable';
  }
  if (/timed out/i.test(text)) return 'timeout';
  return 'other';
}

/** A line short enough to be the sentence itself. */
function isOneLine(text: string) {
  return text !== '' && !text.includes('\n') && text.length <= 120;
}

/**
 * The trouble behind a key that was not read, for the machine it was read
 * from. `host` is the name of that machine in `ssh` mode.
 */
export function describeKeyRead(
  result: KeyReadResult,
  { mode, host }: { mode: HermesConnectionMode; host?: string },
): KeyReadTrouble {
  const error = String(result.error ?? '').trim();
  const raw = String(result.details ?? '').trim() || error;
  const name = String(host ?? '').trim() || 'the host';
  const local = mode === 'local';

  const missing =
    result.reason === 'missing' ||
    (!result.reason && /API_SERVER_KEY not found/i.test(error));
  if (missing) {
    return {
      kind: 'missing',
      sentence: local
        ? 'No API_SERVER_KEY in ~/.hermes/.env on this Mac.'
        : `No API_SERVER_KEY in ~/.hermes/.env on ${name}.`,
      why: "Hermes Bot talks to Hermes' API server, which is off by default. Turning it on takes two lines in ~/.hermes/.env, and a restart of the gateway so it reads them.",
      lead: local ? 'In a terminal on this Mac:' : `In a terminal on ${name}:`,
      commands: API_SERVER_COMMANDS,
    };
  }

  // On this Mac nothing stands between the app and the file: what failed is
  // the command itself, and the output is all there is to say.
  if (local) {
    return isOneLine(raw)
      ? { kind: 'other', sentence: raw }
      : {
          kind: 'other',
          sentence: 'The key could not be read from this Mac.',
          details: raw || undefined,
        };
  }

  const kind = sshTroubleKind(raw);
  const details = raw || undefined;
  const tryIt = {
    lead: 'Try it in a terminal:',
    commands: [`ssh ${name}`],
  };
  switch (kind) {
    case 'refused':
      return {
        kind,
        sentence: `${name} did not let the app in.`,
        why: `The app signs in without a terminal: it cannot type a password or a passphrase, or wait for a security key. ssh ${name} has to work in a terminal without asking anything.`,
        ...tryIt,
        details,
      };
    case 'host-key':
      return {
        kind,
        sentence: `ssh does not trust ${name} yet.`,
        why: 'The first connection to a machine asks whether to trust it, and the app cannot answer. Connect once in a terminal and say yes — or, if the key of the host changed, find out why first.',
        ...tryIt,
        details,
      };
    case 'unknown-host':
      return {
        kind,
        sentence: `No machine called ${name} could be found.`,
        why: 'Check the name — it is the one your ~/.ssh/config uses, or an address.',
        details,
      };
    case 'unreachable':
      return {
        kind,
        sentence: `${name} did not answer on SSH.`,
        why: 'Is it on, and on the same network — or the same tailnet?',
        details,
      };
    case 'timeout':
      return {
        kind,
        sentence: `${name} took too long to answer.`,
        details,
      };
    default:
      return isOneLine(raw)
        ? { kind, sentence: raw }
        : {
            kind,
            sentence: `The key could not be read from ${name}.`,
            details,
          };
  }
}
