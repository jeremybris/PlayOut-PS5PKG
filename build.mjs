// Builds PlayOutPs5Pkg into dist/:
//   PlayOutPs5Pkg.exe              one self-contained win-x64 file (no .NET install needed to run it)
//   LICENSE                        GPL-3.0 (this helper)
//   LICENSES-THIRD-PARTY.txt       the licence and notice texts of everything compiled into the exe
//   playout-ps5pkg-version.txt     helper version, upstream commits and build time
//
// Needs git and the .NET 10 SDK (`dotnet` on PATH, or DOTNET_EXE=<path to dotnet.exe>). Run: `node build.mjs`.
//
// Upstream code is fetched into vendor/ at pinned commits (a newer upstream is a deliberate change here):
// - PS5PKGTool (GPL-3.0): PS5PKGTool.Core and its own projects are compiled; its GUI is not.
// - ProsperoPkgTool (MIT), the package engine PS5PKGTool.Core uses, is compiled from source here instead of using the
//   prebuilt ProsperoPkgTool.dll PS5PKGTool carries, WITHOUT its embedded package-building files (Keys\*.bin and
//   Resources\right.sprx, used only to build packages, never to unpack them). The rebuilt DLL replaces the prebuilt
//   one in vendor/ before the helper is compiled.
// - PS5PKGTool's other binaries (oo2core_9_win64.dll, libScePubTools.dll, LibProsperoPkg) are deleted from vendor/.
// Before the single file is made, a plain publish is scanned (file names and contents) for any of those, and the
// build stops if one is there.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** This helper's own source (GPL-3.0). */
export const SOURCE_URL = 'https://github.com/jeremybris/PlayOut-PS5PKG'
export const PS5PKGTOOL = {
  repo: 'https://github.com/pearlxcore/PS5PKGTool.git',
  commit: '40832abcc6f4444e4e4c54f5080a92b2547e87ac' // main, 2026-10-19 (v1.3.0 + fixes)
}
export const PROSPEROPKGTOOL = {
  repo: 'https://github.com/pearlxcore/ProsperoPkgTool.git',
  // The commit PS5PKGTool's prebuilt ProsperoPkgTool.dll says it was built from (its VERSION.txt).
  commit: '035c0e285e01d5596ec57991235c868423ff476d'
}
const vendor = join(here, 'vendor')
const ps5 = join(vendor, 'PS5PKGTool')
const ppt = join(vendor, 'ProsperoPkgTool')
const dist = join(here, 'dist')
const check = join(here, 'obj', 'publish-check')
const dotnet = process.env.DOTNET_EXE ?? 'dotnet'
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }
const SHIPPED = ['PlayOutPs5Pkg.exe', 'LICENSE', 'LICENSES-THIRD-PARTY.txt', 'playout-ps5pkg-version.txt']
/** Files that never ship (matched against every published file's name). */
const FORBIDDEN_FILES = ['oo2core', 'libScePubTools', 'LibProsperoPkg', 'right.sprx', '.bin']
/**
 * Embedded resources that never ship (matched against every published file's bytes: a manifest resource's name is
 * stored as text). Names only of resources, so a library naming a DLL it never finds (Oodle.NET's oo2core import) is
 * not a match.
 */
const FORBIDDEN_RESOURCES = [
  'ProsperoPkgTool.Resources.right.sprx',
  'ProsperoPkgTool.Keys.passcode.bin',
  'ProsperoPkgTool.Keys.mount_image.bin',
  'ProsperoPkgTool.Keys.metadata_modulus.bin'
]

function git(args, cwd = here) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}
function fetchAt({ repo, commit }, dir) {
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true })
    git(['clone', '--quiet', '--no-checkout', repo, dir])
  }
  git(['fetch', '--quiet', 'origin', commit], dir)
  git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--force', commit], dir)
  git(['clean', '-qfdx'], dir)
  return git(['rev-parse', 'HEAD'], dir)
}
const run = (args, cwd) => execFileSync(dotnet, args, { cwd, env, stdio: 'inherit' })
const read = (...p) => readFileSync(join(...p), 'utf8')
const mit = (holder) => `MIT License

${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`
const section = (title, text) => `${'='.repeat(100)}\n${title}\n${'='.repeat(100)}\n\n${text.trim()}\n\n`

// 1. Upstream at the pinned commits.
const ps5Commit = fetchAt(PS5PKGTOOL, ps5)
const pptCommit = fetchAt(PROSPEROPKGTOOL, ppt)

