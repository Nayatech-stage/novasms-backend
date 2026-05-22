import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    // Prefer a PENDING send so webhook processing has visible effect
    let send = await prisma.send.findFirst({
      where: { status: 'PENDING' },
      include: { campaign: true, contact: true },
    });

    if (!send) {
      send = await prisma.send.findFirst({ include: { campaign: true, contact: true } });
    }

    if (!send) {
      console.error('No send rows found in the database.');
      process.exit(2);
    }

    console.log(JSON.stringify({
      campaignId: send.campaignId,
      contactId: send.contactId,
      campaignName: send.campaign?.name ?? null,
      contactEmail: send.contact?.email ?? null,
      sendStatus: send.status,
    }, null, 2));
  } catch (err) {
    console.error('Error querying Prisma:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
