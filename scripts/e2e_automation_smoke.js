/* E2E smoke test script for Automations (local, uses Prisma + compiled dist AutomationsService)
 * Usage: node scripts/e2e_automation_smoke.js
 */

const { PrismaClient } = require('@prisma/client');
const path = require('path');

async function run() {
  const prisma = new PrismaClient();
  try {
    console.log('Connecting to database...');
    await prisma.$connect();

    // Create a temporary account
    const adminEmail = `e2e+${Date.now()}@example.com`;
    const account = await prisma.account.create({
      data: {
        companyName: 'E2E Company',
        adminEmail,
        passwordHash: 'e2e-hash',
        country: 'CI',
        creditBalance: 0,
        emailVerified: true,
      },
    });

    console.log('Created account', account.id, account.adminEmail);

    // Create a contact
    const contact = await prisma.contact.create({
      data: {
        accountId: account.id,
        email: `contact+${Date.now()}@example.com`,
        firstName: 'E2E',
        lastName: 'Contact',
        phone: null,
        tags: [],
      },
    });

    console.log('Created contact', contact.id);

    // Create an automation (active)
    const automation = await prisma.automation.create({
      data: {
        accountId: account.id,
        name: 'Bienvenue E2E',
        trigger: 'contact_added',
        delaySeconds: 0,
        channel: 'Email',
        status: 'Active',
        sendCount: 0,
      },
    });

    console.log('Created automation', automation.id);

    // Load compiled AutomationsService
    const automationsModulePath = path.join(__dirname, '..', 'dist', 'src', 'automations', 'automations.service');
    let AutomationsService;
    try {
      AutomationsService = require(automationsModulePath).AutomationsService;
    } catch (e) {
      // fallback to dist relative to cwd
      AutomationsService = require('../../dist/src/automations/automations.service').AutomationsService;
    }

    // Mocks for provider factories
    const emailFactoryMock = { getProvider: () => ({ send: async (to, subject, html) => { console.log('[MOCK EMAIL SEND]', to, subject); return { success: true }; } }) };
    const smsFactoryMock = { getProvider: () => ({ send: async (to, msg) => { console.log('[MOCK SMS SEND]', to, msg); return { success: true }; } }) };

    // queue mock that will call the execution immediately
    let serviceRef = null;
    const queueMock = {
      add: async (name, data, opts) => {
        console.log('[MOCK QUEUE] add', name, data, opts);
        // Simulate async worker processing
        setTimeout(async () => {
          try {
            await serviceRef.executeQueuedAutomation(data);
          } catch (err) {
            console.error('Error executing queued automation:', err);
          }
        }, 50);
        return { id: data.executionId };
      },
    };

    // instantiate the service
    const service = new AutomationsService(prisma, emailFactoryMock, smsFactoryMock, queueMock);
    serviceRef = service;

    // trigger scheduling like the app would (contact added)
    await service.scheduleContactAddedAutomations({ accountId: account.id, contactId: contact.id, contact });

    console.log('Scheduling done, waiting for execution...');

    // wait and verify
    await new Promise((r) => setTimeout(r, 1000));

    const exec = await prisma.workflowExecution.findFirst({ where: { automationId: automation.id, contactId: contact.id } });
    const updatedAutomation = await prisma.automation.findUnique({ where: { id: automation.id } });

    console.log('Execution row:', exec);
    console.log('Updated automation sendCount:', updatedAutomation.sendCount);

    if (exec && exec.status === 'Completed' && updatedAutomation.sendCount > 0) {
      console.log('E2E smoke SUCCESS');
      process.exit(0);
    }

    console.error('E2E smoke FAILED');
    process.exit(2);
  } catch (err) {
    console.error('E2E smoke error:', err);
    process.exit(3);
  } finally {
    try { await prisma.$disconnect(); } catch {}
  }
}

run();