// 2. ProsperoPkgTool without its package-building files, in place of the prebuilt DLL.
const pptProject = join(ppt, 'ProsperoPkgTool', 'ProsperoPkgTool.csproj')
writeFileSync(pptProject, read(pptProject).replace(/^\s*<EmbeddedResource [^>]*\/>\s*$/gm, ''))
rmSync(join(ppt, 'ProsperoPkgTool', 'Keys'), { recursive: true, force: true })
rmSync(join(ppt, 'ProsperoPkgTool', 'Resources', 'right.sprx'), { force: true })
run(['build', pptProject, '-c', 'Release', '-o', join(ppt, 'out')], ppt)
const third = join(ps5, 'PS5PKGTool', 'ThirdParty')
for (const name of readdirSync(third)) if (name !== 'ProsperoPkgTool') rmSync(join(third, name), { recursive: true, force: true })
copyFileSync(join(ppt, 'out', 'ProsperoPkgTool.dll'), join(third, 'ProsperoPkgTool', 'ProsperoPkgTool.dll'))
rmSync(join(third, 'ProsperoPkgTool', 'ProsperoPkgTool.pdb'), { force: true })

// 3. A plain publish, scanned for anything that must not ship.
rmSync(check, { recursive: true, force: true })
run(['publish', '-c', 'Release', '-p:PublishSingleFile=false', '-o', check], here)
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
for (const file of walk(check)) {
  const name = file.slice(check.length + 1)
  for (const bad of FORBIDDEN_FILES)
    if (name.toLowerCase().includes(bad.toLowerCase())) throw new Error(`${name} must never ship`)
  const text = readFileSync(file).toString('latin1')
  for (const bad of FORBIDDEN_RESOURCES)
    if (text.includes(bad)) throw new Error(`${name} embeds ${bad}: it must never ship`)
}

// 4. The single file.
rmSync(dist, { recursive: true, force: true })
run(['publish', '-c', 'Release', '-o', dist], here)
if (!existsSync(join(dist, 'PlayOutPs5Pkg.exe'))) throw new Error('publish produced no PlayOutPs5Pkg.exe')
for (const name of readdirSync(dist)) if (!SHIPPED.includes(name)) rmSync(join(dist, name), { recursive: true, force: true })

// 5. Licences: everything compiled into the exe.
const assets = JSON.parse(read(here, 'obj', 'project.assets.json'))
const packagesRoot = Object.keys(assets.packageFolders)[0]
const runtimeDep = assets.project.frameworks['net10.0'].downloadDependencies.find(
  (d) => d.name === 'Microsoft.NETCore.App.Runtime.win-x64'
)
const runtimeVersion = runtimeDep.version.replace(/[[\]\s]/g, '').split(',')[0]
const runtimeFolder = join(packagesRoot, 'microsoft.netcore.app.runtime.win-x64', runtimeVersion)
let licences = `PlayOutPs5Pkg - PlayOut's PS5 package helper (GPL-3.0-or-later; LICENSE).
Source: ${SOURCE_URL} (each release also carries PlayOutPs5Pkg-<version>-source.zip with the exact upstream source).
Built from PS5PKGTool ${PS5PKGTOOL.repo} at ${ps5Commit}
and ProsperoPkgTool ${PROSPEROPKGTOOL.repo} at ${pptCommit} (rebuilt without its embedded Keys\\*.bin and
Resources\\right.sprx). The licence and notice texts of everything inside PlayOutPs5Pkg.exe follow, unmodified.

`
licences += section('PS5PKGTool by pearlxcore (GPL-3.0): PS5PKGTool.Core, PS5PKGTool.Ffpfsc', read(ps5, 'LICENSE'))
licences += section(
  'PS5PKGTool third-party notices',
  "Note: these are the notices of PS5PKGTool's own app. The Oodle redistributable (oo2core_9_win64.dll), " +
    'LibProsperoPkg\nand libScePubTools named in them are NOT part of PlayOutPs5Pkg.exe.\n\n' +
    read(ps5, 'THIRD_PARTY_NOTICES.md')
)
licences += section(
  'PS5PKGTool.Ufs2: based on UFS2Tool by SvenGDK (BSD-2-Clause), https://github.com/SvenGDK/UFS2Tool',
  read(ps5, 'PS5PKGTool.Ufs2', 'LICENSE')
)
licences += section('ProsperoPkgTool by pearlxcore (MIT)', read(ppt, 'LICENSE'))
const target = Object.keys(assets.targets).find((t) => t.startsWith('net10.0'))
for (const key of Object.keys(assets.libraries).sort()) {
  const lib = assets.libraries[key]
  const entry = assets.targets[target]?.[key]
  if (lib.type !== 'package' || !entry) continue
  // Build-time tools (the trimmer) put nothing in the exe.
  const ships = [entry.runtime, entry.native, entry.runtimeTargets]
    .flatMap((group) => Object.keys(group ?? {}))
    .some((file) => !file.endsWith('/_._'))
  if (!ships) continue
  const folder = join(packagesRoot, lib.path)
  const files = (lib.files ?? []).filter((f) => /^(license|licence|third-party-notices)[^/]*$/i.test(f))
  const nuspec = (lib.files ?? []).find((f) => f.endsWith('.nuspec'))
  const spec = nuspec ? read(folder, nuspec) : ''
  const expression = /<license type="expression">([^<]+)</.exec(spec)?.[1]
  if (!files.length && !expression) throw new Error(`no licence found for ${key}`)
  for (const f of files) licences += section(`${key.replace('/', ' ')} - ${f}`, read(folder, f))
  if (!files.length) {
    if (!/(^|[^A-Za-z])MIT([^A-Za-z]|$)/.test(expression)) throw new Error(`${key}: licence ${expression} has no text to ship`)
    const holder =
      /<copyright>([^<]+)</.exec(spec)?.[1]?.trim() ||
      `Copyright (c) ${/<authors>([^<]+)</.exec(spec)?.[1]?.trim() ?? 'its authors'}`
    licences += section(`${key.replace('/', ' ')} - MIT licence (package licence: ${expression})`, mit(holder))
  }
}
licences += section(`.NET ${runtimeVersion} runtime - LICENSE.TXT`, read(runtimeFolder, 'LICENSE.TXT'))
licences += section(`.NET ${runtimeVersion} runtime - THIRD-PARTY-NOTICES.TXT`, read(runtimeFolder, 'THIRD-PARTY-NOTICES.TXT'))
writeFileSync(join(dist, 'LICENSE'), read(here, 'LICENSE'))
writeFileSync(join(dist, 'LICENSES-THIRD-PARTY.txt'), licences.replace(/\r\n/g, '\n'))
const version = /<Version>([^<]+)<\/Version>/.exec(read(here, 'PlayOutPs5Pkg.csproj'))?.[1] ?? 'unknown'
writeFileSync(
  join(dist, 'playout-ps5pkg-version.txt'),
  `PlayOutPs5Pkg ${version}\nSource ${SOURCE_URL}\nPS5PKGTool ${ps5Commit}\nProsperoPkgTool ${pptCommit}\n.NET ${runtimeVersion}\nbuilt ${new Date().toISOString()}\n`
)
// 6. The complete corresponding source, for the helper's release: this folder (without vendor/, bin, obj, dist) and
// exactly the upstream source that is compiled (PS5PKGTool's Core, Ffpfsc and Ufs2 projects with its licence and
// notices; ProsperoPkgTool's engine as built here: without Keys\*.bin and right.sprx). No upstream binaries.
const sourceDir = join(here, 'obj', 'source')
const sourceZip = join(here, 'obj', `PlayOutPs5Pkg-${version}-source.zip`)
rmSync(sourceDir, { recursive: true, force: true })
rmSync(sourceZip, { force: true })
const own = join(sourceDir, 'ps5pkg-helper')
mkdirSync(own, { recursive: true })
for (const name of readdirSync(here))
  if (!['vendor', 'bin', 'obj', 'dist'].includes(name)) cpSync(join(here, name), join(own, name), { recursive: true })
