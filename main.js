'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   mish.home
   a terminal-style home page for obsidian. one tab you open the app to:
   a starship prompt, big block letters, a greeting, shortcuts, recent notes
   as an eza tree, open todos, a contribution-style streak grid, vault stats
   in the fastfetch style, and a little shell you can type into.
   dressed like mish.eza and mish.music: same prompt, same rainbow ring,
   same palette variables, same bundled font.

   every section can be switched on or off, moved up or down, and made full
   or half width. nearly everything about how it looks is a setting: the six
   rainbow colours (with presets), pill text colour, pill shape, border,
   corner radius, margins, card layout, text size and font.

   it is not a real shell: the words are mapped onto obsidian's own api.
   nothing is ever sent to the operating system, and nothing is run.
   ═══════════════════════════════════════════════════════════════════════ */

const obsidian = require('obsidian');
const {
  Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, TFolder, Platform, Keymap,
  FuzzySuggestModal, normalizePath, moment,
} = obsidian;

/* node's `os` module is how the prompt finds your username and the machine's name.
   it only exists on desktop, which is why the manifest says isDesktopOnly. */
let nodeOs = null;
try { nodeOs = require('os'); } catch (e) { nodeOs = null; }

const VIEW_TYPE = 'mh-home-view';
const PLUGIN_ID = 'mish-home';
const SHAPES = ['arrow', 'round', 'flat'];
const RINGS = ['rainbow', 'accent', 'subtle', 'none'];
const HEX = /^#[0-9a-f]{6}$/i;
const COLOURS = 6;

const pad = (n) => String(n).padStart(2, '0');

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

const setText = (node, text) => {
  if (node && node.textContent !== text) node.textContent = text;
};

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const clone = (o) => JSON.parse(JSON.stringify(o));
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* defaults underneath, what was saved on top; nested groups merge key by key,
   so a setting added in an update never goes missing from an old data.json */
