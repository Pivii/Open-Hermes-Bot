import { describe, expect, it } from 'vitest';
import {
  API_SERVER_COMMANDS,
  describeKeyRead,
  sshTroubleKind,
} from './keyRead';

/** What ssh printed for the person who opened the issue: three sk keys. */
const SK_REFUSAL = [
  'sign_and_send_pubkey: signing failed for ED25519-SK "/Users/me/.ssh/id_ed25519_sk": device not found',
  'sign_and_send_pubkey: signing failed for ED25519-SK "/Users/me/.ssh/id_ed25519_sk_2": device not found',
  'sign_and_send_pubkey: signing failed for ED25519-SK "/Users/me/.ssh/id_ed25519_sk_3": device not found',
  'me@jetson: Permission denied (publickey).',
].join('\n');

describe('what ssh says', () => {
  it('reads a refusal', () => {
    expect(sshTroubleKind(SK_REFUSAL)).toBe('refused');
    expect(sshTroubleKind('Permission denied, please try again.')).toBe(
      'refused',
    );
  });

  it('reads a host it has never been asked to trust', () => {
    expect(sshTroubleKind('Host key verification failed.')).toBe('host-key');
    expect(
      sshTroubleKind('@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @'),
    ).toBe('host-key');
  });

  it('reads a name nobody answers to', () => {
    expect(
      sshTroubleKind(
        'ssh: Could not resolve hostname jetsn: nodename nor servname provided, or not known',
      ),
    ).toBe('unknown-host');
    expect(sshTroubleKind('ssh: jetsn: Name or service not known')).toBe(
      'unknown-host',
    );
  });

  it('reads a machine that does not answer', () => {
    for (const line of [
      'ssh: connect to host jetson port 22: Connection refused',
      'ssh: connect to host jetson port 22: Operation timed out',
      'ssh: connect to host 10.0.0.2 port 22: Connection timed out',
      'ssh: connect to host jetson port 22: No route to host',
      'ssh: connect to host jetson port 22: Network is unreachable',
      'Connection closed by 10.0.0.2 port 22',
      'kex_exchange_identification: read: Connection reset by peer',
    ]) {
      expect(sshTroubleKind(line)).toBe('unreachable');
    }
  });

  it('reads the app giving up on a host', () => {
    expect(sshTroubleKind('SSH command timed out')).toBe('timeout');
  });

  it('leaves the rest unread', () => {
    expect(sshTroubleKind('something else entirely')).toBe('other');
    expect(sshTroubleKind('')).toBe('other');
  });
});

describe('a key that is not there', () => {
  it('says the API server is off, and how to turn it on, on the host', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        reason: 'missing',
        error: 'API_SERVER_KEY not found in ~/.hermes/.env',
      },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.kind).toBe('missing');
    expect(trouble.sentence).toBe(
      'No API_SERVER_KEY in ~/.hermes/.env on jetson.',
    );
    expect(trouble.why).toMatch(
      /Hermes Bot talks to Hermes' API server, which is off by default/,
    );
    expect(trouble.why).toMatch(/restart of the gateway/);
    expect(trouble.lead).toBe('In a terminal on jetson:');
    expect(trouble.commands).toEqual(API_SERVER_COMMANDS);
    expect(trouble.details).toBeUndefined();
  });

  it('says the same on this Mac', () => {
    const trouble = describeKeyRead(
      { ok: false, reason: 'missing' },
      { mode: 'local' },
    );
    expect(trouble.sentence).toBe(
      'No API_SERVER_KEY in ~/.hermes/.env on this Mac.',
    );
    expect(trouble.lead).toBe('In a terminal on this Mac:');
  });

  it('reads the older answer that only said it in words', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        error: 'API_SERVER_KEY not found in the remote ~/.hermes/.env',
      },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.kind).toBe('missing');
  });

  it('gives the two lines and the restart, the key made on the host', () => {
    expect(API_SERVER_COMMANDS.join('\n')).toContain('API_SERVER_ENABLED=true');
    // Made by the shell that runs the line: a .env file would keep $(…) as
    // words.
    expect(API_SERVER_COMMANDS[1]).toBe(
      'echo "API_SERVER_KEY=$(openssl rand -hex 32)" >> ~/.hermes/.env',
    );
    expect(API_SERVER_COMMANDS[2]).toBe('hermes gateway restart');
  });
});

