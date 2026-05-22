import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportService } from '../src/contacts/import.service';
import { initImportWorker } from '../src/queues/import.queue';

describe('Import Worker E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let importService: ImportService;
  let authToken: string;
  let accountId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    importService = moduleFixture.get<ImportService>(ImportService);

    // Initialize worker in-process
    initImportWorker(importService);

    // Create account
    const res = await request(app.getHttpServer()).post('/auth/register').send({
      companyName: 'Import Test Co',
      adminEmail: `import-test-${Date.now()}@test.local`,
      password: 'Test123!@#',
      country: 'CI',
    });

    accountId = res.body.account.id;
    authToken = res.body.access_token;
  }, 20000);

  afterAll(async () => {
    if (prisma && accountId) {
      await prisma.contact.deleteMany({ where: { accountId } });
      await prisma.importReport.deleteMany({ where: { accountId } });
    }
    await app.close();
  });

  it('processes an import job end-to-end', async () => {
    const rows = [
      { email: `a-${Date.now()}@test.local`, firstName: 'A', lastName: 'One' },
      { phone: '22812345678', firstName: 'B', lastName: 'Two' },
    ];

    const fileName = `import-test-${Date.now()}.csv`;

    const start = await importService.startImport(accountId, fileName, rows);
    expect(start.success).toBe(true);

    // Poll for report
    const maxMs = 20000;
    const startMs = Date.now();
    let report: any = null;
    while (Date.now() - startMs < maxMs) {
      // eslint-disable-next-line no-await-in-loop
      report = await prisma.importReport.findFirst({ where: { accountId, fileName } });
      if (report) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(report).toBeTruthy();
    expect(report.totalRecords).toBeGreaterThanOrEqual(2);
  }, 30000);
});