const deepMerge = (base, over) => {
  const out = Object.assign({}, base);
  if (!isPlain(over)) return out;
  for (const k of Object.keys(over)) {
    out[k] = isPlain(base[k]) && isPlain(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
};

/* ── the rainbow ─────────────────────────────────────────────────────────
   six colours, in this order everywhere: the prompt pills, the progress bars,
   the tree names, the streak grid and the card border all read from them. */
const SLOTS = [
  { name: 'pink',   vf: '--vf-pink-hi', f: '--mz-f-pink-hi', t: '--mz-pink-hi', dark: 40, used: 'user pill, greeting, first progress colour, where the border starts' },
  { name: 'peach',  vf: '--vf-peach',   f: '--mz-f-peach',   t: '--mz-peach',   dark: 42, used: 'path pill, fortune' },
  { name: 'yellow', vf: '--vf-yellow',  f: '--mz-f-yellow',  t: '--mz-yellow',  dark: 50, used: 'git pill, first chevron' },
  { name: 'green',  vf: '--vf-green',   f: '--mz-f-green',   t: '--mz-green',   dark: 48, used: 'commands and the prompt arrow, second chevron, the streak grid' },
  { name: 'blue',   vf: '--vf-blue',    f: '--mz-f-blue',    t: '--mz-blue',    dark: 40, used: 'third chevron' },
  { name: 'lilac',  vf: '--vf-lilac',   f: '--mz-f-lilac',   t: '--mz-lilac',   dark: 38, used: 'clock pill, where the border ends' },
];

const DARK_FILLS  = ['#ffa6c9', '#ffd6a6', '#fff1a8', '#c9ffa6', '#a6c9ff', '#c9b0ff'];
const LIGHT_FILLS = ['#ff8fb8', '#ffb27a', '#ffd54f', '#8ee07f', '#82b4ff', '#b79bff'];

const PALETTES = {
  catppuccin: ['#f5c2e7', '#fab387', '#f9e2af', '#a6e3a1', '#89b4fa', '#cba6f7'],
  dracula:    ['#ff79c6', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9'],
  nord:       ['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#81a1c1', '#b48ead'],
  gruvbox:    ['#fb4934', '#fe8019', '#fabd2f', '#b8bb26', '#83a598', '#d3869b'],
  ocean:      ['#c4f1f9', '#7fe0e8', '#6fd3c2', '#7bc6f0', '#82a8ff', '#a98bff'],
  sunset:     ['#ff8fa3', '#ff9e6b', '#ffc15e', '#ff7eb6', '#e08bff', '#b794ff'],
  forest:     ['#e6c9a8', '#d9b26f', '#e3e08a', '#9fd58a', '#6fc2a0', '#7fa8c9'],
  greyscale:  ['#f5f5f5', '#dcdcdc', '#c4c4c4', '#a8a8a8', '#8c8c8c', '#707070'],
};

const lightTheme = () => document.body.classList.contains('theme-light');
const themeFills = () => (lightTheme() ? LIGHT_FILLS : DARK_FILLS).slice();

/* ── lowercase ui ────────────────────────────────────────────────────────
   the text in the settings tab is written in lowercase, to match the terminal look.
   with the "lowercase ui" setting off, ui() shows it in sentence case instead. only
   text that obsidian itself shows goes through ui(): the settings tab, its tooltips
   and its messages. */
const uiCase = { lower: true };

const PROPER = [
  [/\bcmu typewriter\b/g, 'CMU Typewriter'],
  [/\bobsidian\b/g, 'Obsidian'],
  [/\bcss\b/g, 'CSS'],
  [/\bui\b/g, 'UI'],
  [/\bmacos\b/g, 'macOS'],
  [/\bgithub\b/g, 'GitHub'],
  [/\bmish\b(?!\.[a-z])/g, 'Mish'],      /* the palette, not mish.home / mish.eza */
  [/\bmish\.(home|music|eza|fastfetch)\b/g, 'mish.$1'],
  [/(?<![\w./-])git\b(?!\/)/g, 'Git'],
];

const KEEP_LOWER = new Set(['help', 'recent', 'todo', 'streak', 'fortune', 'palette', 'open', 'new', 'daily']);

const sentence = (text) => {
  let out = String(text);
  for (const [re, name] of PROPER) out = out.replace(re, name);
  return out.replace(/(^|[.!?]\s+)([a-z][\w-]*)/g, (m, lead, word) => (
    KEEP_LOWER.has(word) ? m : lead + word.charAt(0).toUpperCase() + word.slice(1)
  ));
};

const ui = (text) => (uiCase.lower ? text : sentence(text));

const uiOptions = (options) => Object.fromEntries(
  Object.entries(options).map(([key, label]) => [key, ui(label)])
);

class UiSetting extends Setting {
  setName(name) { return super.setName(typeof name === 'string' ? ui(name) : name); }
  setDesc(desc) { return super.setDesc(typeof desc === 'string' ? ui(desc) : desc); }
}

/* ── the sections ────────────────────────────────────────────────────────
   order, on/off and full/half width of each one are settings. `wide` only matters
   in the two-column layout. */
const SECTION_META = {
  banner:    { label: 'banner',    wide: true,  on: true,  desc: 'big block letters: the vault name, your name or any text.' },
  greeting:  { label: 'greeting',  wide: false, on: true,  desc: 'a hello, the date, and little progress bars for the day, week, month and year.' },
  shortcuts: { label: 'shortcuts', wide: false, on: true,  desc: 'commands you can click, with their hotkeys: new note, go to file, anything in the command palette.' },
  fetch:     { label: 'fastfetch', wide: false, on: false, desc: 'vault stats in the fastfetch style. off by default, since the mish.fastfetch sidebar already shows them.' },
  recent:    { label: 'recent',    wide: false, on: true,  desc: 'the notes you opened or edited last, as an eza-style tree.' },
  pinned:    { label: 'pinned',    wide: false, on: false, desc: 'notes you pin by name, plus your bookmarks.' },
  tasks:     { label: 'todo',      wide: false, on: true,  desc: 'open checkboxes from across the vault. click a box to tick it.' },
  streak:    { label: 'streak',    wide: true,  on: true,  desc: 'a contribution-style grid of the days you wrote, with your current streak.' },
  quote:     { label: 'fortune',   wide: false, on: false, desc: 'one line from your own list, a new one each day.' },
  shell:     { label: 'shell',     wide: true,  on: true,  desc: 'a prompt you can type into: open notes, make notes, search, run commands.' },
};
const SECTION_IDS = Object.keys(SECTION_META);

const DEFAULT_SHORTCUTS = [
  'new note | file-explorer:new-file',
  'go to file | switcher:open',
  'daily note | mish-home:daily-note',
  'search | global-search:open',
  'graph view | graph:open',
  'command palette | command-palette:open',
].join('\n');

const DEFAULT_QUOTES = [
  'make it work, then make it pretty.',
  'read the error message. the whole thing.',
  'one note at a time.',
  'future you is reading this. be kind to them.',
  'it compiles. ship it. then test it.',
  'commit early. commit often. commit something.',
  'the best note is the one you actually wrote.',
].join('\n');

const FETCH_FIELDS = {
  user:    'user@host',
  os:      'os',
  app:     'obsidian version',
  vault:   'vault path',
  notes:   'notes',
  links:   'links',
  tags:    'tags',
  folders: 'folders',
  files:   'files',
  size:    'size',
  theme:   'theme',
  plugins: 'plugins',
  uptime:  'uptime',
};

const DEFAULT_SETTINGS = {
  lowercaseUi: true,        /* settings text in lowercase (true) or sentence case (false) */
  lowercaseText: true,      /* the home page itself in lowercase, note names included (display only) */
  username: '',             /* empty = auto-detect */
  font: 'bundled',          /* bundled | obsidian | system | family:<name> | custom */
  customFont: '',

  /* opening */
  startup: 'always',        /* always | empty | never: open the home tab when obsidian starts */
  takeNewTabs: false,       /* new empty tabs become the home page */
  openIn: 'tab',            /* tab | same: where a note opens when you click it here */
  pinTab: false,
  hideHeader: true,         /* hide the back / forward bar above the page */
  tabTitle: 'home',
  ribbon: true,
  focusShell: false,        /* put the cursor in the prompt when the page opens */
  exclude: '.trash, templates',   /* folders left out of recent, todo and the streak */
  weekStart: 'mon',         /* mon | sun: progress bars and the streak grid */

  /* the rainbow: preset = theme | custom | one of PALETTES */
  palette: { preset: 'theme', colours: DARK_FILLS.slice() },
  inkColour: '',            /* text on the pills. empty = automatic (dark ink) */

  /* the prompt */
  pills: { user: true, path: true, git: true, time: true },
  pillShape: 'arrow',       /* arrow | round | flat */
  pathLabel: '',            /* empty = ~/<vault name> */
  clock: { hour12: false, seconds: false },
  showCommands: true,       /* the ❯ line above each section */

  sections: SECTION_IDS.map((id) => ({ id, on: SECTION_META[id].on, wide: SECTION_META[id].wide })),

  banner: { source: 'vault', custom: '', style: 'blocks', letters: 'lower', size: 7, gradient: 'rainbow', align: 'left' },

  greeting: {
    template: '{greeting}, {name}.',
    showDate: true,
    dateFormat: 'dddd · D MMMM YYYY',
    progress: { day: false, week: false, month: false, year: true },
    barWidth: 24,
    barHeight: 9,
  },

  shortcuts: { items: DEFAULT_SHORTCUTS, layout: 'list', colour: 'plain', hotkeys: true, hideMissing: true },

  fetch: {
    fields: { user: true, os: true, app: false, vault: true, notes: true, links: true, tags: false, folders: true, files: true, size: true, theme: false, plugins: false, uptime: true },
    colourBar: true,
  },

  recent: { mode: 'opened', count: 8, types: 'notes', extensions: 'hide', nameColour: 'rainbow', age: true, folder: false, tree: true },

  pinned: { paths: '', bookmarks: true, extensions: 'hide', nameColour: 'rainbow', tree: true },

  tasks: { count: 6, scan: 40, complete: true, showNote: true },

  streak: { metric: 'edits', weeks: 0, colour: 'green', shape: 'square', cell: 11, gap: 3, dayLabels: true, monthLabels: true, summary: true },

  quote: { lines: DEFAULT_QUOTES, mode: 'daily' },

  shell: { outputLines: 8, placeholder: 'type a command · help' },

  daily: { folder: '', format: '' },    /* empty = whatever the core daily notes plugin says, else the vault root and YYYY-MM-DD */

  /* the card */
  layout: { frame: 'one', columns: 2, width: 860, gap: 16, inner: 16, fit: 'shrink', minScale: 55 },   /* frame: one | each | none. fit: shrink | scroll */
  card: { hAlign: 'centre', vAlign: 'centre', ring: 'rainbow', ringWidth: 1, angle: 135, radius: 12, pad: 16, textSize: 100 },
};

/* a data.json from an older version, or one edited by hand, must never break the page */
const sanitise = (cfg) => {
  const p = cfg.palette;
  if (p.preset !== 'theme' && p.preset !== 'custom' && !PALETTES[p.preset]) p.preset = 'theme';
  if (!Array.isArray(p.colours) || p.colours.length !== 6 || !p.colours.every((c) => HEX.test(c))) {
    p.colours = DARK_FILLS.slice();
  }
  cfg.lowercaseUi = cfg.lowercaseUi !== false;
  cfg.lowercaseText = cfg.lowercaseText !== false;
  cfg.startup = oneOf(cfg.startup, ['always', 'empty', 'never'], 'always');
  cfg.openIn = oneOf(cfg.openIn, ['tab', 'same'], 'tab');
  cfg.weekStart = oneOf(cfg.weekStart, ['mon', 'sun'], 'mon');
  cfg.pillShape = oneOf(cfg.pillShape, SHAPES, 'arrow');

  /* the section list: every section exactly once, unknown ones dropped */
  const seen = new Set();
  const list = [];
  for (const it of Array.isArray(cfg.sections) ? cfg.sections : []) {
    if (it && SECTION_META[it.id] && !seen.has(it.id)) {
      seen.add(it.id);
      list.push({ id: it.id, on: it.on !== false, wide: it.wide === undefined ? SECTION_META[it.id].wide : !!it.wide });
    }
  }
  for (const id of SECTION_IDS) {
    if (!seen.has(id)) list.push({ id, on: SECTION_META[id].on, wide: SECTION_META[id].wide });
  }
  cfg.sections = list;

  const b = cfg.banner;
  b.source = oneOf(b.source, ['vault', 'name', 'custom'], 'vault');
  b.style = oneOf(b.style, ['blocks', 'text'], 'blocks');
  b.gradient = oneOf(b.gradient, ['rainbow', 'accent', 'pink', 'plain'], 'rainbow');
  b.align = oneOf(b.align, ['left', 'centre'], 'left');
  b.letters = oneOf(b.letters, ['lower', 'caps'], 'lower');
  b.size = num(b.size, 3, 14, 7);

  const g = cfg.greeting;
  g.barWidth = num(g.barWidth, 8, 40, 24);
  g.barHeight = num(g.barHeight, 4, 14, 9);

  cfg.shortcuts.layout = oneOf(cfg.shortcuts.layout, ['list', 'row'], 'list');
  cfg.shortcuts.colour = oneOf(cfg.shortcuts.colour, ['plain', 'rainbow'], 'plain');
  cfg.shortcuts.hideMissing = cfg.shortcuts.hideMissing !== false;

  const r = cfg.recent;
  r.mode = oneOf(r.mode, ['opened', 'edited', 'created'], 'opened');
  r.types = oneOf(r.types, ['notes', 'all'], 'notes');
  r.extensions = oneOf(r.extensions, ['hide', 'show'], 'hide');
  r.nameColour = oneOf(r.nameColour, ['rainbow', 'type', 'plain'], 'rainbow');
  r.count = num(r.count, 1, 30, 8);

  const pn = cfg.pinned;
  pn.extensions = oneOf(pn.extensions, ['hide', 'show'], 'hide');
  pn.nameColour = oneOf(pn.nameColour, ['rainbow', 'type', 'plain'], 'rainbow');

  cfg.tasks.count = num(cfg.tasks.count, 1, 30, 6);
  cfg.tasks.scan = num(cfg.tasks.scan, 5, 400, 40);

  const st = cfg.streak;
  st.metric = oneOf(st.metric, ['edits', 'modified', 'created', 'daily'], 'edits');
  st.colour = oneOf(st.colour, SLOTS.map((x) => x.name).concat('rainbow'), 'green');
  st.shape = oneOf(st.shape, ['square', 'round'], 'square');
  st.weeks = num(st.weeks, 0, 53, 0);
  st.cell = num(st.cell, 6, 20, 11);
  st.gap = num(st.gap, 1, 8, 3);

  cfg.quote.mode = oneOf(cfg.quote.mode, ['daily', 'random'], 'daily');
  cfg.shell.outputLines = num(cfg.shell.outputLines, 2, 16, 8);

  const l = cfg.layout;
  l.frame = oneOf(l.frame, ['one', 'each', 'none'], 'one');
  l.columns = Number(l.columns) === 1 ? 1 : 2;
  l.width = num(l.width, 420, 1400, 860);
  l.gap = num(l.gap, 0, 40, 16);
  l.inner = num(l.inner, 0, 40, 16);
  l.fit = oneOf(l.fit, ['shrink', 'scroll'], 'shrink');
  l.minScale = num(l.minScale, 30, 100, 55);

  const c = cfg.card;
  c.ring = oneOf(c.ring, RINGS, 'rainbow');
  c.hAlign = oneOf(c.hAlign, ['centre', 'left'], 'centre');
  c.vAlign = oneOf(c.vAlign, ['centre', 'top'], 'centre');
  return cfg;
};

/* the six colours to draw with, or null when the theme decides */
const customColours = (cfg) => {
  const p = cfg.palette;
  return p.preset !== 'theme' && Array.isArray(p.colours) && p.colours.length === 6 && p.colours.every((c) => HEX.test(c))
    ? p.colours : null;
};

/* css variables for the colours. a custom palette sets the plugin's own fills and text
   colours, and tells the theme's --vf-* to step aside (`initial` = "not set", so the
   fallbacks win). in light mode the text colour is the fill darkened. */
const paletteVars = (cfg) => {
  const v = {};
  const colours = customColours(cfg);
  if (colours) {
    const light = lightTheme();
    SLOTS.forEach((s, i) => {
      v[s.vf] = 'initial';
      v[s.f] = colours[i];
      v[s.t] = light ? 'color-mix(in oklab, ' + colours[i] + ', black ' + s.dark + '%)' : colours[i];
    });
  }
  if (HEX.test(cfg.inkColour)) {
    v['--vf-black'] = 'initial';
    v['--mz-ink'] = cfg.inkColour;
  }
  return v;
};

/* css variables for sizes, the border and the layout. every one has the default as its
   fallback in styles.css. */
const layoutVars = (cfg) => {
  const c = cfg.card;
  const l = cfg.layout;
  const v = {
    '--mh-w': l.width + 'px',
    '--mh-cols': String(l.columns),
    '--mh-gap': l.gap + 'px',
    '--mh-inner': l.inner + 'px',
    '--mh-radius': num(c.radius, 0, 28, 12) + 'px',
    '--mh-pad': num(c.pad, 0, 48, 16) + 'px',
    '--mh-angle': num(c.angle, 0, 360, 135) + 'deg',
    '--mh-scale': String(num(c.textSize, 80, 140, 100) / 100),
    '--mh-mt': c.vAlign === 'top' ? '0' : 'auto',
    '--mh-ml': c.hAlign === 'left' ? '0' : 'auto',
    '--mh-banner': cfg.banner.size + 'px',
    '--mh-seek': cfg.greeting.barHeight + 'px',
    '--mh-cell': cfg.streak.cell + 'px',
    '--mh-cgap': cfg.streak.gap + 'px',
    '--mh-cr': cfg.streak.shape === 'round' ? '50%' : '2px',
  };
  const w = num(c.ringWidth, 1, 4, 1) + 'px';
  if (c.ring === 'none') {
    v['--mh-ring-w'] = '0px';
  } else if (c.ring === 'accent') {
    v['--mh-ring-w'] = w;
    v['--mh-ring-bg'] = 'var(--interactive-accent)';
  } else if (c.ring === 'subtle') {
    v['--mh-ring-w'] = w;
    v['--mh-ring-bg'] = 'var(--background-modifier-border)';
  } else {
    v['--mh-ring-w'] = w;
  }
  return v;
};

/* sets the variables, and clears ones set last time that are no longer wanted */
const applyVars = (node, vars) => {
  for (const name of node.__mhVars || []) {
    if (!(name in vars)) node.style.removeProperty(name);
  }
  for (const name of Object.keys(vars)) node.style.setProperty(name, vars[name]);
  node.__mhVars = Object.keys(vars);
};

/* ── fonts ───────────────────────────────────────────────────────────────
   the page ships its own typewriter face (embedded in styles.css), so the
   default needs nothing installed. the settings can swap it for a font from
   the user's own machine. */
const CANDIDATE_FONTS = [
  'SF Mono', 'Menlo', 'Monaco', 'Andale Mono', 'Consolas', 'Lucida Console', 'Cascadia Code',
  'Cascadia Mono', 'Courier New', 'JetBrains Mono', 'Fira Code', 'Fira Mono', 'Source Code Pro',
  'IBM Plex Mono', 'Roboto Mono', 'Hack', 'Inconsolata', 'Ubuntu Mono', 'DejaVu Sans Mono',
  'Liberation Mono', 'Noto Sans Mono', 'Iosevka', 'Victor Mono', 'Space Mono', 'CMU Typewriter Text',
  'MesloLGS NF',
];

const quoteFont = (name) => '"' + String(name).replace(/["\\]/g, '') + '"';

let measureCtx = null;
const textWidth = (family, text) => {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '64px ' + family;
  return measureCtx.measureText(text).width;
};

const isInstalled = (name) => ['monospace', 'serif', 'sans-serif'].some(
  (base) => textWidth(quoteFont(name) + ', ' + base, 'mmmmmmmmmmlli') !== textWidth(base, 'mmmmmmmmmmlli')
);

const isMono = (name) => {
  const f = quoteFont(name) + ', monospace';
  return Math.abs(textWidth(f, 'iiiiiiiiii') - textWidth(f, 'mmmmmmmmmm')) < 0.5 &&
    Math.abs(textWidth(f, 'llllllllll') - textWidth(f, 'WWWWWWWWWW')) < 0.5;
};

const scanSystemFonts = async () => {
  if (typeof window.queryLocalFonts !== 'function') return null;
  const fonts = await window.queryLocalFonts();
  const families = Array.from(new Set(fonts.map((f) => f.family)));
  return families
    .filter((name) => !/symbols|emoji|icons|dingbats|wingdings|webdings/i.test(name))
    .filter((name) => isInstalled(name) && isMono(name))
    .sort((a, b) => a.localeCompare(b));
};

/* the font-family to put in --vf-mono, or null to leave the css default alone */
const fontStack = (cfg) => {
  switch (cfg.font) {
    case 'obsidian': return 'var(--font-monospace), ui-monospace, monospace';
    case 'system': return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    case 'custom': return cfg.customFont.trim() || null;
    default:
      return cfg.font.indexOf('family:') === 0
        ? quoteFont(cfg.font.slice(7)) + ', ui-monospace, monospace'
        : null;
  }
};

/* ── small helpers ─────────────────────────────────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const dayKey = (ts) => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

/* 4m, 2h, 3d, 5w: short enough that the column never needs more than 4 characters */
const ageOf = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  const m = s / 60;
  if (m < 60) return Math.floor(m) + 'm';
  const h = m / 60;
  if (h < 24) return Math.floor(h) + 'h';
  const d = h / 24;
  if (d < 14) return Math.floor(d) + 'd';
  if (d < 60) return Math.floor(d / 7) + 'w';
  if (d < 365) return Math.floor(d / 30) + 'mo';
  return Math.floor(d / 365) + 'y';
};

const fmtSize = (bytes) => {
  if (bytes < 1024) return bytes + ' b';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kb';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' mb';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' gb';
};

const fmtUp = (ms) => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  if (m) return m + 'm ' + (s % 60) + 's';
  return s + 's';
};

/* comma or newline separated list, trimmed, lowercase, empties dropped */
const parseList = (text) => String(text || '')
  .split(/[,\n]/)
  .map((x) => x.trim().toLowerCase().replace(/^\/+|\/+$/g, ''))
  .filter(Boolean);

const isExcluded = (path, list) => {
  if (!list.length) return false;
  const p = path.toLowerCase();
  return list.some((x) => p === x || p.startsWith(x + '/') || p.includes('/' + x + '/'));
};

/* "label | command-id" per line. lines starting with # are ignored */
const parseShortcuts = (text) => String(text || '')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && line[0] !== '#')
  .map((line) => {
    const at = line.lastIndexOf('|');
    if (at < 0) return { label: line, id: line };
    return { label: line.slice(0, at).trim(), id: line.slice(at + 1).trim() };
  })
  .filter((it) => it.label && it.id);

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'];
const kindColour = (node) => {
  if (!node) return 2;
  const ext = (node.extension || '').toLowerCase();
  if (ext === 'md') return 3;
  if (IMAGE_EXT.includes(ext)) return 5;
  if (ext === 'pdf') return 0;
  if (ext === 'canvas' || ext === 'base') return 1;
  return 2;
};

/* who you are, as the operating system reports it */
const detectIdentity = () => {
  let user = 'user';
  let host = 'localhost';
  try { user = nodeOs.userInfo().username || user; } catch (e) { /* keep the fallback */ }
  try { host = (nodeOs.hostname() || host).replace(/\.local$/i, ''); } catch (e) { /* keep the fallback */ }
  return { user: user.toLowerCase(), host: host.toLowerCase() };
};

const osGlyph = () => {
  if (Platform.isMacOS) return '\uF179';
  if (Platform.isWin) return '\uF17A';
  return '\uF17C';
};

const osName = () => (Platform.isMacOS ? 'macOS' : Platform.isWin ? 'windows' : Platform.isLinux ? 'linux' : 'unknown');

/* ⌘ n, ctrl+n ... for a hotkey object from obsidian */
const KEY_NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↵', Backspace: '⌫', Delete: 'del', Escape: 'esc', ' ': 'space', Tab: 'tab' };
const hotkeyText = (hk) => {
  if (!hk) return '';
  const mac = Platform.isMacOS;
  const sym = mac
    ? { Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'ctrl', Meta: 'win', Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift' };
  const order = ['Mod', 'Meta', 'Ctrl', 'Alt', 'Shift'];
  const mods = order.filter((m) => (hk.modifiers || []).includes(m)).map((m) => sym[m]);
  const key = KEY_NAMES[hk.key] || String(hk.key || '').toLowerCase();
  return mac ? (mods.join('') + ' ' + key).trim() : mods.concat(key).join('+');
};

/* ── block letters ───────────────────────────────────────────────────────
   a tiny 5-row pixel font, drawn as one svg path so it is crisp at any size and
   never depends on which font has block characters. rows are joined by | */
const BANNER_FONT = {
  a: '.###.|#...#|#####|#...#|#...#', b: '####.|#...#|####.|#...#|####.', c: '.####|#....|#....|#....|.####',
  d: '####.|#...#|#...#|#...#|####.', e: '#####|#....|####.|#....|#####', f: '#####|#....|####.|#....|#....',
  g: '.####|#....|#.###|#...#|.###.', h: '#...#|#...#|#####|#...#|#...#', i: '#####|..#..|..#..|..#..|#####',
  j: '..###|...#.|...#.|#..#.|.##..', k: '#...#|#..#.|###..|#..#.|#...#', l: '#....|#....|#....|#....|#####',
  m: '#...#|##.##|#.#.#|#...#|#...#', n: '#...#|##..#|#.#.#|#..##|#...#', o: '.###.|#...#|#...#|#...#|.###.',
  p: '####.|#...#|####.|#....|#....', q: '.###.|#...#|#...#|#..##|.####', r: '####.|#...#|####.|#..#.|#...#',
  s: '.####|#....|.###.|....#|####.', t: '#####|..#..|..#..|..#..|..#..', u: '#...#|#...#|#...#|#...#|.###.',
  v: '#...#|#...#|#...#|.#.#.|..#..', w: '#...#|#...#|#.#.#|##.##|#...#', x: '#...#|.#.#.|..#..|.#.#.|#...#',
  y: '#...#|.#.#.|..#..|..#..|..#..', z: '#####|...#.|..#..|.#...|#####',
  0: '.###.|#..##|#.#.#|##..#|.###.', 1: '..#..|.##..|..#..|..#..|.###.', 2: '.###.|#...#|...#.|..#..|#####',
  3: '####.|....#|.###.|....#|####.', 4: '#...#|#...#|#####|....#|....#', 5: '#####|#....|####.|....#|####.',
  6: '.###.|#....|####.|#...#|.###.', 7: '#####|....#|...#.|..#..|..#..', 8: '.###.|#...#|.###.|#...#|.###.',
  9: '.###.|#...#|.####|....#|.###.',
  '.': '.|.|.|.|#', '-': '...|...|###|...|...', _: '.....|.....|.....|.....|#####',
  '/': '....#|...#.|..#..|.#...|#....', ' ': '...|...|...|...|...',
};

/* the lowercase face: 9 rows. rows 0-1 are where ascenders (b d f h k l t) and the dot of an i / j
   live, rows 2-6 are the x-height, rows 7-8 are where descenders (g j p q y) hang. empty rows at
   the top and bottom are trimmed away, so "mish.shell" is only 7 rows tall. */
const BANNER_LOWER = {
  a: '.....|.....|.###.|....#|.####|#...#|.####|.....|.....',
  b: '#....|#....|####.|#...#|#...#|#...#|####.|.....|.....',
  c: '.....|.....|.####|#....|#....|#....|.####|.....|.....',
  d: '....#|....#|.####|#...#|#...#|#...#|.####|.....|.....',
  e: '.....|.....|.###.|#...#|#####|#....|.####|.....|.....',
  f: '..##.|.#...|####.|.#...|.#...|.#...|.#...|.....|.....',
  g: '.....|.....|.####|#...#|#...#|#...#|.####|....#|.###.',
  h: '#....|#....|#.##.|##..#|#...#|#...#|#...#|.....|.....',
  i: '..#..|.....|.##..|..#..|..#..|..#..|.###.|.....|.....',
  j: '...#.|.....|..##.|...#.|...#.|...#.|...#.|#..#.|.##..',
  k: '#....|#....|#..#.|#.#..|##...|#.#..|#..#.|.....|.....',
  l: '.##..|..#..|..#..|..#..|..#..|..#..|.###.|.....|.....',
  m: '.....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#|.....|.....',
  n: '.....|.....|#.##.|##..#|#...#|#...#|#...#|.....|.....',
  o: '.....|.....|.###.|#...#|#...#|#...#|.###.|.....|.....',
  p: '.....|.....|####.|#...#|#...#|#...#|####.|#....|#....',
  q: '.....|.....|.####|#...#|#...#|#...#|.####|....#|....#',
  r: '.....|.....|#.##.|##..#|#....|#....|#....|.....|.....',
  s: '.....|.....|.####|#....|.###.|....#|####.|.....|.....',
  t: '.....|.#...|####.|.#...|.#...|.#...|..##.|.....|.....',
  u: '.....|.....|#...#|#...#|#...#|#..##|.##.#|.....|.....',
  v: '.....|.....|#...#|#...#|#...#|.#.#.|..#..|.....|.....',
  w: '.....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.|.....|.....',
  x: '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#|.....|.....',
  y: '.....|.....|#...#|#...#|#...#|.####|....#|....#|.###.',
  z: '.....|.....|#####|...#.|..#..|.#...|#####|.....|.....',
  '.': '.|.|.|.|.|.|#|.|.',
  '-': '...|...|...|...|###|...|...|...|...',
  _: '.....|.....|.....|.....|.....|.....|.....|#####|.....',
  '/': '....#|....#|...#.|..#..|..#..|.#...|#....|#....|.....',
  ' ': '...|...|...|...|...|...|...|...|...',
};
/* digits sit at x-height, so they reuse the five-row capital digits */
for (const d of '0123456789') BANNER_LOWER[d] = ['.....', '.....', BANNER_FONT[d], '.....', '.....'].join('|');

/* letters: 'lower' = the lowercase face, 'caps' = the five-row capitals */
const bannerBitmap = (text, letters) => {
  const font = letters === 'caps' ? BANNER_FONT : BANNER_LOWER;
  const height = letters === 'caps' ? 5 : 9;
  let rows = new Array(height).fill('');
  let first = true;
  for (const ch of String(text).toLowerCase()) {
    const g = font[ch];
    if (!g) continue;
    const parts = g.split('|');
    if (!first) for (let r = 0; r < height; r++) rows[r] += '.';      /* one blank column between letters */
    first = false;
    for (let r = 0; r < height; r++) rows[r] += parts[r];
  }
  /* empty rows at the top and bottom would only waste space */
  while (rows.length && !rows[0].includes('#')) rows.shift();
  while (rows.length && !rows[rows.length - 1].includes('#')) rows.pop();
  return rows;
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const bannerSvg = (text, uid, gradient, letters) => {
  const rows = bannerBitmap(text, letters);
  if (!rows.length) return null;
  const W = rows[0].length;
  const H = rows.length;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('class', 'mh-banner');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  svg.style.setProperty('--mh-bw', String(W));
  svg.style.aspectRatio = W + ' / ' + H;

  const id = 'mh-grad-' + uid;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'linearGradient');
  grad.setAttribute('id', id);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', String(W));
  grad.setAttribute('y2', '0');

  const stops = gradient === 'rainbow'
    ? [0, 1, 2, 3, 4, 5].map((i) => 'var(--mh-f' + i + ')')
    : gradient === 'accent' ? ['var(--interactive-accent)']
      : gradient === 'pink' ? ['var(--mh-f0)'] : ['var(--mh-fg)'];
  stops.forEach((c, i) => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', stops.length > 1 ? String(i / (stops.length - 1)) : '0');
    stop.style.stopColor = c;
    grad.appendChild(stop);
  });
  defs.appendChild(grad);
  svg.appendChild(defs);

  /* one path: a rectangle per horizontal run of pixels */
  let d = '';
  rows.forEach((row, y) => {
    const re = /#+/g;
    let m;
    while ((m = re.exec(row))) d += 'M' + m.index + ' ' + y + 'h' + m[0].length + 'v1h-' + m[0].length + 'z';
  });
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'url(#' + id + ')');
  svg.appendChild(path);
  return svg;
};

/* the command palette picker used by the settings tab */
class CommandPicker extends FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder('pick a command to add');
  }

  getItems() { return Object.values(this.app.commands.commands); }

  getItemText(c) { return c.name; }

  onChooseItem(c) { this.onPick(c); }
}

