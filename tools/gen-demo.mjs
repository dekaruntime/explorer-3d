// Generates a synthetic but plausible demo repo at demo-src/ so the POC
// indexer reads real files from disk, like it will for deka/dsc later.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-src');

// deterministic PRNG so the demo repo is stable between runs
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rand() * a.length)];
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const RS_TYPES = ['IslandRenderer', 'HostBridge', 'ModuleGraph', 'TokenStream', 'TypeChecker', 'IslandState', 'DekaCompiler', 'WasmRuntime', 'DiagBag', 'ScopeTree', 'OpCatalog', 'PatchEngine', 'HydrationCtx', 'RouteTable', 'SignalGraph', 'DomPatcher'];
const RS_FNS = ['parse_module', 'lower_hir', 'check_types', 'emit_island', 'resolve_import', 'apply_patch', 'hydrate', 'collect_defs', 'run_pass', 'build_graph', 'infer_expr', 'link_ops', 'render_dom', 'schedule_effect', 'walk_ast', 'compile_file'];
const DS_FNS = ['greeting', 'format_money', 'parse_csv', 'validate_email', 'debounce', 'clamp', 'group_by', 'slugify', 'try_parse', 'range', 'zip_with', 'deep_merge'];
const DS_TYPES = ['Money', 'DateRange', 'CsvRow', 'Validator', 'PageProps', 'CounterState'];
const WORDS = ['island', 'client', 'server', 'render', 'signal', 'effect', 'props', 'state', 'route', 'module', 'bridge', 'host', 'async', 'stream', 'patch', 'hydrate'];

const rsUsed = new Set();
let rsSeq = 0;
const rsName = (pool) => {
  let n = pick(pool);
  if (!rsUsed.has(n)) { rsUsed.add(n); return n; }
  do { n = `${pick(pool)}${++rsSeq}`; } while (rsUsed.has(n));
  rsUsed.add(n);
  return n;
};

function rsBody(indent, ctx) {
  const lines = [];
  const n = ri(4, 14);
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (r < 0.18) lines.push(`${indent}// ${pick(WORDS)} the ${pick(WORDS)} before we ${pick(WORDS)}`);
    else if (r < 0.3) lines.push(`${indent}let ${pick(WORDS)}_${i} = self.${pick(WORDS)}.clone();`);
    else if (r < 0.42 && ctx.length) lines.push(`${indent}let ${pick(WORDS)} = ${ctx[ri(0, ctx.length - 1)]}::${pick(RS_FNS)}(&self.${pick(WORDS)});`);
    else if (r < 0.52) lines.push(`${indent}if ${pick(WORDS)}.is_empty() { return Ok(()); }`);
    else if (r < 0.62) lines.push(`${indent}match self.${pick(WORDS)}.as_ref() {`);
    else if (r < 0.7) lines.push(`${indent}    Some(v) => v.${pick(RS_FNS)}(),`);
    else if (r < 0.78) lines.push(`${indent}    None => return Err(Diag::new("missing ${pick(WORDS)}")),`);
    else if (r < 0.86) lines.push(`${indent}}`);
    else lines.push(`${indent}self.${pick(WORDS)} += ${ri(1, 9)}; // ${pick(WORDS)}`);
  }
  return lines;
}

function genRustFile(modName, symCount) {
  const out = [`use crate::${pick(WORDS)}::{${pick(RS_TYPES)}, ${pick(RS_TYPES)}};`, '', `// ${modName}: handles ${pick(WORDS)} and ${pick(WORDS)} for the compiler.`, ''];
  const local = [];
  for (let s = 0; s < symCount; s++) {
    const kind = rand();
    if (kind < 0.3) {
      const t = rsName(RS_TYPES); local.push(t);
      out.push(`pub struct ${t} {`, `    pub ${pick(WORDS)}: usize,`, `    pub ${pick(WORDS)}: Vec<String>,`, `    ${pick(WORDS)}: Option<Box<${pick(RS_TYPES)}>>,`, '}', '');
    } else if (kind < 0.45) {
      const t = rsName(RS_TYPES);
      out.push(`pub enum ${t} {`, `    ${pick(WORDS).replace(/^./, c => c.toUpperCase())},`, `    ${pick(WORDS).replace(/^./, c => c.toUpperCase())}(Box<Self>),`, `    Empty,`, '}', '');
    } else if (kind < 0.55) {
      out.push(`pub const ${pick(RS_TYPES).toUpperCase()}_${ri(2, 99)}: usize = ${ri(10, 999)};`, '');
    } else {
      const f = pick(RS_FNS);
      const ret = rand() < 0.5 ? 'Result<(), Diag>' : pick(RS_TYPES);
      out.push(`pub fn ${f}(${pick(WORDS)}: &${pick(local.length ? local : RS_TYPES)}, ${pick(WORDS)}: usize) -> ${ret} {`);
      out.push(...rsBody('    ', local));
      out.push('    Ok(())', '}', '');
    }
  }
  if (rand() < 0.6) {
    const t = pick(local.length ? local : RS_TYPES);
    out.push(`impl ${t} {`, `    pub fn ${pick(RS_FNS)}(&mut self) {`, ...rsBody('        ', local), '    }', '}', '');
  }
  return out.join('\n') + '\n';
}

