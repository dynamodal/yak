/**
 * The change log: for every document, an append-only list of segments. A segment is one merged Yjs
 * update (about a minute of editing) with the time span it covers. Replaying a prefix of the list
 * gives the document as this device knew it at that time (docs/decisions/history.md).
 */
export interface Segment {
  docId: string;
  /** Position in the document's log; replay order. */
  seq: number;
  /** Epoch milliseconds of the first and last update merged into this segment. */
  start: number;
  end: number;
  update: Uint8Array;
  /** Some of the updates were edits made on this device (the others came from a link). */
  local: boolean;
  /** The full state at the moment recording began for this document. */
  baseline: boolean;
}

export type NewSegment = Omit<Segment, 'seq'>;

/** A version of a note kept by name; it carries its own text, so it survives thinning. */
export interface Mark {
  id: string;
  docId: string;
  noteId: string;
  name: string;
  at: number;
  text: string;
  /** `before-restore`: the state before a restore from Version history; not tied to a note (`noteId` is empty) and kept through thinning. */
  kind?: 'before-restore';
}

export interface SegmentStore {
  /** Add a segment at the end of the document's log. */
  append(seg: NewSegment): Promise<Segment>;
  /** The document's segments in replay order. */
  list(docId: string): Promise<Segment[]>;
  /** Replace the segments `seqs` (a contiguous run) by one; it takes the first seq. */
  replace(docId: string, seqs: readonly number[], merged: NewSegment): Promise<void>;
  docIds(): Promise<string[]>;
  addMark(mark: Mark): Promise<void>;
  marks(docId: string, noteId?: string): Promise<Mark[]>;
  removeMark(id: string): Promise<void>;
  /** Forget a document's whole log and its named versions. */
  removeDoc(docId: string): Promise<void>;
}