let UID = 0;

/* ═══════════════════════════════════════════════════════════════════════
   the plugin
   ═══════════════════════════════════════════════════════════════════════ */
class MishHome extends Plugin {
  async onload() {
    this.views = new Set();
    this.session = new Set();      /* files already counted as edited today, this session */
    this.pending = new Set();      /* sections waiting for a refresh */
    this.pendingAll = false;
    this.branch = null;
    this.ready = false;
    this.detected = detectIdentity();
    this.statsCache = null;

    /* data.json holds the settings, recently opened notes, the edit log and the shell history */
    const saved = (await this.loadData()) || {};
    this.settings = sanitise(deepMerge(clone(DEFAULT_SETTINGS), saved.settings || {}));
    uiCase.lower = this.settings.lowercaseUi;
    /* 1.0.0 saved the old section layout; the new default (no fastfetch, greeting beside shortcuts) applies once */
    if ((saved.v || 0) < 2) this.settings.sections = clone(DEFAULT_SETTINGS.sections);
    this.opened = Array.isArray(saved.opened) ? saved.opened.filter((p) => typeof p === 'string').slice(0, 60) : [];
    this.history = Array.isArray(saved.history) ? saved.history.filter((p) => typeof p === 'string').slice(-60) : [];
    this.activity = {};
    if (isPlain(saved.activity)) {
      const cutoff = dayKey(Date.now() - 400 * 86400000);
      for (const k of Object.keys(saved.activity)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k >= cutoff && Number.isFinite(saved.activity[k])) this.activity[k] = saved.activity[k];
      }
    }

    this.registerView(VIEW_TYPE, (leaf) => new HomeView(leaf, this));
    this.addSettingTab(new HomeSettingTab(this.app, this));
    this.syncRibbon();

    this.addCommand({ id: 'open-home', name: 'Open home', callback: () => this.openHome() });
    this.addCommand({ id: 'daily-note', name: "Open today's daily note", callback: () => this.openDaily() });
    this.addCommand({ id: 'random-note', name: 'Open a random note', callback: () => this.openRandom() });
    this.addCommand({
      id: 'focus-prompt',
      name: 'Focus the home prompt',
      callback: async () => {
        const leaf = await this.openHome();
        const view = leaf && leaf.view;
        if (view && view.focusShell) window.setTimeout(() => view.focusShell(), 60);
      },
    });
    this.addCommand({ id: 'refresh-home', name: 'Redraw home', callback: () => this.rebuildAll() });