function genDsFile(name, symCount) {
  const out = [`// stdlib/${name} — ${pick(WORDS)} helpers shipped with the runtime.`, ''];
  for (let s = 0; s < symCount; s++) {
    const kind = rand();
    if (kind < 0.25) {
      out.push(`pub type ${pick(DS_TYPES)} = ${pick(['string', 'number', 'bytes', '{ value: number, currency: string }'])}`, '');
    } else if (kind < 0.45) {
      const f = pick(DS_FNS);
      out.push(`pub fn ${f}(${pick(WORDS)}: string, ${pick(WORDS)}: number) string {`, `    let cleaned = ${pick(WORDS)}.trim()`, `    if cleaned.len() == 0 { return "" }`, `    return cleaned.concat("-", ${pick(WORDS)}.to_string())`, '}', '');
    } else {
      out.push(`pub const ${pick(WORDS).toUpperCase()}_${ri(2, 49)} = ${ri(2, 400)}`, '');
    }
  }
  return out.join('\n') + '\n';
}

function genDsxFile(component) {
  return `import { signal, effect } from "io"
import { ${pick(DS_FNS)} } from "string"

type ${component}Props = {
    start: number
    label: string
}

pub fn ${component}(props: ${component}Props) node {
    let count = signal(props.start)
    let doubled = signal(0)

    effect(fn() {
        doubled.set(count.get() * 2)
    })

    return <section class="counter">
        <h2>{props.label}</h2>
        <button on:click={fn() count.set(count.get() + 1)}>
            increment
        </button>
        <output>{count.get()} / {doubled.get()}</output>
    </section>
}
`;
}

function genToml(name) {
  return `[package]\nname = "${name}"\nversion = "0.${ri(1, 9)}.${ri(0, 9)}"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\n\n[dev-dependencies]\npretty_assertions = "1"\n`;
}

const files = [];
function put(rel, content) { files.push([rel, content]); }

// crates/ tree (Rust)
const crates = {
  'deka_syntax': ['lexer.rs', 'parser.rs', 'ast.rs', 'token.rs', 'diagnostic.rs'],
  'deka_hir': ['lower.rs', 'hir.rs', 'scope.rs', 'resolve.rs'],
  'deka_typeck': ['check.rs', 'infer.rs', 'unify.rs', 'builtins.rs', 'catalog.rs'],
  'deka_lsp': ['state.rs', 'completion.rs', 'hover.rs', 'references.rs', 'rename.rs'],
  'deka_island': ['marker.rs', 'hydrate.rs', 'patch.rs', 'morph.rs', 'serialize.rs'],
  'deka_runtime': ['bridge.rs', 'op_host.rs', 'module.rs', 'scheduler.rs', 'wasm.rs'],
};
for (const [crate, mods] of Object.entries(crates)) {
  put(`crates/${crate}/Cargo.toml`, genToml(crate));
  for (const m of mods) put(`crates/${crate}/src/${m}`, genRustFile(`${crate}::${m.replace('.rs', '')}`, ri(4, 8)));
}

// stdlib (.ds)
const stdlib = { 'io': 'io.ds', 'string': 'string.ds', 'crypto': 'crypto.ds', 'money': 'money.ds', 'datetime': 'datetime.ds', 'csv': 'csv.ds' };
for (const [dir, f] of Object.entries(stdlib)) put(`stdlib/${dir}/${f}`, genDsFile(dir, ri(5, 10)));

// example app (.dsx + .ds) — big enough to be a real district on the map
const COMPONENTS = ['Counter', 'Header', 'Footer', 'Sidebar', 'ThemeToggle', 'DataTable', 'Modal', 'Chart', 'Breadcrumbs', 'UserMenu', 'SearchBox', 'Toast'];
for (const c of COMPONENTS) put(`apps/myapp/components/${c}.dsx`, genDsxFile(c));
const ROUTES = ['page', 'dashboard', 'settings', 'profile', 'login', 'docs'];
for (const r of ROUTES) put(`apps/myapp/app/${r}.dsx`, `import { Header } from "../components/Header.dsx"
import { Footer } from "../components/Footer.dsx"

pub fn ${r.replace(/^./, c => c.toUpperCase())}Page() node {
    return <main data-route="${r}">
        <Header title="${r}" />
        <section>…${r} content…</section>
        <Footer />
    </main>
}
`);
put('apps/myapp/lib/util.ds', genDsFile('util', 8));
put('apps/myapp/lib/api.ds', genDsFile('api', 6));
put('apps/myapp/deka.json', `{\n  "name": "myapp",\n  "version": "0.1.0"\n}\n`);

// misc
put('Cargo.toml', `[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n`);
put('README.md', `# demo-src\n\nSynthetic repo for the deka explorer POC. Generated, not real code.\n`);

for (const [rel, content] of files) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
console.log(`wrote ${files.length} files under ${root}`);
