import type { ComponentChildren } from 'preact';

/*
 * Every icon in the app comes from this module, so the set can be swapped in one place.
 * Our own drawings on a 16-unit grid, stroked in the current text colour and sized by the font
 * (1em). Inline SVG only: no icon font, nothing fetched. Icons are decorative (aria-hidden);
 * the button or link around them carries the name.
 */

function Svg({ children, filled }: { children: ComponentChildren; filled?: boolean }) {
  return (
    <svg
      class="ui-icon"
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconPlay = () => (
  <Svg filled>
    <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5z" />
  </Svg>
);

export const IconStop = () => (
  <Svg filled>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
  </Svg>
);

export const IconPlus = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);

export const IconClose = () => (
  <Svg>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconEdit = () => (
  <Svg>
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
  </Svg>
);

export const IconTrash = () => (
  <Svg>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5" />
  </Svg>
);

export const IconMore = () => (
  <Svg filled>
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8" cy="8" r="1.3" />
    <circle cx="12.5" cy="8" r="1.3" />
  </Svg>
);

export const IconChevronDown = () => (
  <Svg>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const IconChevronRight = () => (
  <Svg>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);

export const IconChevronLeft = () => (
  <Svg>
    <path d="M10 4L6 8l4 4" />
  </Svg>
);

export const IconArrowLeft = () => (
  <Svg>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Svg>
);

export const IconArchive = () => (
  <Svg>
    <path d="M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3" />
  </Svg>
);

export const IconRestore = () => (
  <Svg>
    <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v3h3" />
  </Svg>
);

export const IconCheck = () => (
  <Svg>
    <path d="M3 8.5l3 3 7-7" />
  </Svg>
);

/** Billable: a coin with a currency stroke, not tied to one currency's sign. */
export const IconBillable = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 4.5v7M10 6.2c-.4-.6-1.1-.9-2-.9-1.1 0-2 .6-2 1.4 0 1.9 4 1 4 2.9 0 .8-.9 1.4-2 1.4-.9 0-1.6-.3-2-.9" />
  </Svg>
);

export const IconTag = () => (
  <Svg>
    <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
    <circle cx="5.5" cy="5.5" r="0.8" />
  </Svg>
);

export const IconFolder = () => (
  <Svg>
    <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1z" />
  </Svg>
);

export const IconClock = () => (
  <Svg>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </Svg>
);

export const IconNote = () => (
  <Svg>
    <path d="M4 2.5h5l3 3V13a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" />
    <path d="M9 2.5V5.5h3" />
  </Svg>
);

export const IconNotePlus = () => (
  <Svg>
    <path d="M8 13.5H4.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5h5l3 3V8" />
    <path d="M9 2.5V5.5h3" />
    <path d="M12 10.5v4M10 12.5h4" />
  </Svg>
);

export const IconFolderPlus = () => (
  <Svg>
    <path d="M8 13H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h3.5L8 5h5a1 1 0 0 1 1 1v2" />
    <path d="M12 10v4M10 12h4" />
  </Svg>
);

export const IconCollapseAll = () => (
  <Svg>
    <path d="M5 3.5l3 3 3-3M5 12.5l3-3 3 3" />
  </Svg>
);

export const IconCalendar = () => (
  <Svg>
    <path d="M3 4.5h10a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1zM2 7.5h12M5 2.5v3M11 2.5v3" />
  </Svg>
);

export const IconExpandAll = () => (
  <Svg>
    <path d="M5 6.5l3-3 3 3M5 9.5l3 3 3-3" />
  </Svg>
);

export const IconMove = () => (
  <Svg>
    <path d="M2 4.5V12a1 1 0 0 0 1 1h4M2 4.5a1 1 0 0 1 1-1h3.5L8 5h5a1 1 0 0 1 1 1v1.5" />
    <path d="M9.5 11.5h5M12.5 9.5l2 2-2 2" />
  </Svg>
);

export const IconSettings = () => (
  <Svg>
    <path d="M6.79 3.15L7.07 1.47H8.93L9.21 3.15L10.58 3.72L11.96 2.72L13.28 4.04L12.28 5.42L12.85 6.79L14.53 7.07V8.93L12.85 9.21L12.28 10.58L13.28 11.96L11.96 13.28L10.58 12.28L9.21 12.85L8.93 14.53H7.07L6.79 12.85L5.42 12.28L4.04 13.28L2.72 11.96L3.72 10.58L3.15 9.21L1.47 8.93V7.07L3.15 6.79L3.72 5.42L2.72 4.04L4.04 2.72L5.42 3.72z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);

/** Filters: three bars shrinking. */
export const IconFilter = () => (
  <Svg>
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
  </Svg>
);

export const IconCheckbox = () => (
  <Svg>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5.4 8.3l1.9 1.9 3.3-3.9" />
  </Svg>
);

/** The place-of-interest loop sign, drawn here: four loops joined by a square. */
export const IconCommand = () => (
  <Svg>
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H11.5A1.5 1.5 0 1 0 10 4.5V11.5A1.5 1.5 0 1 0 11.5 10H4.5A1.5 1.5 0 1 0 6 11.5V6z" />
  </Svg>
);

/*
 * The four sync shapes (shape as well as colour): a square, a disc, a ring and a triangle.
 * The colour comes from the wrapper (`currentColor`).
 */
export const IconSyncOff = () => (
  <Svg filled>
    <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.5" />
  </Svg>
);

export const IconSyncDirect = () => (
  <Svg filled>
    <circle cx="8" cy="8" r="5.5" />
  </Svg>
);

export const IconSyncRelay = () => (
  <Svg>
    <circle cx="8" cy="8" r="4.6" stroke-width="2" />
  </Svg>
);

export const IconSyncOffline = () => (
  <Svg filled>
    <path d="M7.1 3.1a1 1 0 0 1 1.8 0l5 8.7a1 1 0 0 1-.9 1.5H3a1 1 0 0 1-.9-1.5z" />
  </Svg>
);
