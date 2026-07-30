/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  const password = 'TempPass123!';
  const hashed = await bcrypt.hash(password, 12);

  // Upsert account for e2e tests
  const adminEmail = 'novatest_20260507@example.com';
  let account = await prisma.account.findUnique({ where: { adminEmail } });
  if (!account) {
    account = await prisma.account.create({
      data: {
        companyName: 'NovaSMS Test Boutique',
        adminEmail,
        passwordHash: hashed,
        country: 'CI',
        creditBalance: 0,
        emailVerified: true,
        onboardingCompleted: true,
      },
    });
    console.log('Created account', account.id);
  } else {
    console.log('Account exists', account.id);
  }

  // Create user for that account
  let user = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        accountId: account.id,
        email: adminEmail,
        passwordHash: hashed,
        role: 'Admin',
      },
    });
    console.log('Created user', user.id);
  } else {
    console.log('User exists', user.id);
  }

  // Create contact with expected id/email for e2e test
  const contactId = 'e6bd871b-3ee6-4529-8131-b82a24947c9c';
  let contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        id: contactId,
        accountId: account.id,
        email: 'ui-test@example.com',
        phone: '+22501020304',
        firstName: 'UI',
        lastName: 'Test',
      },
    });
    console.log('Created contact', contact.id);
  } else {
    console.log('Contact exists', contact.id);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
