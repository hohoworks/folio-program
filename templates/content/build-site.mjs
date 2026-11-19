import { execFile } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function programPin(repository, commit) {
  if (typeof repository !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(repository) ||
      ['.', '..'].includes(repository.split('/')[1])) {
    throw new Error('FOLIO_PROGRAM_REPOSITORY에 공개 프로그램 저장소를 소유자/이름 형식으로 입력하세요.');
  }
  if (typeof commit !== 'string' || !/^[a-f\d]{40}$/i.test(commit)) {
    throw new Error('FOLIO_PROGRAM_COMMIT에 프로그램 커밋의 전체 SHA 40자리를 입력하세요.');
  }
  return { url: 'https://github.com/' + repository + '.git', commit: commit.toLowerCase() };
}

export async function buildFromPin(contentRoot, pin) {
  const { url, commit } = programPin(pin.repository, pin.commit);
  const root = await realpath(contentRoot);
  const content = join(root, 'dist');
  if (!(await lstat(content)).isDirectory() || !(await lstat(join(content, 'catalog.json'))).isFile()) {
    throw new Error('자료 저장소의 dist/catalog.json을 확인하세요.');
  }
  const program = await mkdtemp(join(tmpdir(), 'folio-program-'));
  const output = join(root, 'public-site');
  try {
    // This fresh checkout has no credentials, inherited Git config or remote for writing.
    const gitEnv = {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'https',
    };
    const git = (...args) => run('git', args, { cwd: program, env: gitEnv, timeout: 180_000 });
    await git('init', '--quiet', '--template=');
    await git('-c', 'credential.helper=', '-c', 'http.extraHeader=Authorization:', '-c', 'http.followRedirects=false',
      'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--depth=1', url, commit);
    await git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
    const head = await git('rev-parse', '--verify', 'HEAD');
    if (head.stdout.trim() !== commit) throw new Error('가져온 프로그램 버전이 지정한 커밋과 다릅니다.');
    const marker = await lstat(join(program, '.folio-split-program')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!marker?.isFile()) throw new Error('분리형 프로그램 폴더를 올린 저장소와 커밋인지 확인하세요.');
    const builder = join(program, 'scripts', 'build-public.mjs');
    const { stdout } = await run(process.execPath, [builder], { cwd: program, env: {
      PATH: process.env.PATH, FOLIO_CONTENT_DIR: content, FOLIO_PUBLIC_OUTPUT: output,
    } });
    for (const name of ['index.html', '_headers', 'catalog.json']) {
      if (!(await lstat(join(output, name))).isFile()) throw new Error('방문자용 파일이 준비되지 않았습니다. ' + name);
    }
    process.stdout.write(stdout);
  } finally {
    await rm(program, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await buildFromPin(dirname(fileURLToPath(import.meta.url)), {
      repository: process.env.FOLIO_PROGRAM_REPOSITORY,
      commit: process.env.FOLIO_PROGRAM_COMMIT,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
