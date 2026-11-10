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
  banner:    { label: 'banner',      wide: true,  on: true,  desc: 'big block letters: the vault name, your name, the time or any text.' },
  greeting:  { label: 'greeting',    wide: false, on: true,  desc: 'a hello, the date, a one-line summary and progress bars for the day, week, month and year.' },
  shortcuts: { label: 'shortcuts',   wide: false, on: true,  desc: 'commands you can click, with their hotkeys: new note, go to file, anything in the command palette.' },
  tasks:     { label: 'todo',        wide: false, on: true,  desc: 'open checkboxes from across the vault. click a box to tick it.' },
  recent:    { label: 'recent',      wide: false, on: true,  desc: 'the notes you opened or edited last, as an eza-style tree.' },
  system:    { label: 'system',      wide: false, on: true,  desc: 'cpu, memory, battery and uptime, btop-style. updates live.' },
  pinned:    { label: 'pinned',      wide: false, on: false, desc: 'notes you pin by name, plus your bookmarks.' },
  focus:     { label: 'focus timer', wide: false, on: false, desc: 'a pomodoro timer: focus, break, repeat. it keeps running when you leave the tab.' },
  links:     { label: 'links',       wide: false, on: false, desc: 'web links you open often. they open in your browser.' },
  tags:      { label: 'tags',        wide: false, on: false, desc: 'your most used tags, with bars.' },
  folders:   { label: 'folders',     wide: false, on: false, desc: 'where your notes live: the biggest folders, du-style.' },
  random:    { label: 'random note', wide: false, on: false, desc: 'a peek at one note, a new one each day, like cat on a random file.' },
  git:       { label: 'git log',     wide: false, on: false, desc: 'the latest commits, when the vault is a git repository.' },
  streak:    { label: 'streak',      wide: true,  on: true,  desc: 'a contribution-style grid of the days you wrote, with your current streak.' },
  quote:     { label: 'fortune',     wide: false, on: false, desc: 'one line from your own list, a new one each day.' },
  shell:     { label: 'terminal',    wide: true,  on: true,  desc: 'a terminal window you can type into: open and search notes, add to your inbox, run a timer, and more. type help.' },
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

const DEFAULT_LINKS = [
  'github | https://github.com',
  'youtube | https://youtube.com',
  'mail | https://mail.google.com',
].join('\n');

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

  banner: { source: 'vault', custom: '', style: 'blocks', letters: 'lower', size: 6, gradient: 'rainbow', align: 'left' },

  greeting: {
    summary: true,
    template: '{greeting}, {name}.',
    showDate: true,
    dateFormat: 'dddd · D MMMM YYYY',
    progress: { day: false, week: false, month: false, year: true },
    barWidth: 24,
    barHeight: 9,
  },

  shortcuts: { items: DEFAULT_SHORTCUTS, layout: 'list', colour: 'plain', hotkeys: true, hideMissing: true },

  recent: { mode: 'opened', count: 8, types: 'notes', extensions: 'hide', nameColour: 'type', age: true, folder: false, tree: true },

  pinned: { paths: '', bookmarks: true, extensions: 'hide', nameColour: 'type', tree: true },

  tasks: { count: 6, scan: 40, complete: true, showNote: true },

  streak: { metric: 'edits', weeks: 0, colour: 'green', shape: 'square', cell: 10, gap: 2, dayLabels: true, monthLabels: true, summary: true },

  quote: { lines: DEFAULT_QUOTES, mode: 'daily' },

  calendar: { mark: 'activity', weekNumbers: false, arrows: true },
  focus: { focusMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, autoNext: false, notify: true },
  links: { items: DEFAULT_LINKS, layout: 'list', colour: 'plain' },
  tags: { count: 8 },
  folders: { count: 6, depth: 1 },
  random: { lines: 6, mode: 'daily', minChars: 120 },
  system: { cpu: true, memory: true, battery: true, uptime: true, network: false, barWidth: 14 },
  git: { count: 5 },
  terminal: {
    style: 'window',                       /* window | plain */
    titleBar: true,
    title: '{user}@{host}: {path}',
    height: 4,                             /* lines of scrollback */
    prompt: 'powerline',                   /* powerline | compact */
    rprompt: true,                         /* the time on the right of the prompt */
    suggest: true,                         /* grey autosuggestions from your history (press → to accept) */
    welcome: true,
    startup: 'stats, help',                /* commands run once when obsidian opens the pane, so it is never an empty box. comma separated, empty = none */
    placeholder: 'type a command · help',
    capture: 'daily',                      /* daily | inbox: where "add" and "todo add" write */
    inbox: 'inbox.md',
  },

  daily: { folder: '', format: '' },    /* empty = whatever the core daily notes plugin says, else the vault root and YYYY-MM-DD */

  /* the card */
  layout: { frame: 'one', columns: 3, width: 1100, gap: 18, inner: 18, fit: 'shrink', minScale: 85, split: 'right', sideWidth: 400, scaleV2: false },   /* frame: one | each | none. fit: shrink | scroll */
  card: { hAlign: 'centre', vAlign: 'centre', ring: 'rainbow', ringWidth: 1, angle: 135, radius: 14, pad: 20, textSize: 100 },
};

