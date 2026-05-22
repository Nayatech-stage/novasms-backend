(async ()=>{
  try{
    require('dotenv').config({path: './.env'});
    const {PrismaClient} = require('@prisma/client');
    const prisma = new PrismaClient();
    const jwt = require('jsonwebtoken');
    const fetch = global.fetch || require('node-fetch');

    const accountEmail = 'romualdndri9@gmail.com';
    let account = await prisma.account.findUnique({ where: { adminEmail: accountEmail } });
    if (!account) throw new Error('Account not found');
    const segment = await prisma.segment.findFirst({ where: { accountId: account.id, name: 'Smoke Test Segment' } });
    if (!segment) throw new Error('Segment not found');

    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'secret';
    const token = jwt.sign({ sub: account.id, email: account.adminEmail }, secret, { expiresIn: '8h' });

    const apiBase = 'http://localhost:3000/api';
    const smsPayload = { channelType: 'SMS', name: 'Smoke Test SMS', segmentId: segment.id, smsContent: { message: 'Test SMS message. Reply STOP to unsubscribe.' }, content: 'Test SMS message. Reply STOP to unsubscribe.' };

    let res = await fetch(apiBase + '/campaigns', { method: 'POST', body: JSON.stringify(smsPayload), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const createdSms = await res.json();
    console.log('Create sms campaign response', createdSms);
    const smsId = createdSms.id || (createdSms.data && createdSms.data.id);
    if (!smsId) { console.error('Failed to create sms campaign'); process.exit(1); }

    res = await fetch(apiBase + `/campaigns/${smsId}/send`, { method: 'POST', body: JSON.stringify({ immediateOrScheduled: 'immediate' }), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } });
    const smsSend = await res.json();
    console.log('SMS send response', smsSend);

    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