describe('a host that would not give the key', () => {
  it('says the host refused, why, and what to try — the raw output aside', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        reason: 'failed',
        error: 'The key could not be read from the host.',
        details: SK_REFUSAL,
      },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.kind).toBe('refused');
    expect(trouble.sentence).toBe('jetson did not let the app in.');
    expect(trouble.sentence).not.toMatch(/sign_and_send_pubkey/);
    expect(trouble.why).toMatch(
      /ssh jetson has to work in a terminal without asking anything/,
    );
    expect(trouble.lead).toBe('Try it in a terminal:');
    expect(trouble.commands).toEqual(['ssh jetson']);
    expect(trouble.details).toBe(SK_REFUSAL);
  });

  it('says a host is not trusted yet', () => {
    const trouble = describeKeyRead(
      { ok: false, reason: 'failed', details: 'Host key verification failed.' },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.sentence).toBe('ssh does not trust jetson yet.');
    expect(trouble.commands).toEqual(['ssh jetson']);
    expect(trouble.details).toBe('Host key verification failed.');
  });

  it('says a name is not a machine', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        reason: 'failed',
        details: 'ssh: Could not resolve hostname jetsn: nodename nor servname provided, or not known',
      },
      { mode: 'ssh', host: 'jetsn' },
    );
    expect(trouble.sentence).toBe('No machine called jetsn could be found.');
    expect(trouble.commands).toBeUndefined();
  });

  it('says a machine did not answer', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        reason: 'failed',
        details: 'ssh: connect to host jetson port 22: Operation timed out',
      },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.sentence).toBe('jetson did not answer on SSH.');
    expect(trouble.why).toMatch(/tailnet/);
  });

  it('says the app stopped waiting', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        reason: 'failed',
        error: 'SSH command timed out',
        details: 'SSH command timed out',
      },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.sentence).toBe('jetson took too long to answer.');
  });

  it('keeps a line that is already a sentence', () => {
    const trouble = describeKeyRead(
      {
        ok: false,
        error: 'No host configured — open Settings to say where Hermes runs.',
      },
      { mode: 'ssh', host: '' },
    );
    expect(trouble.kind).toBe('other');
    expect(trouble.sentence).toBe(
      'No host configured — open Settings to say where Hermes runs.',
    );
    expect(trouble.details).toBeUndefined();
  });

  it('puts what it cannot read behind the details', () => {
    const noise = 'line one\nline two';
    const trouble = describeKeyRead(
      { ok: false, reason: 'failed', details: noise },
      { mode: 'ssh' },
    );
    expect(trouble.sentence).toBe('The key could not be read from the host.');
    expect(trouble.details).toBe(noise);
  });

  it('says it could not read the key when the host said nothing', () => {
    const trouble = describeKeyRead(
      { ok: false, reason: 'failed' },
      { mode: 'ssh', host: 'jetson' },
    );
    expect(trouble.sentence).toBe('The key could not be read from jetson.');
    expect(trouble.details).toBeUndefined();
  });
});

describe('this Mac, when the command itself fails', () => {
  it('keeps a short line as it is', () => {
    const trouble = describeKeyRead(
      { ok: false, reason: 'failed', error: 'spawn /bin/bash ENOENT' },
      { mode: 'local' },
    );
    expect(trouble.sentence).toBe('spawn /bin/bash ENOENT');
  });

  it('puts a long one behind the details', () => {
    const trouble = describeKeyRead(
      { ok: false, reason: 'failed', details: 'one\ntwo' },
      { mode: 'local' },
    );
    expect(trouble.sentence).toBe('The key could not be read from this Mac.');
    expect(trouble.details).toBe('one\ntwo');
  });

  it('says it could not read the key when nothing else is known', () => {
    const trouble = describeKeyRead({ ok: false }, { mode: 'local' });
    expect(trouble.sentence).toBe('The key could not be read from this Mac.');
    expect(trouble.details).toBeUndefined();
  });
});