    this.app.workspace.onLayoutReady(() => {
      this.ready = true;
      this.probe();
      this.startup();
    });

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!(file instanceof TFile)) return;
      this.opened = [file.path].concat(this.opened.filter((p) => p !== file.path)).slice(0, 60);
      this.persist();
      this.refreshSoon(['recent'], 200);
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.takeOverEmptyTabs();
      this.wakeViews();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.wakeViews()));
    this.registerEvent(this.app.workspace.on('css-change', () => this.restyleAll()));

    const vault = this.app.vault;
    for (const ev of ['create', 'delete']) {
      this.registerEvent(vault.on(ev, () => { this.statsCache = null; this.refreshSoon(null, 600); }));
    }
    this.registerEvent(vault.on('rename', (file, oldPath) => {
      const at = this.opened.indexOf(oldPath);
      if (at >= 0) { this.opened[at] = file.path; this.persist(); }
      this.statsCache = null;
      this.refreshSoon(null, 600);
    }));
    this.registerEvent(vault.on('modify', (file) => {
      this.trackEdit(file);
      this.statsCache = null;
      this.refreshSoon(['recent', 'streak', 'fetch'], 2500);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshSoon(['tasks', 'fetch'], 1500)));

    /* keeps the clock and the uptime ticking */
    this.registerInterval(window.setInterval(() => {
      for (const view of this.views) view.tick();
    }, 1000));
  }

  onunload() {
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.saveTimer);
    this.saveAll();
    /* open home tabs are left alone: obsidian turns them back into the page when the plugin returns */
  }

  /* ── opening ─────────────────────────────────────────────────────────── */

  startup() {
    const mode = this.settings.startup;
    if (mode === 'never') return;
    const ws = this.app.workspace;
    const homes = ws.getLeavesOfType(VIEW_TYPE);
    if (homes.length) {
      if (mode === 'always') ws.revealLeaf(homes[0]);
      return;
    }
    if (mode === 'empty') {
      let busy = false;
      ws.iterateRootLeaves((leaf) => {
        if (leaf.view && leaf.view.getViewType() !== 'empty') busy = true;
      });
      if (busy) return;
    }
    this.openHome();
  }

  async openHome() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await ws.revealLeaf(existing);
      return existing;
    }
    let leaf = null;
    ws.iterateRootLeaves((l) => {
      if (!leaf && l.view && l.view.getViewType() === 'empty') leaf = l;
    });
    if (!leaf) leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    if (this.settings.pinTab && leaf.setPinned) leaf.setPinned(true);
    await ws.revealLeaf(leaf);
    return leaf;
  }

  /* a new empty tab becomes the home page, when the setting is on */
  takeOverEmptyTabs() {
    if (!this.ready || !this.settings.takeNewTabs) return;
    window.clearTimeout(this.takeTimer);
    this.takeTimer = window.setTimeout(() => {
      const empties = [];
      this.app.workspace.iterateRootLeaves((leaf) => {
        if (leaf.view && leaf.view.getViewType() === 'empty') empties.push(leaf);
      });
      for (const leaf of empties) leaf.setViewState({ type: VIEW_TYPE, active: leaf === this.app.workspace.activeLeaf });
    }, 60);
  }

  syncRibbon() {
    if (this.ribbonEl) { this.ribbonEl.remove(); this.ribbonEl = null; }
    if (this.settings.ribbon) {
      this.ribbonEl = this.addRibbonIcon('terminal', 'Open home', () => this.openHome());
    }
  }

  /* where a note opens when you click it on the page. ctrl/cmd-click does the other thing. */
  leafFor(ev) {
    const mod = ev ? Keymap.isModEvent(ev) : false;
    if (mod) return this.app.workspace.getLeaf(mod);
    return this.app.workspace.getLeaf(this.settings.openIn === 'same' ? false : 'tab');
  }

  async openFile(file, ev, line) {
    const leaf = this.leafFor(ev);
    await leaf.openFile(file, line != null ? { eState: { line } } : undefined);
  }

  runCommand(id) {
    const cmds = this.app.commands;
    if (!cmds.commands[id]) {
      new Notice(ui('no command called ' + id + '. check the shortcuts list in settings.'));
      return false;
    }
    cmds.executeCommandById(id);
    return true;
  }

  hotkeyFor(id) {
    try {
      const hm = this.app.hotkeyManager;
      const list = (hm.getHotkeys(id) || hm.getDefaultHotkeys(id) || []);
      return hotkeyText(list[0]);
    } catch (e) {
      return '';
    }
  }

  /* ── git branch for the prompt: one small file, read through obsidian's own api ── */
  async probe() {
    this.branch = null;
    if (this.settings.pills.git) {
      try {
        const head = (await this.app.vault.adapter.read('.git/HEAD')).trim();
        const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        if (m) this.branch = m[1];
        else if (/^[0-9a-f]{40}$/i.test(head)) this.branch = head.slice(0, 7);
      } catch (e) {
        this.branch = null;
      }
    }
    for (const view of this.views) view.drawBar();
  }

  /* ── notes: new, daily, random ─────────────────────────────────────────── */

  async ensureFolder(folder) {
    const path = normalizePath(folder);
    if (!path || path === '/') return;
    const parts = path.split('/');
    let built = '';
    for (const part of parts) {
      built = built ? built + '/' + part : part;
      if (!this.app.vault.getAbstractFileByPath(built)) await this.app.vault.createFolder(built);
    }
  }

  dailyConfig() {
    let folder = '';
    let format = 'YYYY-MM-DD';
    let template = '';
    try {
      const plugin = this.app.internalPlugins.getPluginById('daily-notes');
      const o = (plugin && plugin.instance && plugin.instance.options) || {};
      if (plugin && plugin.enabled) {
        folder = o.folder || '';
        format = o.format || format;
        template = o.template || '';
      }
    } catch (e) { /* the core plugin is optional */ }
    if (this.settings.daily.folder) folder = this.settings.daily.folder;
    if (this.settings.daily.format) format = this.settings.daily.format;
    return { folder: folder.replace(/^\/+|\/+$/g, ''), format, template };
  }

  async openDaily() {
    const { folder, format, template } = this.dailyConfig();
    const now = moment();
    const name = now.format(format);
    const path = normalizePath((folder ? folder + '/' : '') + name + '.md');
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir) await this.ensureFolder(dir);
      let body = '';
      if (template) {
        const t = this.app.metadataCache.getFirstLinkpathDest(template.replace(/\.md$/i, ''), '');
        if (t) {
          const title = name.split('/').pop();
          body = (await this.app.vault.read(t)).replace(/{{\s*(date|time|title)\s*(?::([^}]*))?}}/gi, (m, kind, fmt) => {
            const k = kind.toLowerCase();
            if (k === 'title') return title;
            return now.format((fmt || '').trim() || (k === 'date' ? 'YYYY-MM-DD' : 'HH:mm'));
          });
        }
      }
      file = await this.app.vault.create(path, body);
    }
    await this.openFile(file);
    return file;
  }

  async openRandom() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, parseList(this.settings.exclude)));
    if (!files.length) { new Notice(ui('no notes yet.')); return null; }
    const file = files[Math.floor(Math.random() * files.length)];
    await this.openFile(file);
    return file;
  }

  async createNote(name) {
    const base = String(name || 'untitled').replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'untitled';
    const active = this.app.workspace.getActiveFile();
    let parent = '';
    try { parent = this.app.fileManager.getNewFileParent(active ? active.path : '').path; } catch (e) { parent = ''; }
    if (parent === '/') parent = '';
    let n = 0;
    let path;
    do {
      path = normalizePath((parent ? parent + '/' : '') + base + (n ? ' ' + n : '') + '.md');
      n++;
    } while (this.app.vault.getAbstractFileByPath(path));
    const file = await this.app.vault.create(path, '');
    await this.openFile(file);
    return file;
  }

  /* best matches for a typed name: exact name, exact path, starts with, contains */
  findNotes(query) {
    const q = String(query || '').trim().toLowerCase().replace(/\.md$/, '');
    if (!q) return [];
    const files = this.app.vault.getMarkdownFiles();
    const tiers = [[], [], [], [], []];
    for (const f of files) {
      const base = f.basename.toLowerCase();
      const path = f.path.toLowerCase().replace(/\.md$/, '');
      if (base === q) tiers[0].push(f);
      else if (path === q) tiers[1].push(f);
      else if (base.startsWith(q)) tiers[2].push(f);
      else if (base.includes(q)) tiers[3].push(f);
      else if (path.includes(q)) tiers[4].push(f);
    }
    const hit = tiers.find((t) => t.length) || [];
    return hit.sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  /* ── data for the sections ─────────────────────────────────────────────── */

  vaultStats() {
    const now = Date.now();
    if (this.statsCache && now - this.statsCache.at < 2000) return this.statsCache.data;
    const vault = this.app.vault;
    let notes = 0;
    let files = 0;
    let folders = 0;
    let size = 0;
    for (const f of vault.getAllLoadedFiles()) {
      if (f instanceof TFolder) { if (!f.isRoot()) folders++; continue; }
      files++;
      size += (f.stat && f.stat.size) || 0;
      if (f.extension === 'md') notes++;
    }
    let links = 0;
    const resolved = this.app.metadataCache.resolvedLinks || {};
    for (const src of Object.keys(resolved)) {
      for (const dst of Object.keys(resolved[src])) links += resolved[src][dst];
    }
    let tags = 0;
    try { tags = Object.keys(this.app.metadataCache.getTags() || {}).length; } catch (e) { tags = 0; }
    const data = { notes, files, folders, size, links, tags };
    this.statsCache = { at: now, data };
    return data;
  }

  /* open checkboxes. the metadata cache knows where they are; only the first few notes
     are actually read, to show the text. */
  async collectTasks() {
    const s = this.settings.tasks;
    const ex = parseList(this.settings.exclude);
    const files = this.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f.path, ex))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    let total = 0;
    let noteCount = 0;
    let scanned = 0;
    const items = [];
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      const li = cache && cache.listItems;
      if (!li) continue;
      const open = li.filter((i) => i.task === ' ');
      if (!open.length) continue;
      total += open.length;
      noteCount++;
      if (items.length >= s.count || scanned >= s.scan) continue;
      scanned++;
      let lines;
      try { lines = (await this.app.vault.cachedRead(f)).split('\n'); } catch (e) { continue; }
      for (const it of open) {
        if (items.length >= s.count) break;
        const raw = lines[it.position.start.line] || '';
        const m = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s?(.*)$/);
        if (m) items.push({ file: f, line: it.position.start.line, raw, text: m[1].trim() });
      }
    }
    return { total, noteCount, items };
  }

  /* ticks one box. the line must still be exactly what was shown, or nothing is written. */
  async tickTask(t) {
    let done = false;
    await this.app.vault.process(t.file, (data) => {
      const lines = data.split('\n');
      if (lines[t.line] === t.raw && t.raw.includes('[ ]')) {
        lines[t.line] = t.raw.replace('[ ]', '[x]');
        done = true;
        return lines.join('\n');
      }
      return data;
    });
    return done;
  }

  /* edits per day, for the streak grid */
  trackEdit(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    if (isExcluded(file.path, parseList(this.settings.exclude))) return;
    const day = dayKey(Date.now());
    const key = day + '|' + file.path;
    if (this.session.has(key)) return;
    this.session.add(key);
    this.activity[day] = (this.activity[day] || 0) + 1;
    this.persist();
  }

  dayCounts(metric) {
    const ex = parseList(this.settings.exclude);
    const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, ex));
    const m = new Map();
    const bump = (k, n) => m.set(k, (m.get(k) || 0) + n);
    if (metric === 'daily') {
      const { format } = this.dailyConfig();
      const lastPart = format.split('/').pop();
      for (const f of files) {
        let key = null;
        const strict = moment(f.basename, lastPart, true);
        if (strict.isValid()) {
          key = strict.format('YYYY-MM-DD');
        } else {
          const r = f.basename.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (r) key = r[0];
        }
        if (key) bump(key, Math.max(1, Math.round(f.stat.size / 500)));   /* longer entries count for more */
      }
    } else if (metric === 'created') {
      for (const f of files) bump(dayKey(f.stat.ctime), 1);
    } else {
      for (const f of files) bump(dayKey(f.stat.mtime), 1);
      if (metric === 'edits') {
        for (const k of Object.keys(this.activity)) m.set(k, Math.max(m.get(k) || 0, this.activity[k]));
      }
    }
    return m;
  }

  /* ── refreshing ────────────────────────────────────────────────────────── */

  /* ids = list of section ids, or null for all of them */
  refreshSoon(ids, delay) {
    if (!this.views.size) return;
    if (ids === null) this.pendingAll = true;
    else ids.forEach((id) => this.pending.add(id));
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      const which = this.pendingAll ? null : new Set(this.pending);
      this.pending.clear();
      this.pendingAll = false;
      for (const view of this.views) view.refresh(which);
    }, delay == null ? 300 : delay);
  }

  /* a page that was hidden while things changed catches up when it comes back */
  wakeViews() {
    for (const view of this.views) {
      if (view.dirty && view.contentEl.isShown()) {
        view.dirty = false;
        view.refresh(null);
      }
    }
  }

  restyleAll() { for (const view of this.views) view.restyle(); }

  rebuildAll() {
    this.syncRibbon();
    this.probe();
    for (const view of this.views) view.build();
  }

  persist() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveAll(), 600);
  }

  async saveAll() {
    await this.saveData({
      v: 2,
      settings: this.settings,
      opened: this.opened,
      activity: this.activity,
      history: this.history.slice(-60),
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   the page
   ═══════════════════════════════════════════════════════════════════════ */

const NOTE_CMDS = new Set(['open', 'cat', 'edit', 'vim', 'less']);

const tokenise = (text) => {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  return out;
};

const commonPrefix = (list) => {
  if (!list.length) return '';
  let p = list[0];
  for (const w of list) while (!w.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
  return p;
};

const setClassGroup = (node, prefix, value) => {
  for (const c of Array.from(node.classList)) if (c.indexOf(prefix) === 0) node.classList.remove(c);
  node.classList.add(prefix + value);
};

const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

class HomeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.uid = ++UID;
    this.refs = {};
    this.dirty = false;
    this.quoteSeed = Math.random();
    this.minute = 0;
    this.cmds = this.defineCommands();
  }

  get s() { return this.plugin.settings; }

  getViewType() { return VIEW_TYPE; }

  getDisplayText() { return this.s.tabTitle || 'home'; }

  getIcon() { return 'terminal'; }

  async onOpen() {
    this.plugin.views.add(this);
    /* "/" jumps to the prompt, like a search box on a website */
    this.registerDomEvent(this.contentEl, 'keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (this.focusShell()) e.preventDefault();
    });
    this.build();
    if (this.s.focusShell) window.setTimeout(() => this.focusShell(), 80);
  }

  async onClose() {
    this.stop();
    this.plugin.views.delete(this);
  }

  stop() {
    if (this.streakRO) { this.streakRO.disconnect(); this.streakRO = null; }
    if (this.fitRO) { this.fitRO.disconnect(); this.fitRO = null; }
    if (this.fitRaf) { cancelAnimationFrame(this.fitRaf); this.fitRaf = 0; }
  }

  /* ── fitting the page to the tab ───────────────────────────────────────────
     the home page should never need scrolling. the card is laid out at the width it will end up
     with, measured, and when it is too tall it is scaled down (and laid out wider by the same
     factor, so it still fills the same width and needs fewer lines). if even the smallest allowed
     scale is not enough, scrolling comes back, because unreachable content is worse. */
  scheduleFit() {
    if (this.fitRaf) return;
    this.fitRaf = requestAnimationFrame(() => {
      this.fitRaf = 0;
      if (this.contentEl.isShown()) this.fit();
    });
  }

  fit() {
    const scroll = this.scrollEl;
    const card = this.cardEl;
    if (!scroll || !card) return;
    const L = this.s.layout;
    card.style.width = '';
    card.style.margin = '';
    card.style.transform = '';
    card.style.transformOrigin = '';
    scroll.classList.remove('is-overflow');
    this.contentEl.classList.toggle('mh-fit', L.fit === 'shrink');
    if (L.fit !== 'shrink') return;

    const cs = (scroll.ownerDocument.defaultView || window).getComputedStyle(scroll);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const availW = scroll.clientWidth - padX;
    const availH = scroll.clientHeight - padY;
    if (!(availW > 80 && availH > 80)) return;       /* not laid out yet */

    const baseW = Math.min(availW, L.width);
    const floor = L.minScale / 100;
    let k = 1;
    let h = 0;
    for (let i = 0; i < 5; i++) {
      card.style.width = (baseW / k) + 'px';
      h = card.offsetHeight;
      const next = Math.min(1, Math.max(floor, availH / h));
      if (Math.abs(next - k) < 0.005) break;
      k = next;
    }

    const c = this.s.card;
    const offX = c.hAlign === 'left' ? 0 : Math.max(0, (availW - baseW) / 2);
    const offY = c.vAlign === 'top' ? 0 : Math.max(0, (availH - h * k) / 2);
    card.style.transformOrigin = '0 0';
    card.style.transform = k < 1 ? 'scale(' + k + ')' : '';
    /* the negative bottom margin cancels the room the unscaled box would take */
    card.style.margin = offY + 'px 0 ' + (h * k - h) + 'px ' + offX + 'px';
    if (h * k > availH + 1) scroll.classList.add('is-overflow');
  }

  focusShell() {
    const sh = this.refs.shell;
    if (!sh || !sh.input) return false;
    sh.input.focus();
    return true;
  }

  /* ── building ──────────────────────────────────────────────────────────── */

  build() {
    const s = this.s;
    const host = this.contentEl;
    this.stop();
    host.empty();
    host.classList.add('mh-root');
    this.containerEl.classList.toggle('mh-nohead', !!s.hideHeader);
    this.refs = {};
    this.clockEl = null;
    this.upEl = null;

    const scroll = el('div', 'mh-scroll');
    const card = el('div', 'mh');
    this.bar = el('div', 'mh-bar');
    card.appendChild(this.bar);

    const grid = el('div', 'mh-grid');
    const active = s.sections.filter((it) => it.on);
    for (const it of active) grid.appendChild(this.makeSection(it));
    if (!active.length) grid.appendChild(el('div', 'mh-hint is-wide', '# every section is switched off. open settings > mish.home.'));
    card.appendChild(grid);
    scroll.appendChild(card);
    host.appendChild(scroll);
    this.scrollEl = scroll;
    this.cardEl = card;
    if (typeof ResizeObserver === 'function') {
      this.fitRO = new ResizeObserver(() => this.scheduleFit());
      this.fitRO.observe(scroll);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.scheduleFit());

    this.restyle();
    this.drawBar();
    for (const it of active) this.fill(it.id);
  }

  restyle() {
    const s = this.s;
    const host = this.contentEl;
    const vars = Object.assign({}, paletteVars(s), layoutVars(s));
    const font = fontStack(s);
    if (font) vars['--vf-mono'] = font;
    vars['--mh-outlines'] = String(s.shell.outputLines);
    applyVars(host, vars);
    setClassGroup(host, 'mh-shape-', s.pillShape);
    setClassGroup(host, 'mh-frame-', s.layout.frame);
    host.classList.toggle('mh-lower', s.lowercaseText);
    host.classList.toggle('mh-nocmd', !s.showCommands);
    if (this.leaf && this.leaf.updateHeader) this.leaf.updateHeader();     /* picks up a new tab title */
    this.scheduleFit();
  }

  makeSection(it) {
    const sec = el('div', 'mh-sec mh-sec-' + it.id + (it.wide ? ' is-wide' : ''));
    sec.dataset.id = it.id;
    const refs = { sec };
    const cmd = this.s.showCommands ? this.cmdFor(it.id) : null;
    if (cmd) {
      const line = el('div', 'mh-cmd');
      line.appendChild(el('span', 'mh-chev', '❯'));
      line.appendChild(el('span', 'mh-exe', cmd[0]));
      refs.arg = el('span', 'mh-arg', cmd[1]);
      line.appendChild(refs.arg);
      sec.appendChild(line);
    }
    refs.body = el('div', 'mh-body');
    sec.appendChild(refs.body);
    this.refs[it.id] = refs;
    return sec;
  }

  /* the command each section pretends to have run */
  cmdFor(id) {
    const s = this.s;
    switch (id) {
      case 'greeting': return ['hello', ''];
      case 'shortcuts': return ['launch', ''];
      case 'fetch': return ['fastfetch', ''];
      case 'recent': {
        const sort = { opened: 'accessed', edited: 'modified', created: 'created' }[s.recent.mode];
        return ['eza', '--tree --sort=' + sort + ' -r -n' + s.recent.count];
      }
      case 'pinned': return ['pinned', ''];
      case 'tasks': return ['grep', '-rn "- [ ]"'];
      case 'streak': return ['streak', '--weeks=' + (s.streak.weeks || 'fit')];
      case 'quote': return ['fortune', ''];
      default: return null;
    }
  }

  fill(id) {
    const r = this.refs[id];
    const fn = this['fill_' + id];
    if (!r || !fn) return;
    try {
      const out = fn.call(this, r.body);
      if (out && out.then) out.then(() => this.scheduleFit(), (e) => this.broke(id, e));
      else this.scheduleFit();
    } catch (e) {
      this.broke(id, e);
    }
  }

  broke(id, e) {
    console.error('mish.home: ' + id + ' failed', e);
    const r = this.refs[id];
    if (r) r.body.replaceChildren(el('div', 'mh-hint is-bad', '# ' + id + ' broke: ' + ((e && e.message) || 'unknown error')));
  }

  /* ids = Set of section ids, or null for every data section. the shell is never redrawn
     (you may be typing in it) */
  refresh(ids) {
    if (!this.contentEl.isShown()) { this.dirty = true; return; }
    for (const id of Object.keys(this.refs)) {
      if (id === 'shell') continue;
      if (!ids || ids.has(id)) this.fill(id);
    }
  }

  tick() {
    if (!this.contentEl.isShown()) return;
    if (this.clockEl) setText(this.clockEl, this.clockText());
    if (this.upEl) setText(this.upEl, fmtUp(performance.now()));
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== this.minute) {
      this.minute = minute;
      if (this.refs.greeting) this.fill('greeting');
    }
  }

  userName() { return this.s.username || this.plugin.detected.user; }

  hint(text, cls) { return el('div', 'mh-hint' + (cls ? ' ' + cls : ''), '# ' + text); }

  /* ── the powerline prompt ──────────────────────────────────────────────── */

  clockText() {
    const d = new Date();
    const { hour12, seconds } = this.s.clock;
    const h = d.getHours();
    return '\uF43A ' + pad(hour12 ? h % 12 || 12 : h) + ':' + pad(d.getMinutes()) +
      (seconds ? ':' + pad(d.getSeconds()) : '') + (hour12 ? (h >= 12 ? ' pm' : ' am') : '');
  }

  drawBar() {
    const bar = this.bar;
    if (!bar) return;
    const s = this.s;
    const p = s.pills;
    bar.replaceChildren();
    this.clockEl = null;
    const seg = (cls, text) => { const n = el('span', 'mh-seg ' + cls, text); bar.appendChild(n); return n; };

    if (p.user) seg('mh-user', osGlyph() + ' ' + this.userName());
    if (p.path) seg('mh-path', s.pathLabel || '~/' + this.app.vault.getName());
    const git = p.git && this.plugin.branch;
    if (git) seg('mh-git', this.plugin.branch);
    if (p.time) {
      if (!git) seg('mh-ch mh-ch1', '');
      seg('mh-ch mh-ch2', '');
      seg('mh-ch mh-ch3', '');
      this.clockEl = seg('mh-time', this.clockText());
    }
    bar.classList.toggle('is-empty', !bar.childNodes.length);
  }

  /* ── banner ────────────────────────────────────────────────────────────── */

  fill_banner(body) {
    const b = this.s.banner;
    body.replaceChildren();
    body.classList.toggle('is-centre', b.align === 'centre');
    let text = this.app.vault.getName();
    if (b.source === 'name') text = this.userName();
    else if (b.source === 'custom' && b.custom.trim()) text = b.custom.trim();
    if (b.style === 'text') {
      body.appendChild(el('div', 'mh-btext mh-grad-' + b.gradient, text));
      return;
    }
    const svg = bannerSvg(text, this.uid, b.gradient, b.letters);
    if (svg) body.appendChild(svg);
  }

  /* ── greeting ──────────────────────────────────────────────────────────── */

  greetWord(h) {
    if (h >= 5 && h < 12) return 'good morning';
    if (h >= 12 && h < 17) return 'good afternoon';
    if (h >= 17 && h < 22) return 'good evening';
    return 'still up';
  }

  fill_greeting(body) {
    const g = this.s.greeting;
    body.replaceChildren();
    const now = new Date();
    const text = g.template.replace(/\{(greeting|name|vault|time|date)\}/g, (m, key) => {
      switch (key) {
        case 'greeting': return this.greetWord(now.getHours());
        case 'name': return this.userName();
        case 'vault': return this.app.vault.getName();
        case 'time': return pad(now.getHours()) + ':' + pad(now.getMinutes());
        default: return moment().format('YYYY-MM-DD');
      }
    });
    body.appendChild(el('div', 'mh-hello', text));
    if (g.showDate) body.appendChild(el('div', 'mh-date', moment().format(g.dateFormat || 'dddd · D MMMM YYYY')));

    /* progress bars: each is a row of little cells, coloured along the rainbow */
    const minutes = now.getHours() * 60 + now.getMinutes();
    const startDow = this.s.weekStart === 'sun' ? 0 : 1;
    const dow = (now.getDay() - startDow + 7) % 7;
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const y0 = new Date(now.getFullYear(), 0, 1).getTime();
    const y1 = new Date(now.getFullYear() + 1, 0, 1).getTime();
    const fracs = {
      day: minutes / 1440,
      week: (dow * 1440 + minutes) / (7 * 1440),
      month: ((now.getDate() - 1) * 1440 + minutes) / (dim * 1440),
      year: (now.getTime() - y0) / (y1 - y0),
    };
    const N = g.barWidth;
    for (const key of ['day', 'week', 'month', 'year']) {
      if (!g.progress[key]) continue;
      const row = el('div', 'mh-prog');
      row.appendChild(el('span', 'mh-pk', key));
      const bar = el('span', 'mh-pbar');
      const on = Math.round(fracs[key] * N);
      for (let i = 0; i < N; i++) {
        bar.appendChild(el('i', (i < on ? 'on ' : '') + 'mh-c' + Math.min(COLOURS - 1, Math.floor((i / N) * COLOURS))));
      }
      row.appendChild(bar);
      row.appendChild(el('span', 'mh-pv', Math.floor(fracs[key] * 100) + '%'));
      body.appendChild(row);
    }
  }

  /* ── shortcuts ─────────────────────────────────────────────────────────── */

  fill_shortcuts(body) {
    const sc = this.s.shortcuts;
    body.replaceChildren();
    let items = parseShortcuts(sc.items);
    if (sc.hideMissing) items = items.filter((it) => this.app.commands.commands[it.id]);
    if (!items.length) { body.appendChild(this.hint('no shortcuts. add some in settings.')); return; }
    body.classList.toggle('is-row', sc.layout === 'row');
    items.forEach((it, i) => {
      const known = Boolean(this.app.commands.commands[it.id]);
      const row = el('div', 'mh-sc' + (known ? '' : ' is-missing'));
      row.appendChild(el('span', 'mh-chev mh-c' + (i % COLOURS), '❯'));
      row.appendChild(el('span', 'mh-sclabel' + (sc.colour === 'rainbow' ? ' mh-c' + (i % COLOURS) : ''), it.label));
      if (sc.hotkeys && known) {
        const hk = this.plugin.hotkeyFor(it.id);
        if (hk) row.appendChild(el('span', 'mh-kbd', hk));
      }
      row.title = known ? it.id : 'no command called ' + it.id;
      row.addEventListener('click', () => this.plugin.runCommand(it.id));
      body.appendChild(row);
    });
  }

  /* ── fastfetch ─────────────────────────────────────────────────────────── */

  fill_fetch(body) {
    const f = this.s.fetch;
    body.replaceChildren();
    this.upEl = null;
    const st = this.plugin.vaultStats();
    const rows = [];
    const on = f.fields;
    if (on.user) rows.push(['user', this.userName() + '@' + this.plugin.detected.host]);
    if (on.os) rows.push(['os', osName() + ' · obsidian', true]);
    if (on.app) rows.push(['app', 'obsidian ' + (obsidian.apiVersion || '?'), true]);
    if (on.vault) {
      let path = this.app.vault.getName();
      try { path = this.app.vault.adapter.getBasePath() || path; } catch (e) { /* not a desktop adapter */ }
      rows.push(['vault', path, false, false, true]);
    }
    if (on.notes) rows.push(['notes', String(st.notes)]);
    if (on.links) rows.push(['links', String(st.links)]);
    if (on.tags) rows.push(['tags', String(st.tags)]);
    if (on.folders) rows.push(['folders', String(st.folders)]);
    if (on.files) rows.push(['files', String(st.files)]);
    if (on.size) rows.push(['size', fmtSize(st.size), true]);
    if (on.theme) rows.push(['theme', (this.app.customCss && this.app.customCss.theme) || 'default']);
    if (on.plugins) rows.push(['plugins', String(Object.keys((this.app.plugins && this.app.plugins.plugins) || {}).length)]);
    if (on.uptime) rows.push(['uptime', fmtUp(performance.now()), false, true]);

    const kv = el('div', 'mh-kv');
    for (const [k, v, dim, live, keep] of rows) {
      kv.appendChild(el('span', 'mh-k', k));
      const val = el('span', 'mh-v' + (dim ? ' is-dim' : '') + (keep ? ' mh-keep' : ''), v);
      if (live) this.upEl = val;
      kv.appendChild(val);
    }
    body.appendChild(kv);
    if (f.colourBar) {
      const pal = el('div', 'mh-pal');
      pal.appendChild(el('i', 'mh-pal-dark'));
      for (let i = 0; i < COLOURS; i++) pal.appendChild(el('i', 'mh-bg' + i));
      pal.appendChild(el('i', 'mh-pal-light'));
      body.appendChild(pal);
    }
    if (!rows.length && !f.colourBar) body.appendChild(this.hint('every field is switched off.'));
  }

  /* ── file lists: recent and pinned ─────────────────────────────────────── */

  labelFor(file, mode) {
    return mode === 'hide' && file.extension === 'md' ? file.basename : file.name;
  }

  nameClass(file, i, mode) {
    if (mode === 'rainbow') return ' mh-c' + (i % COLOURS);
    if (mode === 'type') return ' mh-c' + kindColour(file);
    return '';
  }

  renderFiles(body, entries, o) {
    const list = el('div', 'mh-tree');
    entries.forEach((e, i) => {
      const f = e.file;
      const row = el('div', 'mh-row' + (i === entries.length - 1 ? ' is-last' : '') + (f ? '' : ' is-missing'));
      if (o.tree !== false) row.appendChild(el('span', 'mh-tl'));
      else row.appendChild(el('span', 'mh-bullet mh-c' + (i % COLOURS), '❯'));
      const label = e.label || (f ? this.labelFor(f, o.extensions) : e.path);
      row.appendChild(el('span', 'mh-name' + this.nameClass(f, i, o.nameColour), label));
      if (o.folder && f && f.parent && !f.parent.isRoot()) row.appendChild(el('span', 'mh-sub', f.parent.path));
      if (o.age && f) row.appendChild(el('span', 'mh-age', ageOf(f.stat.mtime)));
      row.title = f ? f.path : e.path + ' (not found)';
      if (f) row.addEventListener('click', (ev) => this.plugin.openFile(f, ev));
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  fill_recent(body) {
    const r = this.s.recent;
    body.replaceChildren();
    const ex = parseList(this.s.exclude);
    const vault = this.app.vault;
    const pool = (r.types === 'all' ? vault.getFiles() : vault.getMarkdownFiles())
      .filter((f) => f.path[0] !== '.' && !isExcluded(f.path, ex));
    const byPath = new Map(pool.map((f) => [f.path, f]));
    const out = [];
    const seen = new Set();
    const take = (f) => {
      if (f && !seen.has(f.path) && out.length < r.count) { seen.add(f.path); out.push({ file: f }); }
    };
    if (r.mode === 'opened') for (const p of this.plugin.opened) take(byPath.get(p));
    if (out.length < r.count) {
      const key = r.mode === 'created' ? (f) => f.stat.ctime : (f) => f.stat.mtime;
      pool.slice().sort((a, b) => key(b) - key(a)).forEach(take);   /* the rest of the list is filled with the newest */
    }
    if (!out.length) { body.appendChild(this.hint('nothing here yet. write something.')); return; }
    this.renderFiles(body, out, r);
  }

  fill_pinned(body) {
    const p = this.s.pinned;
    body.replaceChildren();
    const vault = this.app.vault;
    const entries = [];
    const seen = new Set();
    const add = (file, label, path) => {
      const key = file ? file.path : 'missing:' + path;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ file, label, path });
    };
    for (const line of String(p.paths || '').split('\n')) {
      const t = line.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
      if (!t || t[0] === '#') continue;
      const np = normalizePath(t);
      const f = vault.getAbstractFileByPath(np) || vault.getAbstractFileByPath(np + '.md') ||
        this.app.metadataCache.getFirstLinkpathDest(t.replace(/\.md$/i, ''), '');
      add(f instanceof TFile ? f : null, null, t);
    }
    if (p.bookmarks) {
      try {
        const bm = this.app.internalPlugins.getPluginById('bookmarks');
        if (bm && bm.enabled && bm.instance) {
          const walk = (items) => {
            for (const it of items || []) {
              if (it.type === 'file') {
                const f = vault.getAbstractFileByPath(it.path);
                if (f instanceof TFile) add(f, it.title || null, it.path);
              } else if (it.type === 'group') walk(it.items);
            }
          };
          walk(bm.instance.items);
        }
      } catch (e) { /* bookmarks are optional */ }
    }
    if (!entries.length) { body.appendChild(this.hint('nothing pinned. add notes in settings, or bookmark some.')); return; }
    this.renderFiles(body, entries, p);
  }

  /* ── todo ──────────────────────────────────────────────────────────────── */

  async fill_tasks(body) {
    const t = this.s.tasks;
    const token = (this.taskToken = (this.taskToken || 0) + 1);
    const data = await this.plugin.collectTasks();
    if (token !== this.taskToken || !body.isConnected) return;     /* a newer redraw is on its way */
    body.replaceChildren();
    if (!data.total) { body.appendChild(this.hint('nothing to do. suspicious.')); return; }

    const sum = el('div', 'mh-sum');
    sum.appendChild(el('span', 'mh-t3', String(data.total)));
    sum.appendChild(document.createTextNode(' open · ' + data.noteCount + (data.noteCount === 1 ? ' note' : ' notes')));
    body.appendChild(sum);

    for (const task of data.items) {
      const row = el('div', 'mh-task');
      const box = el('span', 'mh-box', '[ ]');
      const text = el('span', 'mh-ttext', task.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/[*_`]/g, ''));
      row.appendChild(box);
      row.appendChild(text);
      if (t.showNote) row.appendChild(el('span', 'mh-tnote', task.file.basename));
      row.title = task.file.path;
      text.addEventListener('click', (ev) => this.plugin.openFile(task.file, ev, task.line));
      if (t.complete) {
        box.title = ui('tick it');
        box.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const ok = await this.plugin.tickTask(task);
          if (ok) {
            row.classList.add('is-done');
            setText(box, '[x]');
            this.plugin.refreshSoon(['tasks'], 1200);
          } else new Notice(ui('that line changed. open the note to tick it.'));
        });
      } else box.classList.add('is-static');
      body.appendChild(row);
    }
    if (data.total > data.items.length) body.appendChild(el('div', 'mh-hint', '# +' + (data.total - data.items.length) + ' more'));
  }

  /* ── streak ────────────────────────────────────────────────────────────── */

  fill_streak(body) {
    const st = this.s.streak;
    body.replaceChildren();
    const counts = this.plugin.dayCounts(st.metric);
    const unit = { edits: 'edits', modified: 'notes', created: 'notes', daily: 'entries' }[st.metric];

    const labelW = st.dayLabels ? 30 : 0;
    const avail = body.clientWidth;
    let W = st.weeks;
    if (!W) W = avail > 40 ? Math.floor((avail - labelW + st.gap) / (st.cell + st.gap)) : 26;
    W = Math.max(4, Math.min(53, W));
    if (this.refs.streak && this.refs.streak.arg) setText(this.refs.streak.arg, '--weeks=' + W);

    /* fit mode follows the width of the card */
    if (!this.streakRO && typeof ResizeObserver === 'function') {
      this.streakW = avail;
      this.streakRO = new ResizeObserver(() => {
        const w = body.clientWidth;
        if (this.s.streak.weeks === 0 && Math.abs(w - (this.streakW || 0)) > 2) {
          this.streakW = w;
          requestAnimationFrame(() => this.fill('streak'));
        }
      });
      this.streakRO.observe(body);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDow = this.s.weekStart === 'sun' ? 0 : 1;
    const dow = (today.getDay() - startDow + 7) % 7;
    const first = new Date(today);
    first.setDate(first.getDate() - dow - (W - 1) * 7);

    /* streaks: today may still be empty without breaking it */
    const has = (d) => (counts.get(dayKey(d.getTime())) || 0) > 0;
    let current = 0;
    const cursor = new Date(today);
    if (!has(cursor)) cursor.setDate(cursor.getDate() - 1);
    while (has(cursor) && current < 5000) { current++; cursor.setDate(cursor.getDate() - 1); }
    let best = 0;
    const keys = Array.from(counts.keys()).filter((k) => counts.get(k) > 0).sort();
    if (keys.length) {
      const d = parseKey(keys[0]);
      let run = 0;
      let guard = 0;
      while (d <= today && guard++ < 5000) {
        if (has(d)) { run++; if (run > best) best = run; } else run = 0;
        d.setDate(d.getDate() + 1);
      }
    }

    /* levels by quartile, so one huge day does not wash out the rest */
    const vals = Array.from(counts.values()).filter((n) => n > 0).sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))];
    const q1 = q(0.25);
    const q2 = q(0.5);
    const q3 = q(0.75);
    const level = (n) => (n <= 0 ? 0 : n <= q1 ? 1 : n <= q2 ? 2 : n <= q3 ? 3 : 4);

    const cells = [];
    let windowTotal = 0;
    const monthAt = [];
    for (let w = 0; w < W; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(first);
        date.setDate(first.getDate() + w * 7 + d);
        const future = date > today;
        const key = dayKey(date.getTime());
        const n = future ? 0 : counts.get(key) || 0;
        windowTotal += n;
        const cell = el('i', 'mh-cell' + (future ? ' is-future' : ' lv-' + level(n)));
        if (!future) cell.title = key + ' · ' + n + ' ' + unit;
        cells.push(cell);
        if (d === 0) monthAt.push(date.getMonth());
      }
    }

    if (st.summary) {
      const sum = el('div', 'mh-sum');
      sum.appendChild(el('span', 'mh-t3', current + 'd'));
      sum.appendChild(document.createTextNode(' streak · best '));
      sum.appendChild(el('span', 'mh-t1', best + 'd'));
      sum.appendChild(document.createTextNode(' · '));
      sum.appendChild(el('span', 'mh-t0', String(windowTotal)));
      sum.appendChild(document.createTextNode(' ' + unit + ' in ' + W + 'w'));
      body.appendChild(sum);
    }

    const wrap = el('div', 'mh-heatwrap');
    if (st.dayLabels) {
      const days = el('div', 'mh-days');
      for (let r = 0; r < 7; r++) {
        const name = DAYS[(startDow + r) % 7];
        days.appendChild(el('span', '', ['mon', 'wed', 'fri'].includes(name) ? name : ''));
      }
      if (st.monthLabels) wrap.appendChild(el('span', 'mh-corner'));
      wrap.appendChild(days);
    }
    const col = el('div', 'mh-heatcol');
    if (st.monthLabels) {
      const months = el('div', 'mh-months');
      let lastShown = -9;
      for (let w = 0; w < W; w++) {
        const changed = w === 0 || monthAt[w] !== monthAt[w - 1];
        const show = changed && w - lastShown >= 3;
        if (show) lastShown = w;
        months.appendChild(el('span', '', show ? MONTHS[monthAt[w]] : ''));
      }
      col.appendChild(months);
    }
    const heat = el('div', 'mh-heat mh-heat-' + st.colour);
    heat.style.gridTemplateColumns = 'repeat(' + W + ', var(--mh-cell))';
    cells.forEach((c) => heat.appendChild(c));
    col.appendChild(heat);
    wrap.appendChild(col);
    body.appendChild(wrap);
  }

  /* ── fortune ───────────────────────────────────────────────────────────── */

  fill_quote(body) {
    body.replaceChildren();
    const lines = String(this.s.quote.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { body.appendChild(this.hint('no lines. add some in settings.')); return; }
    let at;
    if (this.s.quote.mode === 'random') {
      at = Math.floor(this.quoteSeed * lines.length);
    } else {
      let h = 0;
      for (const ch of dayKey(Date.now())) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      at = h % lines.length;
    }
    body.appendChild(el('div', 'mh-quote', lines[at]));
  }

  /* ── the shell ─────────────────────────────────────────────────────────── */

  say(text, kind) {
    const sh = this.refs.shell;
    if (!sh || !sh.out) return;
    sh.out.className = 'mh-out' + (kind ? ' is-' + kind : '');
    sh.out.textContent = Array.isArray(text) ? text.join('\n') : String(text == null ? '' : text);
  }

  paintLine(host, text) {
    host.replaceChildren();
    const re = /("[^"]*"?|'[^']*'?|\s+|[^\s"']+)/g;
    let m;
    let first = true;
    while ((m = re.exec(text))) {
      const part = m[0];
      if (/^\s+$/.test(part)) { host.appendChild(document.createTextNode(part)); continue; }
      const span = document.createElement('span');
      if (first) span.className = this.cmds[part.toLowerCase()] ? 'mh-hl-cmd' : 'mh-hl-bad';
      else if (/^["']/.test(part)) span.className = 'mh-hl-str';
      else if (/^-/.test(part)) span.className = 'mh-hl-flag';
      first = false;
      span.textContent = part;
      host.appendChild(span);
    }
  }

  fill_shell(body) {
    body.replaceChildren();
    const out = el('div', 'mh-out');
    out.addEventListener('click', () => this.say(''));       /* click the output to dismiss it */
    body.appendChild(out);

    const line = el('div', 'mh-line');
    line.appendChild(el('span', 'mh-chev', '❯'));
    const input = el('input', 'mh-input');
    input.type = 'text';
    input.placeholder = this.s.shell.placeholder;
    input.spellcheck = false;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');

    /* the text is drawn twice: the input's own copy is transparent, a coloured copy sits behind it,
       and the caret is a hand-drawn block (same trick as mish.eza) */
    const wrap = el('div', 'mh-inwrap');
    const hl = el('div', 'mh-hl');
    const hlIn = el('span', 'mh-hl-in');
    const meas = el('span', 'mh-hl-meas');
    const caret = el('div', 'mh-caret');
    hl.appendChild(hlIn);
    hl.appendChild(meas);
    hl.appendChild(caret);
    wrap.appendChild(hl);
    wrap.appendChild(input);
    line.appendChild(wrap);
    body.appendChild(line);

    const paint = () => {
      try { this.paintLine(hlIn, input.value); } catch (e) { hlIn.textContent = input.value; }
      hlIn.style.transform = 'translateX(' + (-input.scrollLeft) + 'px)';
      const v = input.value;
      const pos = input.selectionStart == null ? v.length : input.selectionStart;
      meas.textContent = v.slice(0, pos);
      const x = meas.getBoundingClientRect().width - input.scrollLeft;
      caret.style.transform = 'translate(' + x + 'px, -50%)';
      caret.textContent = v.charAt(pos);
      caret.style.animation = 'none';
      void caret.offsetWidth;
      caret.style.animation = '';
      wrap.classList.toggle('is-empty', !v);
      wrap.classList.toggle('has-sel', input.selectionStart !== input.selectionEnd);
      wrap.classList.toggle('is-focus', input.ownerDocument.activeElement === input);
    };
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); paint(); },
    });
    ['input', 'scroll', 'keyup', 'mouseup', 'focus', 'blur', 'select'].forEach((ev) => input.addEventListener(ev, paint));
    input.addEventListener('keydown', () => requestAnimationFrame(paint));
    paint();

    /* enter runs, tab completes, up/down walk the history, escape clears */
    let at = -1;
    const hist = this.plugin.history;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value;
        input.value = '';
        at = -1;
        this.exec(value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.complete(input);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hist.length) return;
        at = Math.min(at + 1, hist.length - 1);
        input.value = hist[hist.length - 1 - at];
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        at = Math.max(at - 1, -1);
        input.value = at < 0 ? '' : hist[hist.length - 1 - at];
      } else if (e.key === 'Escape') {
        input.value = '';
        at = -1;
        this.say('');
        input.blur();
      }
    });
    line.addEventListener('mousedown', (e) => {
      if (e.target !== input) { e.preventDefault(); input.focus(); }
    });

    this.refs.shell.out = out;
    this.refs.shell.input = input;
  }

  complete(input) {
    const v = input.value;
    const pos = input.selectionStart == null ? v.length : input.selectionStart;
    const before = v.slice(0, pos);
    const after = v.slice(pos);

    const first = before.match(/^(\s*)(\S*)$/);
    if (first) {
      const word = first[2].toLowerCase();
      const names = Object.keys(this.cmds).filter((n) => n.startsWith(word));
      if (!names.length) return;
      if (names.length === 1) input.value = first[1] + names[0] + ' ' + after;
      else { input.value = first[1] + commonPrefix(names) + after; this.say(names.join('  ')); }
      return;
    }

    const m = before.match(/^(\s*)(\S+)\s+(.*)$/);
    if (!m || !NOTE_CMDS.has(m[2].toLowerCase())) return;
    const q = m[3].replace(/^["']/, '').toLowerCase();
    const names = Array.from(new Set(this.app.vault.getMarkdownFiles().map((f) => f.basename)))
      .filter((n) => n.toLowerCase().startsWith(q))
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) return;
    const wrapName = (n) => (/\s/.test(n) ? '"' + n : n);
    if (names.length === 1) {
      input.value = m[1] + m[2] + ' ' + (/\s/.test(names[0]) ? '"' + names[0] + '"' : names[0]);
    } else {
      const cp = commonPrefix(names);
      input.value = m[1] + m[2] + ' ' + wrapName(cp.length >= q.length ? cp : q);
      this.say(names.slice(0, 12).join('\n') + (names.length > 12 ? '\n… +' + (names.length - 12) : ''));
    }
  }

  async exec(line) {
    const raw = line.trim();
    if (!raw) return;
    const hist = this.plugin.history;
    if (hist[hist.length - 1] !== raw) hist.push(raw);
    this.plugin.persist();

    const tokens = tokenise(raw);
    const name = tokens[0].toLowerCase();
    const cmd = this.cmds[name];
    if (!cmd) { this.say('zsh: command not found: ' + tokens[0], 'bad'); return; }
    try {
      await cmd.run(tokens.slice(1), raw.slice(raw.indexOf(tokens[0]) + tokens[0].length).trim());
    } catch (e) {
      console.error(e);
      this.say(name + ': ' + ((e && e.message) || 'failed'), 'bad');
    }
  }

  /* a note by name: opens it when there is one clear match, lists them when there are several */
  async openByName(query) {
    if (!query) { this.say('open: which note?', 'bad'); return; }
    const hits = this.plugin.findNotes(query);
    if (!hits.length) { this.say('open: no note called ' + query, 'bad'); return; }
    if (hits.length > 1 && hits[0].basename.toLowerCase() !== query.toLowerCase()) {
      this.say(hits.slice(0, 8).map((f) => f.path).concat(hits.length > 8 ? ['… +' + (hits.length - 8)] : []).concat(['(be more specific)']));
      return;
    }
    this.say('');
    await this.plugin.openFile(hits[0]);
  }

  defineCommands() {
    const plugin = this.plugin;
    const cmds = {};
    const def = (names, desc, run, hidden) => {
      [].concat(names).forEach((n, i) => { cmds[n] = { desc, run, alias: hidden || i > 0, usage: [].concat(names)[0] }; });
    };

    def('help', 'this list', () => {
      const seen = new Set();
      const rows = [];
      for (const key of Object.keys(cmds)) {
        const c = cmds[key];
        if (c.alias || seen.has(c.usage)) continue;
        seen.add(c.usage);
        rows.push(key.padEnd(10) + c.desc);
      }
      this.say(rows.concat(['', 'tab completes. up / down walk the history. esc clears.']));
    });

    def(['open', 'cat', 'edit', 'vim', 'less'], 'open a note by name: open "my note"', (args) => this.openByName(args.join(' ')));

    def(['new', 'touch'], 'make a note and open it: new [name]', async (args) => {
      const f = await plugin.createNote(args.join(' '));
      this.say('created ' + f.path);
    });

    def('daily', "open today's daily note", async () => { const f = await plugin.openDaily(); this.say('opened ' + f.path); });

    def('random', 'open a random note', async () => { const f = await plugin.openRandom(); if (f) this.say('opened ' + f.path); });

    def(['find', 'search', 'grep'], 'search the vault: find <text>', (args) => {
      const q = args.join(' ');
      if (!q) { this.say('find: what are we looking for?', 'bad'); return; }
      const gs = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('global-search');
      if (gs && gs.instance && gs.instance.openGlobalSearch) gs.instance.openGlobalSearch(q);
      else plugin.runCommand('global-search:open');
    });

    def(['recent', 'ls'], 'the notes you touched last: recent [n]', (args) => {
      const n = num(args[0], 1, 30, 8);
      const files = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, n);
      this.say(files.map((f) => ageOf(f.stat.mtime).padStart(4) + '  ' + f.path));
    });

    def('todo', 'open checkboxes', async () => {
      const d = await plugin.collectTasks();
      if (!d.total) { this.say('nothing to do. suspicious.'); return; }
      this.say([d.total + ' open in ' + d.noteCount + ' notes'].concat(d.items.map((t) => '[ ] ' + t.text + '   (' + t.file.basename + ')')));
    });

    def('streak', 'your current streak', () => {
      const counts = plugin.dayCounts(this.s.streak.metric);
      const has = (d) => (counts.get(dayKey(d.getTime())) || 0) > 0;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (!has(d)) d.setDate(d.getDate() - 1);
      let run = 0;
      while (has(d) && run < 5000) { run++; d.setDate(d.getDate() - 1); }
      this.say(run + ' day' + (run === 1 ? '' : 's') + ' in a row');
    });

    def(['stats', 'fastfetch', 'neofetch'], 'vault stats', () => {
      const st = plugin.vaultStats();
      this.say([
        'notes    ' + st.notes, 'links    ' + st.links, 'tags     ' + st.tags,
        'folders  ' + st.folders, 'files    ' + st.files, 'size     ' + fmtSize(st.size),
      ]);
    });

    def(['cmd', 'run'], 'run any obsidian command: cmd <name>', (args) => {
      const q = args.join(' ').toLowerCase();
      if (!q) { plugin.runCommand('command-palette:open'); return; }
      const all = Object.values(this.app.commands.commands);
      const exact = all.filter((c) => c.id.toLowerCase() === q || c.name.toLowerCase() === q);
      const hits = exact.length ? exact : all.filter((c) => c.name.toLowerCase().includes(q));
      if (!hits.length) { this.say('cmd: nothing matches ' + q, 'bad'); return; }
      if (hits.length > 1) { this.say(hits.slice(0, 8).map((c) => c.name).concat(['(be more specific)'])); return; }
      this.say('running ' + hits[0].name);
      plugin.runCommand(hits[0].id);
    });

    def('settings', 'open the settings for this plugin', () => {
      this.app.setting.open();
      this.app.setting.openTabById(PLUGIN_ID);
    });

    def('palette', 'change the colours: palette <name>', (args) => {
      const names = ['mish'].concat(Object.keys(PALETTES));
      const want = (args[0] || '').toLowerCase();
      if (!names.includes(want)) { this.say('palettes: ' + names.join(', ')); return; }
      const p = this.s.palette;
      if (want === 'mish') p.preset = 'theme';
      else { p.preset = want; p.colours = PALETTES[want].slice(); }
      plugin.restyleAll();
      plugin.persist();
      this.say('palette: ' + want);
    });

    def('reload', 'redraw the page', () => plugin.rebuildAll());
    def('clear', 'clear the output', () => this.say(''));
    def('date', 'the date', () => {
      const d = new Date();
      let zone = '';
      try {
        const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((x) => x.type === 'timeZoneName');
        zone = part ? ' ' + part.value : '';
      } catch (e) { zone = ''; }
      this.say(moment(d).format('ddd D MMM HH:mm:ss') + zone + ' ' + d.getFullYear());
    });
    def('uptime', 'how long obsidian has been open', () => this.say('up ' + fmtUp(performance.now())));
    def('whoami', 'you', () => this.say(this.userName()));
    def('pwd', 'where you are', () => this.say(this.s.pathLabel || '~/' + this.app.vault.getName()));
    def('echo', 'say something back', (args, rest) => this.say(rest));
    def('fortune', 'a line from your list', () => {
      const lines = String(this.s.quote.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
      this.say(lines.length ? lines[Math.floor(Math.random() * lines.length)] : 'no lines. add some in settings.');
    });
    def('history', 'what you typed before', () => this.say(plugin.history.slice(-15).map((h, i, a) => String(plugin.history.length - a.length + i + 1).padStart(3) + '  ' + h)));
    def(['exit', 'quit', 'q'], 'close this tab', () => this.leaf.detach());

    /* things a real shell has that this one does not */
    def('sudo', '', () => this.say(this.userName() + ' is not in the sudoers file. this incident will be reported.', 'bad'), true);
    def('cd', '', () => this.say('cd: you live here now.'), true);
    def('rm', '', () => this.say("rm: not from here. that's mish.eza's job.", 'bad'), true);
    return cmds;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   settings
   ═══════════════════════════════════════════════════════════════════════ */
class HomeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.scanned = [];
  }

  /* redraws the tab without jumping back to the top */
  redraw() {
    const sc = this.containerEl.closest('.vertical-tab-content');
    const top = sc ? sc.scrollTop : 0;
    this.display();
    if (sc) sc.scrollTop = top;
  }

  display() {
    const { containerEl, plugin } = this;
    const s = plugin.settings;
    containerEl.empty();

    /* "a.b.c" paths into the settings and into the defaults */
    const at = (path) => {
      const parts = path.split('.');
      const key = parts.pop();
      return [parts.reduce((o, k) => o[k], s), key];
    };
    const dflt = (path) => {
      const parts = path.split('.');
      const key = parts.pop();
      return [parts.reduce((o, k) => o[k], DEFAULT_SETTINGS), key];
    };

    /* kind: 'look' = styles only, 'bar' = redraw the prompt, 'data' = redraw the sections,
       'build' = rebuild the whole page */
    const apply = (kind) => {
      if (kind === 'build') plugin.rebuildAll();
      else if (kind === 'bar') { plugin.probe(); }
      else if (kind === 'data') { plugin.restyleAll(); for (const v of plugin.views) v.refresh(null); }
      else plugin.restyleAll();
      plugin.persist();
    };

    const get = (path) => { const [o, k] = at(path); return o[k]; };
    const put = (path, v) => { const [o, k] = at(path); o[k] = v; };

    const drop = (path, name, desc, options, kind) => new UiSetting(containerEl)
      .setName(name)
      .setDesc(desc || '')
      .addDropdown((d) => d
        .addOptions(uiOptions(options))
        .setValue(String(get(path)))
        .onChange((value) => {
          put(path, typeof dflt(path)[0][dflt(path)[1]] === 'number' ? Number(value) : value);
          apply(kind);
        }));

    const tog = (path, name, desc, kind) => new UiSetting(containerEl)
      .setName(name)
      .setDesc(desc || '')
      .addToggle((t) => t
        .setValue(Boolean(get(path)))
        .onChange((value) => { put(path, value); apply(kind); }));

    const text = (path, name, desc, placeholder, kind) => new UiSetting(containerEl)
      .setName(name)
      .setDesc(desc || '')
      .addText((t) => t
        .setPlaceholder(placeholder || '')
        .setValue(String(get(path)))
        .onChange((value) => { put(path, value); apply(kind); }));

    const area = (path, name, desc, rows, kind) => {
      let comp = null;
      const setting = new UiSetting(containerEl)
        .setName(name)
        .setDesc(desc || '')
        .addTextArea((t) => {
          comp = t;
          t.setValue(String(get(path))).onChange((value) => { put(path, value); apply(kind); });
          t.inputEl.rows = rows || 5;
          t.inputEl.style.width = '100%';
        });
      setting.settingEl.classList.add('mh-setting-area');
      return { setting, comp: () => comp };
    };

    /* a slider with a little reset arrow that puts the default back */
    const slide = (path, name, desc, lo, hi, step, kind, unit) => {
      let comp = null;
      return new UiSetting(containerEl)
        .setName(name)
        .setDesc(desc || '')
        .addSlider((sl) => {
          comp = sl;
          sl.setLimits(lo, hi, step)
            .setValue(Number(get(path)))
            .setDynamicTooltip()
            .onChange((value) => { put(path, value); apply(kind); });
        })
        .addExtraButton((b) => b
          .setIcon('rotate-ccw')
          .setTooltip(ui('back to the default (' + dflt(path)[0][dflt(path)[1]] + (unit || '') + ')'))
          .onClick(() => {
            const d = dflt(path)[0][dflt(path)[1]];
            put(path, d);
            comp.setValue(d);
            apply(kind);
          }));
    };

    const head = (name) => new UiSetting(containerEl).setName(name).setHeading();

    /* ── the first setting: how the text in this tab is cased ── */
    new UiSetting(containerEl)
      .setName('lowercase ui')
      .setDesc('show the text in this tab, its tooltips and its messages in lowercase, to match the terminal look. turn it off for normal sentence case.')
      .addToggle((toggle) => toggle
        .setValue(s.lowercaseUi !== false)
        .onChange((value) => {
          s.lowercaseUi = value;
          uiCase.lower = value;
          plugin.persist();
          this.redraw();
        }));

    new UiSetting(containerEl)
      .setName('open home now')
      .setDesc('opens the home tab, or jumps to it if it is already open.')
      .addButton((b) => b.setButtonText(ui('open')).setCta().onClick(() => plugin.openHome()));

    /* ── opening ── */
    head('opening');
    drop('startup', 'open on startup', 'always opens the home tab (or jumps to it) every time obsidian starts. only when nothing is open does it when the workspace is empty. never leaves it to you.',
      { always: 'always', empty: 'only when nothing is open', never: 'never' }, 'look');
    tog('takeNewTabs', 'replace new tabs', 'every new empty tab becomes the home page, instead of the "new note / go to file" screen.', 'look');
    drop('openIn', 'open notes in', 'where a note opens when you click it here. ctrl or cmd-click does the other one.',
      { tab: 'a new tab', same: 'this tab (replaces the home page)' }, 'look');
    tog('pinTab', 'pin the home tab', 'pinned tabs cannot be closed by accident. applies the next time the tab is opened.', 'look');
    tog('hideHeader', 'hide the tab header', 'hides the back / forward bar above the page.', 'build');
    text('tabTitle', 'tab title', 'what the tab says.', 'home', 'look');
    tog('ribbon', 'ribbon button', 'a button in the left ribbon that opens the home tab.', 'build');
    tog('focusShell', 'focus the prompt', 'puts the cursor in the shell when the page opens. pressing / does the same any time.', 'look');
    text('exclude', 'ignored folders', 'comma separated. left out of recent, todo and the streak.', '.trash, templates', 'data');
    drop('weekStart', 'week starts on', 'for the streak grid and the week progress bar.', { mon: 'monday', sun: 'sunday' }, 'data');

    /* ── identity ── */
    head('identity');
    new UiSetting(containerEl)
      .setName('user name')
      .setDesc('shown in the first pill, the greeting and the shell. leave empty to use the name your system reports.')
      .addText((t) => t
        .setPlaceholder(plugin.detected.user)
        .setValue(s.username)
        .onChange((value) => { s.username = value.trim(); apply('build'); }));
    text('pathLabel', 'path pill text', 'what the second pill says. leave it empty for ~/ and the vault name.', '~/' + plugin.app.vault.getName(), 'build');
    tog('lowercaseText', 'lowercase page', 'shows everything on the page in lowercase, note names included. only the display changes, never the notes.', 'look');

    /* ── sections ── */
    head('sections');
    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= s.sections.length) return;
      [s.sections[i], s.sections[j]] = [s.sections[j], s.sections[i]];
      apply('build');
      this.redraw();
    };
    s.sections.forEach((it, i) => {
      const meta = SECTION_META[it.id];
      new UiSetting(containerEl)
        .setName(meta.label)
        .setDesc(meta.desc)
        .addToggle((t) => t.setValue(it.on).onChange((v) => { it.on = v; apply('build'); }))
        .addExtraButton((b) => b
          .setIcon(it.wide ? 'rectangle-horizontal' : 'square')
          .setTooltip(ui(it.wide ? 'full width in the two-column layout' : 'half width in the two-column layout'))
          .onClick(() => {
            it.wide = !it.wide;
            b.setIcon(it.wide ? 'rectangle-horizontal' : 'square');
            b.setTooltip(ui(it.wide ? 'full width in the two-column layout' : 'half width in the two-column layout'));
            apply('build');
          }))
        .addExtraButton((b) => b.setIcon('arrow-up').setTooltip(ui('move up')).onClick(() => move(i, -1)))
        .addExtraButton((b) => b.setIcon('arrow-down').setTooltip(ui('move down')).onClick(() => move(i, 1)));
    });
    tog('showCommands', 'command lines', 'the ❯ line above each section, like the command that drew it.', 'build');

    /* ── prompt ── */
    head('prompt');
    tog('pills.user', 'user pill', 'your name, with a logo for your operating system.', 'build');
    tog('pills.path', 'path pill', 'the name of this vault.', 'build');
    tog('pills.git', 'git pill', 'the current branch, when this vault is a git repository. it reads the file .git/HEAD in the vault folder and nothing else.', 'build');
    tog('pills.time', 'time pill', 'the time of day, with the little >>> bridge before it.', 'build');
    drop('pillShape', 'pill shape', 'arrow is the powerline look. round and flat drop the arrow tips and use gaps instead.',
      { arrow: 'arrow (powerline)', round: 'round', flat: 'flat' }, 'look');
    tog('clock.hour12', '12-hour clock', 'shows 09:41 pm instead of 21:41.', 'build');
    tog('clock.seconds', 'show seconds', 'the clock pill already ticks every second.', 'build');

    /* ── banner ── */
    head('banner');
    drop('banner.source', 'text', 'what the big letters say.', { vault: 'the vault name', name: 'your name', custom: 'custom text' }, 'data');
    text('banner.custom', 'custom text', 'used when text is set to custom. letters, numbers, spaces and . - _ / are drawn; anything else is skipped.', 'welcome home', 'data');
    drop('banner.letters', 'letters', 'lowercase is a full lowercase block face with ascenders and descenders (mish.shell). capitals are the chunkier five-row letters.', { lower: 'lowercase', caps: 'capitals' }, 'data');
    drop('banner.style', 'style', 'blocks are pixel letters drawn by the plugin. text is a big line in your font.', { blocks: 'blocks', text: 'big text' }, 'data');
    slide('banner.size', 'block size', 'how big one pixel of a letter is. a ten-letter name is about 60 pixels wide.', 3, 14, 1, 'look', ' px');
    drop('banner.gradient', 'colour', 'rainbow runs across the six palette colours.',
      { rainbow: 'rainbow', accent: 'accent colour', pink: 'first palette colour', plain: 'plain text colour' }, 'data');
    drop('banner.align', 'position', '', { left: 'left', centre: 'centre' }, 'data');

    /* ── greeting ── */
    head('greeting');
    text('greeting.template', 'greeting', 'you can use {greeting} (good morning / afternoon / evening, or still up when it is late), {name}, {vault}, {time} and {date}.', '{greeting}, {name}.', 'data');
    tog('greeting.showDate', 'show the date', '', 'data');
    text('greeting.dateFormat', 'date format', 'moment.js tokens: dddd is the weekday, D the day, MMMM the month, YYYY the year. a middle dot is nice between them.', 'dddd · D MMMM YYYY', 'data');
    tog('greeting.progress.day', 'day progress bar', 'how far through the day you are.', 'data');
    tog('greeting.progress.week', 'week progress bar', '', 'data');
    tog('greeting.progress.month', 'month progress bar', '', 'data');
    tog('greeting.progress.year', 'year progress bar', '', 'data');
    slide('greeting.barWidth', 'bar length', 'number of cells in each bar.', 8, 40, 1, 'data', '');
    slide('greeting.barHeight', 'bar thickness', '', 4, 14, 1, 'look', ' px');

    /* ── shortcuts ── */
    head('shortcuts');
    const shortcuts = area('shortcuts.items', 'commands', 'one per line, as  label | command id. lines starting with # are skipped. a dimmed shortcut means the command id does not exist. pick commands with the button below, so you never have to look up an id.', 7, 'data');
    new UiSetting(containerEl)
      .setName('add a command')
      .setDesc('search every command obsidian and your plugins have and add it to the list.')
      .addButton((b) => b.setButtonText(ui('add…')).onClick(() => {
        new CommandPicker(plugin.app, (c) => {
          const label = c.name.replace(/^[^:]+:\s*/, '').toLowerCase();
          s.shortcuts.items = (s.shortcuts.items.replace(/\s+$/, '') + '\n' + label + ' | ' + c.id).replace(/^\n/, '');
          if (shortcuts.comp()) shortcuts.comp().setValue(s.shortcuts.items);
          apply('data');
        }).open();
      }));
    drop('shortcuts.layout', 'layout', 'list is one per line, like the new-tab screen. row puts them side by side.', { list: 'list', row: 'row' }, 'data');
    drop('shortcuts.colour', 'label colour', '', { plain: 'plain', rainbow: 'rainbow' }, 'data');
    tog('shortcuts.hideMissing', 'hide unavailable', 'leaves out shortcuts whose command does not exist (for example, a core plugin you have switched off), instead of showing them dimmed.', 'data');
    tog('shortcuts.hotkeys', 'show hotkeys', 'the little ⌘ n badge, when the command has a hotkey.', 'data');

    /* ── fastfetch ── */
    head('fastfetch');
    new UiSetting(containerEl).setDesc('this section is off by default. your sidebar already has mish.fastfetch. switch it on under sections.');
    for (const key of Object.keys(FETCH_FIELDS)) tog('fetch.fields.' + key, FETCH_FIELDS[key], '', 'data');
    tog('fetch.colourBar', 'colour bar', 'the row of colour blocks at the bottom.', 'data');

    /* ── recent ── */
    head('recent');
    drop('recent.mode', 'sort by', 'opened = the notes you opened last. if fewer than the count, the list is filled with the newest edited. the page remembers what you open while the plugin is on.',
      { opened: 'last opened', edited: 'last edited', created: 'newest' }, 'data');
    slide('recent.count', 'how many', '', 1, 30, 1, 'build', '');
    drop('recent.types', 'file types', '', { notes: 'notes only', all: 'every file' }, 'data');
    drop('recent.extensions', 'file extensions', 'notes lose their .md when hidden.', { hide: 'hide .md', show: 'show all' }, 'data');
    drop('recent.nameColour', 'name colours', 'rainbow = one colour per row. by file type = notes green, images lilac, pdfs pink, canvases peach, the rest yellow.',
      { rainbow: 'rainbow', type: 'by file type', plain: 'plain' }, 'data');
    tog('recent.age', 'show age', 'how long ago the note was last edited: 4m, 2h, 3d, 5w.', 'data');
    tog('recent.folder', 'show folder', 'the folder, after the name.', 'data');
    tog('recent.tree', 'tree lines', 'the ├── └── lines. off uses a ❯ in front of each name.', 'data');

    /* ── pinned ── */
    head('pinned');
    area('pinned.paths', 'notes', 'one per line: a note name, a path, or a [[link]]. missing ones show dimmed.', 5, 'data');
    tog('pinned.bookmarks', 'include bookmarks', "adds the notes from obsidian's bookmarks core plugin, when it is on.", 'data');
    drop('pinned.extensions', 'file extensions', '', { hide: 'hide .md', show: 'show all' }, 'data');
    drop('pinned.nameColour', 'name colours', '', { rainbow: 'rainbow', type: 'by file type', plain: 'plain' }, 'data');
    tog('pinned.tree', 'tree lines', '', 'data');

    /* ── todo ── */
    head('todo');
    slide('tasks.count', 'how many to show', 'the most recently edited notes come first.', 1, 30, 1, 'data', '');
    slide('tasks.scan', 'notes to read', 'at most this many notes are opened to read the task text. the count at the top always covers the whole vault.', 5, 400, 5, 'data', '');
    tog('tasks.complete', 'click a box to tick it', 'ticks the box in the note itself. nothing is written unless the line is still exactly what the page shows.', 'data');
    tog('tasks.showNote', 'show the note name', '', 'data');

    /* ── streak ── */
    head('streak');
    drop('streak.metric', 'counts', 'edits = days you edited notes, kept from the day this plugin first ran and filled in from file dates before that. last modified and created use file dates only (a synced vault can show everything on one day). journal entries counts notes named like your daily notes, longer ones darker.',
      { edits: 'edits', modified: 'last modified', created: 'created', daily: 'journal entries' }, 'data');
    slide('streak.weeks', 'weeks', '0 fits as many as the card is wide.', 0, 53, 1, 'data', '');
    drop('streak.colour', 'colour', 'the colour of the busiest days. rainbow walks through the palette.',
      Object.assign(Object.fromEntries(SLOTS.map((x) => [x.name, x.name])), { rainbow: 'rainbow' }), 'look');
    drop('streak.shape', 'cell shape', '', { square: 'square', round: 'round' }, 'look');
    slide('streak.cell', 'cell size', '', 6, 20, 1, 'data', ' px');
    slide('streak.gap', 'cell gap', '', 1, 8, 1, 'data', ' px');
    tog('streak.dayLabels', 'day labels', 'mon, wed, fri down the side.', 'data');
    tog('streak.monthLabels', 'month labels', '', 'data');
    tog('streak.summary', 'summary line', 'current streak, best streak and the total.', 'data');
    new UiSetting(containerEl)
      .setName('journal note format')
      .setDesc('for the journal entries count and the daily note command. leave empty to use the core daily notes plugin, or YYYY-MM-DD.')
      .addText((t) => t.setPlaceholder(plugin.dailyConfig().format).setValue(s.daily.format).onChange((v) => { s.daily.format = v.trim(); apply('data'); }));
    new UiSetting(containerEl)
      .setName('journal folder')
      .setDesc('where new daily notes go. leave empty to use the core daily notes plugin, or the vault root.')
      .addText((t) => t.setPlaceholder(plugin.dailyConfig().folder || '/').setValue(s.daily.folder).onChange((v) => { s.daily.folder = v.trim(); apply('data'); }));

    /* ── fortune ── */
    head('fortune');
    drop('quote.mode', 'pick', 'daily shows the same line all day. random picks a new one each time the page opens.', { daily: 'one per day', random: 'random' }, 'data');
    area('quote.lines', 'lines', 'one per line.', 6, 'data');

    /* ── shell ── */
    head('shell');
    text('shell.placeholder', 'placeholder', 'what the empty prompt says.', 'type a command · help', 'build');
    slide('shell.outputLines', 'output height', 'lines of output shown before it scrolls.', 2, 16, 1, 'look', '');

    /* ── colours ── */
    head('colours');
    const pickers = [];
    let presetDrop = null;
    let refreshing = false;
    const shown = () => (s.palette.preset === 'theme' ? themeFills() : s.palette.colours);
    const presets = { theme: ui('mish') };
    Object.keys(PALETTES).forEach((k) => { presets[k] = ui(k); });
    presets.custom = ui('custom');

    new UiSetting(containerEl)
      .setName('palette')
      .setDesc('the six colours of the rainbow. they colour the prompt pills, the progress bars, the tree names, the streak grid and the card border. mish is the default: the pastel rainbow, following the colours of your obsidian theme if it sets them. pick a preset, then change any colour below.')
      .addDropdown((d) => {
        presetDrop = d;
        d.addOptions(presets)
          .setValue(presets[s.palette.preset] ? s.palette.preset : 'theme')
          .onChange((value) => {
            const was = s.palette.preset;
            s.palette.preset = value;
            if (PALETTES[value]) s.palette.colours = PALETTES[value].slice();
            else if (value === 'custom' && was === 'theme') s.palette.colours = themeFills();
            refreshing = true;
            shown().forEach((c, i) => { if (pickers[i]) pickers[i].setValue(c); });
            refreshing = false;
            apply('look');
          });
      })
      .addExtraButton((b) => b
        .setIcon('rotate-ccw')
        .setTooltip(ui('back to mish'))
        .onClick(() => {
          s.palette.preset = 'theme';
          presetDrop.setValue('theme');
          refreshing = true;
          shown().forEach((c, i) => { if (pickers[i]) pickers[i].setValue(c); });
          refreshing = false;
          apply('look');
        }));

    SLOTS.forEach((slot, i) => {
      new UiSetting(containerEl)
        .setName('colour ' + (i + 1))
        .setDesc(slot.used)
        .addColorPicker((c) => {
          pickers[i] = c;
          c.setValue(shown()[i]).onChange((hex) => {
            if (refreshing) return;
            if (s.palette.preset === 'theme') s.palette.colours = themeFills();
            s.palette.colours[i] = String(hex).toLowerCase();
            s.palette.preset = 'custom';
            presetDrop.setValue('custom');
            apply('look');
          });
        });
    });

    let inkPicker = null;
    const autoInk = () => (lightTheme() ? '#2a2430' : '#0f0f12');
    new UiSetting(containerEl)
      .setName('pill text colour')
      .setDesc('the text on every pill. automatic = dark ink. try white with a dark palette.')
      .addColorPicker((c) => {
        inkPicker = c;
        c.setValue(HEX.test(s.inkColour) ? s.inkColour : autoInk()).onChange((hex) => {
          s.inkColour = String(hex).toLowerCase();
          apply('look');
        });
      })
      .addExtraButton((b) => b
        .setIcon('rotate-ccw')
        .setTooltip(ui('back to automatic'))
        .onClick(() => {
          s.inkColour = '';
          inkPicker.setValue(autoInk());
          apply('look');
        }));

    /* ── card and layout ── */
    head('card and layout');
    drop('layout.frame', 'frame', 'one card puts everything in a single bordered box. each section gives every section its own box. none has no borders at all.',
      { one: 'one card', each: 'each section', none: 'none' }, 'look');
    drop('layout.columns', 'columns', 'two columns pair up the half-width sections. narrow tabs always fall back to one.', { 1: 'one', 2: 'two' }, 'look');
    drop('layout.fit', 'when the page is taller than the tab', 'shrink scales the whole page down to fit, so it never scrolls. scroll leaves it full size and lets you scroll.',
      { shrink: 'shrink to fit', scroll: 'scroll' }, 'look');
    slide('layout.minScale', 'smallest size', 'shrinking stops here. if the page still does not fit, scrolling comes back so nothing is out of reach. turn a section off or lower the number of rows to get more room.', 30, 100, 5, 'look', '%');
    slide('layout.width', 'maximum width', 'how wide the page gets in a big tab.', 420, 1400, 20, 'look', ' px');
    slide('layout.gap', 'gap between sections', '', 0, 40, 1, 'look', ' px');
    slide('layout.inner', 'card padding', 'space between a border and what is inside it.', 0, 40, 1, 'look', ' px');
    drop('card.ring', 'border', "rainbow uses the palette. accent is obsidian's accent colour. subtle is your theme's border colour.",
      { rainbow: 'rainbow', accent: 'accent colour', subtle: 'subtle', none: 'none' }, 'look');
    slide('card.ringWidth', 'border thickness', '', 1, 4, 1, 'look', ' px');
    slide('card.angle', 'rainbow angle', 'direction of the border gradient. 135 runs top-left to bottom-right.', 0, 345, 15, 'look', '°');
    slide('card.radius', 'corner radius', '', 0, 28, 1, 'look', ' px');
    slide('card.pad', 'outer margin', 'space between the page and the edge of the tab.', 0, 48, 1, 'look', ' px');
    drop('card.hAlign', 'horizontal position', 'only matters when the tab is wider than the page.', { centre: 'centre', left: 'left' }, 'look');
    drop('card.vAlign', 'vertical position', 'centred when the page is shorter than the tab, or pinned to the top.', { centre: 'centre', top: 'top' }, 'look');
    slide('card.textSize', 'text size', 'percent of the normal size.', 80, 140, 5, 'look', '%');

    /* ── font ── */
    head('font');
    const choices = () => {
      const opts = {
        bundled: ui('cmu typewriter (bundled)'),
        obsidian: ui("obsidian's monospace font"),
        system: ui('system monospace'),
      };
      const names = new Set(CANDIDATE_FONTS.filter((n) => isInstalled(n)));
      this.scanned.forEach((n) => names.add(n));
      if (s.font.indexOf('family:') === 0) names.add(s.font.slice(7));
      Array.from(names).sort((a, b) => a.localeCompare(b)).forEach((n) => { opts['family:' + n] = n; });
      opts.custom = ui('custom…');
      return opts;
    };
    let custom = null;
    new UiSetting(containerEl)
      .setName('font')
      .setDesc('the default font is bundled with the plugin, so nothing needs installing. or pick a monospace font from this computer.')
      .addDropdown((dropdown) => {
        this.fontDropdown = dropdown;
        dropdown.addOptions(choices()).setValue(s.font).onChange((value) => {
          s.font = value;
          if (custom) custom.settingEl.hidden = value !== 'custom';
          apply('look');
        });
      });
    custom = new UiSetting(containerEl)
      .setName('custom font')
      .setDesc('any css font-family list, such as "JetBrains Mono", monospace')
      .addText((t) => t
        .setPlaceholder('"JetBrains Mono", monospace')
        .setValue(s.customFont)
        .onChange((value) => { s.customFont = value; apply('look'); }));
    custom.settingEl.hidden = s.font !== 'custom';
    new UiSetting(containerEl)
      .setName('find monospace fonts')
      .setDesc("adds every monospace font installed on this computer to the menu above. obsidian may ask for permission first. if this version can't do it, the menu still lists the common fonts it finds.")
      .addButton((button) => button
        .setButtonText(ui('scan'))
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const list = await scanSystemFonts();
            if (!list) {
              new Notice(ui("this version of obsidian can't list system fonts. use a custom font instead."));
            } else {
              this.scanned = list;
              this.fontDropdown.selectEl.empty();
              this.fontDropdown.addOptions(choices());
              this.fontDropdown.setValue(s.font);
              new Notice(ui('found ' + list.length + ' monospace fonts.'));
            }
          } catch (e) {
            new Notice(ui('could not read the font list. use a custom font instead.'));
          }
          button.setDisabled(false);
        }));

    /* ── reset ── */
    head('reset');
    new UiSetting(containerEl)
      .setName('reset appearance')
      .setDesc('puts every colour, pill shape, banner, streak and card option back to the default. sections, shortcuts, your name and your lists are not touched.')
      .addButton((button) => button
        .setButtonText(ui('reset'))
        .setWarning()
        .onClick(() => {
          for (const k of ['palette', 'inkColour', 'pillShape', 'layout', 'card', 'banner']) s[k] = clone(DEFAULT_SETTINGS[k]);
          for (const k of ['colour', 'shape', 'cell', 'gap']) s.streak[k] = DEFAULT_SETTINGS.streak[k];
          apply('build');
          this.redraw();
        }));
    new UiSetting(containerEl)
      .setName('reset sections')
      .setDesc('puts the sections back in their original order, on or off, and full or half width.')
      .addButton((button) => button
        .setButtonText(ui('reset'))
        .setWarning()
        .onClick(() => {
          s.sections = clone(DEFAULT_SETTINGS.sections);
          apply('build');
          this.redraw();
        }));
  }
}

module.exports = MishHome;
