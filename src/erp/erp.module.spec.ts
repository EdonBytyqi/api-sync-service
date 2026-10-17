import { Test } from '@nestjs/testing';
import { ErpClient } from './erp-client.js';
import { ERP_CONFIG, ErpModule } from './erp.module.js';

describe('ErpModule', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('AK-7.1 stellt einen ErpClient mit der Konfiguration aus der Umgebung bereit', async () => {
    vi.stubEnv('ERP_BASE_URL', 'http://erp.test:4000');

    const moduleRef = await Test.createTestingModule({
      imports: [ErpModule],
    }).compile();

    expect(moduleRef.get(ErpClient)).toBeInstanceOf(ErpClient);
    expect(moduleRef.get(ERP_CONFIG)).toMatchObject({
      baseUrl: 'http://erp.test:4000',
    });
  });

  it('AK-8.2 mit ungültiger Konfiguration startet das Modul nicht', async () => {
    vi.stubEnv('ERP_TIMEOUT_MS', 'abc');

    await expect(
      Test.createTestingModule({ imports: [ErpModule] }).compile(),
    ).rejects.toThrow('ERP_TIMEOUT_MS="abc" must be a positive integer');
  });
});
