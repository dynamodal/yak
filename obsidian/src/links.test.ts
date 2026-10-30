import { describe, expect, it } from 'vitest';
import { fromVaultLinks, toVaultLinks, type LinkSpace } from './links';

const personal: LinkSpace = { id: 'p', name: 'Personal', folder: 'Personal', paths: ['Home.md', 'Plan.md'] };
const work: LinkSpace = { id: 'w', name: 'Work', folder: 'Work', paths: ['Plan.md', 'Acme/Brief.md'] };
const spaces = [personal, work];

describe('links between the app and the vault', () => {
  it('writes a cross-space link as a vault path with a title', () => {
    expect(toVaultLinks('See [[Work:Acme/Brief]].', 'Yak', personal, spaces)).toBe('See [[Yak/Work/Acme/Brief|Brief]].');
  });

  it('keeps the heading, the alias and embeds', () => {
    expect(toVaultLinks('[[Work:Acme/Brief#Scope|the scope]] ![[Work:Acme/Brief]]', 'Yak', personal, spaces)).toBe(
      '[[Yak/Work/Acme/Brief#Scope|the scope]] ![[Yak/Work/Acme/Brief|Brief]]',
    );
  });

  it('turns it back when reading, dropping the title that was added', () => {
    expect(fromVaultLinks('See [[Yak/Work/Acme/Brief|Brief]].', 'Yak', personal, spaces)).toBe('See [[Work:Acme/Brief]].');
    expect(fromVaultLinks('[[Yak/Work/Acme/Brief#Scope|the scope]]', 'Yak', personal, spaces)).toBe('[[Work:Acme/Brief#Scope|the scope]]');
  });

  it('spells out the folder for a name that exists in two spaces', () => {
    expect(toVaultLinks('[[Plan]] and [[Home]]', 'Yak', personal, spaces)).toBe('[[Yak/Personal/Plan|Plan]] and [[Home]]');
    expect(fromVaultLinks('[[Yak/Personal/Plan|Plan]]', 'Yak', personal, spaces)).toBe('[[Plan]]');
  });

  it('turns a vault link into the same space into a plain link', () => {
    expect(fromVaultLinks('[[Yak/Work/Plan|my plan]]', 'Yak', work, spaces)).toBe('[[Plan|my plan]]');
  });

  it('leaves everything else alone', () => {
    const text = '[[Home]] [[Elsewhere/Thing]] [[Unknown:x]] `[[Work:Acme/Brief]]`\n```\n[[Work:Acme/Brief]]\n```';
    expect(toVaultLinks(text, 'Yak', personal, spaces)).toBe(text);
    expect(fromVaultLinks('[[Other/Place]] [[Yak/Nowhere/x]]', 'Yak', personal, spaces)).toBe('[[Other/Place]] [[Yak/Nowhere/x]]');
  });

  it('round-trips a note', () => {
    const note = 'A [[Work:Acme/Brief#Scope|scope]], B [[Work:Plan]], C [[Plan]], D [[Home]].';
    const file = toVaultLinks(note, 'Yak', personal, spaces);
    expect(fromVaultLinks(file, 'Yak', personal, spaces)).toBe(note);
  });
});
