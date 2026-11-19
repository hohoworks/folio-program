import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { programPin } from '../templates/content/build-site.mjs';

const run = promisify(execFile);
const repo = new URL('../', import.meta.url);

test('a program pin must name a GitHub repository and immutable commit', () => {
  const commit = 'AB'.repeat(20);
  assert.deepEqual(programPin('studio/site', commit), { url: 'https://github.com/studio/site.git', commit: commit.toLowerCase() });
  for (const invalid of ['', 'https://github.com/studio/site', 'studio/..', 'other.example/path/site']) {
    assert.throws(() => programPin(invalid, commit), /REPOSITORY/);
  }
  for (const invalid of ['', undefined, 'main', 'a'.repeat(39)]) {
    assert.throws(() => programPin('studio/site', invalid), /COMMIT/);
  }
});

test('private checkout builds with the pinned public program without sending credentials to git', async t => {
  const work = await mkdtemp(join(tmpdir(), 'folio-bootstrap-test-'));
  t.after(() => rm(work, { force: true, recursive: true }));
  const source = join(work, 'application');
  const remote = join(work, 'public-app.git');
  const content = join(work, 'private');
  const bin = join(work, 'bin');
  const realGit = (await run('which', ['git'])).stdout.trim();
  const git = (...args) => run(realGit, args, { cwd: source, env: {
    PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  } });
  await Promise.all([mkdir(join(source, 'dist/assets'), { recursive: true }), mkdir(join(source, 'scripts'), { recursive: true }),
    mkdir(join(content, 'dist/assets/projects/work'), { recursive: true }), mkdir(bin)]);
  for (const name of (await readdir(new URL('dist/', repo))).filter(name => /\.(?:html|css|js)$/.test(name) || name === '_headers')) {
    await cp(new URL('dist/' + name, repo), join(source, 'dist', name));
  }
  await cp(new URL('dist/assets/folio.svg', repo), join(source, 'dist/assets/folio.svg'));
  for (const name of ['build-public.mjs', 'check-site.mjs']) {
    await cp(new URL('scripts/' + name, repo), join(source, 'scripts', name));
  }
  await writeFile(join(source, '.folio-split-program'), '');
  await writeFile(join(source, 'dist/index.html'), 'pinned edition');
  await git('init', '--quiet', '--template=');
  await git('add', '.');
  await git('commit', '--quiet', '-m', 'First edition');
  const commit = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(source, 'dist/index.html'), 'newer edition');
  await git('commit', '--quiet', '-am', 'Second edition');
  await git('clone', '--quiet', '--bare', source, remote);

  await cp(new URL('templates/content/build-site.mjs', repo), join(content, 'build-site.mjs'));
  const picture = 'assets/projects/work/photo.webp';
  await writeFile(join(content, 'dist', picture), 'public photo');
  await writeFile(join(content, 'dist/private-note.txt'), 'private note');
  await writeFile(join(content, 'dist/catalog.json'), JSON.stringify({ books: [], projects: [
    { id: 'visible', title: 'Published', images: [{ imageSrc: picture }] },
    { id: 'draft', title: 'Unpublished', published: false, images: [] },
  ] }));

  // Replace only the network transport with a local bare repository. Git still fetches and verifies the SHA.
  const shim = join(bin, 'git');
  await writeFile(shim, `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (process.env.GITHUB_TOKEN || process.env.GIT_ASKPASS || process.env.GIT_CONFIG_COUNT || process.env.GIT_DIR) process.exit(90);
if (args.includes('fetch')) {
  const remoteAt = args.indexOf('https://github.com/fixture/program.git');
  if (remoteAt === -1 || process.env.GIT_ALLOW_PROTOCOL !== 'https') process.exit(91);
  args[remoteAt] = ${JSON.stringify(remote)};
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' }, stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
  await chmod(shim, 0o755);
  const build = sha => run(process.execPath, [join(content, 'build-site.mjs')], { cwd: content, env: {
    PATH: bin + delimiter + process.env.PATH,
    FOLIO_PROGRAM_REPOSITORY: 'fixture/program', FOLIO_PROGRAM_COMMIT: sha,
    GITHUB_TOKEN: 'fixture-only', GIT_CONFIG_COUNT: '1', GIT_ASKPASS: 'fixture-only', GIT_DIR: 'private-checkout',
  } });
  await build(commit);
  const output = join(content, 'public-site');
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'pinned edition');
  assert.equal(await readFile(join(output, picture), 'utf8'), 'public photo');
  assert.deepEqual(JSON.parse(await readFile(join(output, 'catalog.json'))).projects.map(item => item.id), ['visible']);
  await assert.rejects(readFile(join(output, 'private-note.txt')), { code: 'ENOENT' });
  await assert.rejects(readdir(join(output, '.git')), { code: 'ENOENT' });
  await assert.rejects(build('0'.repeat(40)));
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'pinned edition');
});