for (const project of ['PS5PKGTool.Core', 'PS5PKGTool.Ffpfsc', 'PS5PKGTool.Ufs2'])
  cpSync(join(ps5, project), join(own, 'vendor', 'PS5PKGTool', project), {
    recursive: true,
    filter: (p) => !/[\\/](bin|obj)([\\/]|$)/.test(p)
  })
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'])
  copyFileSync(join(ps5, file), join(own, 'vendor', 'PS5PKGTool', file))
cpSync(join(ppt, 'ProsperoPkgTool'), join(own, 'vendor', 'ProsperoPkgTool', 'ProsperoPkgTool'), {
  recursive: true,
  filter: (p) => !/[\\/](bin|obj|out)([\\/]|$)/.test(p)
})
for (const file of ['LICENSE', 'README.md', 'Directory.Build.props'])
  if (existsSync(join(ppt, file))) copyFileSync(join(ppt, file), join(own, 'vendor', 'ProsperoPkgTool', file))
writeFileSync(
  join(own, 'vendor', 'SOURCE.txt'),
  `Upstream source compiled into PlayOutPs5Pkg ${version} (only what is built; no binaries):\n` +
    `PS5PKGTool ${PS5PKGTOOL.repo} at ${ps5Commit}\n` +
    `ProsperoPkgTool ${PROSPEROPKGTOOL.repo} at ${pptCommit}, its EmbeddedResource lines and Keys\\*.bin / Resources\\right.sprx removed.\n` +
    `Build: the ProsperoPkgTool.dll built from vendor/ProsperoPkgTool goes in place of PS5PKGTool's prebuilt one\n` +
    `(vendor/PS5PKGTool/PS5PKGTool/ThirdParty/ProsperoPkgTool/ProsperoPkgTool.dll), as build.mjs does.\n`
)
for (const file of walk(own))
  // Source only: no binaries of any kind (the .cs loaders that name those libraries are source and stay).
  if (/\.(dll|exe|bin|sprx|pdb|so|dylib|nupkg|zip|7z)$/i.test(file) || /oo2core|libscepubtools/i.test(file))
    throw new Error(`${file} must not be in the source archive`)
// Windows' own tar (bsdtar) writes zip archives; a GNU tar earlier on PATH (Git's) cannot.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
execFileSync(tar, ['-a', '-c', '-f', sourceZip, '-C', sourceDir, 'ps5pkg-helper'], { stdio: 'inherit' })
console.log(`PlayOutPs5Pkg ${version} built in ${dist}; source archive ${sourceZip}`)
