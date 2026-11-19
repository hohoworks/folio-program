import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const managedAsset = /^assets\/(?:books|projects|site)\/[\w-]+\/[\w.-]+\.(?:png|jpe?g|webp)$/i;
const hash = bytes => createHash('sha1').update(bytes).digest('hex');

export async function createLocalStore(contentDirectory, stateDirectory) {
  const content = await realpath(contentDirectory);
  const stateDir = resolve(stateDirectory);
  const catalogPath = join(content, 'catalog.json');
  if (stateDir === content || stateDir.startsWith(content + sep)) throw new Error('임시 저장 폴더는 공개 폴더 밖에 지정해주세요.');
  if (!(await lstat(catalogPath)).isFile()) throw new Error('공개 폴더의 catalog.json을 확인해주세요.');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const state = await realpath(stateDir);
  if (state === content || state.startsWith(content + sep)) {
    throw new Error('임시 저장 폴더가 공개 폴더 안에 있습니다.');
  }
  if ((await lstat(state)).dev !== (await lstat(content)).dev) {
    throw new Error('안전하게 저장하려면 임시 저장 폴더와 사이트 폴더를 같은 디스크에 두세요.');
  }

  async function assetPath(relative, createParents = false) {
    if (!managedAsset.test(relative)) throw new Error('잘못된 이미지 경로입니다.');
    const parts = relative.split('/');
    const name = parts.pop();
    let directory = content;
    for (const part of parts) {
      directory = join(directory, part);
      if (createParents) await mkdir(directory, { recursive: true });
      if (!(await lstat(directory)).isDirectory()) throw new Error('이미지 폴더를 확인해주세요.');
    }
    return join(directory, name);
  }

  let pending = Promise.resolve();
  return {
    async snapshot() {
      const bytes = await readFile(catalogPath);
      return { head: hash(bytes), catalog: JSON.parse(bytes) };
    },
    async stage(bytes) {
      const sha = hash(bytes);
      const temporary = join(state, randomUUID() + '.tmp');
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      try {
        await link(temporary, join(state, sha));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        await rm(temporary, { force: true });
      }
      return sha;
    },
    async readAsset(path) {
      const file = await assetPath(path);
      if (!(await lstat(file)).isFile()) throw new Error('이미지 파일을 확인해주세요.');
      return readFile(file);
    },
    publish(head, catalog, entries, removed) {
      const result = pending.then(async () => {
        if (hash(await readFile(catalogPath)) !== head) return null;
        const data = JSON.stringify(catalog, null, 2) + '\n';
        const temporary = join(state, randomUUID() + '.tmp');
        const newFiles = [];
        try {
          for (const { path, sha } of entries) {
            if (!path.startsWith('dist/') || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('이미지를 확인해주세요.');
            const file = await assetPath(path.slice(5), true);
            try {
              await copyFile(join(state, sha), file, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
              newFiles.push(file);
            } catch (error) {
              if (error.code !== 'EEXIST' || !(await lstat(file)).isFile() || hash(await readFile(file)) !== sha) throw error;
            }
          }
          await writeFile(temporary, data, { flag: 'wx', flush: true });
          // The public catalog is the commit point. Readers always see complete assets.
          await rename(temporary, catalogPath);
        } catch (error) {
          await Promise.all(newFiles.map(file => rm(file, { force: true })));
          throw error;
        } finally {
          await rm(temporary, { force: true });
        }
        for (const path of new Set(removed.filter(path => managedAsset.test(path)))) {
          try {
            await rm(await assetPath(path), { force: true });
          } catch (error) {
            if (error.code !== 'ENOENT') console.warn('이전 이미지 정리를 다음에 확인해주세요.', path);
          }
        }
        return hash(data);
      });
      pending = result.catch(() => {});
      return result;
    },
  };
}
