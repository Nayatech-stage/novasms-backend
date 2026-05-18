const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getToken() {
  const account = await prisma.account.findUnique({
    where: { adminEmail: 'test@example.ci' },
    select: { confirmationToken: true }
  });
  
  console.log(account?.confirmationToken || 'Token not found');
  await prisma.$disconnect();
}

getToken();