/* a data.json from an older version, or one edited by hand, must never break the page */
const sanitise = (cfg) => {
  const p = cfg.palette;
  if (p.preset !== 'theme' && p.preset !== 'custom' && !PALETTES[p.preset]) p.preset = 'theme';
  if (!Array.isArray(p.colours) || p.colours.length !== 6 || !p.colours.every((c) => HEX.test(c))) {
    p.colours = DARK_FILLS.slice();
  }
  delete cfg.fetch;      /* the fastfetch section was removed */
  delete cfg.shell;      /* replaced by cfg.terminal */
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
  b.source = oneOf(b.source, ['vault', 'name', 'time', 'custom'], 'vault');
  b.style = oneOf(b.style, ['blocks', 'text'], 'blocks');
  b.gradient = oneOf(b.gradient, ['rainbow', 'accent', 'pink', 'plain'], 'rainbow');
  b.align = oneOf(b.align, ['left', 'centre'], 'left');
  b.letters = oneOf(b.letters, ['lower', 'caps'], 'lower');
  b.size = num(b.size, 3, 14, 6);

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
  st.cell = num(st.cell, 6, 20, 10);
  st.gap = num(st.gap, 1, 8, 2);

  cfg.quote.mode = oneOf(cfg.quote.mode, ['daily', 'random'], 'daily');

  cfg.greeting.summary = cfg.greeting.summary !== false;
  cfg.calendar.mark = oneOf(cfg.calendar.mark, ['activity', 'daily', 'none'], 'activity');
  const fo = cfg.focus;
  fo.focusMin = num(fo.focusMin, 1, 180, 25);
  fo.breakMin = num(fo.breakMin, 1, 60, 5);
  fo.longBreakMin = num(fo.longBreakMin, 1, 120, 15);
  fo.longEvery = num(fo.longEvery, 2, 12, 4);
  cfg.links.layout = oneOf(cfg.links.layout, ['list', 'row'], 'list');
  cfg.links.colour = oneOf(cfg.links.colour, ['plain', 'rainbow'], 'plain');
  cfg.tags.count = num(cfg.tags.count, 1, 20, 8);
  cfg.folders.count = num(cfg.folders.count, 1, 20, 6);
  cfg.folders.depth = num(cfg.folders.depth, 1, 3, 1);
  cfg.random.lines = num(cfg.random.lines, 2, 20, 6);
  cfg.random.mode = oneOf(cfg.random.mode, ['daily', 'random'], 'daily');
  cfg.random.minChars = num(cfg.random.minChars, 0, 2000, 120);
  cfg.system.barWidth = num(cfg.system.barWidth, 6, 30, 14);
  cfg.git.count = num(cfg.git.count, 1, 20, 5);
  const tm = cfg.terminal;
  tm.style = oneOf(tm.style, ['window', 'plain'], 'window');
  tm.prompt = oneOf(tm.prompt, ['powerline', 'compact'], 'powerline');
  tm.capture = oneOf(tm.capture, ['daily', 'inbox'], 'daily');
  tm.height = num(tm.height, 2, 20, 4);
  if (typeof tm.inbox !== 'string' || !tm.inbox.trim()) tm.inbox = 'inbox.md';
  if (typeof tm.startup !== 'string') tm.startup = 'stats, help';

  const l = cfg.layout;
  l.frame = oneOf(l.frame, ['one', 'each', 'none'], 'one');
  l.columns = oneOf(Number(l.columns), [1, 2, 3], 2);
  l.width = num(l.width, 420, 1400, 1100);
  l.gap = num(l.gap, 0, 40, 14);
  l.inner = num(l.inner, 0, 40, 14);
  l.fit = oneOf(l.fit, ['shrink', 'scroll'], 'shrink');
  l.minScale = num(l.minScale, 30, 100, 85);
  /* 1.2: the old default (55) squeezed the page too small in a narrow tab. move it once, and only if it was never changed */
  if (!l.scaleV2) { if (l.minScale === 55) l.minScale = 85; l.scaleV2 = true; }
  l.split = oneOf(l.split, ['right', 'off'], 'right');      /* right = the terminal is a tall pane beside the sections */
  l.sideWidth = num(l.sideWidth, 260, 640, 400);

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
/* the terminal sits in its own tall pane when that is switched on and the terminal section is too */
const splitActive = (cfg) => cfg.layout.split === 'right' && cfg.sections.some((it) => it.id === 'shell' && it.on);
/* the pane is added on top of the width you set, so the sections keep the room they always had */
const cardWidth = (cfg) => cfg.layout.width + (splitActive(cfg) ? cfg.layout.sideWidth : 0);

const layoutVars = (cfg) => {
  const c = cfg.card;
  const l = cfg.layout;
  const v = {
    '--mh-w': cardWidth(cfg) + 'px',
    '--mh-side': l.sideWidth + 'px',
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

const hashStr = (str) => {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
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
  '/': '....#|...#.|..#..|.#...|#....', ':': '.|#|.|#|.', ' ': '...|...|...|...|...',
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
  ':': '.|.|.|#|.|#|.|.|.',
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

/* ── terminal output ─────────────────────────────────────────────────────
   a command returns lines. a line is a string, or an array of pieces: a plain string, or
   { t: text, c: colour class, file, line | run: a command | url }. file / run / url make the
   piece clickable. */
const T = (t, c) => ({ t, c });
const LINK = (t, file, c, line) => ({ t, c, file, line });
const RUN = (t, run, c) => ({ t, c, run });
const GO = (t, url, c) => ({ t, c, url });
const CLEAR = Symbol('clear');

class CmdError extends Error {
  constructor(message, lines) {
    super(message);
    this.lines = lines || null;
  }
}

const toLines = (out) => {
  if (out == null) return [];
  if (typeof out === 'string') return out.split('\n');
  return Array.isArray(out) ? out : [String(out)];
};

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
    /* older versions saved an older section list; the new default (calendar, system, terminal, no fastfetch) applies once */
    if ((saved.v || 0) < 3) {
      const d = DEFAULT_SETTINGS;
      this.settings.sections = clone(d.sections);
      this.settings.layout = clone(d.layout);                 /* three columns, shrink to fit */
      this.settings.banner.size = d.banner.size;
      this.settings.streak.cell = d.streak.cell;
      this.settings.streak.gap = d.streak.gap;
    }
    /* 1.3: a calmer page. the spacing moved once, and only where it was still the old default,
       so anyone who had already tuned it keeps their numbers. */
    if ((saved.v || 0) < 4) {
      const l = this.settings.layout;
      const c = this.settings.card;
      if (l.gap === 14) l.gap = 18;
      if (l.inner === 14) l.inner = 18;
      if (c.radius === 12) c.radius = 14;
      if (c.pad === 16) c.pad = 20;
      /* the help dump filled the terminal pane with a wall of text on every launch */
      if (this.settings.terminal.startup === 'stats, help') this.settings.terminal.startup = 'stats';
      /* a rainbow per row in the file lists was the busiest part of the page */
      if (this.settings.recent.nameColour === 'rainbow') this.settings.recent.nameColour = 'type';
      if (this.settings.pinned.nameColour === 'rainbow') this.settings.pinned.nameColour = 'type';
    }
    this.opened = Array.isArray(saved.opened) ? saved.opened.filter((p) => typeof p === 'string').slice(0, 60) : [];
    this.history = Array.isArray(saved.history) ? saved.history.filter((p) => typeof p === 'string').slice(-60) : [];
    this.activity = {};
    this.focusLog = {};
    if (isPlain(saved.focusLog)) {
      const cut = dayKey(Date.now() - 60 * 86400000);
      for (const k of Object.keys(saved.focusLog)) if (k >= cut && Number.isFinite(saved.focusLog[k])) this.focusLog[k] = saved.focusLog[k];
    }
    this.scrollback = [];          /* the terminal's history for this session */
    this.cwd = '';                 /* the terminal's working folder ('' = vault root) */
    this.lastOk = true;            /* did the last terminal command succeed? */
    this.focus = { mode: 'focus', running: false, endsAt: 0, left: 0 };
    this.cpuPrev = null;
    this.cpuLast = null;
    this.battery = null;
    if (isPlain(saved.activity)) {
      const cutoff = dayKey(Date.now() - 400 * 86400000);
      for (const k of Object.keys(saved.activity)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k >= cutoff && Number.isFinite(saved.activity[k])) this.activity[k] = saved.activity[k];
      }
    }

    this.focus.left = this.focusLen('focus');
    this.cpuNow();
    this.refreshBattery();

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
    this.addCommand({
      id: 'focus-toggle',
      name: 'Start or pause the focus timer',
      callback: () => { this.focusToggle(); for (const v of this.views) v.updateFocus(); },
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
      this.refreshSoon(['recent', 'streak', 'calendar', 'tags', 'folders'], 2500);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshSoon(['tasks', 'tags', 'folders'], 1500)));

    /* keeps the clock and the uptime ticking */
    let beat = 0;
    this.registerInterval(window.setInterval(() => {
      beat++;
      this.focusTick();
      if (beat % 60 === 0) this.refreshBattery();
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

  dailyPath(m) {
    const { folder, format } = this.dailyConfig();
    return normalizePath((folder ? folder + '/' : '') + m.format(format) + '.md');
  }

  dailyExists(m) {
    return this.app.vault.getAbstractFileByPath(this.dailyPath(m)) instanceof TFile;
  }

  /* the daily note for a date (today by default), made from the template if it does not exist yet */
  async dailyFile(m) {
    const when = m || moment();
    const { format, template } = this.dailyConfig();
    const name = when.format(format);
    const path = this.dailyPath(when);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (dir) await this.ensureFolder(dir);
    let body = '';
    if (template) {
      const t = this.app.metadataCache.getFirstLinkpathDest(template.replace(/\.md$/i, ''), '');
      if (t) {
        const title = name.split('/').pop();
        body = (await this.app.vault.read(t)).replace(/{{\s*(date|time|title)\s*(?::([^}]*))?}}/gi, (x, kind, fmt) => {
          const k = kind.toLowerCase();
          if (k === 'title') return title;
          return when.format((fmt || '').trim() || (k === 'date' ? 'YYYY-MM-DD' : 'HH:mm'));
        });
      }
    }
    file = await this.app.vault.create(path, body);
    return file;
  }

  async openDaily(m) {
    const file = await this.dailyFile(m);
    await this.openFile(file);
    return file;
  }

  /* "add" and "todo add" in the terminal: a line at the end of today's daily note, or your inbox note */
  async capture(text, kind) {
    const t = this.settings.terminal;
    let file;
    if (t.capture === 'inbox') {
      const path = normalizePath(t.inbox.trim());
      file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        if (path.includes('/')) await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
        file = await this.app.vault.create(path, '');
      }
    } else {
      file = await this.dailyFile();
    }
    const line = kind === 'task' ? '- [ ] ' + text : '- ' + moment().format('HH:mm') + ' ' + text;
    await this.app.vault.process(file, (data) => data + (data && !data.endsWith('\n') ? '\n' : '') + line + '\n');
    return file;
  }

  async openRandom() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, parseList(this.settings.exclude)));
    if (!files.length) { new Notice(ui('no notes yet.')); return null; }
    const file = files[Math.floor(Math.random() * files.length)];
    await this.openFile(file);
    return file;
  }

  async createNote(name, folder) {
    const base = String(name || 'untitled').replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]]/g, '-').trim() || 'untitled';
    const active = this.app.workspace.getActiveFile();
    let parent = '';
    if (typeof folder === 'string') parent = folder;
    else {
      try { parent = this.app.fileManager.getNewFileParent(active ? active.path : '').path; } catch (e) { parent = ''; }
    }
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

  /* ── focus timer ───────────────────────────────────────────────────────────
     lives here, not in the page, so it keeps counting (and rings) with the tab closed */
  focusLen(mode) {
    if (mode === 'focus' && this.focus.custom) return this.focus.custom;      /* "focus 40" in the terminal */
    const f = this.settings.focus;
    return (mode === 'focus' ? f.focusMin : mode === 'long' ? f.longBreakMin : f.breakMin) * 60000;
  }

  focusLeft() {
    const st = this.focus;
    return st.running ? Math.max(0, st.endsAt - Date.now()) : st.left;
  }

  focusStart() {
    const st = this.focus;
    if (st.running) return;
    st.running = true;
    st.endsAt = Date.now() + st.left;
  }

  focusPause() {
    const st = this.focus;
    if (!st.running) return;
    st.left = Math.max(1000, st.endsAt - Date.now());
    st.running = false;
  }

  focusToggle() { if (this.focus.running) this.focusPause(); else this.focusStart(); }

  focusReset() {
    const st = this.focus;
    st.running = false;
    st.mode = 'focus';
    st.custom = 0;
    st.left = this.focusLen('focus');
  }

  focusSkip() { this.focusFinish(true); }

  /* after the lengths change in settings */
  focusSync() {
    const st = this.focus;
    if (!st.running) st.left = this.focusLen(st.mode);
  }

  focusToday() { return this.focusLog[dayKey(Date.now())] || 0; }

  focusTick() {
    const st = this.focus;
    if (st.running && Date.now() >= st.endsAt) this.focusFinish(false);
  }

  focusFinish(skipped) {
    const st = this.focus;
    const f = this.settings.focus;
    st.custom = 0;
    if (st.mode === 'focus') {
      if (!skipped) {
        const day = dayKey(Date.now());
        this.focusLog[day] = (this.focusLog[day] || 0) + 1;
        this.persist();
      }
      const n = this.focusToday();
      st.mode = !skipped && n > 0 && n % f.longEvery === 0 ? 'long' : 'break';
      if (f.notify && !skipped) new Notice(ui('focus done. take a ' + (st.mode === 'long' ? 'long ' : '') + 'break.'), 8000);
    } else {
      st.mode = 'focus';
      if (f.notify && !skipped) new Notice(ui('break over. back to it.'), 8000);
    }
    st.left = this.focusLen(st.mode);
    st.running = Boolean(f.autoNext) && !skipped;
    if (st.running) st.endsAt = Date.now() + st.left;
    for (const view of this.views) view.updateFocus();
  }

  /* ── system, for the system section and the top command ─────────────────── */
  cpuNow() {
    if (!nodeOs) return null;
    try {
      let idle = 0;
      let total = 0;
      for (const c of nodeOs.cpus()) {
        const t = c.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.idle + t.irq;
      }
      const prev = this.cpuPrev;
      this.cpuPrev = { idle, total };
      if (prev && total > prev.total) {
        this.cpuLast = Math.max(0, Math.min(100, Math.round(100 * (1 - (idle - prev.idle) / (total - prev.total)))));
      }
      return this.cpuLast;
    } catch (e) {
      return null;
    }
  }

  memNow() {
    if (!nodeOs) return null;
    try {
      const total = nodeOs.totalmem();
      return { total, used: total - nodeOs.freemem() };
    } catch (e) {
      return null;
    }
  }

  sysUptime() {
    try { return nodeOs.uptime() * 1000; } catch (e) { return null; }
  }

  refreshBattery() {
    try {
      if (navigator.getBattery) {
        navigator.getBattery().then((b) => { this.battery = { level: b.level, charging: b.charging }; }).catch(() => { this.battery = null; });
      }
    } catch (e) { /* no battery api */ }
  }

  /* ── git log: the vault's own .git/logs/HEAD, read as plain text. nothing is run. ── */
  async gitLog(n) {
    try {
      const raw = await this.app.vault.adapter.read('.git/logs/HEAD');
      const out = [];
      for (const line of raw.trim().split('\n').reverse()) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const m = line.slice(0, tab).match(/^\w+ (\w+) (.+?) <[^>]*> (\d+) [+-]\d{4}$/);
        if (!m) continue;
        out.push({ hash: m[1].slice(0, 7), author: m[2], ts: Number(m[3]) * 1000, msg: line.slice(tab + 1).replace(/^commit(?: \([^)]*\))?: /, '') });
        if (out.length >= n) break;
      }
      return out;
    } catch (e) {
      return null;                         /* not a git repository */
    }
  }

  topTags(n) {
    let tags = {};
    try { tags = this.app.metadataCache.getTags() || {}; } catch (e) { tags = {}; }
    return Object.entries(tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  }

  folderStats(depth, n) {
    const ex = parseList(this.settings.exclude);
    const m = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (isExcluded(f.path, ex)) continue;
      const parts = f.path.split('/');
      parts.pop();
      const key = parts.length ? parts.slice(0, depth).join('/') : '.';
      m.set(key, (m.get(key) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
  }

  /* one note, picked by a seed (the same note all day for "daily") */
  pickNote(seed) {
    const r = this.settings.random;
    const ex = parseList(this.settings.exclude);
    const files = this.app.vault.getMarkdownFiles()
      .filter((f) => !isExcluded(f.path, ex) && f.stat.size >= r.minChars)
      .sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) return null;
    const n = seed == null ? hashStr(dayKey(Date.now())) : Math.floor(seed * 1e6);
    return files[n % files.length];
  }

  openUrl(url) {
    let u = String(url).trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
    if (!/^https?:\/\//i.test(u)) { new Notice(ui('only http and https links can be opened.')); return; }
    window.open(u, '_blank');
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
      v: 4,
      settings: this.settings,
      focusLog: this.focusLog,
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
const DIR_CMDS = new Set(['cd', 'ls', 'll', 'tree']);

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
    this.registerDomEvent(window, 'resize', () => this.scheduleFit());
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
     the home page never scrolls, at any window size. the card is laid out, measured, and scaled
     down until it fits both ways. a smaller scale means the card is laid out wider, so the text
     reflows into more columns and fewer lines as it shrinks; that is what makes the fit converge
     on the largest scale that still fits. there is no floor and no fallback: if the tab is tiny,
     the page gets tiny. an unscrollable page beats a hidden one. */
  scheduleFit() {
    if (this.fitRaf) return;
    this.fitRaf = requestAnimationFrame(() => {
      this.fitRaf = 0;
      if (this.contentEl.isShown()) this.fit();
    });
  }

  /* the card can change height without the tab changing size (a late font, the battery row,
     an async section landing). compare, and refit when it really moved. */
  fitCheck() {
    const card = this.cardEl;
    if (!card || !this.contentEl.classList.contains('mh-fit')) return;
    if (Math.abs(card.offsetHeight - (this.lastH || 0)) > 1) this.scheduleFit();
  }

  fit() {
    const scroll = this.scrollEl;
    const card = this.cardEl;
    if (!scroll || !card) return;
    const host = this.contentEl;
    const L = this.s.layout;
    const c = this.s.card;

    card.style.transform = '';
    card.style.transformOrigin = '';
    card.style.width = '';
    card.style.margin = '';
    host.classList.remove('mh-fit', 'mh-compact', 'mh-flow');
    if (L.fit !== 'shrink') {
      /* the fit pass owns --mh-cols; hand it back before leaving, or the column count
         from the last fit would outlive the mode that asked for it. */
      host.style.setProperty('--mh-cols', String(L.columns));
      host.classList.add('mh-flow');
      return;
    }

    const cs = (scroll.ownerDocument.defaultView || window).getComputedStyle(scroll);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const availW = scroll.clientWidth - padL - padR;
    const availH = scroll.clientHeight - padT - padB;
    if (!(availW > 60 && availH > 60)) return;       /* not laid out yet */

    /* the column count follows the room there actually is, not the width the card is laid out
       at. otherwise a narrow tab would widen itself into three toothpick columns and scale the
       text into dust to get there. */
    const mainW = availW - (splitActive(this.s) ? L.sideWidth : 0);
    const cols = Math.max(1, Math.min(Number(L.columns) || 1, Math.floor(mainW / 290)));
    host.style.setProperty('--mh-cols', String(cols));

    const baseW = Math.min(availW, Math.max(160, cardWidth(this.s)));
    const heightAt = (k) => {
      card.style.width = (baseW / k) + 'px';
      return card.offsetHeight;
    };
    const visible = (k) => heightAt(k) * k;

    /* bisect for the largest scale that fits. the visible height only ever falls as k falls,
       so this is well behaved even when the column count changes under it. */
    const solve = () => {
      if (heightAt(1) <= availH) return 1;
      const floor = 0.18;
      let k;
      if (visible(floor) > availH) {
        k = floor;
      } else {
        let lo = floor;
        let hi = 1;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (visible(mid) <= availH) lo = mid; else hi = mid;
        }
        k = lo;
      }
      /* one exact correction, for rounding and for anything that refused to shrink.
         scaling the transform can only make the page smaller, so this always fits. */
      const h = heightAt(k);
      if (h * k > availH) k *= availH / (h * k);
      return k;
    };

    let k = solve();
    /* if fitting costs too much size, drop the decorative command lines and tighten the
       spacing first. less to read, and less height to squeeze. */
    if (k < 0.8) {
      host.classList.add('mh-compact');
      k = solve();
    }

    /* the last word on the fit: if anything at all is still too tall, scale the rest of the way
       out. this cannot loop forever, and it cannot leave a scrollbar behind. */
    let h = heightAt(k);
    for (let i = 0; i < 3 && h * k > availH; i++) {
      k *= availH / (h * k);
      h = heightAt(k);
    }
    this.lastH = h;
    const shownW = baseW;
    const shownH = h * k;
    const offX = padL + (c.hAlign === 'left' ? 0 : Math.max(0, (availW - shownW) / 2));
    const offY = padT + (c.vAlign === 'top' ? 0 : Math.max(0, (availH - shownH) / 2));

    host.classList.add('mh-fit');
    card.style.transformOrigin = '0 0';
    card.style.transform = 'translate(' + offX + 'px, ' + offY + 'px) scale(' + k + ')';
    card.style.width = (baseW / k) + 'px';
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
    const split = splitActive(s);
    let sideSec = null;
    for (const it of active) {
      const sec = this.makeSection(it);
      if (split && it.id === 'shell') sideSec = sec; else grid.appendChild(sec);
    }
    if (!active.length) grid.appendChild(el('div', 'mh-hint is-wide', '# every section is switched off. open settings > mish.home.'));
    if (sideSec) {
      /* sections on the left, the terminal as one tall pane on the right, like a tmux split */
      const wrap = el('div', 'mh-split');
      const main = el('div', 'mh-main');
      const pane = el('div', 'mh-side');
      main.appendChild(grid);
      pane.appendChild(sideSec);
      wrap.appendChild(main);
      wrap.appendChild(pane);
      card.appendChild(wrap);
    } else {
      card.appendChild(grid);
    }
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
    vars['--mh-termlines'] = String(s.terminal.height);
    applyVars(host, vars);
    setClassGroup(host, 'mh-shape-', s.pillShape);
    setClassGroup(host, 'mh-frame-', s.layout.frame);
    setClassGroup(host, 'mh-cols-', String(s.layout.columns));
    host.classList.toggle('mh-split-on', splitActive(s));
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
      case 'calendar': return ['cal', ''];
      case 'focus': return ['timer', '--pomodoro'];
      case 'system': return ['top', '-n1'];
      case 'links': return ['go', ''];
      case 'tags': return ['tags', '--top=' + s.tags.count];
      case 'folders': return ['du', '-h --max-depth=' + s.folders.depth];
      case 'random': return ['cat', ''];
      case 'git': return ['git', 'log --oneline -n' + s.git.count];
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
    const now = Date.now();
    if (this.refs.focus) this.updateFocus();
    if (this.refs.system && now - (this.sysAt || 0) >= 2000) {
      this.sysAt = now;
      const before = this.sysRows;
      try { this.fill_system(this.refs.system.body); } catch (e) { this.broke('system', e); }
      if (before !== this.sysRows) this.scheduleFit();      /* the battery row can show up late */
    }
    if (now - (this.fitAt || 0) >= 1000) {
      this.fitAt = now;
      this.fitCheck();
    }
    const minute = Math.floor(now / 60000);
    if (minute !== this.minute) {
      this.minute = minute;
      for (const id of ['greeting', 'calendar']) if (this.refs[id]) this.fill(id);
      if (this.refs.banner && this.s.banner.source === 'time') this.fill('banner');
      this.updatePrompt();
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
    else if (b.source === 'time') {
      const d = new Date();
      const h = this.s.clock.hour12 ? d.getHours() % 12 || 12 : d.getHours();
      text = pad(h) + ':' + pad(d.getMinutes());
    }
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
    if (g.summary) {
      const st = this.plugin.vaultStats();
      const counts = this.plugin.dayCounts('edits');
      const has = (d) => (counts.get(dayKey(d.getTime())) || 0) > 0;
      const cur = new Date();
      cur.setHours(0, 0, 0, 0);
      if (!has(cur)) cur.setDate(cur.getDate() - 1);
      let streak = 0;
      while (has(cur) && streak < 5000) { streak++; cur.setDate(cur.getDate() - 1); }
      const sum = el('div', 'mh-gsum');
      const bit = (n, label, cls) => {
        if (sum.childNodes.length) sum.appendChild(document.createTextNode(' · '));
        sum.appendChild(el('span', cls, String(n)));
        sum.appendChild(document.createTextNode(' ' + label));
      };
      bit(st.notes, st.notes === 1 ? 'note' : 'notes', 'mh-t0');
      bit(st.links, st.links === 1 ? 'link' : 'links', 'mh-t1');
      bit(streak + 'd', 'streak', 'mh-t3');
      body.appendChild(sum);
    }

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
      row.appendChild(el('span', 'mh-chev' + (sc.colour === 'rainbow' ? ' mh-c' + (i % COLOURS) : ''), '❯'));
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

  /* ══════════════════════════════════════════════════════════════════════
     more sections
     ══════════════════════════════════════════════════════════════════════ */

  /* a row of little cells. mode 'high' = fuller is worse (cpu, memory), 'low' = emptier is worse (battery) */
  barEl(frac, n, mode) {
    const f = Math.max(0, Math.min(1, frac));
    const bar = el('span', 'mh-pbar');
    const on = Math.round(f * n);
    const lvl = mode === 'low' ? (f < 0.2 ? 'bad' : f < 0.4 ? 'warn' : 'ok') : (f > 0.85 ? 'bad' : f > 0.6 ? 'warn' : 'ok');
    for (let i = 0; i < n; i++) bar.appendChild(el('i', i < on ? 'on mh-lv-' + lvl : ''));
    return bar;
  }

  openSearch(query) {
    const gs = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('global-search');
    if (gs && gs.instance && gs.instance.openGlobalSearch) gs.instance.openGlobalSearch(query);
    else this.plugin.runCommand('global-search:open');
  }

  /* ── calendar ──────────────────────────────────────────────────────────── */

  fill_calendar(body) {
    const c = this.s.calendar;
    body.replaceChildren();
    if (!this.calMonth) this.calMonth = moment().startOf('month');
    const month = this.calMonth.clone();
    const today = moment().format('YYYY-MM-DD');
    const marks = c.mark === 'none' ? null : this.plugin.dayCounts(c.mark === 'daily' ? 'daily' : 'edits');

    const head = el('div', 'mh-calhead');
    const step = (n) => { this.calMonth = this.calMonth.clone().add(n, 'months'); this.fill('calendar'); };
    if (c.arrows) {
      const prev = el('span', 'mh-calbtn', '←');
      prev.title = 'previous month';
      prev.addEventListener('click', () => step(-1));
      head.appendChild(prev);
    }
    const title = el('span', 'mh-caltitle', month.format('MMMM YYYY'));
    title.title = 'back to this month';
    title.addEventListener('click', () => { this.calMonth = moment().startOf('month'); this.fill('calendar'); });
    head.appendChild(title);
    if (c.arrows) {
      const next = el('span', 'mh-calbtn', '→');
      next.title = 'next month';
      next.addEventListener('click', () => step(1));
      head.appendChild(next);
    }
    body.appendChild(head);

    const startDow = this.s.weekStart === 'sun' ? 0 : 1;
    const grid = el('div', 'mh-cal' + (c.weekNumbers ? ' has-wk' : ''));
    if (c.weekNumbers) grid.appendChild(el('span', 'mh-calwd', 'wk'));
    for (let i = 0; i < 7; i++) grid.appendChild(el('span', 'mh-calwd', DAYS[(startDow + i) % 7].slice(0, 2)));
    const offset = (month.day() - startDow + 7) % 7;
    const start = month.clone().subtract(offset, 'days');
    const weeks = Math.ceil((offset + month.daysInMonth()) / 7);
    for (let w = 0; w < weeks; w++) {
      if (c.weekNumbers) grid.appendChild(el('span', 'mh-calwk', String(start.clone().add(w * 7 + 3, 'days').isoWeek())));
      for (let d = 0; d < 7; d++) {
        const day = start.clone().add(w * 7 + d, 'days');
        const key = day.format('YYYY-MM-DD');
        const n = marks ? marks.get(key) || 0 : 0;
        const cell = el('span', 'mh-day' + (day.month() !== month.month() ? ' is-out' : '') + (key === today ? ' is-today' : '') + (n > 0 ? ' has-note' : ''), String(day.date()));
        cell.title = key + (n ? ' · ' + n : '') + ' · click to open the daily note';
        cell.addEventListener('click', () => this.plugin.openDaily(day.clone()));
        grid.appendChild(cell);
      }
    }
    body.appendChild(grid);
  }

  /* ── focus timer ───────────────────────────────────────────────────────── */

  fill_focus(body) {
    body.replaceChildren();
    const f = {};
    const top = el('div', 'mh-fotop');
    f.mode = el('span', 'mh-fomode');
    f.time = el('span', 'mh-fotime');
    top.appendChild(f.mode);
    top.appendChild(f.time);
    body.appendChild(top);

    f.bar = el('span', 'mh-pbar mh-fobar');
    f.cells = [];
    const N = 28;
    for (let i = 0; i < N; i++) {
      const cell = el('i', 'mh-c' + Math.min(COLOURS - 1, Math.floor((i / N) * COLOURS)));
      f.bar.appendChild(cell);
      f.cells.push(cell);
    }
    body.appendChild(f.bar);

    const btns = el('div', 'mh-fobtns');
    const mk = (label, fn) => {
      const b = el('span', 'mh-btn', label);
      b.addEventListener('click', () => { fn(); for (const v of this.plugin.views) v.updateFocus(); });
      btns.appendChild(b);
      return b;
    };
    f.toggle = mk('start', () => this.plugin.focusToggle());
    mk('reset', () => this.plugin.focusReset());
    mk('skip', () => this.plugin.focusSkip());
    body.appendChild(btns);
    f.sum = el('div', 'mh-fosum');
    body.appendChild(f.sum);
    this.focusRefs = f;
    this.updateFocus();
  }

  /* redraws only what changes every second, so the section never flickers */
  updateFocus() {
    const f = this.focusRefs;
    if (!f || !f.time.isConnected) return;
    const p = this.plugin;
    const st = p.focus;
    const left = p.focusLeft();
    const total = p.focusLen(st.mode);
    const secs = Math.ceil(left / 1000);
    setText(f.time, pad(Math.floor(secs / 60)) + ':' + pad(secs % 60));
    setText(f.mode, st.mode === 'focus' ? 'focus' : st.mode === 'long' ? 'long break' : 'break');
    const cls = 'mh-fomode ' + (st.mode === 'focus' ? 'mh-t0' : 'mh-t3');
    if (f.mode.className !== cls) f.mode.className = cls;
    const on = Math.round((total > 0 ? 1 - left / total : 0) * f.cells.length);
    f.cells.forEach((cell, i) => cell.classList.toggle('on', i < on));
    setText(f.toggle, st.running ? 'pause' : left < total ? 'resume' : 'start');
    const n = p.focusToday();
    setText(f.sum, n + (n === 1 ? ' session' : ' sessions') + ' today');
  }

  /* ── links ─────────────────────────────────────────────────────────────── */

  fill_links(body) {
    const l = this.s.links;
    body.replaceChildren();
    const items = parseShortcuts(l.items);
    if (!items.length) { body.appendChild(this.hint('no links. add some in settings.')); return; }
    body.classList.toggle('is-row', l.layout === 'row');
    items.forEach((it, i) => {
      const row = el('div', 'mh-sc');
      row.appendChild(el('span', 'mh-chev' + (l.colour === 'rainbow' ? ' mh-c' + (i % COLOURS) : ''), '❯'));
      row.appendChild(el('span', 'mh-sclabel' + (l.colour === 'rainbow' ? ' mh-c' + (i % COLOURS) : ''), it.label));
      let host = '';
      try { host = new URL(/^[a-z]+:\/\//i.test(it.id) ? it.id : 'https://' + it.id).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
      if (host && l.layout !== 'row') row.appendChild(el('span', 'mh-kbd', host));
      row.title = it.id;
      row.addEventListener('click', () => this.plugin.openUrl(it.id));
      body.appendChild(row);
    });
  }

  /* ── tags and folders: little bar charts ───────────────────────────────── */

  barRows(body, rows, nameClass, onClick) {
    const max = rows.length ? rows[0][1] : 1;
    const list = el('div', 'mh-bars');
    rows.forEach(([name, n], i) => {
      const row = el('div', 'mh-brow');
      row.appendChild(el('span', 'mh-name ' + nameClass(i), name));
      const bar = el('span', 'mh-pbar mh-minibar');
      const on = Math.max(1, Math.round((n / max) * 10));
      for (let k = 0; k < 10; k++) bar.appendChild(el('i', k < on ? 'on mh-c' + (i % COLOURS) : ''));
      row.appendChild(bar);
      row.appendChild(el('span', 'mh-age', String(n)));
      row.addEventListener('click', () => onClick(name));
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  fill_tags(body) {
    body.replaceChildren();
    const list = this.plugin.topTags(this.s.tags.count);
    if (!list.length) { body.appendChild(this.hint('no tags yet. write #something.')); return; }
    this.barRows(body, list, (i) => 'mh-c' + (i % COLOURS), (tag) => this.openSearch('tag:' + tag));
  }

  fill_folders(body) {
    body.replaceChildren();
    const f = this.s.folders;
    const list = this.plugin.folderStats(f.depth, f.count);
    if (!list.length) { body.appendChild(this.hint('no notes yet.')); return; }
    this.barRows(body, list.map(([name, n]) => [name === '.' ? './' : name + '/', n]), () => 'mh-t4', (name) => {
      if (name !== './') this.exec('ls "' + name.replace(/\/$/, '') + '"');
    });
  }

  /* ── random note: a peek, like cat ─────────────────────────────────────── */

  async fill_random(body) {
    const r = this.s.random;
    const token = (this.randToken = (this.randToken || 0) + 1);
    const file = this.plugin.pickNote(r.mode === 'random' ? this.quoteSeed : null);
    if (!file) { body.replaceChildren(this.hint('no notes long enough yet.')); return; }
    const text = await this.app.vault.cachedRead(file);
    if (token !== this.randToken || !body.isConnected) return;
    body.replaceChildren();
    if (this.refs.random && this.refs.random.arg) setText(this.refs.random.arg, '"' + file.basename + '.md"');
    const title = el('div', 'mh-rtitle mh-t1', file.basename);
    title.addEventListener('click', (ev) => this.plugin.openFile(file, ev));
    body.appendChild(title);
    const lines = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/[*_`>]/g, '').trim())
      .filter(Boolean)
      .slice(0, r.lines);
    lines.forEach((l, i) => {
      const row = el('div', 'mh-rline');
      row.appendChild(el('span', 'mh-rnum', String(i + 1)));
      row.appendChild(el('span', 'mh-rtext', l));
      row.addEventListener('click', (ev) => this.plugin.openFile(file, ev, i));
      body.appendChild(row);
    });
    if (!lines.length) body.appendChild(this.hint('(empty note)'));
  }

  /* ── system ────────────────────────────────────────────────────────────── */

  fill_system(body) {
    const s = this.s.system;
    const p = this.plugin;
    body.replaceChildren();
    const kv = el('div', 'mh-sys');
    let rows = 0;
    const row = (key, frac, text, mode) => {
      rows++;
      kv.appendChild(el('span', 'mh-k', key));
      const v = el('span', 'mh-sv');
      if (frac != null) v.appendChild(this.barEl(frac, s.barWidth, mode));
      v.appendChild(el('span', 'mh-sval', text));
      kv.appendChild(v);
    };
    if (s.cpu) {
      const c = p.cpuNow();
      row('cpu', c == null ? null : c / 100, c == null ? '…' : c + '%', 'high');
    }
    if (s.memory) {
      const m = p.memNow();
      if (m) row('mem', m.used / m.total, (m.used / 1073741824).toFixed(1) + '/' + (m.total / 1073741824).toFixed(0) + 'g', 'high');
    }
    if (s.battery && p.battery) row('batt', p.battery.level, Math.round(p.battery.level * 100) + '%' + (p.battery.charging ? ' ⚡' : ''), 'low');
    if (s.uptime) {
      const up = p.sysUptime();
      row('up', null, (up == null ? '' : fmtUp(up) + ' · ') + 'obsidian ' + fmtUp(performance.now()));
    }
    if (s.network) row('net', null, navigator.onLine ? 'online' : 'offline');
    this.sysRows = rows;
    if (!rows) body.appendChild(this.hint('every row is switched off.'));
    else body.appendChild(kv);
  }

  /* ── git log ───────────────────────────────────────────────────────────── */

  async fill_git(body) {
    const list = await this.plugin.gitLog(this.s.git.count);
    if (!body.isConnected) return;
    body.replaceChildren();
    if (list === null) { body.appendChild(this.hint('not a git repository.')); return; }
    if (!list.length) { body.appendChild(this.hint('no commits yet.')); return; }
    for (const c of list) {
      const row = el('div', 'mh-gl');
      row.appendChild(el('span', 'mh-t2', c.hash));
      const msg = el('span', 'mh-glmsg', c.msg);
      msg.title = c.msg;
      row.appendChild(msg);
      row.appendChild(el('span', 'mh-age', ageOf(c.ts)));
      body.appendChild(row);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     the terminal
     ══════════════════════════════════════════════════════════════════════ */

  cwdLabel() {
    return (this.s.pathLabel || '~/' + this.app.vault.getName()) + (this.plugin.cwd ? '/' + this.plugin.cwd : '');
  }

  termTitle() {
    return this.s.terminal.title.replace(/\{(user|host|path|vault)\}/g, (m, k) => (
      k === 'user' ? this.userName() : k === 'host' ? this.plugin.detected.host : k === 'path' ? this.cwdLabel() : this.app.vault.getName()
    ));
  }

  /* one line of output. pieces with file / run / url are clickable. */
  lineEl(line) {
    const d = el('div', 'mh-ln');
    const parts = Array.isArray(line) ? line : [line];
    for (const part of parts) {
      if (part == null) continue;
      if (typeof part === 'string') { d.appendChild(document.createTextNode(part)); continue; }
      const sp = el('span', part.c ? 'mh-' + part.c : '', part.t);
      if (part.file) {
        sp.classList.add('is-link');
        sp.title = part.file.path;
        sp.addEventListener('click', (ev) => this.plugin.openFile(part.file, ev, part.line));
      } else if (part.run) {
        sp.classList.add('is-link');
        sp.title = part.run;
        sp.addEventListener('click', () => this.exec(part.run));
      } else if (part.url) {
        sp.classList.add('is-link');
        sp.title = part.url;
        sp.addEventListener('click', () => this.plugin.openUrl(part.url));
      }
      d.appendChild(sp);
    }
    if (!d.childNodes.length) d.appendChild(document.createTextNode('\u00a0'));
    return d;
  }

  entryEl(e) {
    const box = el('div', 'mh-te');
    const c = el('div', 'mh-ln mh-tcmd');
    c.appendChild(el('span', 'mh-chev' + (e.ok ? '' : ' is-bad'), '❯'));
    c.appendChild(document.createTextNode(' '));
    const code = el('span', 'mh-tcode');
    this.paintLine(code, e.cmd);
    c.appendChild(code);
    box.appendChild(c);
    for (const l of e.lines) box.appendChild(this.lineEl(l));
    return box;
  }

  welcomeEl() {
    const box = el('div', 'mh-te is-welcome');
    box.appendChild(this.lineEl([T('mish.home', 't0'), T(' · type ', 'dim'), T('help', 't3'), T(' for commands · tab completes · ', 'dim'), T('/', 't3'), T(' jumps here', 'dim')]));
    return box;
  }

  renderScrollback() {
    const sh = this.refs.shell;
    if (!sh || !sh.out) return;
    sh.out.replaceChildren();
    const sb = this.plugin.scrollback;
    if (!sb.length && this.s.terminal.welcome) sh.out.appendChild(this.welcomeEl());
    for (const e of sb) sh.out.appendChild(this.entryEl(e));
    sh.out.scrollTop = sh.out.scrollHeight;
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

  /* the powerline line above the prompt: where you are, the git branch, did the last command work */
  updatePrompt() {
    const sh = this.refs.shell;
    if (!sh || !sh.pl) return;
    const t = this.s.terminal;
    const ok = this.plugin.lastOk;
    sh.chev.classList.toggle('is-bad', !ok);
    sh.pl.replaceChildren();
    sh.pl.classList.toggle('is-hidden', t.prompt !== 'powerline');
    if (sh.title) setText(sh.title, this.termTitle());
    if (t.prompt !== 'powerline') return;
    const group = el('span', 'mh-plseg');
    group.appendChild(el('span', 'mh-seg mh-path', this.cwdLabel()));
    if (this.s.pills.git && this.plugin.branch) group.appendChild(el('span', 'mh-seg mh-git', this.plugin.branch));
    group.appendChild(el('span', 'mh-seg ' + (ok ? 'mh-ok' : 'mh-err'), ok ? '✓' : '✘'));
    sh.pl.appendChild(group);
    if (t.rprompt) {
      const d = new Date();
      sh.pl.appendChild(el('span', 'mh-rp', pad(d.getHours()) + ':' + pad(d.getMinutes())));
    }
  }

  /* a grey suggestion from your history, fish-style. press → or End to take it. */
  suggestion(v) {
    if (!v) return '';
    const h = this.plugin.history;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].length > v.length && h[i].startsWith(v)) return h[i].slice(v.length);
    }
    return '';
  }

  fill_shell(body) {
    const t = this.s.terminal;
    body.replaceChildren();
    const win = el('div', 'mh-term mh-term-' + t.style);
    const refs = this.refs.shell;

    if (t.style === 'window' && t.titleBar) {
      const bar = el('div', 'mh-tbar');
      const dots = el('span', 'mh-tdots');
      ['mh-bg0', 'mh-bg2', 'mh-bg3'].forEach((c, i) => {
        const d = el('i', 'mh-tdot ' + c);
        if (i === 0) { d.title = 'clear'; d.addEventListener('click', () => this.exec('clear')); }
        dots.appendChild(d);
      });
      bar.appendChild(dots);
      refs.title = el('span', 'mh-ttitle');
      bar.appendChild(refs.title);
      bar.appendChild(el('span', 'mh-tcorner', 'zsh'));
      win.appendChild(bar);
    }

    const out = el('div', 'mh-tout');
    const menu = el('div', 'mh-menu');
    const prompt = el('div', 'mh-tprompt');
    const pl = el('div', 'mh-pl');
    const line = el('div', 'mh-line');
    const chev = el('span', 'mh-chev', '❯');
    line.appendChild(chev);

    const input = el('input', 'mh-input');
    input.type = 'text';
    input.placeholder = t.placeholder;
    input.spellcheck = false;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');

    /* the text is drawn twice: the input's own copy is transparent, a coloured copy sits behind it
       (with the grey suggestion after it), and the caret is a hand-drawn block, like mish.eza */
    const wrap = el('div', 'mh-inwrap');
    const hl = el('div', 'mh-hl');
    const row = el('span', 'mh-hl-row');
    const hlIn = el('span', 'mh-hl-in');
    const ghost = el('span', 'mh-ghost');
    const meas = el('span', 'mh-hl-meas');
    const caret = el('div', 'mh-caret');
    row.appendChild(hlIn);
    row.appendChild(ghost);
    hl.appendChild(row);
    hl.appendChild(meas);
    hl.appendChild(caret);
    wrap.appendChild(hl);
    wrap.appendChild(input);
    line.appendChild(wrap);

    win.appendChild(out);
    win.appendChild(menu);
    prompt.appendChild(pl);
    prompt.appendChild(line);
    win.appendChild(prompt);
    body.appendChild(win);

    Object.assign(refs, { out, menu, pl, chev, input, ghost });

    const paint = () => {
      try { this.paintLine(hlIn, input.value); } catch (e) { hlIn.textContent = input.value; }
      const v = input.value;
      const pos = input.selectionStart == null ? v.length : input.selectionStart;
      const atEnd = pos === v.length && input.selectionEnd === v.length;
      const focused = input.ownerDocument.activeElement === input;
      ghost.textContent = this.s.terminal.suggest && atEnd && focused ? this.suggestion(v) : '';
      row.style.transform = 'translateX(' + (-input.scrollLeft) + 'px)';
      meas.textContent = v.slice(0, pos);
      const x = meas.getBoundingClientRect().width - input.scrollLeft;
      caret.style.transform = 'translate(' + x + 'px, -50%)';
      caret.textContent = v.charAt(pos);
      caret.style.animation = 'none';
      void caret.offsetWidth;
      caret.style.animation = '';
      wrap.classList.toggle('is-empty', !v);
      wrap.classList.toggle('has-sel', input.selectionStart !== input.selectionEnd);
      wrap.classList.toggle('is-focus', focused);
    };
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); paint(); },
    });
    ['input', 'scroll', 'keyup', 'mouseup', 'focus', 'blur', 'select'].forEach((ev) => input.addEventListener(ev, paint));
    input.addEventListener('input', () => { this.compl = null; this.showMenu([], -1); });
    paint();

    /* enter runs. tab completes (again to cycle). → takes the suggestion. up / down walk the history.
       ctrl-l clears, ctrl-c drops the line, ctrl-u clears the line, esc leaves. */
    let at = -1;
    const hist = this.plugin.history;
    input.addEventListener('keydown', (e) => {
      requestAnimationFrame(paint);
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = input.value;
        input.value = '';
        at = -1;
        this.compl = null;
        this.showMenu([], -1);
        this.exec(value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.complete(input, e.shiftKey);
      } else if (e.key === 'ArrowRight' || e.key === 'End') {
        const v = input.value;
        if (input.selectionStart === v.length && input.selectionEnd === v.length) {
          const s = this.suggestion(v);
          if (s) { e.preventDefault(); input.value = v + s; }
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hist.length) return;
        at = Math.min(at + 1, hist.length - 1);
        input.value = hist[hist.length - 1 - at];
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        at = Math.max(at - 1, -1);
        input.value = at < 0 ? '' : hist[hist.length - 1 - at];
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.exec('clear');
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        if (v) { this.plugin.scrollback.push({ cmd: v + '^C', lines: [], ok: true }); this.renderScrollback(); }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        input.value = '';
      } else if (e.key === 'Escape') {
        input.value = '';
        at = -1;
        this.compl = null;
        this.showMenu([], -1);
        input.blur();
      }
    });
    line.addEventListener('mousedown', (e) => {
      if (e.target !== input) { e.preventDefault(); input.focus(); }
    });
    prompt.addEventListener('mousedown', (e) => {
      if (e.target === prompt || e.target === pl) { e.preventDefault(); input.focus(); }
    });

    this.renderScrollback();
    this.updatePrompt();
    this.runStartup();
  }

  /* the tall pane would be a black box with one line in it, so the first time it opens in a session it
     runs a few commands, like a login message. they are not added to your history, and clear empties them. */
  runStartup() {
    const p = this.plugin;
    if (!splitActive(this.s) || p.startupDone || p.scrollback.length) return;
    const list = String(this.s.terminal.startup || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6);
    if (!list.length) return;
    /* wait for the page to be laid out: in a narrow tab the terminal is a short window under the sections, and a
       login message would just scroll past in it */
    window.setTimeout(async () => {
      const sh = this.refs.shell;
      if (p.startupDone || p.scrollback.length || !sh || !sh.out || sh.out.clientHeight < 140) return;
      p.startupDone = true;
      for (const c of list) {
        try { await this.exec(c, true); } catch (e) { console.error('mish.home: startup command failed', e); }
      }
    }, 250);
  }

  /* ── completion ────────────────────────────────────────────────────────── */

  noteNames() {
    return Array.from(new Set(this.app.vault.getMarkdownFiles().map((f) => f.basename))).sort((a, b) => a.localeCompare(b));
  }

  childFolders(path) {
    const folder = path ? this.app.vault.getAbstractFileByPath(normalizePath(path)) : this.app.vault.getRoot();
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((c) => c instanceof TFolder && c.name[0] !== '.').map((c) => c.name).sort((a, b) => a.localeCompare(b));
  }

  /* what could the word under the cursor become: { start, end, items: [{ label, insert, space }] } */
  candidates(input) {
    const v = input.value;
    const pos = input.selectionStart == null ? v.length : input.selectionStart;
    const before = v.slice(0, pos);
    const first = before.match(/^(\s*)(\S*)$/);
    if (first) {
      const word = first[2].toLowerCase();
      const names = Object.keys(this.cmds).filter((n) => !this.cmds[n].hidden && n.startsWith(word)).sort();
      return { start: first[1].length, end: pos, items: names.map((n) => ({ label: n, insert: n, space: true })) };
    }
    const m = before.match(/^(\s*)(\S+)\s+(.*)$/);
    if (!m) return null;
    const cmd = m[2].toLowerCase();
    const typed = m[3];
    const start = before.length - typed.length;
    const bare = typed.replace(/^["']/, '');
    const low = bare.toLowerCase();
    const quote = (n) => (/\s/.test(n) ? '"' + n + '"' : n);
    let items = [];
    if (NOTE_CMDS.has(cmd)) {
      const names = this.noteNames();
      let hit = names.filter((n) => n.toLowerCase().startsWith(low));
      if (!hit.length && low) hit = names.filter((n) => n.toLowerCase().includes(low));
      items = hit.map((n) => ({ label: n, insert: quote(n), space: true }));
    } else if (DIR_CMDS.has(cmd)) {
      const slash = bare.lastIndexOf('/');
      const dirPart = slash >= 0 ? bare.slice(0, slash + 1) : '';
      const namePart = slash >= 0 ? bare.slice(slash + 1) : bare;
      let base = this.plugin.cwd;
      try { base = this.resolveDir(dirPart || '.'); } catch (e) { return null; }
      const kids = this.childFolders(base).filter((n) => n.toLowerCase().startsWith(namePart.toLowerCase()));
      if (!dirPart && '..'.startsWith(namePart)) kids.unshift('..');
      items = kids.map((n) => ({ label: n + '/', insert: dirPart + n + '/', space: false }));
    } else {
      const lists = {
        palette: ['mish'].concat(Object.keys(PALETTES)),
        focus: ['start', 'pause', 'reset', 'skip', 'status'],
        timer: ['start', 'pause', 'reset', 'skip', 'status'],
        git: ['log', 'branch'],
        help: Object.keys(this.cmds).filter((n) => !this.cmds[n].hidden).sort(),
        man: Object.keys(this.cmds).filter((n) => !this.cmds[n].hidden).sort(),
        go: parseShortcuts(this.s.links.items).map((x) => x.label.toLowerCase()),
      };
      if (lists[cmd]) items = lists[cmd].filter((n) => n.startsWith(low)).map((n) => ({ label: n, insert: n, space: true }));
    }
    return { start, end: pos, items };
  }

  showMenu(items, sel) {
    const sh = this.refs.shell;
    if (!sh || !sh.menu) return;
    sh.menu.replaceChildren();
    sh.menu.classList.toggle('is-open', items.length > 1);
    if (items.length < 2) return;
    items.slice(0, 14).forEach((it, i) => sh.menu.appendChild(el('span', 'mh-chip' + (i === sel ? ' is-sel' : ''), it.label)));
    if (items.length > 14) sh.menu.appendChild(el('span', 'mh-chip is-more', '+' + (items.length - 14)));
  }

  /* tab: finish the word. several choices: fill what they share and show a menu, then tab cycles. */
  complete(input, back) {
    const st = this.compl;
    if (st && input.value === st.last) {
      st.i = (st.i + (back ? -1 : 1) + st.items.length) % st.items.length;
      const it = st.items[st.i];
      const next = st.before + it.insert + st.after;
      st.last = next;
      input.value = next;
      const caretAt = (st.before + it.insert).length;
      input.setSelectionRange(caretAt, caretAt);
      this.showMenu(st.items, st.i);
      return;
    }
    const c = this.candidates(input);
    if (!c || !c.items.length) return;
    const v = input.value;
    const before = v.slice(0, c.start);
    const tail = v.slice(c.end);
    if (c.items.length === 1) {
      const it = c.items[0];
      input.value = before + it.insert + (it.space ? ' ' : '') + tail;
      const caretAt = (before + it.insert + (it.space ? ' ' : '')).length;
      input.setSelectionRange(caretAt, caretAt);
      this.showMenu([], -1);
      return;
    }
    const typed = v.slice(c.start, c.end);
    const cp = commonPrefix(c.items.map((x) => x.insert));
    let now = v;
    if (cp.length > typed.length) {
      now = before + cp + tail;
      input.value = now;
      input.setSelectionRange((before + cp).length, (before + cp).length);
    }
    this.compl = { items: c.items, i: -1, before, after: tail, last: now };
    this.showMenu(c.items, -1);
  }

  /* ── running things ────────────────────────────────────────────────────── */

  async exec(line, quiet) {
    const raw = line.trim();
    if (!raw) return;
    const p = this.plugin;
    if (!quiet) {
      if (p.history[p.history.length - 1] !== raw) p.history.push(raw);
      p.persist();
    }

    const tokens = tokenise(raw);
    const name = tokens[0].toLowerCase();
    const entry = { cmd: raw, lines: [], ok: true };
    let cleared = false;
    try {
      const cmd = this.cmds[name];
      if (!cmd) throw new CmdError('zsh: command not found: ' + tokens[0]);
      const out = await cmd.run(tokens.slice(1), raw.slice(raw.indexOf(tokens[0]) + tokens[0].length).trim());
      if (out === CLEAR) cleared = true;
      else entry.lines = toLines(out);
    } catch (e) {
      entry.ok = false;
      if (e instanceof CmdError) entry.lines = e.lines || [[T(e.message, 't0')]];
      else {
        console.error(e);
        entry.lines = [[T(name + ': ' + ((e && e.message) || 'failed'), 't0')]];
      }
    }
    if (cleared) {
      p.scrollback.length = 0;
      p.lastOk = true;
    } else {
      entry.lines = entry.lines.slice(0, 300);
      p.scrollback.push(entry);
      if (p.scrollback.length > 60) p.scrollback.shift();
      p.lastOk = entry.ok;
    }
    const sh = this.refs.shell;                   /* a command like reload may have rebuilt the page */
    if (sh && sh.out) {
      if (cleared) this.renderScrollback();
      else {
        const w = sh.out.querySelector('.is-welcome');
        if (w) w.remove();
        sh.out.appendChild(this.entryEl(entry));
        while (sh.out.childNodes.length > 60) sh.out.removeChild(sh.out.firstChild);
        sh.out.scrollTop = sh.out.scrollHeight;
      }
    }
    this.updatePrompt();
  }

  /* a folder, resolved against the terminal's current folder. throws if it is not there. */
  resolveDir(arg, emptyIsCwd) {
    let a = String(arg || '').trim().replace(/^["']|["']$/g, '');
    let base = this.plugin.cwd;
    if (!a) return emptyIsCwd ? base : '';      /* cd alone goes home; ls and tree alone mean here */
    if (a === '~') return '';
    if (a[0] === '/') { base = ''; a = a.slice(1); } else if (a.indexOf('~/') === 0) { base = ''; a = a.slice(2); }
    const parts = base ? base.split('/') : [];
    for (const seg of a.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop(); else parts.push(seg);
    }
    const path = parts.join('/');
    if (path && !(this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFolder)) throw new CmdError('no such folder: ' + String(arg).trim());
    return path;
  }

  /* one note for a typed name. if several match, the error lists them (clickable). */
  oneNote(query) {
    if (!query) throw new CmdError('which note?');
    const hits = this.plugin.findNotes(query);
    if (!hits.length) throw new CmdError('no note called ' + query);
    if (hits.length > 1 && hits[0].basename.toLowerCase() !== String(query).toLowerCase()) {
      throw new CmdError('several notes match', hits.slice(0, 10).map((f) => [LINK(f.path, f, 't3')]).concat([[T('be more specific', 'dim')]]));
    }
    return hits[0];
  }

  fileName(f) { return f.extension === 'md' ? f.basename : f.name; }

  defineCommands() {
    const plugin = this.plugin;
    const cmds = {};
    const def = (names, usage, desc, group, run, hidden) => {
      const list = [].concat(names);
      list.forEach((n, i) => { cmds[n] = { usage, desc, group, run, hidden: Boolean(hidden), alias: i > 0, primary: list[0] }; });
    };
    const exclude = () => parseList(this.s.exclude);
    const sortKids = (a, b) => {
      const fa = a instanceof TFolder;
      const fb = b instanceof TFolder;
      return fa === fb ? a.name.localeCompare(b.name) : fa ? -1 : 1;
    };
    const kidSeg = (k) => (k instanceof TFolder
      ? RUN(k.name + '/', 'cd "' + k.path + '"', 't4')
      : LINK(this.fileName(k), k, 't' + kindColour(k)));
    const bar = (frac, n, mode) => {
      const f = Math.max(0, Math.min(1, frac));
      const on = Math.round(f * n);
      const lvl = mode === 'low' ? (f < 0.2 ? 'bg0' : f < 0.4 ? 'bg2' : 'bg3') : (f > 0.85 ? 'bg0' : f > 0.6 ? 'bg2' : 'bg3');
      return [T(' '.repeat(on), lvl), T(' '.repeat(n - on), 'bgdim')];
    };
    const statusLine = () => {
      const st = plugin.focus;
      const secs = Math.ceil(plugin.focusLeft() / 1000);
      return [[T(st.mode === 'focus' ? 'focus' : st.mode === 'long' ? 'long break' : 'break', st.mode === 'focus' ? 't0' : 't3'),
        '  ' + pad(Math.floor(secs / 60)) + ':' + pad(secs % 60) + '  ', T(st.running ? 'running' : 'paused', 'dim'),
        T('  ·  ' + plugin.focusToday() + ' done today', 'dim')]];
    };
    const syncFocus = () => { for (const v of plugin.views) v.updateFocus(); };

    /* ── go ── */
    def('help', 'help [command]', 'list the commands, or explain one', 'look', (args) => {
      if (args[0]) {
        const c = cmds[args[0].toLowerCase()];
        if (!c) throw new CmdError('help: no such command: ' + args[0]);
        return [[T(c.usage, 't3'), T('   ' + c.desc, 'dim')]];
      }
      const names = { go: 'go', read: 'read', write: 'write', time: 'time', info: 'info', look: 'look', fun: 'fun' };
      const rows = [];
      for (const g of Object.keys(names)) {
        const members = Object.keys(cmds).filter((k) => !cmds[k].alias && !cmds[k].hidden && cmds[k].group === g);
        const segs = [T(names[g].padEnd(7), 'dim')];
        members.forEach((k, i) => { if (i) segs.push('  '); segs.push(RUN(k, 'help ' + k, 't3')); });
        rows.push(segs);
      }
      rows.push([T('click a command for its usage · tab completes · ↑ ↓ history · ctrl-l clears', 'dim')]);
      return rows;
    });
    def('man', 'man <command>', 'same as help', 'look', (args) => cmds.help.run(args), true);

    def(['open', 'cat', 'edit', 'vim', 'less'], 'open <note | url>', 'open a note by name, or a web address', 'go', async (args, rest) => {
      if (/^https?:\/\//i.test(rest)) { plugin.openUrl(rest); return [[T('opening ', 'dim'), GO(rest, rest, 't3')]]; }
      const f = this.oneNote(args.join(' '));
      await plugin.openFile(f);
      return [[T('opened ', 'dim'), LINK(f.path, f, 't3')]];
    });
    cmds.cat = { usage: 'cat <note>', desc: 'print a note here', group: 'read', alias: false, primary: 'cat', hidden: false, run: async (args) => {
      const f = this.oneNote(args.join(' '));
      const text = await this.app.vault.cachedRead(f);
      const all = text.split(/\r?\n/);
      const out = [[LINK(f.path, f, 't1')]];
      let fm = all[0] === '---';
      let i = 0;
      for (; i < all.length && out.length < 40; i++) {
        const l = all[i];
        if (fm) { out.push([T(l, 'dim')]); if (i > 0 && l === '---') fm = false; continue; }
        if (/^#+\s/.test(l)) out.push([T(l, 't0')]);
        else if (/^\s*[-*+]\s+\[ \]/.test(l)) out.push([T(l, 't3')]);
        else out.push(l);
      }
      if (i < all.length) out.push([T('… ' + (all.length - i) + ' more lines. ', 'dim'), RUN('open ' + (f.basename.includes(' ') ? '"' + f.basename + '"' : f.basename), 'open "' + f.basename + '"', 't3')]);
      return out;
    } };

    def('cd', 'cd [folder]', 'change the terminal folder (new, ls and tree use it)', 'go', (args) => {
      plugin.cwd = this.resolveDir(args.join(' '));
      this.updatePrompt();
      return [];
    });
    def('pwd', 'pwd', 'where you are', 'go', () => [[this.cwdLabel()]]);
    def(['ls', 'll'], 'ls [-l] [folder]', 'list a folder', 'go', (args) => {
      const long = args.includes('-l');
      const dir = this.resolveDir(args.filter((a) => a[0] !== '-').join(' '), true);
      const folder = dir ? this.app.vault.getAbstractFileByPath(normalizePath(dir)) : this.app.vault.getRoot();
      const kids = folder.children.filter((c) => c.name[0] !== '.').sort(sortKids);
      if (!kids.length) return [[T('(empty)', 'dim')]];
      if (long) {
        return kids.slice(0, 40).map((k) => [T((k instanceof TFolder ? '-' : ageOf(k.stat.mtime)).padStart(4) + '  ', 'dim'),
          T((k instanceof TFolder ? '' : fmtSize(k.stat.size)).padStart(8) + '  ', 'dim'), kidSeg(k)]);
      }
      const segs = [];
      kids.slice(0, 80).forEach((k, i) => { if (i) segs.push('  '); segs.push(kidSeg(k)); });
      if (kids.length > 80) segs.push(T('  … +' + (kids.length - 80), 'dim'));
      return [segs];
    });
    def('tree', 'tree [folder] [-L depth]', 'a folder as a tree', 'go', (args) => {
      let depth = 2;
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-L' && args[i + 1]) { depth = num(args[i + 1], 1, 4, 2); i++; } else rest.push(args[i]);
      }
      const dir = this.resolveDir(rest.join(' '), true);
      const root = dir ? this.app.vault.getAbstractFileByPath(normalizePath(dir)) : this.app.vault.getRoot();
      const out = [[T(dir || '.', 't4')]];
      const walk = (folder, prefix, d) => {
        const kids = folder.children.filter((c) => c.name[0] !== '.').sort(sortKids);
        kids.forEach((k, i) => {
          if (out.length >= 60) return;
          const last = i === kids.length - 1;
          out.push([T(prefix + (last ? '`-- ' : '|-- '), 'dim'), kidSeg(k)]);
          if (k instanceof TFolder && d > 1) walk(k, prefix + (last ? '    ' : '|   '), d - 1);
        });
      };
      walk(root, '', depth);
      if (out.length >= 60) out.push([T('… (cut at 60 lines)', 'dim')]);
      return out;
    });
    def('new', 'new [name]', 'make a note in this folder and open it', 'go', async (args) => {
      const f = await plugin.createNote(args.join(' '), plugin.cwd);
      return [[T('created ', 'dim'), LINK(f.path, f, 't3')]];
    });
    def('daily', 'daily', "open today's daily note", 'go', async () => {
      const f = await plugin.openDaily();
      return [[T('opened ', 'dim'), LINK(f.path, f, 't3')]];
    });
    def('random', 'random', 'open a random note', 'go', async () => {
      const f = await plugin.openRandom();
      if (!f) throw new CmdError('no notes yet');
      return [[T('opened ', 'dim'), LINK(f.path, f, 't3')]];
    });
    def('go', 'go [link]', 'open one of your links in the browser', 'go', (args) => {
      const links = parseShortcuts(this.s.links.items);
      if (!args.length) {
        if (!links.length) throw new CmdError('no links. add some in settings.');
        return links.map((l) => [T('❯ ', 't3'), GO(l.label, l.id, 'fg'), T('  ' + l.id, 'dim')]);
      }
      const q = args.join(' ').toLowerCase();
      const hit = links.find((l) => l.label.toLowerCase() === q) || links.find((l) => l.label.toLowerCase().startsWith(q));
      if (!hit) throw new CmdError('go: no link called ' + q);
      plugin.openUrl(hit.id);
      return [[T('opening ', 'dim'), GO(hit.label, hit.id, 't3')]];
    });

    /* ── read & search ── */
    def('recent', 'recent [n]', 'the notes you touched last', 'read', (args) => {
      const n = num(args[0], 1, 30, 8);
      const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, exclude())).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, n);
      return files.map((f) => [T(ageOf(f.stat.mtime).padStart(4) + '  ', 'dim'), LINK(f.path, f, 't3')]);
    });
    def('find', 'find <name>', 'find notes by name', 'read', (args) => {
      const q = args.join(' ');
      if (!q) throw new CmdError('find: what are we looking for?');
      const hits = plugin.findNotes(q).slice(0, 12);
      if (!hits.length) throw new CmdError('find: nothing called ' + q);
      return hits.map((f) => [LINK(f.path, f, 't3')]);
    });
    def('grep', 'grep <text>', 'search inside your notes', 'read', async (args, rest) => {
      const q = rest.toLowerCase();
      if (!q) throw new CmdError('grep: what are we looking for?');
      const files = this.app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path, exclude())).sort((a, b) => b.stat.mtime - a.stat.mtime);
      const hits = [];
      let scanned = 0;
      for (const f of files) {
        if (hits.length >= 14 || scanned >= 800) break;
        scanned++;
        let text;
        try { text = await this.app.vault.cachedRead(f); } catch (e) { continue; }
        if (!text.toLowerCase().includes(q)) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < 14; i++) {
          const at = lines[i].toLowerCase().indexOf(q);
          if (at >= 0) hits.push({ f, i, line: lines[i].trim(), at });
        }
      }
      if (!hits.length) throw new CmdError('grep: nothing matches ' + rest);
      const out = hits.map((h) => {
        const lineText = h.line;
        const k = lineText.toLowerCase().indexOf(q);
        const from = Math.max(0, k - 24);
        const pre = (from > 0 ? '…' : '') + lineText.slice(from, k);
        const post = lineText.slice(k + q.length, k + q.length + 40);
        return [LINK(h.f.basename + ':' + (h.i + 1), h.f, 't1', h.i), T('  ' + pre, 'dim'), T(lineText.slice(k, k + q.length), 't0'), T(post, 'dim')];
      });
      if (hits.length >= 14) out.push([T('… showing the first 14. ', 'dim'), RUN('search ' + rest, 'search ' + rest, 't3'), T(' opens them all', 'dim')]);
      return out;
    });
    def('search', 'search <text>', "open obsidian's search panel", 'read', (args) => {
      if (!args.length) throw new CmdError('search: what are we looking for?');
      this.openSearch(args.join(' '));
      return [[T('searching for ' + args.join(' '), 'dim')]];
    });
    def('todo', 'todo [add <text>]', 'list open tasks, or add one', 'read', async (args, rest) => {
      if (args[0] && args[0].toLowerCase() === 'add') {
        const text = rest.replace(/^add\s*/i, '').trim();
        if (!text) throw new CmdError('todo add: what needs doing?');
        const f = await plugin.capture(text, 'task');
        plugin.refreshSoon(['tasks'], 800);
        return [[T('[ ] ', 't3'), text, T('  → ', 'dim'), LINK(f.path, f, 't3')]];
      }
      const d = await plugin.collectTasks();
      if (!d.total) return [[T('nothing to do. suspicious.', 'dim')]];
      return [[T(String(d.total), 't3'), T(' open in ' + d.noteCount + ' notes', 'dim')]].concat(
        d.items.map((t) => [T('[ ] ', 't3'), LINK(t.text, t.file, 'fg', t.line), T('  ' + t.file.basename, 'dim')])
      );
    });

    /* ── write ── */
    def(['add', 'note'], 'add <text>', 'jot a line into your daily note or inbox', 'write', async (args, rest) => {
      if (!rest) throw new CmdError('add: add what?');
      const f = await plugin.capture(rest, 'note');
      return [[T('+ ', 't3'), rest, T('  → ', 'dim'), LINK(f.path, f, 't3')]];
    });

    /* ── time ── */
    def('date', 'date', 'the date and time', 'time', () => {
      const d = new Date();
      let zone = '';
      try {
        const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((x) => x.type === 'timeZoneName');
        zone = part ? ' ' + part.value : '';
      } catch (e) { zone = ''; }
      return [[moment(d).format('ddd D MMM HH:mm:ss') + zone + ' ' + d.getFullYear()]];
    });
    def('cal', 'cal [+n | -n]', 'a month calendar (days with notes are green)', 'time', (args) => {
      const off = Number(args[0]) || 0;
      const m = moment().startOf('month').add(off, 'months');
      const startDow = this.s.weekStart === 'sun' ? 0 : 1;
      const marks = plugin.dayCounts('edits');
      const title = m.format('MMMM YYYY');
      const out = [[T(' '.repeat(Math.max(0, Math.floor((20 - title.length) / 2))) + title, 't0')]];
      out.push([T(Array.from({ length: 7 }, (x, i) => DAYS[(startDow + i) % 7].slice(0, 2)).join(' '), 'dim')]);
      const offset = (m.day() - startDow + 7) % 7;
      const start = m.clone().subtract(offset, 'days');
      const weeks = Math.ceil((offset + m.daysInMonth()) / 7);
      const today = moment().format('YYYY-MM-DD');
      for (let w = 0; w < weeks; w++) {
        const line = [];
        for (let d = 0; d < 7; d++) {
          const day = start.clone().add(w * 7 + d, 'days');
          const key = day.format('YYYY-MM-DD');
          const s = String(day.date()).padStart(2);
          if (d) line.push(' ');
          if (key === today) line.push(T(s, 'today'));
          else if (day.month() !== m.month()) line.push(T(s, 'dim'));
          else if (marks.get(key)) line.push(T(s, 't3'));
          else line.push(s);
        }
        out.push(line);
      }
      return out;
    });
    def(['focus', 'timer', 'pomodoro'], 'focus [start|pause|reset|skip|<minutes>]', 'the pomodoro timer', 'time', (args) => {
      const sub = (args[0] || 'status').toLowerCase();
      if (/^\d+$/.test(sub)) {
        /* a one-off length: your settings are left alone */
        plugin.focusReset();
        plugin.focus.custom = num(sub, 1, 180, 25) * 60000;
        plugin.focus.left = plugin.focus.custom;
        plugin.focusStart();
      } else if (sub === 'start' || sub === 'resume') plugin.focusStart();
      else if (sub === 'pause' || sub === 'stop') plugin.focusPause();
      else if (sub === 'reset') plugin.focusReset();
      else if (sub === 'skip') plugin.focusSkip();
      else if (sub !== 'status') throw new CmdError('focus: try start, pause, reset, skip or a number of minutes');
      syncFocus();
      return statusLine();
    });
    def('uptime', 'uptime', 'how long obsidian and this computer have been up', 'time', () => {
      const up = plugin.sysUptime();
      return [['obsidian ' + fmtUp(performance.now()) + (up == null ? '' : '  ·  system ' + fmtUp(up))]];
    });

    /* ── info ── */
    def(['stats', 'fastfetch', 'neofetch'], 'stats', 'a summary of the vault', 'info', () => {
      const st = plugin.vaultStats();
      let path = this.app.vault.getName();
      try { path = this.app.vault.adapter.getBasePath() || path; } catch (e) { /* not a desktop adapter */ }
      const rows = [
        ['user', this.userName() + '@' + plugin.detected.host], ['os', osName() + ' · obsidian ' + (obsidian.apiVersion || '')],
        ['vault', path], ['notes', String(st.notes)], ['links', String(st.links)], ['tags', String(st.tags)],
        ['folders', String(st.folders)], ['files', String(st.files)], ['size', fmtSize(st.size)], ['uptime', fmtUp(performance.now())],
      ];
      const out = rows.map(([k, v]) => [T(k.padEnd(9), 't0'), v]);
      out.push([T('   ', 'bg0'), T('   ', 'bg1'), T('   ', 'bg2'), T('   ', 'bg3'), T('   ', 'bg4'), T('   ', 'bg5')]);
      return out;
    });
    def(['top', 'sysinfo'], 'top', 'cpu, memory and battery', 'info', () => {
      const out = [];
      const c = plugin.cpuNow();
      if (c != null) out.push([T('cpu   ', 't0')].concat(bar(c / 100, 20, 'high'), ' ' + c + '%'));
      const m = plugin.memNow();
      if (m) out.push([T('mem   ', 't0')].concat(bar(m.used / m.total, 20, 'high'), ' ' + (m.used / 1073741824).toFixed(1) + '/' + (m.total / 1073741824).toFixed(0) + 'g'));
      if (plugin.battery) out.push([T('batt  ', 't0')].concat(bar(plugin.battery.level, 20, 'low'), ' ' + Math.round(plugin.battery.level * 100) + '%' + (plugin.battery.charging ? ' charging' : '')));
      const up = plugin.sysUptime();
      out.push([T('up    ', 't0'), (up == null ? '' : fmtUp(up) + ' · ') + 'obsidian ' + fmtUp(performance.now())]);
      return out;
    });
    def('git', 'git [log | branch]', 'read the vault\'s git history', 'info', async (args) => {
      const sub = (args[0] || 'log').toLowerCase();
      if (sub === 'branch') {
        if (!plugin.branch) throw new CmdError('fatal: not a git repository');
        return [[T('* ', 't3'), plugin.branch]];
      }
      if (sub !== 'log') throw new CmdError('git: only log and branch are available here');
      const list = await plugin.gitLog(num(args[1], 1, 30, 8));
      if (list === null) throw new CmdError('fatal: not a git repository');
      return list.length ? list.map((c) => [T(c.hash + ' ', 't2'), c.msg, T('  ' + ageOf(c.ts), 'dim')]) : [[T('no commits yet', 'dim')]];
    });
    def('tags', 'tags [n]', 'your most used tags', 'info', (args) => {
      const list = plugin.topTags(num(args[0], 1, 30, 10));
      if (!list.length) throw new CmdError('no tags yet');
      return list.map(([tag, n], i) => [RUN(tag.padEnd(18), 'search tag:' + tag, 't' + (i % COLOURS)), String(n)]);
    });
    def('du', 'du [depth]', 'notes per folder', 'info', (args) => {
      const list = plugin.folderStats(num(args[0], 1, 3, 1), 14);
      if (!list.length) throw new CmdError('no notes yet');
      return list.map(([name, n]) => [T(String(n).padStart(5) + '  ', 'dim'), name === '.' ? './' : RUN(name + '/', 'ls "' + name + '"', 't4')]);
    });
    def('whoami', 'whoami', 'you', 'info', () => [[this.userName()]]);
    def('history', 'history', 'what you typed before', 'info', () => {
      const h = plugin.history.slice(-15);
      return h.map((x, i) => [T(String(plugin.history.length - h.length + i + 1).padStart(4) + '  ', 'dim'), RUN(x, x, 'fg')]);
    });

    /* ── look ── */
    def('palette', 'palette <name>', 'change the colours', 'look', (args) => {
      const names = ['mish'].concat(Object.keys(PALETTES));
      const want = (args[0] || '').toLowerCase();
      if (!names.includes(want)) return [[T('palettes  ', 'dim')].concat(names.reduce((a, n, i) => a.concat(i ? ['  '] : [], [RUN(n, 'palette ' + n, 't' + (i % COLOURS))]), []))];
      const p = this.s.palette;
      if (want === 'mish') p.preset = 'theme';
      else { p.preset = want; p.colours = PALETTES[want].slice(); }
      plugin.restyleAll();
      plugin.persist();
      return [[T('palette: ' + want, 'dim')]];
    });
    def('banner', 'banner <text>', 'change the big letters', 'look', (args, rest) => {
      if (!rest) throw new CmdError('banner: what should it say?');
      const b = this.s.banner;
      b.source = 'custom';
      b.custom = rest;
      plugin.persist();
      for (const v of plugin.views) v.fill('banner');
      return this.refs.banner ? [[T('banner: ' + rest, 'dim')]] : [[T('the banner section is switched off (settings > sections)', 'dim')]];
    });
    def('clear', 'clear', 'clear the terminal', 'look', () => CLEAR);
    def('reload', 'reload', 'redraw the whole page', 'look', () => {
      window.setTimeout(() => plugin.rebuildAll(), 0);
      return [[T('redrawing…', 'dim')]];
    });
    def('settings', 'settings', 'open the settings for this plugin', 'look', () => {
      this.app.setting.open();
      this.app.setting.openTabById(PLUGIN_ID);
      return [];
    });
    def(['exit', 'quit', 'q'], 'exit', 'close this tab', 'look', () => { this.leaf.detach(); return []; });

    /* ── fun ── */
    def('echo', 'echo <text>', 'say something back', 'fun', (args, rest) => [[rest]]);
    def('fortune', 'fortune', 'a line from your list', 'fun', () => {
      const lines = String(this.s.quote.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) throw new CmdError('no lines. add some in settings.');
      return [[T(lines[Math.floor(Math.random() * lines.length)], 't1')]];
    });
    def('cowsay', 'cowsay [text]', 'a cow says it', 'fun', (args, rest) => {
      const lines = String(this.s.quote.lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const text = rest || (lines.length ? lines[Math.floor(Math.random() * lines.length)] : 'moo');
      const words = text.split(/\s+/);
      const rows = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > 34) { rows.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
      }
      if (cur) rows.push(cur);
      const w = Math.max(...rows.map((r) => r.length));
      const out = [[T(' ' + '_'.repeat(w + 2), 'dim')]];
      rows.forEach((r, i) => {
        const [l, rr] = rows.length === 1 ? ['<', '>'] : i === 0 ? ['/', '\\'] : i === rows.length - 1 ? ['\\', '/'] : ['|', '|'];
        out.push([T(l + ' ', 'dim'), T(r.padEnd(w), 't1'), T(' ' + rr, 'dim')]);
      });
      out.push([T(' ' + '-'.repeat(w + 2), 'dim')]);
      ['        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||']
        .forEach((l) => out.push([T(l, 't0')]));
      return out;
    });
    def('sudo', 'sudo', '', 'fun', () => { throw new CmdError(this.userName() + ' is not in the sudoers file. this incident will be reported.'); }, true);
    def('rm', 'rm', '', 'fun', () => { throw new CmdError("rm: not from here. that's mish.eza's job."); }, true);
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
      if (kind === 'focus') { plugin.focusSync(); for (const v of plugin.views) v.updateFocus(); }
      else if (kind === 'build') plugin.rebuildAll();
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
    const on = (id) => Boolean((s.sections.find((x) => x.id === id) || {}).on);

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
        .addToggle((t) => t.setValue(it.on).onChange((v) => { it.on = v; apply('build'); this.redraw(); }))
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
    if (on('banner')) {
    head('banner');
    drop('banner.source', 'text', 'what the big letters say.', { vault: 'the vault name', name: 'your name', time: 'the time (updates every minute)', custom: 'custom text' }, 'data');
    text('banner.custom', 'custom text', 'used when text is set to custom. letters, numbers, spaces and . - _ / are drawn; anything else is skipped.', 'welcome home', 'data');
    drop('banner.letters', 'letters', 'lowercase is a full lowercase block face with ascenders and descenders (mish.shell). capitals are the chunkier five-row letters.', { lower: 'lowercase', caps: 'capitals' }, 'data');
    drop('banner.style', 'style', 'blocks are pixel letters drawn by the plugin. text is a big line in your font.', { blocks: 'blocks', text: 'big text' }, 'data');
    slide('banner.size', 'block size', 'how big one pixel of a letter is. a ten-letter name is about 60 pixels wide.', 3, 14, 1, 'look', ' px');
    drop('banner.gradient', 'colour', 'rainbow runs across the six palette colours.',
      { rainbow: 'rainbow', accent: 'accent colour', pink: 'first palette colour', plain: 'plain text colour' }, 'data');
    drop('banner.align', 'position', '', { left: 'left', centre: 'centre' }, 'data');

    /* ── greeting ── */
    }

    if (on('greeting')) {
    head('greeting');
    text('greeting.template', 'greeting', 'you can use {greeting} (good morning / afternoon / evening, or still up when it is late), {name}, {vault}, {time} and {date}.', '{greeting}, {name}.', 'data');
    tog('greeting.showDate', 'show the date', '', 'data');
    tog('greeting.summary', 'summary line', 'notes, links and your current streak, in one line.', 'data');
    text('greeting.dateFormat', 'date format', 'moment.js tokens: dddd is the weekday, D the day, MMMM the month, YYYY the year. a middle dot is nice between them.', 'dddd · D MMMM YYYY', 'data');
    tog('greeting.progress.day', 'day progress bar', 'how far through the day you are.', 'data');
    tog('greeting.progress.week', 'week progress bar', '', 'data');
    tog('greeting.progress.month', 'month progress bar', '', 'data');
    tog('greeting.progress.year', 'year progress bar', '', 'data');
    slide('greeting.barWidth', 'bar length', 'number of cells in each bar.', 8, 40, 1, 'data', '');
    slide('greeting.barHeight', 'bar thickness', '', 4, 14, 1, 'look', ' px');

    /* ── shortcuts ── */
    }

    if (on('shortcuts')) {
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
    }

    if (on('calendar')) {
    head('calendar');
    drop('calendar.mark', 'mark days with', 'edits marks the days you edited notes (the same count as the streak). daily notes marks days that have a daily note.',
      { activity: 'edits', daily: 'daily notes', none: 'nothing' }, 'data');
    tog('calendar.weekNumbers', 'week numbers', '', 'data');
    tog('calendar.arrows', 'month arrows', 'the ← → buttons for looking at other months. click the month name to come back.', 'data');
    }

    if (on('recent')) {
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
    }

    if (on('pinned')) {
    head('pinned');
    area('pinned.paths', 'notes', 'one per line: a note name, a path, or a [[link]]. missing ones show dimmed.', 5, 'data');
    tog('pinned.bookmarks', 'include bookmarks', "adds the notes from obsidian's bookmarks core plugin, when it is on.", 'data');
    drop('pinned.extensions', 'file extensions', '', { hide: 'hide .md', show: 'show all' }, 'data');
    drop('pinned.nameColour', 'name colours', '', { rainbow: 'rainbow', type: 'by file type', plain: 'plain' }, 'data');
    tog('pinned.tree', 'tree lines', '', 'data');

    /* ── todo ── */
    }

    if (on('tasks')) {
    head('todo');
    slide('tasks.count', 'how many to show', 'the most recently edited notes come first.', 1, 30, 1, 'data', '');
    slide('tasks.scan', 'notes to read', 'at most this many notes are opened to read the task text. the count at the top always covers the whole vault.', 5, 400, 5, 'data', '');
    tog('tasks.complete', 'click a box to tick it', 'ticks the box in the note itself. nothing is written unless the line is still exactly what the page shows.', 'data');
    tog('tasks.showNote', 'show the note name', '', 'data');

    /* ── streak ── */
    }

    if (on('focus')) {
    head('focus timer');
    slide('focus.focusMin', 'focus', 'minutes.', 5, 120, 5, 'focus', ' min');
    slide('focus.breakMin', 'break', 'minutes.', 1, 30, 1, 'focus', ' min');
    slide('focus.longBreakMin', 'long break', 'minutes. you get one after every few focus sessions.', 5, 60, 5, 'focus', ' min');
    slide('focus.longEvery', 'long break every', 'focus sessions.', 2, 8, 1, 'focus', '');
    tog('focus.autoNext', 'start the next one automatically', 'after a focus or break ends, the next starts on its own.', 'focus');
    tog('focus.notify', 'notify when one ends', 'a message in the corner of obsidian.', 'focus');
    }

    if (on('system')) {
    head('system');
    tog('system.cpu', 'cpu', '', 'data');
    tog('system.memory', 'memory', 'memory in use. macos counts cached memory as used, so this reads high.', 'data');
    tog('system.battery', 'battery', 'only shown when the computer reports one.', 'data');
    tog('system.uptime', 'uptime', 'how long this computer and obsidian have been up.', 'data');
    tog('system.network', 'network', 'online or offline.', 'data');
    slide('system.barWidth', 'bar length', 'cells in each bar.', 6, 30, 1, 'data', '');
    }

    if (on('links')) {
    head('links');
    area('links.items', 'links', 'one per line, as  label | address. they open in your browser. the terminal can open them too: go <label>.', 5, 'data');
    drop('links.layout', 'layout', '', { list: 'list', row: 'row' }, 'data');
    drop('links.colour', 'label colour', '', { plain: 'plain', rainbow: 'rainbow' }, 'data');
    }

    if (on('tags')) {
    head('tags');
    slide('tags.count', 'how many', 'the most used tags. click one to search for it.', 1, 20, 1, 'data', '');
    }

    if (on('folders')) {
    head('folders');
    slide('folders.count', 'how many', '', 1, 20, 1, 'data', '');
    slide('folders.depth', 'depth', '1 counts top-level folders. 2 counts folder/subfolder.', 1, 3, 1, 'data', '');
    }

    if (on('random')) {
    head('random note');
    slide('random.lines', 'lines', 'how much of the note to show.', 2, 20, 1, 'data', '');
    drop('random.mode', 'pick', 'one per day shows the same note all day. random picks a new one each time the page opens.', { daily: 'one per day', random: 'random' }, 'data');
    slide('random.minChars', 'skip short notes', 'notes smaller than this many characters are never picked.', 0, 2000, 20, 'data', '');
    }

    if (on('git')) {
    head('git log');
    slide('git.count', 'commits', 'read from the vault\'s .git folder, when there is one.', 1, 20, 1, 'data', '');
    }

    if (on('streak')) {
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
    }

    if (on('quote')) {
    head('fortune');
    drop('quote.mode', 'pick', 'daily shows the same line all day. random picks a new one each time the page opens.', { daily: 'one per day', random: 'random' }, 'data');
    area('quote.lines', 'lines', 'one per line.', 6, 'data');

    /* ── shell ── */
    }

    if (on('shell')) {
    head('terminal');
    drop('terminal.style', 'look', 'window is a terminal window with a title bar and its own background. plain is just the text.', { window: 'window', plain: 'plain' }, 'build');
    tog('terminal.titleBar', 'title bar', 'the three dots and the title above the window. the first dot clears it.', 'build');
    text('terminal.title', 'title', 'you can use {user}, {host}, {path} and {vault}.', '{user}@{host}: {path}', 'build');
    slide('terminal.height', 'scrollback height', 'lines of output shown above the prompt.', 2, 20, 1, 'look', '');
    drop('terminal.prompt', 'prompt', 'powerline adds a line of pills above the prompt: the folder you are in, the git branch, and whether the last command worked.',
      { powerline: 'powerline', compact: 'compact' }, 'build');
    tog('terminal.rprompt', 'time on the right', 'the time at the right end of the powerline.', 'build');
    tog('terminal.suggest', 'autosuggestions', 'grey suggestions from your history as you type. press → to take one.', 'look');
    text('terminal.startup', 'startup commands', 'run once when the terminal pane first opens, so it has something in it. separate with commas. leave empty for none. only used when the terminal is a pane.', 'stats, help', 'build');
    tog('terminal.welcome', 'welcome line', 'the one-line hint before you have typed anything.', 'build');
    text('terminal.placeholder', 'placeholder', 'what the empty prompt says.', 'type a command · help', 'build');
    drop('terminal.capture', 'add writes to', 'the add and todo add commands put a line in today\'s daily note, or in one inbox note.', { daily: "today's daily note", inbox: 'an inbox note' }, 'look');
    text('terminal.inbox', 'inbox note', 'the path of the inbox note. it is made if it is missing.', 'inbox.md', 'look');
    }

    head('daily notes');
    new UiSetting(containerEl).setDesc(ui('used by the daily note shortcut, the calendar, the journal entries count and the add command.'));
    new UiSetting(containerEl)
      .setName('journal note format')
      .setDesc('for the journal entries count and the daily note command. leave empty to use the core daily notes plugin, or YYYY-MM-DD.')
      .addText((t) => t.setPlaceholder(plugin.dailyConfig().format).setValue(s.daily.format).onChange((v) => { s.daily.format = v.trim(); apply('data'); }));
    new UiSetting(containerEl)
      .setName('journal folder')
      .setDesc('where new daily notes go. leave empty to use the core daily notes plugin, or the vault root.')
      .addText((t) => t.setPlaceholder(plugin.dailyConfig().folder || '/').setValue(s.daily.folder).onChange((v) => { s.daily.folder = v.trim(); apply('data'); }));

    /* ── fortune ── */

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
    drop('layout.columns', 'columns', 'sections flow down each column, balanced, so there are no gaps. full-width sections span them all. narrow tabs use fewer columns.', { 1: 'one', 2: 'two', 3: 'three' }, 'look');
    drop('layout.split', 'terminal', 'right puts the terminal in a tall pane beside the sections, like a tmux split. off keeps it as a short row under them.',
      { right: 'tall pane on the right', off: 'row at the bottom' }, 'build');
    slide('layout.sideWidth', 'terminal pane width', 'only used when the terminal is a pane. the pane is added to the maximum width below, so the sections keep their room.', 260, 640, 10, 'look', ' px');
    drop('layout.fit', 'when the page is taller than the tab', 'shrink scales the whole page down until it fits, so the page never scrolls, at any window size. scroll leaves it at full size and lets you scroll, which defeats the point of a home page.',
      { shrink: 'shrink to fit', scroll: 'scroll' }, 'look');
    new UiSetting(containerEl)
      .setDesc(ui('when the tab is too small for the page, the command lines above each section step aside and the spacing tightens first, so the page keeps its size for as long as it can.'));
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
