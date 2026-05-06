const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = process.argv[2] || 'romualdndri9@gmail.com';
    const acc = await prisma.account.findUnique({ where: { adminEmail: email } });
    if (!acc) {
      console.log(`Account not found for ${email}`);
      return;
    }
    console.log('Account:', {
      id: acc.id,
      adminEmail: acc.adminEmail,
      twoFactorEnabled: acc.twoFactorEnabled,
      twoFactorSecretSet: !!acc.twoFactorSecret,
      twoFactorCode: acc.twoFactorCode,
      twoFactorCodeExpiry: acc.twoFactorCodeExpiry,
      backupCodesCount: Array.isArray(acc.backupCodes) ? acc.backupCodes.length : 0,
    });
  } catch (err) {
    console.error('Error:', err);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

main();
