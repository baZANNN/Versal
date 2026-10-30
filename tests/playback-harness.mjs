import { loadTypeScript } from "./load-typescript.mjs";

// Render the real component's effects against a deterministic clock and mocked network.
// No browser, Spotify credentials, or paid API requests are used by these checks.
export function harness(fetcher, { page = "../app/page.tsx", storageEntries = [], random = 0 } = {}) {
  let now = 1_000_000, cursor = 0, nextTimer = 0, tree;
  const slots = [], effects = [], timers = new Map(), storage = new Map(storageEntries), events = new Map();
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn) { cursor++; return fn(); },
    useEffect(fn, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: fn() }; });
      }
    },
  };
  const addTimer = (fn, delay, interval = false) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, interval: interval ? delay : 0 });
    return id;
  };
  const browser = {
    location: { search: "", pathname: "/" }, history: { replaceState() {} }, crypto: { randomUUID: () => "test-tab" },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout: (fn, delay) => addTimer(fn, delay), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => addTimer(fn, delay, true), clearInterval: (id) => timers.delete(id),
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name),
  };
  const document = { hidden: false, addEventListener: browser.addEventListener, removeEventListener: browser.removeEventListener };
  const { default: Home } = loadTypeScript(page, { react: hooks }, {
    fetch: fetcher, window: browser, document, navigator: { onLine: true },
    setTimeout: browser.setTimeout, clearTimeout: browser.clearTimeout,
    Math: Object.assign(Object.create(Math), { random: () => random }),
    performance: { now: () => now }, Date: class extends Date { static now() { return now; } },
  });
  // Expand extracted presentational components without introducing another effect owner.
  const expand = (node) => {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  };
  const render = () => { cursor = 0; tree = expand(Home()); while (effects.length) effects.shift()(); return tree; };
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); render(); };
  const find = (predicate, node = tree) => {
    if (node == null || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const result = find(predicate, child ?? null); if (result) return result; }
  };
  const text = (node = tree) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node)
    : [node.props?.children].flat(Infinity).map((child) => text(child ?? null)).join(" ");
  render(); render();
  return {
    text, find, storage,
    snapshot: () => JSON.parse(JSON.stringify(tree, (key, value) => key === "_owner" ? undefined : value)),
    async click(predicate) { await find(predicate)?.props.onClick(); await settle(); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at; timers.delete(id);
        if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
        await timer.fn(); await settle();
      }
      now = end; await settle();
    },
    async resolve() { await settle(); },
    async clickRefresh() { await find((node) => node.props?.["aria-label"] === "Re-sync lyrics to Spotify")?.props.onClick(); await settle(); },
    async hidden(value) { document.hidden = value; events.get("visibilitychange")?.(); await settle(); },
    cleanup() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
