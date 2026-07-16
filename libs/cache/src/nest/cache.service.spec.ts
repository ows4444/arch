import { CacheService } from './cache.service';
import { Cache } from '../core/cache.interface';

function fakeCache(): jest.Mocked<Cache<string, string>> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    size: jest.fn(),
    keys: jest.fn(),
    values: jest.fn(),
    entries: jest.fn(),
  };
}

describe('CacheService', () => {
  it('get() delegates to the injected cache', async () => {
    const cache = fakeCache();
    cache.get.mockResolvedValue('value');
    const service = new CacheService(cache);

    await expect(service.get('key')).resolves.toBe('value');
    expect(cache.get).toHaveBeenCalledWith('key');
  });

  it('set() delegates to the injected cache with an empty options object when no ttl is given', async () => {
    const cache = fakeCache();
    const service = new CacheService(cache);

    await service.set('key', 'value');

    expect(cache.set).toHaveBeenCalledWith('key', 'value', {});
  });

  it('set() delegates to the injected cache with a ttl option when supplied', async () => {
    const cache = fakeCache();
    const service = new CacheService(cache);

    await service.set('key', 'value', 5000);

    expect(cache.set).toHaveBeenCalledWith('key', 'value', { ttl: 5000 });
  });

  it('delete() delegates to the injected cache', async () => {
    const cache = fakeCache();
    cache.delete.mockResolvedValue(true);
    const service = new CacheService(cache);

    await expect(service.delete('key')).resolves.toBe(true);
    expect(cache.delete).toHaveBeenCalledWith('key');
  });

  it('clear() delegates to the injected cache', async () => {
    const cache = fakeCache();
    const service = new CacheService(cache);

    await service.clear();

    expect(cache.clear).toHaveBeenCalled();
  });

  it('has() delegates to the injected cache', async () => {
    const cache = fakeCache();
    cache.has.mockResolvedValue(true);
    const service = new CacheService(cache);

    await expect(service.has('key')).resolves.toBe(true);
    expect(cache.has).toHaveBeenCalledWith('key');
  });
});
