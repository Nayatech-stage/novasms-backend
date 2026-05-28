(async () => {
  try {
    require('dotenv').config({ path: './.env' });
    const { PrismaClient } = require('@prisma/client');
    const jwt = require('jsonwebtoken');
    const fetch = global.fetch || require('node-fetch');

    const prisma = new PrismaClient();
    const apiBase = 'http://localhost:3000/api';
    const accountEmail = 'romualdndri9@gmail.com';
    const recipientEmail = process.env.RESEND_TEST_RECIPIENT || accountEmail;

    let account = await prisma.account.findUnique({
      where: { adminEmail: accountEmail },
    });

    if (!account) {
      account = await prisma.account.create({
        data: {
          companyName: 'Romuald Test Co',
          adminEmail: accountEmail,
          passwordHash: 'fakehash',
          country: 'CIV',
        },
      });
      console.log('Created account', account.id);
    } else {
      console.log('Found account', account.id);
    }

    const contact = await prisma.contact.upsert({
      where: {
        accountId_email: {
          accountId: account.id,
          email: recipientEmail,
        },
      },
      update: {
        optOut: false,
        firstName: 'Romuald',
        lastName: 'Test',
      },
      create: {
        accountId: account.id,
        email: recipientEmail,
        firstName: 'Romuald',
        lastName: 'Test',
        optOut: false,
      },
    });
    console.log('Using recipient contact', contact.id, recipientEmail);

    const segmentName = 'Email Smoke Single Recipient';
    let segment = await prisma.segment.findFirst({
      where: { accountId: account.id, name: segmentName },
    });

    const segmentData = {
      accountId: account.id,
      name: segmentName,
      type: 'static',
      criteria: { contactIds: [contact.id] },
      contactCount: 1,
      lastCalculated: new Date(),
    };

    if (!segment) {
      segment = await prisma.segment.create({ data: segmentData });
    } else {
      segment = await prisma.segment.update({
        where: { id: segment.id },
        data: segmentData,
      });
    }
    console.log('Using segment', segment.id);

    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'secret';
    const token = jwt.sign(
      { sub: account.id, email: account.adminEmail },
      secret,
      { expiresIn: '8h' },
    );

    const emailPayload = {
      channelType: 'EMAIL',
      name: 'Smoke Test Email',
      segmentId: segment.id,
      emailContent: {
        subject: '[SMOKE] NovaSMS email delivery test',
        preheader: 'This email should arrive in the exact destination mailbox',
        blocks: [
          {
            id: 'blk-1',
            type: 'text',
            content: {
              text: `Hello, this is a delivery test for ${recipientEmail}.`,
              fontSize: 14,
            },
          },
        ],
      },
      content: `Hello, this is a delivery test for ${recipientEmail}.`,
    };

    const createRes = await fetch(apiBase + '/campaigns', {
      method: 'POST',
      body: JSON.stringify(emailPayload),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
    });
    const created = await createRes.json();
    console.log('Create email campaign response', created);

    const campaignId = created.id || (created.data && created.data.id);
    if (!campaignId) {
      throw new Error('Failed to create email campaign');
    }

    const sendRes = await fetch(apiBase + `/campaigns/${campaignId}/send`, {
      method: 'POST',
      body: JSON.stringify({ immediateOrScheduled: 'immediate' }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
    });
    const sendResponse = await sendRes.json();
    console.log('Email send response', sendResponse);

    let finalSend = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const sendRows = await prisma.send.findMany({
        where: { campaignId },
        select: { status: true, sentAt: true, bouncedReason: true, contactId: true },
      });
      if (sendRows.length > 0) {
        finalSend = sendRows[0];
        if (finalSend.status !== 'PENDING') break;
      }
    }

    const finalCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true, sentCount: true, failedCount: true, updatedAt: true },
    });

    console.log('Final campaign', finalCampaign);
    console.log('Final send', finalSend);
    console.log('Check mailbox for', recipientEmail);

    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Script error', error);
    process.exit(1);
  }
})();